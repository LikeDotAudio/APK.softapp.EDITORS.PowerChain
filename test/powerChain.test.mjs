// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerChainModel } from '../js/powerChainModel.js';
import { renderPowerDiagramSvg } from '../js/powerChainSvg.js';

test('PowerChainModel initializes with default 3-phase circuits', () => {
  const model = new PowerChainModel();
  assert.equal(model.panelName, 'PANEL-EP1');
  assert.ok(model.circuits.length >= 8);
  const rollup = model.getPhaseRollup();
  assert.ok(rollup.total_VA > 0);
  assert.ok(rollup.phaseA_VA > 0);
  assert.ok(rollup.phaseB_VA > 0);
  assert.ok(rollup.phaseC_VA > 0);
});

test('calculateCircuitAmps and capacity percentage adhere to NEC 80% continuous limit', () => {
  const model = new PowerChainModel();
  const ckt = { breakerAmps: 20, volts: 120, loadsVA: 1200 };
  const amps = model.calculateCircuitAmps(ckt);
  assert.equal(amps, 10); // 1200 / 120 = 10A

  // Max continuous rating = 20 * 0.8 = 16A. 10 / 16 = 62.5% -> 63%
  const capPct = model.getCircuitCapacityPercent(ckt);
  assert.equal(capPct, 63);
});

test('PowerChainModel detects redundancy clashes when dual feeds share a single phase', () => {
  const model = new PowerChainModel();
  // Clear and configure a clash
  model.circuits = [
    { id: 'c1', number: 1, phase: 'A', breakerAmps: 20, volts: 120, label: 'Core PSU A', loadsVA: 500, redundantGroup: 'CORE' },
    { id: 'c2', number: 2, phase: 'A', breakerAmps: 20, volts: 120, label: 'Core PSU B', loadsVA: 500, redundantGroup: 'CORE' },
  ];
  const clashes = model.checkRedundancyClashes();
  assert.equal(clashes.length, 1);
  assert.ok(clashes[0].reason.includes('share Phase A/A'));

  // Separate onto different phases (A and B)
  model.circuits[1].phase = 'B';
  const resolved = model.checkRedundancyClashes();
  assert.equal(resolved.length, 0);
});

test('renderPowerDiagramSvg generates SVG markup with circuits and 3-phase bar chart', () => {
  const model = new PowerChainModel();
  const svg = renderPowerDiagramSvg(model);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('PANEL-EP1'));
  assert.ok(svg.includes('3-PHASE BALANCE'));
  assert.ok(svg.includes('CKT 01'));
});
