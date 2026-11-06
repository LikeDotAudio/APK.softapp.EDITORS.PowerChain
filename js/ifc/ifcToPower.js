// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * OPEN .IFC — a power chain saved by powerToIfc.js read back to the block it was written
 * from, out of the IFC's own words (IFC-CORE-DELTAS power-2: lossless projection):
 *
 *   panelName       the main IfcElectricDistributionBoard's Name (Pset_DistributionBoardOccurrence.IsMain)
 *   mainsConfig     the mains IfcDistributionSystem's LongName
 *   mainBreakerAmps the MAIN breaker's type RatedCurrent;  interruptingKA its ICU60947 / 1000
 *   boardWeightKg   the board's own Qto GrossWeight
 *   circuits        each IfcDistributionCircuit: Name → number, LongName → label, its breaker's
 *                   RatedCurrent → breakerAmps, first ConductorFunction → phase, port Voltage → volts,
 *                   APK_PowerCircuit (CircuitId, PlannedApparentPowerVA → loadsVA), the
 *                   'RedundantFeedGroup' IfcGroup it is in → redundantGroup
 *   loads           each element with APK_PowerLoad.LoadId: Name, APK_PowerLoad.Part, the rack assembly
 *                   that aggregates it; its supply port's IfcRelConnectsPorts gives circuit (a breaker's
 *                   port) or fedBy (another load's outlet); what the OCCURRENCE declares itself (never its
 *                   type's) → watts / heatW / powerFactor / weightKg; aggregated components → parts
 *
 * The roll-ups (APK_PowerRollup, APK_RackQuantities) are derived on export and never read back.
 * → {model: the block, report: {schema, lost: [why]}}.
 */

import { entitiesByType, getPsets, isRef, parseStep, ports, schemaOf, unwrap } from '../../vendor/apk-contracts/apk-ifc.js';
import { boundedNumber, partFacts } from '../powerRollup.js';
import { normalizeComponent, normalizeLoad } from '../powerChainModel.js';

const PHASE_OF = { PHASE_L1: 'A', PHASE_L2: 'B', PHASE_L3: 'C' };
const refsIn = (v) => (Array.isArray(v) ? v.flatMap(refsIn) : isRef(v) ? [v.id] : []);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const numOr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Only the sets attached to the occurrence itself (IfcRelDefinesByProperties), not its type's. */
function ownPsets(file, el, rels) {
  const out = {};
  for (const rel of rels.get(el.id) ?? []) {
    const def = file.byId.get(rel.args[5]?.id);
    if (!def) continue;
    const name = def.args[2];
    const list = def.type === 'IFCELEMENTQUANTITY' ? def.args[5] : def.args[4];
    const props = (out[name] ??= {});
    for (const id of refsIn(list)) {
      const p = file.byId.get(id);
      if (!p) continue;
      if (p.type === 'IFCPROPERTYSINGLEVALUE') props[p.args[0]] = unwrap(p.args[2]);
      else if (p.type === 'IFCPROPERTYENUMERATEDVALUE') props[p.args[0]] = unwrap(p.args[2]);
      else if (p.type === 'IFCPROPERTYBOUNDEDVALUE') props[p.args[0]] = { UpperBoundValue: unwrap(p.args[2]), LowerBoundValue: unwrap(p.args[3]), SetPointValue: unwrap(p.args[5]) };
      else if (p.type.startsWith('IFCQUANTITY')) props[p.args[0]] = unwrap(p.args[3]);
    }
  }
  return out;
}

export function ifcToPower(text) {
  const file = typeof text === 'string' ? parseStep(text) : text;
  const lost = [];
  const schema = schemaOf(file);
  const all = file.entities;
  const rels = new Map(); // object id → [IfcRelDefinesByProperties]
  const aggregates = new Map(); // whole id → [part ids]
  const partOf = new Map(); // part id → whole id
  const groupsOf = new Map(); // member id → [group entity]
  const membersOf = new Map(); // group id → [member ids]
  const nestedIn = new Map(); // port id → owner id
  for (const e of all) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES') for (const id of refsIn(e.args[4])) (rels.get(id) ?? rels.set(id, []).get(id)).push(e);
    else if (e.type === 'IFCRELAGGREGATES') {
      const whole = e.args[4]?.id;
      const parts = refsIn(e.args[5]);
      aggregates.set(whole, [...(aggregates.get(whole) ?? []), ...parts]);
      for (const p of parts) partOf.set(p, whole);
    } else if (e.type === 'IFCRELASSIGNSTOGROUP') {
      const g = file.byId.get(e.args[6]?.id);
      const members = refsIn(e.args[4]);
      membersOf.set(g.id, [...(membersOf.get(g.id) ?? []), ...members]);
      for (const m of members) (groupsOf.get(m) ?? groupsOf.set(m, []).get(m)).push(g);
    } else if (e.type === 'IFCRELNESTS') for (const id of refsIn(e.args[5])) nestedIn.set(id, e.args[4]?.id);
  }
  const project = entitiesByType(file, 'IFCPROJECT')[0];
  const chain = project ? ownPsets(file, project, rels).APK_PowerChain ?? {} : {};
  if (!chain.Schema) lost.push('no APK_PowerChain on the project: not a power chain this editor wrote; read what IFC says');

  const boards = entitiesByType(file, 'IFCELECTRICDISTRIBUTIONBOARD');
  const board = boards.find((b) => ownPsets(file, b, rels).Pset_DistributionBoardOccurrence?.IsMain === true) ?? null;
  const mainsSys = board ? (groupsOf.get(board.id) ?? []).find((g) => g.type === 'IFCDISTRIBUTIONSYSTEM') : null;
  const breakers = board ? (aggregates.get(board.id) ?? []).map((id) => file.byId.get(id)).filter((e) => e?.type === 'IFCPROTECTIVEDEVICE') : [];
  const main = breakers.find((b) => b.args[7] === 'MAIN');
  const mainType = main ? getPsets(file, main) : {};

  const model = {
    type: 'powerchain',
    id: chain.ChainId ?? project?.args[0] ?? 'power_ifc',
    name: project?.args[2] ?? 'Technical Power Distribution',
    panelName: board?.args[2] ?? 'PANEL',
    mainsConfig: mainsSys?.args[5] ?? '',
    mainBreakerAmps: boundedNumber(mainType.Pset_ElectricalDeviceCommon?.RatedCurrent) ?? null,
    interruptingKA: numOr(mainType.Pset_ProtectiveDeviceTypeCircuitBreaker?.ICU60947) != null ? mainType.Pset_ProtectiveDeviceTypeCircuitBreaker.ICU60947 / 1000 : null,
    boardWeightKg: board ? numOr(ownPsets(file, board, rels).Qto_DistributionBoardBaseQuantities?.GrossWeight) : null,
    circuits: [],
    loads: [],
  };

  // ---- circuits
  const circuitOfBreaker = new Map();
  for (const c of entitiesByType(file, 'IFCDISTRIBUTIONCIRCUIT')) {
    const own = ownPsets(file, c, rels).APK_PowerCircuit ?? {};
    const members = (membersOf.get(c.id) ?? []).map((id) => file.byId.get(id));
    const b = members.find((m) => m?.type === 'IFCPROTECTIVEDEVICE');
    const ps = b ? getPsets(file, b) : {};
    const out = b ? ports(file, b)[0] : null;
    const volts = out ? boundedNumber(getPsets(file, out).Pset_DistributionPortTypeCable?.Voltage) : null;
    const red = (groupsOf.get(c.id) ?? []).find((g) => g.type === 'IFCGROUP' && g.args[4] === 'RedundantFeedGroup');
    const id = own.CircuitId ?? c.args[0];
    const number = Number(c.args[2]);
    model.circuits.push({
      id,
      number: Number.isFinite(number) ? number : c.args[2],
      phase: PHASE_OF[first(ps.Pset_ElectricalDeviceCommon?.ConductorFunction)] ?? 'A',
      breakerAmps: boundedNumber(ps.Pset_ElectricalDeviceCommon?.RatedCurrent),
      volts,
      label: c.args[5] ?? '',
      loadsVA: numOr(own.PlannedApparentPowerVA) ?? 0,
      redundantGroup: red ? red.args[2] : null,
    });
    if (b) circuitOfBreaker.set(b.id, id);
  }

  // ---- loads
  const loadIdOf = new Map(); // element id → LoadId
  const loadEls = all.filter((e) => rels.has(e.id) && ownPsets(file, e, rels).APK_PowerLoad?.LoadId);
  for (const e of loadEls) loadIdOf.set(e.id, ownPsets(file, e, rels).APK_PowerLoad.LoadId);
  const connectedFrom = new Map(); // related (sink) port id → relating (source) port id
  for (const r of entitiesByType(file, 'IFCRELCONNECTSPORTS')) connectedFrom.set(r.args[5]?.id, r.args[4]?.id);
  const typeOf = new Map(); // occurrence id → its type entity
  for (const r of entitiesByType(file, 'IFCRELDEFINESBYTYPE')) for (const id of refsIn(r.args[4])) typeOf.set(id, file.byId.get(r.args[5]?.id));
  const declared = (e) => {
    const own = ownPsets(file, e, rels);
    const typeName = typeOf.get(e.id)?.args[2];
    const elec = own.Pset_ElectricalDeviceCommon ?? {};
    const apk = own.APK_PowerLoad ?? {};
    let weightKg = null;
    for (const [name, set] of Object.entries(own)) if ((name.startsWith('Qto_') || name === 'APK_BaseQuantities') && numOr(set.GrossWeight) != null) weightKg = set.GrossWeight;
    return {
      part: apk.Part ?? null,
      name: e.args[2] != null && e.args[2] !== typeName ? e.args[2] : null, // the part's own name is no name of its own
      watts: numOr(elec.NominalPowerConsumption) ?? numOr(apk.DeclaredPower),
      heatW: numOr(elec.HeatDissipation) ?? numOr(apk.DeclaredHeatDissipation),
      weightKg,
      powerFactor: numOr(elec.PowerFactor) ?? numOr(apk.DeclaredPowerFactor),
    };
  };
  for (const e of loadEls) {
    const d = declared(e);
    let circuit = null;
    let fedBy = null;
    const sink = ports(file, e).find((p) => unwrap(p.args[7]) === 'SINK' && connectedFrom.has(p.id));
    if (sink) {
      const owner = nestedIn.get(connectedFrom.get(sink.id));
      if (circuitOfBreaker.has(owner)) circuit = circuitOfBreaker.get(owner);
      else if (loadIdOf.has(owner)) fedBy = loadIdOf.get(owner);
    }
    const whole = file.byId.get(partOf.get(e.id));
    const rack = whole?.type === 'IFCELEMENTASSEMBLY' && whole.args[4] === 'EquipmentRack' ? whole.args[2] : null;
    const comps = (aggregates.get(e.id) ?? []).map((id) => file.byId.get(id)).filter(Boolean).map((c) => normalizeComponent(declared(c)));
    model.loads.push(normalizeLoad({ id: loadIdOf.get(e.id), ...d, circuit, fedBy, rack, ...(comps.length ? { parts: comps } : {}) }));
  }
  if (!board) lost.push('no main IfcElectricDistributionBoard (Pset_DistributionBoardOccurrence.IsMain)');
  return { model, report: { schema, lost } };
}


/**
 * The model an .ifc holds, ready to roll up from the file alone: the block read back, and each
 * load's part facts read from the BIM part type the file itself embeds (power-3: the roll-ups
 * come from IFC quantities). → PowerChainModel.
 */
export function modelFromIfc(text, PowerChainModel) {
  const file = typeof text === 'string' ? parseStep(text) : text;
  const { model, report } = ifcToPower(file);
  const m = new PowerChainModel(model);
  const pids = new Set();
  for (const l of model.loads) {
    if (l.part) pids.add(l.part);
    for (const c of l.parts ?? []) if (c.part) pids.add(c.part);
  }
  for (const pid of pids) {
    const t = file.entities.find((e) => e.args[7] === pid && /TYPE$/.test(e.type) && e.type !== 'IFCRELDEFINESBYTYPE');
    if (t) m.setPartFacts(pid, partFacts(file, pid));
  }
  return { model: m, report };
}
