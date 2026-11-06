// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * SAVE .IFC — the power chain as one IFC4X3_ADD2 model (IFC-CORE-DELTAS power-2/3).
 * Written with the contracts' STEP writer and GlobalId rule (vendor/apk-contracts/apk-ifc.js),
 * no IfcOpenShell in the page. Byte-deterministic: the same block and the same part types
 * write the same file; every GlobalId is uuid5 of a role under the block id (contracts
 * ifcGuid), and an embedded BIM part type keeps the GlobalIds its own part file has.
 *
 *   IfcProject ─ IfcSite ─ IfcBuilding ─ IfcBuildingStorey   units mm · kg · W · V · A · Hz
 *   mains      IfcDistributionSystem ELECTRICAL, LongName = mainsConfig,
 *              Pset_DistributionSystemTypeElectrical (NumberOfLiveConductors, ElectricalSystemCategory,
 *              RatedVoltageRange, ElectricalSystemType when the text names it); assigned the board
 *   board      IfcElectricDistributionBoard DISTRIBUTIONBOARD typed by its own IfcElectricDistributionBoardType
 *              (Pset_ElectricalDeviceCommon RatedCurrent = main breaker, NumberOfPoles = phases);
 *              Pset_DistributionBoardOccurrence.IsMain, Qto_DistributionBoardBaseQuantities
 *              (NumberOfCircuits, GrossWeight when declared); a MAINS SINK port
 *   breakers   IfcProtectiveDevice CIRCUITBREAKER, the main and one per circuit, aggregated in the board
 *              (IfcRelAggregates); typed per rating by IfcProtectiveDeviceType CIRCUITBREAKER with
 *              Pset_ProtectiveDeviceTypeCircuitBreaker.ICU60947 (A, only when interruptingKA is declared:
 *              never a default, so an undeclared one fails apk-av.ids' breaker spec) + Pset_ElectricalDeviceCommon
 *              (RatedCurrent, NumberOfPoles); on the occurrence ConductorFunction PHASE_L1..L3 and
 *              Pset_ProtectiveDeviceOccurrence.PoleUsage; one SOURCE port per load it feeds (an IfcPort
 *              joins ONE IfcRelConnectsPorts per role), Voltage = the circuit's volts
 *   circuits   IfcDistributionCircuit ELECTRICAL (Name = number, LongName = label), aggregated in the mains,
 *              assigned (IfcRelAssignsToGroup) its breaker and every load it feeds, through PDUs too;
 *              APK_PowerCircuit (CircuitId, PlannedApparentPowerVA); a redundant pair is an IfcGroup
 *              'RedundantFeedGroup' over its circuits
 *   loads      occurrences typed by the BIM part's own IFC type (embedded from /api/bim/parts/<id>.ifc,
 *              its ports and sets with it), else IfcElectricAppliance USERDEFINED 'PlannedLoad';
 *              APK_PowerLoad (LoadId, Part); what this occurrence declares itself in
 *              Pset_ElectricalDeviceCommon (NominalPowerConsumption, HeatDissipation, PowerFactor) and
 *              its entity's Qto GrossWeight; a supply SINK port (the part's connector words, Voltage,
 *              Power when known) connected by IfcRelConnectsPorts to its breaker or to a PDU outlet;
 *              a kit's components aggregated in it
 *   racks      IfcElementAssembly USERDEFINED 'EquipmentRack' aggregating the loads that name it;
 *              APK_RackQuantities.LoadedGrossWeight (derived)
 *   roll-ups   APK_PowerRollup on every circuit, the board and every rack — Load and Heat (W),
 *              Weight (kg), ApparentPowerVA, what is partial / unknown / assumed — export-time
 *              derived values (powerRollup.js), never read back as truth
 *   the block  APK_PowerChain on the project (ChainId, Schema)
 */

import { enumv, ifcGuid, isRef, parseStep, real, ref, typed, writeStep } from '../../vendor/apk-contracts/apk-ifc.js';
import { partFacts, partTypeEntity, rollup } from '../powerRollup.js';

export const IFC_SCHEMA = 'IFC4X3_ADD2';
export const NATIVE_SCHEMA = 'apk.powerchain/1';
const PHASES = ['A', 'B', 'C'];
const FN = { A: 'PHASE_L1', B: 'PHASE_L2', C: 'PHASE_L3' };
const DERIVED = { kind: 'derived' };

