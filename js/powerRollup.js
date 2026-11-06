// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * LOAD, HEAT AND WEIGHT ROLL-UPS (IFC-CORE-DELTAS power-3), by the rules of
 * DATABASE.server.BIM SRC/tools/ifc/kit_report.py:
 *
 *   - A DECLARED total wins over summing parts. A load (or its BIM part) that
 *     declares a weight is that weight; its components are not added again.
 *     Only when nothing is declared are the direct components summed.
 *   - Unknown is unknown, never 0. A total over items some of which are
 *     unknown is the known sum, marked partial, with the unknown count; a
 *     total over items all unknown is null.
 *   - Heat is the declared HeatDissipation; when there is none it falls back
 *     to the electrical power, marked assumed (all of it ends up as heat).
 *   - Apparent power is W / PowerFactor; a silent part is PF 1, marked assumed.
 *   - A distribution element (a PDU: the loads plugged into it name it in
 *     fedBy) passes its loads' power through: its own draw counts only when it
 *     declares one, and an undeclared draw is not an unknown. Its weight is
 *     still its own, and unknown when nothing declares it.
 *
 * The facts of a BIM part come from its IFC type (GET /api/bim/parts/<id>.ifc,
 * the stored twin): Pset_ElectricalDeviceCommon (NominalPowerConsumption,
 * Power, HeatDissipation, PowerFactor, RatedCurrent, NumberOfPoles), the
 * supply port's Pset_DistributionPortTypeCable.Power, and GrossWeight in the
 * type's Qto. Values set on a load in this editor are the occurrence's own and
 * win over the type's. Roll-ups are computed on read, never stored in the block.
 * Units: W, kg, VA.
 */

import { getPsets, parseStep, ports, unwrap, isTypeObject } from '../vendor/apk-contracts/apk-ifc.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A bounded value read back ({UpperBoundValue, LowerBoundValue, SetPointValue}) as one number: set point, else upper. */
export function boundedNumber(v) {
  if (num(v) != null) return v;
  if (v && typeof v === 'object') return num(v.SetPointValue) ?? num(v.UpperBoundValue) ?? num(v.LowerBoundValue);
  return null;
}

/** The type object a part's .ifc carries: the one whose APK_Part.PartId (or Tag) is the part, else the only element type. */
export function partTypeEntity(file, partId) {
  const types = file.entities.filter((e) => isTypeObject(e.type));
  if (partId) {
    const byTag = types.find((t) => t.args[7] === partId);
    if (byTag) return byTag;
  }
  return types.length === 1 ? types[0] : (types.find((t) => /^IFC[A-Z]+TYPE$/.test(t.type) && t.args[7]) ?? null);
}

/** What a part's IFC type says that the roll-ups need. text: the part's .ifc (STEP). */
export function partFacts(text, partId = null) {
  const file = typeof text === 'string' ? parseStep(text) : text;
  const t = partTypeEntity(file, partId);
  if (!t) return null;
  const ps = getPsets(file, t);
  const elec = ps.Pset_ElectricalDeviceCommon ?? {};
  let weightKg = null;
  for (const [name, set] of Object.entries(ps)) {
    if ((name.startsWith('Qto_') || name === 'APK_BaseQuantities') && num(set.GrossWeight) != null) { weightKg = set.GrossWeight; break; }
  }
  const pts = ports(file, t).map((p) => {
    const cable = getPsets(file, p).Pset_DistributionPortTypeCable ?? {};
    return { name: p.args[2], flow: unwrap(p.args[7]), system: unwrap(p.args[9]), cable };
  });
  const electrical = pts.filter((p) => p.system === 'ELECTRICAL');
  const supply = electrical.filter((p) => p.flow === 'SINK');
  const portPower = supply.map((p) => boundedNumber(p.cable.Power)).filter((x) => x != null);
  const watts = num(elec.NominalPowerConsumption) ?? boundedNumber(elec.Power) ?? (portPower.length ? portPower.reduce((a, b) => a + b, 0) : null);
  return {
    part: (ps.APK_Part ?? {}).PartId ?? t.args[7] ?? partId,
    entity: t.type,
    predefined: unwrap(t.args[t.args.length - 1]),
    name: t.args[2],
    watts,
    heatW: num(elec.HeatDissipation),
    powerFactor: num(elec.PowerFactor),
    weightKg,
    ratedCurrentA: boundedNumber(elec.RatedCurrent),
    poles: num(elec.NumberOfPoles),
    supply: supply.map(({ name, cable }) => ({ name, cable })),
    outlets: electrical.filter((p) => p.flow === 'SOURCE').map(({ name, cable }) => ({ name, cable })),
  };
}

/** Is this part a distribution element (a PDU / strip / board)? */
export const isDistribution = (facts) => !!facts && facts.entity === 'IFCELECTRICDISTRIBUTIONBOARDTYPE';

/** A sum over items, each {value|null}: {value, known, unknown, partial}. Empty is 0, all-unknown is null. */
export function total(values) {
  let sum = 0;
  let known = 0;
  let unknown = 0;
  for (const v of values) {
    if (v == null) unknown += 1;
    else { sum += v; known += 1; }
  }
  const value = known === 0 && unknown > 0 ? null : Math.round(sum * 1000) / 1000;
  return { value, known, unknown, partial: unknown > 0 && known > 0 };
}

/**
 * One load (a device, a kit, a planned stub) as {watts, heatW, weightKg, va, …}
 * with where each came from. facts: (partId) => partFacts | null.
 */
