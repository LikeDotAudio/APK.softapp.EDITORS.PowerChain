// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// The power chain as IFC4X3 (IFC-CORE-DELTAS power-2/3): the board, its breakers, a circuit per
// branch, loads typed by BIM parts, feeds as IfcRelConnectsPorts, and the load / heat / weight
// roll-ups by kit_report.py's rules — written, read back equal, and checked by IfcOpenShell.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IFC_GUID_RE, parseStep } from '../vendor/apk-contracts/apk-ifc.js';
import { PowerChainModel } from '../js/powerChainModel.js';
import { loadFigures, rollup, total } from '../js/powerRollup.js';
import { conductorsOf, parseMains, polesOf, powerToIfc } from '../js/ifc/powerToIfc.js';
import { ifcToPower, modelFromIfc } from '../js/ifc/ifcToPower.js';
import { buildBundle, BUNDLE } from '../scripts/vendor-ifc.mjs';
import { fixtureModel, LOADS, partTypes } from './fixture.mjs';

const byType = (text, type) => parseStep(text).entities.filter((e) => e.type === type);
const exportFixture = () => powerToIfc(fixtureModel(), { types: partTypes() });

test('the vendored STEP codec is what contracts/src/ifc builds to today', async () => {
  const now = await buildBundle();
  if (now == null) return; // this repo on its own: the committed bundle is what there is
  assert.equal(readFileSync(BUNDLE, 'utf8'), now, 'run node scripts/vendor-ifc.mjs');
});

// ---------------------------------------------------------------- power-3: the roll-up rules

test('a kit that declares its total weight is that weight; its components are not added again', () => {
  const none = () => null;
  const kit = { id: 'k', weightKg: 50.5, parts: [{ weightKg: 38.5 }, { weightKg: 12 }] };
  assert.equal(loadFigures(kit, none).weightKg, 50.5, 'declared total wins: 50.5 kg, not 101 kg');
  assert.equal(loadFigures(kit, none).weightFrom, 'declared');
  const undeclared = { id: 'k', parts: [{ weightKg: 38.5 }, { weightKg: 12 }] };
  assert.equal(loadFigures(undeclared, none).weightKg, 50.5, 'no total: the components summed');
  assert.equal(loadFigures(undeclared, none).weightFrom, 'sum of parts');
  const half = { id: 'k', parts: [{ weightKg: 38.5 }, { name: 'arm' }] };
  assert.equal(loadFigures(half, none).weightKg, 38.5);
  assert.equal(loadFigures(half, none).weightFrom, 'partial: known parts only');
});

test('unknown is unknown, never 0: an all-unknown total is null, a mixed one is partial', () => {
  assert.deepEqual(total([null, null]), { value: null, known: 0, unknown: 2, partial: false });
  assert.deepEqual(total([2, null, 3]), { value: 5, known: 2, unknown: 1, partial: true });
  assert.deepEqual(total([]), { value: 0, known: 0, unknown: 0, partial: false });
  const f = loadFigures({ id: 'x', part: 'nobody/knows' }, () => null);
  assert.equal(f.watts, null);
  assert.equal(f.weightKg, null);
  assert.equal(f.va, null);
});

test('heat falls back to power (assumed), PF to 1 (assumed); the part type fills what the load does not say', () => {
  const m = fixtureModel();
  const r = m.rollup();
  assert.equal(r.loads.spk1.watts, 15, 'the Nest Mini type: NominalPowerConsumption 15 W');
  assert.equal(r.loads.spk1.heatW, 15, 'its HeatDissipation');
  assert.equal(r.loads.spk1.weightKg, 0.181, 'its Qto GrossWeight');
  assert.equal(r.loads.spk1.wattsFrom, 'part');
  assert.equal(r.loads.amp1.heatW, 120);
  assert.equal(r.loads.amp1.heatAssumed, true);
  assert.equal(r.loads.dsp1.va, Math.round((150 / 0.95) * 1000) / 1000);
  assert.equal(r.loads.dsp1.pfAssumed, false);
  assert.equal(r.loads.mon1.heatW, 30, 'a declared heat is not the power');
});