/** The weight Qto ISO 16739 gives each occurrence entity (IfcOpenShell templates, IFC4X3); others take APK_BaseQuantities. */
export const WEIGHT_QTO = {
  IFCAUDIOVISUALAPPLIANCE: 'Qto_AudioVisualApplianceBaseQuantities',
  IFCCOMMUNICATIONSAPPLIANCE: 'Qto_CommunicationsApplianceBaseQuantities',
  IFCCABLESEGMENT: 'Qto_CableSegmentBaseQuantities',
  IFCTRANSFORMER: 'Qto_TransformerBaseQuantities',
  IFCFLOWINSTRUMENT: 'Qto_FlowInstrumentBaseQuantities',
  IFCELECTRICAPPLIANCE: 'Qto_ElectricApplianceBaseQuantities',
  IFCELECTRICDISTRIBUTIONBOARD: 'Qto_DistributionBoardBaseQuantities',
  IFCCONTROLLER: 'Qto_ControllerBaseQuantities',
  IFCOUTLET: 'Qto_OutletBaseQuantities',
  IFCUNITARYCONTROLELEMENT: 'Qto_UnitaryControlElementBaseQuantities',
  IFCELECTRICFLOWSTORAGEDEVICE: 'Qto_ElectricFlowStorageDeviceBaseQuantities',
  IFCLIGHTFIXTURE: 'Qto_LightFixtureBaseQuantities',
  IFCCABLEFITTING: 'Qto_CableFittingBaseQuantities',
  IFCSWITCHINGDEVICE: 'Qto_SwitchingDeviceBaseQuantities',
  IFCPROTECTIVEDEVICE: 'Qto_ProtectiveDeviceBaseQuantities',
  IFCELECTRICGENERATOR: 'Qto_ElectricGeneratorBaseQuantities',
};
/** Occurrence entities that are not IfcDistributionElement (Pset_ElectricalDeviceCommon does not apply). */
const NOT_DISTRIBUTION = new Set(['IFCELEMENTASSEMBLY', 'IFCDISCRETEACCESSORY', 'IFCBUILDINGELEMENTPROXY', 'IFCFURNITURE', 'IFCMECHANICALFASTENER']);

const label = (s) => typed('IFCLABEL', String(s));
const ident = (s) => typed('IFCIDENTIFIER', String(s));
const bool = (b) => typed('IFCBOOLEAN', enumv(b ? 'T' : 'F'));
const measure = (type, x) => typed(type, real(x));
const count = (x) => typed('IFCCOUNTMEASURE', Math.round(x));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPf = (v) => isNum(v) && v > 0 && v <= 1;