export function loadFigures(load, facts, { passThrough = false } = {}) {
  const f = (load.part && facts(load.part)) || null;
  const kids = (load.parts ?? []).map((c) => loadFigures(c, facts));
  const pick = (own, typeVal, kidVals) => {
    if (num(own) != null) return [own, 'declared'];
    if (num(typeVal) != null) return [typeVal, 'part'];
    if (kidVals.length) {
      const t = total(kidVals);
      return [t.value, t.unknown ? (t.known ? 'partial: known parts only' : 'unknown') : 'sum of parts'];
    }
    return [null, 'unknown'];
  };
  let [watts, wattsFrom] = pick(load.watts, f?.watts, kids.map((k) => k.watts));
  const [weightKg, weightFrom] = pick(load.weightKg, f?.weightKg, kids.map((k) => k.weightKg));
  // heat: declared (here or by the part); else the components' when every one declares it; else the power, assumed
  const kidsDeclareHeat = kids.length > 0 && kids.every((k) => k.heatW != null && !k.heatAssumed);
  let [heatW, heatFrom] = pick(load.heatW, f?.heatW, kidsDeclareHeat ? kids.map((k) => k.heatW) : []);
  let heatAssumed = false;
  if (heatW == null && watts != null) { heatW = watts; heatFrom = 'assumed: all power becomes heat'; heatAssumed = true; }
  if (heatW == null && kids.length) {
    const t = total(kids.map((k) => k.heatW));
    heatW = t.value;
    heatFrom = t.unknown ? (t.known ? 'partial: known parts only' : 'unknown') : 'sum of parts';
    heatAssumed = kids.some((k) => k.heatAssumed);
  }
  if (passThrough && watts == null) { watts = 0; wattsFrom = 'pass-through'; heatW = heatW ?? 0; heatFrom = heatFrom === 'unknown' ? 'pass-through' : heatFrom; }
  const pfOwn = num(load.powerFactor) ?? f?.powerFactor ?? null;
  const pf = pfOwn != null && pfOwn > 0 ? pfOwn : 1;
  const va = watts == null ? null : Math.round((watts / pf) * 1000) / 1000;
  return { watts, wattsFrom, heatW, heatFrom, heatAssumed, weightKg, weightFrom, powerFactor: pf, pfAssumed: pfOwn == null || !(pfOwn > 0), va, facts: f };
}

/** A load's circuit: its own, else the circuit of the load it is plugged into (a PDU), walking fedBy. */
export function circuitOf(load, byId) {
  const seen = new Set();
  let l = load;
  while (l && !l.circuit && l.fedBy && !seen.has(l.id)) {
    seen.add(l.id);
    l = byId.get(l.fedBy);
  }
  return (l && l.circuit) || null;
}

function sumFigures(figs) {
  const w = total(figs.map((x) => x.watts));
  const h = total(figs.map((x) => x.heatW));
  const kg = total(figs.map((x) => x.weightKg));
  const va = total(figs.map((x) => x.va));
  return {
    watts: w.value, heatW: h.value, weightKg: kg.value, va: va.value,
    partial: { watts: w.partial, heatW: h.partial, weightKg: kg.partial, va: va.partial },
    unknown: { watts: w.unknown, heatW: h.unknown, weightKg: kg.unknown, va: va.unknown },
    heatAssumed: figs.some((x) => x.heatAssumed),
    pfAssumed: figs.some((x) => x.pfAssumed && x.watts != null && x.wattsFrom !== 'pass-through'),
    count: figs.length,
  };
}

/**
 * Every roll-up of a power chain model ({circuits, loads, …}):
 *   loads    id → loadFigures
 *   circuits id → {watts, heatW, weightKg, va, planned, …} over the loads it feeds (through PDUs too)
 *   board    over every circuit; weightKg is the board's own declared weight (an assembly
 *            whose breakers carry none), else unknown
 *   racks    name → over the loads that say they are in it (kits by the declared-total rule)
 *   phases   A/B/C → VA
 */
export function rollup(model, facts = () => null) {
  const loads = model.loads ?? [];
  const byId = new Map(loads.map((l) => [l.id, l]));
  const feeds = new Set(loads.map((l) => l.fedBy).filter(Boolean));
  const figs = new Map(loads.map((l) => [l.id, loadFigures(l, facts, {
    passThrough: feeds.has(l.id) || isDistribution(l.part ? facts(l.part) : null),
  })]));
  const circuits = {};
  for (const c of model.circuits ?? []) {
    const members = loads.filter((l) => circuitOf(l, byId) === c.id);
    const s = sumFigures(members.map((l) => figs.get(l.id)));
    const planned = members.length === 0;
    circuits[c.id] = { ...s, planned, members: members.map((l) => l.id), va: planned ? (num(c.loadsVA) ?? 0) : s.va };
  }
  const cs = Object.values(circuits);
  const sumOf = (key) => total(cs.map((c) => c[key]));
  const board = {
    watts: sumOf('watts').value, heatW: sumOf('heatW').value, va: sumOf('va').value,
    partial: { watts: cs.some((c) => c.partial.watts || c.watts == null), heatW: cs.some((c) => c.partial.heatW || c.heatW == null) },
    weightKg: num(model.boardWeightKg),
    weightFrom: num(model.boardWeightKg) != null ? 'declared' : 'unknown',
  };
  const racks = {};
  for (const name of [...new Set(loads.map((l) => l.rack).filter(Boolean))].sort()) {
    racks[name] = sumFigures(loads.filter((l) => l.rack === name).map((l) => figs.get(l.id)));
  }
  const phases = { A: 0, B: 0, C: 0 };
  for (const c of model.circuits ?? []) {
    const p = c.phase || 'A';
    if (phases[p] !== undefined) phases[p] += circuits[c.id].va ?? 0;
  }
  return { loads: Object.fromEntries(figs), circuits, board, racks, phases };
}