test('a PDU passes its loads through: the circuit carries what is plugged into it', () => {
  const r = fixtureModel().rollup();
  assert.deepEqual(r.circuits.ckt_1.members, ['pdu1', 'amp1', 'mix1']);
  assert.equal(r.circuits.ckt_1.watts, 180);
  assert.equal(r.circuits.ckt_1.partial.watts, false, 'a PDU that states no draw is not an unknown load');
  assert.equal(r.circuits.ckt_1.weightKg, 11.3, 'but its weight is unknown, so the weight is partial');
  assert.equal(r.circuits.ckt_1.partial.weightKg, true);
  assert.equal(r.circuits.ckt_3.watts, null, 'a converter whose part states no power: unknown, not 0');
  assert.equal(r.circuits.ckt_9.weightKg, 50.681, 'the kit counts its declared 50.5 kg once, plus the speaker');
  assert.equal(r.circuits.ckt_4.planned, true, 'no loads yet: the planned VA stands');
  assert.equal(r.circuits.ckt_4.va, 850);
  assert.equal(r.racks.A01.weightKg, 27.6);
  assert.equal(r.racks.A01.unknown.weightKg, 2, 'PDU A and the converter state no weight');
  assert.equal(r.board.weightKg, null, 'the board states none');
});

test('circuit VA is derived from its loads; the planned figure is used only until there are loads', () => {
  const m = fixtureModel();
  assert.equal(m.circuitVA(m.circuits[0]), 180, 'ckt_1: derived, not its planned 1400 VA');
  assert.equal(m.circuitVA(m.circuits[3]), 850, 'ckt_4: planned');
  const bare = new PowerChainModel();
  assert.equal(bare.getPhaseRollup().total_VA, 15600, 'a block with no loads keeps its planned figures');
});

test('mains text: volts, phases, wires; poles and conductors of a 208 V leg', () => {
  assert.deepEqual(parseMains('120/208V 3-Phase 4-Wire'), { volts: [120, 208], phases: 3, wires: 4, system: null });
  assert.deepEqual(parseMains('230/400 V 3-phase 5-wire TN-S'), { volts: [230, 400], phases: 3, wires: 5, system: 'TN_S' });
  const mains = parseMains('120/208V 3-Phase 4-Wire');
  assert.equal(polesOf({ volts: 208 }, mains), 2);
  assert.equal(polesOf({ volts: 120 }, mains), 1);
  assert.deepEqual(conductorsOf('C', 2), ['PHASE_L3', 'PHASE_L1']);
});

// ---------------------------------------------------------------- power-2: the model as IFC

test('export: 1 board, the main + 10 branch breakers aggregated in it, 10 circuits, 2 PDUs, loads typed by their parts', () => {
  const text = exportFixture();
  assert.ok(text.startsWith('ISO-10303-21;'));
  assert.ok(text.includes("FILE_SCHEMA(('IFC4X3_ADD2'));"));
  const file = parseStep(text);
  const boards = byType(text, 'IFCELECTRICDISTRIBUTIONBOARD');
  assert.equal(boards.length, 3, 'the panel and 2 PDUs');
  const breakers = byType(text, 'IFCPROTECTIVEDEVICE');
  assert.equal(breakers.length, 11);
  assert.ok(breakers.every((b) => b.args[8].value === 'CIRCUITBREAKER'));
  const panel = boards.find((b) => b.args[2] === 'PANEL-EP1');
  const agg = byType(text, 'IFCRELAGGREGATES').find((r) => r.args[4].id === panel.id);
  assert.deepEqual(new Set(agg.args[5].map((r) => r.id)), new Set(breakers.map((b) => b.id)));
  const circuits = byType(text, 'IFCDISTRIBUTIONCIRCUIT');
  assert.equal(circuits.length, 10);
  assert.ok(circuits.every((c) => c.args[6].value === 'ELECTRICAL'));
  // a feed per load: breaker / outlet → supply port
  assert.equal(byType(text, 'IFCRELCONNECTSPORTS').length, LOADS.length);
  // each part's type once, with its own GlobalId (part/<id>, the part file's)
  const pdu = partTypes()['salamander-designs/sa-rm-pdu'];
  const gid = /IFCELECTRICDISTRIBUTIONBOARDTYPE\('([^']+)'/.exec(pdu)[1];
  assert.equal(text.split(`'${gid}'`).length - 1, 1);
  const typedPdu = byType(text, 'IFCRELDEFINESBYTYPE').find((r) => file.byId.get(r.args[5].id).args[0] === gid);
  assert.equal(typedPdu.args[4].length, 1);
  // every GlobalId well-formed and unique
  const gids = file.entities.filter((e) => typeof e.args[0] === 'string' && IFC_GUID_RE.test(e.args[0])).map((e) => e.args[0]);
  assert.equal(new Set(gids).size, gids.length);
});

