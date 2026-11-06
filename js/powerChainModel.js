// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* The power chain (IFC-CORE-DELTAS power-2/3): one board (panelName, mainsConfig,
   main breaker, interruptingKA — the breakers' breaking capacity, kA, null until declared), its branch
   circuits, and the LOADS they feed. A load is an occurrence of a BIM part
   ({id, part, name, circuit | fedBy, rack, watts, heatW, weightKg, powerFactor,
   parts}): `circuit` when it is wired to a breaker, `fedBy` (a load id) when it is
   plugged into a PDU; watts / heatW / weightKg / powerFactor only when this
   occurrence declares its own (the part's IFC type says the rest, powerRollup.js);
   `parts` the components of a kit. A circuit's VA is derived from its loads
   (W / PF); a circuit with no loads yet keeps its typed loadsVA as a PLANNED figure,
   so a designer can plan before any device is chosen. Saved as this block and its
   IFC4X3_ADD2 twin (ifc/powerToIfc.js), read back by ifc/ifcToPower.js. */

import { rollup } from './powerRollup.js';

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A load as the block stores it: every key present, null when not declared. */
export function normalizeLoad(l, i = 0) {
  const out = {
    id: String(l.id ?? `load_${i + 1}`),
    part: l.part ? String(l.part) : null,
    name: l.name != null ? String(l.name) : null,
    circuit: l.circuit ? String(l.circuit) : null,
    fedBy: l.fedBy ? String(l.fedBy) : null,
    rack: l.rack ? String(l.rack) : null,
    watts: n(l.watts),
    heatW: n(l.heatW),
    weightKg: n(l.weightKg),
    powerFactor: n(l.powerFactor),
  };
  if (Array.isArray(l.parts) && l.parts.length) out.parts = l.parts.map(normalizeComponent);
  return out;
}

/** A component of a kit load: {part, name, watts, heatW, weightKg}. */
export function normalizeComponent(c) {
  return {
    part: c.part ? String(c.part) : null,
    name: c.name != null ? String(c.name) : null,
    watts: n(c.watts),
    heatW: n(c.heatW),
    weightKg: n(c.weightKg),
  };
}

export class PowerChainModel {
  constructor(initialData = null) {
    this.id = initialData?.id || `power_${Date.now()}`;
    this.name = initialData?.name || 'Technical Power Distribution';
    this.panelName = initialData?.panelName || 'PANEL-EP1';
    this.mainsConfig = initialData?.mainsConfig || '120/208V 3-Phase 4-Wire';
    this.mainBreakerAmps = initialData?.mainBreakerAmps || 200;
    // the breakers' breaking capacity (UL 489 interrupting rating / IEC 60947-2 Icu), kA. NO default
    // (ROAD-3598 answer 11): unknown until declared, and apk-av.ids flags a breaker that states none
    this.interruptingKA = n(initialData?.interruptingKA);
    this.boardWeightKg = n(initialData?.boardWeightKg);
    this.loads = (initialData?.loads || []).map(normalizeLoad);
    /** partId → partFacts (powerRollup.js) of the BIM part's IFC type; read, never saved */
    this.partFacts = new Map();

    this.circuits = initialData?.circuits || [
      { id: 'ckt_1', number: 1, phase: 'A', breakerAmps: 20, volts: 120, label: 'Audio Console Feed A', loadsVA: 1400, redundantGroup: 'CONSOLE' },
      { id: 'ckt_2', number: 2, phase: 'B', breakerAmps: 20, volts: 120, label: 'Audio Console Feed B', loadsVA: 1400, redundantGroup: 'CONSOLE' },
      { id: 'ckt_3', number: 3, phase: 'C', breakerAmps: 20, volts: 120, label: 'Core DSP Frame 1', loadsVA: 850, redundantGroup: 'DSP' },
      { id: 'ckt_4', number: 4, phase: 'A', breakerAmps: 20, volts: 120, label: 'Core DSP Frame 2 (Redundant)', loadsVA: 850, redundantGroup: 'DSP' },
      { id: 'ckt_5', number: 5, phase: 'B', breakerAmps: 20, volts: 120, label: 'Video Switcher Frame PSU-1', loadsVA: 1800, redundantGroup: 'VISION' },
      { id: 'ckt_6', number: 6, phase: 'C', breakerAmps: 20, volts: 120, label: 'Video Switcher Frame PSU-2', loadsVA: 1800, redundantGroup: 'VISION' },
      { id: 'ckt_7', number: 7, phase: 'A', breakerAmps: 30, volts: 208, label: 'High-Power Amp Rack Left', loadsVA: 3200, redundantGroup: 'AMPS' },
      { id: 'ckt_8', number: 8, phase: 'B', breakerAmps: 30, volts: 208, label: 'High-Power Amp Rack Right', loadsVA: 3200, redundantGroup: 'AMPS' },
      { id: 'ckt_9', number: 9, phase: 'C', breakerAmps: 20, volts: 120, label: 'Production Workstations', loadsVA: 1100, redundantGroup: null },
      { id: 'ckt_10', number: 10, phase: 'A', breakerAmps: 20, volts: 120, label: 'Unassigned Spare', loadsVA: 0, redundantGroup: null },
    ];

    this.selectedCircuitId = null;
    this._circuitCounter = this.circuits.length + 1;
  }

  addCircuit(circuit) {
    const id = circuit.id || `ckt_${this._circuitCounter++}`;
    const nextNum = Math.max(0, ...this.circuits.map((c) => c.number || 0)) + 1;
    const phases = ['A', 'B', 'C'];
    const autoPhase = phases[(nextNum - 1) % 3];

    const newCircuit = {
      id,
      number: circuit.number || nextNum,
      phase: circuit.phase || autoPhase,
      breakerAmps: circuit.breakerAmps || 20,
      volts: circuit.volts || 120,
      label: circuit.label || `Technical Load ${nextNum}`,
      loadsVA: circuit.loadsVA || 600,
      redundantGroup: circuit.redundantGroup || null,
    };
    this.circuits.push(newCircuit);
    return newCircuit;
  }

  updateCircuit(id, updates) {
    const ckt = this.circuits.find((c) => c.id === id);
    if (!ckt) return null;
    Object.assign(ckt, updates);
    return ckt;
  }

  deleteCircuit(id) {
    const idx = this.circuits.findIndex((c) => c.id === id);
    if (idx !== -1) {
      this.circuits.splice(idx, 1);
      for (const l of this.loads) if (l.circuit === id) l.circuit = null;
      if (this.selectedCircuitId === id) this.selectedCircuitId = null;
      return true;
    }
    return false;
  }

  /** A load wired to circuit `circuit` or plugged into load `fedBy`; → the stored load. */
  addLoad(load) {
    const ids = new Set(this.loads.map((l) => l.id));
    let k = this.loads.length + 1;
    while (ids.has(`load_${k}`)) k += 1;
    const l = normalizeLoad({ ...load, id: load.id || `load_${k}` });
    this.loads.push(l);
    return l;
  }

  updateLoad(id, updates) {
    const i = this.loads.findIndex((l) => l.id === id);
    if (i < 0) return null;
    this.loads[i] = normalizeLoad({ ...this.loads[i], ...updates, id });
    return this.loads[i];
  }

  /** Remove a load; what was plugged into it is left unplugged (no circuit, no fedBy). */
  deleteLoad(id) {
    const i = this.loads.findIndex((l) => l.id === id);
    if (i < 0) return false;
    this.loads.splice(i, 1);
    for (const l of this.loads) if (l.fedBy === id) l.fedBy = null;
    return true;
  }

  /** The part facts this model knows (setPartFacts), as powerRollup.js asks for them. */
  facts() {
    return (id) => this.partFacts.get(id) ?? null;
  }

  setPartFacts(id, facts) {
    if (facts) this.partFacts.set(id, facts);
    else this.partFacts.delete(id);
  }

  /** Load, heat, weight and VA per circuit, board and rack (powerRollup.js rollup). */
  rollup() {
    return rollup(this, this.facts());
  }

  /** A circuit's VA: derived from its loads (W / PF), else its planned loadsVA. */
  circuitVA(circuit) {
    if (circuit && circuit.id && this.loads.length) {
      const r = this.rollup().circuits[circuit.id];
      if (r) return r.va ?? 0;
    }
    return circuit.loadsVA || 0;
  }

  calculateCircuitAmps(circuit) {
    const va = this.circuitVA(circuit);
    const v = circuit.volts || 120;
    return Math.round((va / v) * 10) / 10;
  }

  getCircuitCapacityPercent(circuit) {
    const amps = this.calculateCircuitAmps(circuit);
    const maxAmps = (circuit.breakerAmps || 20) * 0.8; // 80% continuous rating
    return Math.round((amps / maxAmps) * 100);
  }

  getPhaseRollup() {
    const totals = { A: 0, B: 0, C: 0 };
    for (const c of this.circuits) {
      const p = c.phase || 'A';
      if (totals[p] !== undefined) {
        totals[p] += this.circuitVA(c);
      }
    }
    const max = Math.max(totals.A, totals.B, totals.C);
    const min = Math.min(totals.A, totals.B, totals.C);
    const avg = (totals.A + totals.B + totals.C) / 3;
    const unbalancePercent = avg > 0 ? Math.round(((max - min) / avg) * 100) : 0;

    return {
      phaseA_VA: totals.A,
      phaseB_VA: totals.B,
      phaseC_VA: totals.C,
      total_VA: totals.A + totals.B + totals.C,
      unbalancePercent,
    };
  }

  checkRedundancyClashes() {
    const groups = {};
    for (const c of this.circuits) {
      if (c.redundantGroup) {
        if (!groups[c.redundantGroup]) groups[c.redundantGroup] = [];
        groups[c.redundantGroup].push(c);
      }
    }

    const clashes = [];
    for (const [groupName, ckts] of Object.entries(groups)) {
      if (ckts.length > 1) {
        // Check if multiple redundant feeds share the same phase or same breaker
        const phases = ckts.map((c) => c.phase);
        const uniquePhases = new Set(phases);
        if (uniquePhases.size < ckts.length) {
          clashes.push({
            group: groupName,
            reason: `Redundant group "${groupName}" feeds share Phase ${phases.join('/')}. Loss of phase causes complete outage.`,
          });
        }
      }
    }
    return clashes;
  }

  toJSON() {
    return {
      type: 'powerchain',
      id: this.id,
      name: this.name,
      panelName: this.panelName,
      mainsConfig: this.mainsConfig,
      mainBreakerAmps: this.mainBreakerAmps,
      interruptingKA: this.interruptingKA,
      boardWeightKg: this.boardWeightKg,
      circuits: this.circuits,
      loads: this.loads,
    };
  }
}
