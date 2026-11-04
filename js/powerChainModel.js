// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export class PowerChainModel {
  constructor(initialData = null) {
    this.id = initialData?.id || `power_${Date.now()}`;
    this.name = initialData?.name || 'Technical Power Distribution';
    this.panelName = initialData?.panelName || 'PANEL-EP1';
    this.mainsConfig = initialData?.mainsConfig || '120/208V 3-Phase 4-Wire';
    this.mainBreakerAmps = initialData?.mainBreakerAmps || 200;

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
      if (this.selectedCircuitId === id) this.selectedCircuitId = null;
      return true;
    }
    return false;
  }

  calculateCircuitAmps(circuit) {
    const va = circuit.loadsVA || 0;
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
        totals[p] += c.loadsVA || 0;
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
      circuits: this.circuits,
    };
  }
}