test('export is byte-deterministic', () => {
  assert.equal(exportFixture(), exportFixture());
});

test('a circuit holds its breaker, the PDU and every load plugged into it (IfcRelAssignsToGroup)', () => {
  const text = exportFixture();
  const file = parseStep(text);
  const c1 = byType(text, 'IFCDISTRIBUTIONCIRCUIT').find((c) => c.args[2] === '1');
  const rel = byType(text, 'IFCRELASSIGNSTOGROUP').find((r) => r.args[6].id === c1.id);
  const names = rel.args[4].map((r) => file.byId.get(r.id)).map((e) => `${e.type}:${e.args[2] ?? ''}`);
  assert.deepEqual(names, ['IFCPROTECTIVEDEVICE:CB-1', 'IFCELECTRICDISTRIBUTIONBOARD:PDU A', 'IFCAUDIOVISUALAPPLIANCE:Biamp REVAMP1120T', 'IFCAUDIOVISUALAPPLIANCE:Allen & Heath USA AH-GX4816']);
});

test('read back: the block, phase roll-up, redundancy audit and every roll-up are what the native model says', () => {
  const m = fixtureModel();
  const text = powerToIfc(m, { types: partTypes() });
  const { model, report } = ifcToPower(text);
  assert.deepEqual(report.lost, []);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), JSON.parse(JSON.stringify(m.toJSON())));
  const { model: back } = modelFromIfc(text, PowerChainModel);
  assert.equal(JSON.stringify(back.getPhaseRollup()), JSON.stringify(m.getPhaseRollup()));
  assert.equal(JSON.stringify(back.checkRedundancyClashes()), JSON.stringify(m.checkRedundancyClashes()));
  assert.equal(JSON.stringify(back.rollup()), JSON.stringify(m.rollup()), 'the roll-ups from the file alone: its embedded part types');
  // and the twin of the twin is the same file
  assert.equal(powerToIfc(back, { types: partTypes() }), text);
});

test('a block with no loads and no part types still writes and reads back (planned loads only)', () => {
  const m = new PowerChainModel({ id: 'power_plan' });
  const text = powerToIfc(m);
  const { model } = ifcToPower(text);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(JSON.stringify(rollup(model).phases), JSON.stringify(rollup(m.toJSON()).phases));
});

test('a load whose part type could not be fetched is a USERDEFINED appliance naming its part, never dropped', () => {
  const m = new PowerChainModel({ id: 'p', loads: [{ id: 'x', part: 'acme/thing', circuit: 'ckt_1', watts: 10 }] });
  const text = powerToIfc(m);
  const app = byType(text, 'IFCELECTRICAPPLIANCE')[0];
  assert.equal(app.args[4], 'acme/thing');
  assert.equal(app.args[8].value, 'USERDEFINED');
  assert.deepEqual(ifcToPower(text).model.loads, m.toJSON().loads);
});

