// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* A power chain fixture (IFC-CORE-DELTAS power-2 VERIFY): 1 board, 10 breakers, 2 PDUs, 6 rack
   devices, a desk speaker and a display kit. The part types are the BIM library's stored twins
   (DATABASE.server.BIM SRC/library/<maker>/<model>.ifc), copied into fixtures/parts so this repo
   tests on its own. Loads that declare their own watts / kg are the occurrence's figures (most
   library parts state none); the speaker's come from its part type. */
import { readFileSync, readdirSync } from 'node:fs';
import { PowerChainModel } from '../js/powerChainModel.js';
import { partFacts } from '../js/powerRollup.js';

const DIR = new URL('./fixtures/parts/', import.meta.url);

/** {partId: .ifc text} of every fixture part. */
export function partTypes() {
  const out = {};
  for (const f of readdirSync(DIR).sort()) out[f.replace('--', '/').replace(/\.ifc$/, '')] = readFileSync(new URL(f, DIR), 'utf8');
  return out;
}

export const LOADS = [
  { id: 'pdu1', part: 'salamander-designs/sa-rm-pdu', name: 'PDU A', circuit: 'ckt_1', rack: 'A01' },
  { id: 'pdu2', part: 'servertech/c4w36ra-0abe2fe2', name: 'PDU B', circuit: 'ckt_2', rack: 'A01', weightKg: 4.1 },
  { id: 'amp1', part: 'biamp/revamp1120t', fedBy: 'pdu1', rack: 'A01', watts: 120, weightKg: 4.5 },
  { id: 'mix1', part: 'allen-and-heath-usa/ah-gx4816', fedBy: 'pdu1', rack: 'A01', watts: 60, weightKg: 6.8 },
  { id: 'box1', part: 'allen-and-heath-usa/ar2-2412-blk', fedBy: 'pdu2', rack: 'A01', watts: 75, weightKg: 7.2 },
  { id: 'dsp1', part: 'wheatstone/134', fedBy: 'pdu2', rack: 'A01', watts: 150, powerFactor: 0.95, weightKg: 5 },
  { id: 'conv1', part: 'aja/drm', circuit: 'ckt_3', rack: 'A01' },
  { id: 'mon1', part: 'densitron/ids-dm132', circuit: 'ckt_5', rack: 'A02', watts: 35, heatW: 30, weightKg: 3.2 },
  { id: 'spk1', part: 'google/google-nest-mini', circuit: 'ckt_9' },
  { id: 'kit1', name: 'Display kit', circuit: 'ckt_9', watts: 180, weightKg: 50.5,
    parts: [{ name: 'Display', weightKg: 38.5, watts: 180 }, { name: 'Arm', weightKg: 12 }] },
];

/** The fixture as a PowerChainModel with its part facts read from the fixture types. */
export function fixtureModel(over = {}) {
  const m = new PowerChainModel({ id: 'power_fixture', loads: LOADS, ...over });
  for (const [pid, text] of Object.entries(partTypes())) m.setPartFacts(pid, partFacts(text, pid));
  return m;
}