/** "120/208V 3-Phase 4-Wire" → {volts:[120,208], phases:3, wires:4, system:'TN_S'|null}. Unknown parts stay null. */
export function parseMains(text) {
  const s = String(text ?? '');
  const v = (/(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*V\b/i.exec(s) || []).slice(1).filter(Boolean).map(Number);
  const ph = /(\d)\s*-?\s*(?:phase|ph)\b/i.exec(s);
  const w = /(\d)\s*-?\s*wire\b/i.exec(s);
  const sys = /\b(TN[-_ ]?C[-_ ]?S|TN[-_ ]?S|TN[-_ ]?C|TN|TT|IT)\b/.exec(s);
  return {
    volts: v.sort((a, b) => a - b),
    phases: ph ? Number(ph[1]) : null,
    wires: w ? Number(w[1]) : null,
    system: sys ? sys[1].toUpperCase().replace(/[- ]/g, '_') : null,
  };
}

/** Poles of a branch breaker: 2 when the circuit runs at the line-to-line voltage of a multi-phase supply, else 1. */
export function polesOf(circuit, mains) {
  if (isNum(circuit.poles) && circuit.poles > 0) return circuit.poles;
  const [ln, ll] = mains.volts;
  return ll && ln && isNum(circuit.volts) && circuit.volts > ln * 1.2 ? 2 : 1;
}

/** The conductors a breaker lands on: its phase, and the next for a 2-pole, all three for 3. */
export function conductorsOf(phase, poles) {
  const i = Math.max(0, PHASES.indexOf(phase || 'A'));
  return Array.from({ length: Math.min(poles, 3) }, (_, k) => FN[PHASES[(i + k) % 3]]);
}

class Writer {
  constructor() { this.entities = []; }
  add(type, ...args) {
    const id = this.entities.length + 1;
    this.entities.push({ id, type, args });
    return ref(id);
  }
}

/** The occurrence entity of a type entity name, and its attribute list. */
function occurrenceOf(typeName) {
  const occ = typeName.replace(/TYPE$/, '');
  return occ;
}

function occurrenceArgs(entity, { gid, name, desc, objectType, tag, predefined = null }) {
  const head = [gid, null, name ?? null, desc ?? null, objectType ?? null, null, null, tag ?? null];
  if (entity === 'IFCELEMENTASSEMBLY') return [...head, enumv('NOTDEFINED'), predefined ? enumv(predefined) : null];
  if (entity === 'IFCMECHANICALFASTENER') return [...head, null, null, predefined ? enumv(predefined) : null];
  return [...head, predefined ? enumv(predefined) : null];
}

/**
 * The power chain block (model.toJSON()) as IFC4X3_ADD2 STEP text.
 *   types   {partId: the part's .ifc text}: each load's type, embedded with its ports and sets
 *   facts   (partId) → partFacts, for the roll-ups (the model's own when model is a PowerChainModel)
 */
export function powerToIfc(model, { types = {}, facts = null, fileName = null } = {}) {
  const json = typeof model.toJSON === 'function' ? model.toJSON() : model;
  const factsOf = facts ?? (typeof model.facts === 'function' ? model.facts() : () => null);
  const R = rollup(json, factsOf);
  const W = new Writer();
  const key = String(json.id);
  const g = (...roles) => ifcGuid('powerchain', key, ...roles);
  const mains = parseMains(json.mainsConfig);

  // ---- units and contexts
  const si = (type, prefix, name) => W.add('IFCSIUNIT', DERIVED, enumv(type), prefix ? enumv(prefix) : null, enumv(name));
  const units = [
    ['LENGTHUNIT', 'MILLI', 'METRE'], ['MASSUNIT', 'KILO', 'GRAM'], ['POWERUNIT', null, 'WATT'],
    ['ELECTRICVOLTAGEUNIT', null, 'VOLT'], ['ELECTRICCURRENTUNIT', null, 'AMPERE'], ['FREQUENCYUNIT', null, 'HERTZ'],
    ['ELECTRICRESISTANCEUNIT', null, 'OHM'],
  ];
  const unitRef = new Map(units.map(([t, p, n]) => [`${t}/${p ?? ''}/${n}`, si(t, p, n)]));
  const unitAssignment = W.add('IFCUNITASSIGNMENT', [...unitRef.values()]);
  const origin = W.add('IFCAXIS2PLACEMENT3D', W.add('IFCCARTESIANPOINT', [real(0), real(0), real(0)]), null, null);
  const ctx = W.add('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', 3, real(1e-5), origin, null);
  const bodyCtx = W.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', 'Body', 'Model', DERIVED, DERIVED, DERIVED, DERIVED, ctx, null, enumv('MODEL_VIEW'), null);
  const project = W.add('IFCPROJECT', g('project'), null, json.name ?? 'Power chain', 'APK.audio Power Chain', null, null, null, [ctx], unitAssignment);

  // ---- property helpers
  const single = (name, value) => W.add('IFCPROPERTYSINGLEVALUE', name, null, value, null);
  const enumProp = (name, words) => W.add('IFCPROPERTYENUMERATEDVALUE', name, null, (Array.isArray(words) ? words : [words]).map(label), null);
  const setPoint = (name, type, x) => W.add('IFCPROPERTYBOUNDEDVALUE', name, null, null, null, null, measure(type, x));
  const range = (name, type, lo, hi) => W.add('IFCPROPERTYBOUNDEDVALUE', name, null, measure(type, hi), measure(type, lo), null, null);
  const pset = (owners, ownerKey, name, props) => {
    const list = props.filter(Boolean);
    if (!list.length || !owners.length) return null;
    const ps = W.add('IFCPROPERTYSET', g('pset', ownerKey, name), null, name, null, list);
    W.add('IFCRELDEFINESBYPROPERTIES', g('props', ownerKey, name), null, null, null, owners, ps);
    return ps;
  };
  const typePset = (typeKey, name, props) => {
    const list = props.filter(Boolean);
    return list.length ? W.add('IFCPROPERTYSET', g('pset', typeKey, name), null, name, null, list) : null;
  };
  const qto = (owners, ownerKey, name, quantities, method = null) => {
    const list = quantities.filter(Boolean);
    if (!list.length || !owners.length) return null;
    const q = W.add('IFCELEMENTQUANTITY', g('qto', ownerKey, name), null, name, null, method, list);
    W.add('IFCRELDEFINESBYPROPERTIES', g('props', ownerKey, name), null, null, null, owners, q);
    return q;
  };
  const weightQ = (name, kg) => (isNum(kg) ? W.add('IFCQUANTITYWEIGHT', name, null, null, real(kg), null) : null);
  const port = (gidKey, name, flow, desc = null) =>
    W.add('IFCDISTRIBUTIONPORT', g('port', ...gidKey), null, name, desc, null, null, null, enumv(flow), enumv('CABLE'), enumv('ELECTRICAL'));
  const cable = (owner, ownerKey, words) => pset([owner], ownerKey, 'Pset_DistributionPortTypeCable', [
    enumProp('ElectricalConnectionType', words.type ?? 'NOTKNOWN'),
    words.subtype ? single('ConnectionSubtype', label(words.subtype)) : null,
    enumProp('ConnectionGender', words.gender ?? 'NOTKNOWN'),
    words.conductors ? enumProp('ConductorFunction', words.conductors) : null,
    isNum(words.volts) ? setPoint('Voltage', 'IFCELECTRICVOLTAGEMEASURE', words.volts) : null,
    isNum(words.watts) ? setPoint('Power', 'IFCPOWERMEASURE', words.watts) : null,
  ]);
  const nest = (owner, ownerKey, ports) => {
    if (ports.length) W.add('IFCRELNESTS', g('nests', ownerKey), null, 'Ports', null, owner, ports);
  };
  const rollupSet = (owner, ownerKey, r, extra = []) => pset([owner], ownerKey, 'APK_PowerRollup', [
    isNum(r.watts) ? single('Load', measure('IFCPOWERMEASURE', r.watts)) : null,
    isNum(r.heatW) ? single('Heat', measure('IFCPOWERMEASURE', r.heatW)) : null,
    isNum(r.weightKg) ? single('Weight', measure('IFCMASSMEASURE', r.weightKg)) : null,
    isNum(r.va) ? single('ApparentPowerVA', measure('IFCREAL', r.va)) : null,
    r.partial ? single('LoadPartial', bool(!!r.partial.watts)) : null,
    r.partial ? single('HeatPartial', bool(!!r.partial.heatW)) : null,
    r.partial && 'weightKg' in r.partial ? single('WeightPartial', bool(!!r.partial.weightKg)) : null,
    r.unknown ? single('UnknownLoadCount', typed('IFCINTEGER', r.unknown.watts)) : null,
    r.unknown ? single('UnknownWeightCount', typed('IFCINTEGER', r.unknown.weightKg)) : null,
    'heatAssumed' in r ? single('HeatAssumed', bool(!!r.heatAssumed)) : null,
    'pfAssumed' in r ? single('PowerFactorAssumed', bool(!!r.pfAssumed)) : null,
    ...extra,
    single('Method', label('APK no-double-count')),
    single('Derived', bool(true)),
  ]);

  // ---- the spine
  const sitePl = W.add('IFCLOCALPLACEMENT', null, origin);
  const buildingPl = W.add('IFCLOCALPLACEMENT', sitePl, origin);
  const storeyPl = W.add('IFCLOCALPLACEMENT', buildingPl, origin);
  const site = W.add('IFCSITE', g('site'), null, 'Site', null, null, sitePl, null, null, enumv('ELEMENT'), null, null, null, null, null);
  const building = W.add('IFCBUILDING', g('building'), null, 'Building', null, null, buildingPl, null, null, enumv('ELEMENT'), null, null, null);
  const storey = W.add('IFCBUILDINGSTOREY', g('storey'), null, 'Level 0', null, null, storeyPl, null, null, enumv('ELEMENT'), real(0));
  W.add('IFCRELAGGREGATES', g('aggregates', 'project'), null, null, null, project, [site]);
  W.add('IFCRELAGGREGATES', g('aggregates', 'site'), null, null, null, site, [building]);
  W.add('IFCRELAGGREGATES', g('aggregates', 'building'), null, null, null, building, [storey]);
  pset([project], 'project', 'APK_PowerChain', [single('Schema', ident(NATIVE_SCHEMA)), single('ChainId', ident(key))]);
  const declared = [];
  const contained = [];

  // ---- the mains
  const mainsSys = W.add('IFCDISTRIBUTIONSYSTEM', g('mains'), null, 'Mains', null, null, json.mainsConfig ?? null, enumv('ELECTRICAL'));
  const top = mains.volts.length ? mains.volts[mains.volts.length - 1] : null;
  pset([mainsSys], 'mains', 'Pset_DistributionSystemTypeElectrical', [
    mains.system ? enumProp('ElectricalSystemType', mains.system) : null,
    top != null ? enumProp('ElectricalSystemCategory', top <= 50 ? 'EXTRALOWVOLTAGE' : top <= 1000 ? 'LOWVOLTAGE' : 'HIGHVOLTAGE') : null,
    mains.wires ? single('NumberOfLiveConductors', count(mains.wires)) : null,
    mains.volts.length === 2 ? range('RatedVoltageRange', 'IFCELECTRICVOLTAGEMEASURE', mains.volts[0], mains.volts[1]) : null,
  ]);

  // ---- the board and its breakers
  const phases = mains.phases ?? 1;
  const boardType = W.add('IFCELECTRICDISTRIBUTIONBOARDTYPE', g('board', 'type'), null, `${json.panelName} type`, json.mainsConfig ?? null, null, [
    typePset('board/type', 'Pset_ElectricalDeviceCommon', [
      isNum(json.mainBreakerAmps) ? setPoint('RatedCurrent', 'IFCELECTRICCURRENTMEASURE', json.mainBreakerAmps) : null,
      single('NumberOfPoles', count(phases)),
    ]),
  ].filter(Boolean), null, null, null, enumv('DISTRIBUTIONBOARD'));
  declared.push(boardType);
  const board = W.add('IFCELECTRICDISTRIBUTIONBOARD', g('board'), null, json.panelName, json.mainsConfig ?? null, null, null, null, json.panelName, enumv('DISTRIBUTIONBOARD'));
  W.add('IFCRELDEFINESBYTYPE', g('typed', 'board'), null, null, null, [board], boardType);
  contained.push(board);
  pset([board], 'board', 'Pset_DistributionBoardOccurrence', [single('IsMain', bool(true))]);
  qto([board], 'board', 'Qto_DistributionBoardBaseQuantities', [
    W.add('IFCQUANTITYCOUNT', 'NumberOfCircuits', null, null, (json.circuits ?? []).length, null),
    weightQ('GrossWeight', json.boardWeightKg),
  ]);
  const mainsPort = port(['board', 'mains'], 'MAINS', 'SINK');
  cable(mainsPort, 'board/mains', { type: 'OTHER', subtype: 'Hard-wired (lugs)', gender: 'OTHER', volts: top });
  nest(board, 'board', [mainsPort]);
  W.add('IFCRELASSIGNSTOGROUP', g('group', 'mains'), null, null, null, [board], null, mainsSys);

  const kA = isNum(json.interruptingKA) ? json.interruptingKA : null;
  const breakerTypes = new Map();
  const breakerType = (amps, poles) => {
    const k = `${amps}/${poles}`;
    if (breakerTypes.has(k)) return breakerTypes.get(k);
    const tk = `breaker-type/${k}`;
    const t = W.add('IFCPROTECTIVEDEVICETYPE', g(tk), null, `${amps} A ${poles}P circuit breaker`, null, null, [
      typePset(tk, 'Pset_ProtectiveDeviceTypeCircuitBreaker', [kA != null ? single('ICU60947', measure('IFCELECTRICCURRENTMEASURE', kA * 1000)) : null]),
      typePset(tk, 'Pset_ElectricalDeviceCommon', [
        isNum(amps) ? setPoint('RatedCurrent', 'IFCELECTRICCURRENTMEASURE', amps) : null,
        single('NumberOfPoles', count(poles)),
      ]),
    ].filter(Boolean), null, null, null, enumv('CIRCUITBREAKER'));
    declared.push(t);
    breakerTypes.set(k, { ref: t, occ: [] });
    return breakerTypes.get(k);
  };
  const poleUsage = (p) => (p >= 1 && p <= 4 ? `${p}P` : 'OTHER');

  const mainBreaker = W.add('IFCPROTECTIVEDEVICE', g('breaker', 'main'), null, 'Main breaker', null, null, null, null, 'MAIN', enumv('CIRCUITBREAKER'));
  breakerType(json.mainBreakerAmps, phases).occ.push(mainBreaker);
  pset([mainBreaker], 'breaker/main', 'Pset_ElectricalDeviceCommon', [enumProp('ConductorFunction', conductorsOf('A', phases))]);
  pset([mainBreaker], 'breaker/main', 'Pset_ProtectiveDeviceOccurrence', [enumProp('PoleUsage', poleUsage(phases))]);

  const loads = json.loads ?? [];
  const byId = new Map(loads.map((l) => [l.id, l]));
  const direct = (cid) => loads.filter((l) => l.circuit === cid && !l.fedBy);
  const breakers = [];
  const feedSource = new Map(); // load id → the SOURCE port that feeds it
  const circuitBreaker = new Map();
  for (const c of json.circuits ?? []) {
    const poles = polesOf(c, mains);
    const b = W.add('IFCPROTECTIVEDEVICE', g('breaker', c.id), null, `CB-${c.number}`, c.label ?? null, null, null, null, String(c.number), enumv('CIRCUITBREAKER'));
    breakerType(c.breakerAmps, poles).occ.push(b);
    breakers.push(b);
    circuitBreaker.set(c.id, b);
    const fns = conductorsOf(c.phase, poles);
    pset([b], `breaker/${c.id}`, 'Pset_ElectricalDeviceCommon', [enumProp('ConductorFunction', fns)]);
    pset([b], `breaker/${c.id}`, 'Pset_ProtectiveDeviceOccurrence', [enumProp('PoleUsage', poleUsage(poles))]);
    const fed = direct(c.id);
    const outs = (fed.length ? fed : [null]).map((l, i) => {
      const p = port(['breaker', c.id, 'out', String(i + 1)], fed.length > 1 ? `OUT-${i + 1}` : 'OUT', 'SOURCE');
      cable(p, `breaker/${c.id}/out/${i + 1}`, { type: 'OTHER', subtype: 'Breaker terminal', gender: 'OTHER', conductors: fns, volts: c.volts });
      if (l) feedSource.set(l.id, p);
      return p;
    });
    nest(b, `breaker/${c.id}`, outs);
  }
  W.add('IFCRELAGGREGATES', g('aggregates', 'board'), null, null, null, board, [mainBreaker, ...breakers]);
  W.add('IFCRELASSIGNSTOGROUP', g('group', 'mains', 'main-breaker'), null, 'Main breaker', null, [mainBreaker], null, mainsSys);

  // ---- part types, embedded once each
  const embedded = new Map();
  const unitByKey = (u) => unitRef.get(`${u.args[1].value}/${u.args[2] ? u.args[2].value : ''}/${u.args[3].value}`);
  const contextUnits = new Map();
  const embed = (pid) => {
    if (embedded.has(pid)) return embedded.get(pid);
    const text = types[pid];
    let out = null;
    if (typeof text === 'string' && text) {
      const file = parseStep(text);
      const t = partTypeEntity(file, pid);
      if (t) out = { ...copyType(W, file, t, { ctx, bodyCtx, unitByKey, contextUnits }), pid, facts: partFacts(file, pid) };
    }
    if (out) declared.push(out.ref);
    embedded.set(pid, out);
    return out;
  };

  // ---- loads
  const occ = new Map(); // load id → {ref, entity, outlets}
  const typedBy = new Map(); // type ref id → {ref, occ: []}
  const typeUse = (t, o) => {
    if (!typedBy.has(t.pid)) typedBy.set(t.pid, { ref: t.ref, occ: [] });
    typedBy.get(t.pid).occ.push(o);
  };
  const writeOccurrence = (item, okey, f) => {
    const t = item.part ? embed(item.part) : null;
    const entity = t ? occurrenceOf(t.entity) : 'IFCELECTRICAPPLIANCE';
    const name = item.name ?? t?.name ?? null; // no name of its own: the part's (read back as none)
    const o = W.add(entity, ...occurrenceArgs(entity, {
      gid: g('load', okey), name, tag: item.id ?? null,
      objectType: t ? null : item.part ?? 'PlannedLoad', predefined: t ? null : 'USERDEFINED',
    }));
    if (t) typeUse(t, o);
    const distribution = !NOT_DISTRIBUTION.has(entity);
    pset([o], `load/${okey}`, 'APK_PowerLoad', [
      item.id ? single('LoadId', ident(item.id)) : null,
      item.part ? single('Part', ident(item.part)) : null,
      !distribution && isNum(item.watts) ? single('DeclaredPower', measure('IFCPOWERMEASURE', item.watts)) : null,
      !distribution && isNum(item.heatW) ? single('DeclaredHeatDissipation', measure('IFCPOWERMEASURE', item.heatW)) : null,
      !distribution && isPf(item.powerFactor) ? single('DeclaredPowerFactor', measure('IFCNORMALISEDRATIOMEASURE', item.powerFactor)) : null,
    ]);
    if (distribution) {
      pset([o], `load/${okey}`, 'Pset_ElectricalDeviceCommon', [
        isPf(item.powerFactor) ? single('PowerFactor', measure('IFCNORMALISEDRATIOMEASURE', item.powerFactor)) : null,
        isNum(item.heatW) ? single('HeatDissipation', measure('IFCPOWERMEASURE', item.heatW)) : null,
        isNum(item.watts) ? single('NominalPowerConsumption', measure('IFCPOWERMEASURE', item.watts)) : null,
      ]);
    }
    if (isNum(item.weightKg)) qto([o], `load/${okey}`, WEIGHT_QTO[entity] ?? 'APK_BaseQuantities', [weightQ('GrossWeight', item.weightKg)]);
    return { ref: o, entity, t, f };
  };

  for (const l of loads) {
    const fig = R.loads[l.id];
    const o = writeOccurrence(l, l.id, fig);
    const c = (json.circuits ?? []).find((x) => x.id === circuitOfLoad(l, byId));
    const words = supplyWords(o.t?.facts?.supply?.[0]);
    const inlet = port(['load', l.id, 'supply'], o.t?.facts?.supply?.[0]?.name ?? 'POWER IN', 'SINK');
    cable(inlet, `load/${l.id}/supply`, { ...words, volts: c?.volts, watts: fig?.watts != null && fig.wattsFrom !== 'pass-through' ? fig.watts : null });
    const ports = [inlet];
    const plugged = loads.filter((x) => x.fedBy === l.id);
    const outletRows = o.t?.facts?.outlets ?? [];
    plugged.forEach((x, i) => {
      const row = outletRows[i];
      const p = port(['load', l.id, 'outlet', String(i + 1)], row?.name ?? `OUT-${i + 1}`, 'SOURCE');
      cable(p, `load/${l.id}/outlet/${i + 1}`, { ...supplyWords(row), volts: c?.volts });
      feedSource.set(x.id, p);
      ports.push(p);
    });
    nest(o.ref, `load/${l.id}`, ports);
    occ.set(l.id, { ...o, inlet });
    if (l.parts?.length) {
      const comps = l.parts.map((p, i) => writeOccurrence(p, `${l.id}/part/${i + 1}`, null).ref);
      W.add('IFCRELAGGREGATES', g('aggregates', 'load', l.id), null, 'Kit', null, o.ref, comps);
    }
  }

  // ---- feeds: breaker / PDU outlet → the load's supply port
  for (const l of loads) {
    const src = feedSource.get(l.id);
    if (src) W.add('IFCRELCONNECTSPORTS', g('feed', l.id), null, `feed ${l.id}`, null, src, occ.get(l.id).inlet, null);
  }

  // ---- circuits
  const circuitRefs = [];
  for (const c of json.circuits ?? []) {
    const r = R.circuits[c.id];
    const cref = W.add('IFCDISTRIBUTIONCIRCUIT', g('circuit', c.id), null, String(c.number), null, null, c.label ?? null, enumv('ELECTRICAL'));
    circuitRefs.push(cref);
    W.add('IFCRELASSIGNSTOGROUP', g('group', 'circuit', c.id), null, null, null,
      [circuitBreaker.get(c.id), ...r.members.map((id) => occ.get(id).ref)], null, cref);
    pset([cref], `circuit/${c.id}`, 'APK_PowerCircuit', [
      single('CircuitId', ident(c.id)),
      isNum(c.loadsVA) ? single('PlannedApparentPowerVA', measure('IFCREAL', c.loadsVA)) : null,
    ]);
    rollupSet(cref, `circuit/${c.id}`, r, [single('Planned', bool(r.planned))]);
  }
  if (circuitRefs.length) W.add('IFCRELAGGREGATES', g('aggregates', 'mains'), null, 'Circuits', null, mainsSys, circuitRefs);
  const groups = new Map();
  (json.circuits ?? []).forEach((c, i) => {
    if (!c.redundantGroup) return;
    if (!groups.has(c.redundantGroup)) groups.set(c.redundantGroup, []);
    groups.get(c.redundantGroup).push(circuitRefs[i]);
  });
  for (const [name, members] of groups) {
    const grp = W.add('IFCGROUP', g('redundant', name), null, name, null, 'RedundantFeedGroup');
    W.add('IFCRELASSIGNSTOGROUP', g('group', 'redundant', name), null, null, null, members, null, grp);
  }
  rollupSet(board, 'board', { ...R.board, partial: { watts: R.board.partial.watts, heatW: R.board.partial.heatW } });

  // ---- racks
  for (const [name, r] of Object.entries(R.racks)) {
    const rack = W.add('IFCELEMENTASSEMBLY', ...occurrenceArgs('IFCELEMENTASSEMBLY', { gid: g('rack', name), name, objectType: 'EquipmentRack', tag: name, predefined: 'USERDEFINED' }));
    contained.push(rack);
    const members = loads.filter((l) => l.rack === name).map((l) => occ.get(l.id).ref);
    W.add('IFCRELAGGREGATES', g('aggregates', 'rack', name), null, 'Rack', null, rack, members);
    qto([rack], `rack/${name}`, 'APK_RackQuantities', [weightQ('LoadedGrossWeight', r.weightKg)], 'APK no-double-count');
    rollupSet(rack, `rack/${name}`, r);
  }
  for (const l of loads) if (!l.rack) contained.push(occ.get(l.id).ref);

  // ---- types, containment
  for (const [k, t] of breakerTypes) if (t.occ.length) W.add('IFCRELDEFINESBYTYPE', g('typed', 'breaker', k), null, null, null, t.occ, t.ref);
  for (const [pid, t] of typedBy) W.add('IFCRELDEFINESBYTYPE', g('typed', 'part', pid), null, null, null, t.occ, t.ref);
  W.add('IFCRELDECLARES', g('declares'), null, null, null, project, declared);
  W.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', g('contains', 'storey'), null, null, null, contained, storey);

  const stem = String(fileName ?? json.panelName ?? 'power').replace(/\.[^.]+$/, '');
  const header = [
    { type: 'FILE_DESCRIPTION', args: [['ViewDefinition [ReferenceView]'], '2;1'] },
    { type: 'FILE_NAME', args: [`${stem}.ifc`, '1970-01-01T00:00:00', ['APK.audio'], ['APK.audio'], 'EDITORS.PowerChain', 'APK.audio Power Chain', ''] },
    { type: 'FILE_SCHEMA', args: [[IFC_SCHEMA]] },
  ];
  return writeStep({ header, entities: W.entities });
}

function circuitOfLoad(load, byId) {
  const seen = new Set();
  let l = load;
  while (l && !l.circuit && l.fedBy && !seen.has(l.id)) { seen.add(l.id); l = byId.get(l.fedBy); }
  return (l && l.circuit) || null;
}

/** The connector words of a part's port row (its Pset_DistributionPortTypeCable), for the occurrence's port. */
function supplyWords(row) {
  const c = row?.cable ?? {};
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  return { type: first(c.ElectricalConnectionType) ?? 'NOTKNOWN', subtype: c.ConnectionSubtype ?? null, gender: first(c.ConnectionGender) ?? 'NOTKNOWN' };
}

/**
 * Copy one part's type object out of its own .ifc into W: the type, its sets, its nested
 * ports and their sets, keeping their GlobalIds. The part file's owner history goes (it is
 * optional), its units and contexts become this file's. → {ref, entity, name, facts}.
 */
function copyType(W, file, t, { ctx, bodyCtx, unitByKey, contextUnits }) {
  const include = new Set([t.id]);
  const portIds = new Set();
  for (const e of file.entities) {
    if (e.type === 'IFCRELNESTS' && isRef(e.args[4]) && e.args[4].id === t.id) {
      include.add(e.id);
      for (const r of e.args[5] ?? []) if (isRef(r)) portIds.add(r.id);
    }
  }
  for (const id of portIds) include.add(id);
  for (const e of file.entities) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES' && (e.args[4] ?? []).every((r) => isRef(r) && portIds.has(r.id))) include.add(e.id);
  }
  const map = new Map(); // old id → new ref (or null to drop)
  const mapped = (id) => {
    const e = file.byId.get(id);
    if (!e) return undefined;
    if (e.type === 'IFCOWNERHISTORY') return null;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONCONTEXT') return ctx;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT') return bodyCtx;
    if (e.type === 'IFCSIUNIT') return unitByKey(e) ?? undefined;
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT' && contextUnits.has(e.args[2])) return contextUnits.get(e.args[2]);
    return undefined;
  };
  // the closure over forward references
  const order = [];
  const visit = (id) => {
    if (map.has(id)) return;
    const m = mapped(id);
    if (m !== undefined) { map.set(id, m); return; }
    map.set(id, 'pending');
    order.push(id);
    const e = file.byId.get(id);
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isRef(v)) visit(v.id);
      else if (v && typeof v === 'object' && v.kind === 'typed') walk(v.value);
    };
    e.args.forEach(walk);
  };
  [...include].sort((a, b) => a - b).forEach(visit);
  order.sort((a, b) => a - b);
  const base = W.entities.length;
  order.forEach((id, i) => map.set(id, ref(base + i + 1)));
  const remap = (v) => {
    if (Array.isArray(v)) return v.map(remap);
    if (isRef(v)) return map.get(v.id);
    if (v && typeof v === 'object' && v.kind === 'typed') return { ...v, value: remap(v.value) };
    return v;
  };
  for (const id of order) {
    const e = file.byId.get(id);
    const r = W.add(e.type, ...e.args.map(remap));
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT') contextUnits.set(e.args[2], r);
  }
  return { ref: map.get(t.id), entity: t.type, name: t.args[2], facts: null };
}