// IfcOpenShell (LGPL, test-only, never vendored) when the environment has it: APK_IFC_PYTHON=<python with ifcopenshell + ifctester>
test('IfcOpenShell: 0 schema + EXPRESS errors, sets match the templates / apk_psets.py, board + breaker IDS specs pass, rack weight = kit_report', { skip: !process.env.APK_IFC_PYTHON && 'set APK_IFC_PYTHON to a python with ifcopenshell + ifctester' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'powerchain-ifc-'));
  const files = {
    'power.ifc': exportFixture(),
    'planned.ifc': powerToIfc(new PowerChainModel({ id: 'power_plan' })),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const script = new URL('../scripts/validate-ifc.py', import.meta.url).pathname;
  const run = spawnSync(process.env.APK_IFC_PYTHON, ['-I', script, ...Object.keys(files).map((n) => join(dir, n))], { cwd: tmpdir(), encoding: 'utf8' });
  const rows = run.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, Object.keys(files).length, run.stderr);
  for (const r of rows) {
    assert.equal(r.schema, 'IFC4X3_ADD2', r.file);
    assert.equal(r.statements, 0, `${r.file}: ${r.first.join(' | ')}`);
    assert.deepEqual(r.checks, [], r.file);
    if (!r.oracle) continue;
    assert.deepEqual(r.pset_problems, [], r.file);
    const own = r.ids_failures.filter((x) => !x.part && /boards|breakers/.test(x.spec));
    assert.deepEqual(own, [], `${r.file}: this editor's board and breakers pass apk-av.ids`);
    const breakerSpec = r.ids.find((x) => x[0] === 'Circuit breakers carry breaking capacity');
    assert.equal(breakerSpec[1], true, r.file);
  }
  const planned = rows.find((r) => r.file.endsWith('planned.ifc'));
  if (planned.oracle) assert.equal(planned.ids.find((x) => x[0] === 'Distribution boards carry their rating')[1], true, 'no part types: the board spec passes outright');
  const power = rows.find((r) => r.file.endsWith('power.ifc'));
  assert.equal(power.circuits.length, 10);
  assert.deepEqual(power.circuits.find((c) => c.name === '1').elements, ['IfcAudioVisualAppliance', 'IfcAudioVisualAppliance', 'IfcElectricDistributionBoard', 'IfcProtectiveDevice']);
  for (const rack of power.racks) if (rack.walk !== null) assert.equal(rack.walk, rack.loaded, rack.name);
  assert.equal(run.status, 0, run.stdout);
});

test('part types come from /api/bim/parts/<maker>/<model>.ifc; a part that does not answer stays unknown, its load kept', async () => {
  const { loadPartTypes, partIfcUrl } = await import('../js/partTypes.js');
  assert.equal(partIfcUrl('google/google-nest-mini', '/api/bim'), '/api/bim/parts/google/google-nest-mini.ifc');
  const texts = partTypes();
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    const pid = decodeURIComponent(url.replace('/api/bim/parts/', '').replace(/\.ifc$/, ''));
    return texts[pid] ? { ok: true, text: async () => texts[pid] } : { ok: false, status: 404, text: async () => '' };
  };
  const m = new PowerChainModel({ id: 'p', loads: [...LOADS, { id: 'x', part: 'acme/thing', circuit: 'ckt_4' }] });
  const cache = new Map();
  const r = await loadPartTypes(m, cache, { fetchFn, base: '/api/bim' });
  assert.deepEqual(r.missing, ['acme/thing']);
  assert.equal(Object.keys(r.types).length, Object.keys(texts).length);
  assert.equal(m.rollup().loads.spk1.watts, 15);
  await loadPartTypes(m, cache, { fetchFn, base: '/api/bim' });
  assert.equal(asked.length, Object.keys(texts).length + 1, 'each part asked once');
  assert.equal(powerToIfc(m, { types: r.types }), powerToIfc(m, { types: r.types }));
});
