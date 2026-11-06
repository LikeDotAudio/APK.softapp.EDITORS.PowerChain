// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { linkBlock, mountDiscovered } from './softappLink.js';
import { PowerChainModel } from './powerChainModel.js';
import { renderPowerDiagramSvg } from './powerChainSvg.js';
import { powerToIfc } from './ifc/powerToIfc.js';
import { modelFromIfc } from './ifc/ifcToPower.js';
import { loadPartTypes } from './partTypes.js';
import { libraryButton } from './bimLibraryPicker.js';

let model = new PowerChainModel();
/** pid → the part's .ifc type text (or null when the BIM API did not give it) */
const typeCache = new Map();
let missingParts = [];

/** Read the loads' part types from the BIM library, then redraw with their facts. */
async function refreshParts() {
  const r = await loadPartTypes(model, typeCache);
  missingParts = r.missing;
  renderAll();
  return r;
}

const S = window.APKSoftapp;
const esc = S.esc;

const bridge = linkBlock(S, {
  editor: 'Power Chain Editor',
  blockType: 'powerchain',
  Model: PowerChainModel,
  getModel: () => model,
  setModel: (m, meta) => {
    model = m;
    const tag = document.getElementById('block-tag');
    if (tag && (meta.blockName || meta.filename)) tag.textContent = meta.blockName || meta.filename;
    renderAll();
    refreshParts();
  },
  filename: (m) => m.panelName.toLowerCase().replace(/\s+/g, '_'),
});

function renderInspector() {
  const container = document.getElementById('inspector-content');
  if (!container) return;

  if (model.selectedCircuitId) {
    const ckt = model.circuits.find((c) => c.id === model.selectedCircuitId);
    if (!ckt) {
      model.selectedCircuitId = null;
      renderInspector();
      return;
    }

    const amps = model.calculateCircuitAmps(ckt);
    const capPct = model.getCircuitCapacityPercent(ckt);
    const roll = model.rollup();
    const r = roll.circuits[ckt.id] || { members: [] };
    const hasLoads = r.members.length > 0;

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--osc-border-default); padding-bottom: 8px;">
        <span style="font-weight: 700; color: var(--osc-text-primary); font-size: 13px;">CKT ${esc(ckt.number)} — ${esc(ckt.label)}</span>
        <button class="btn btn-secondary btn-sm" id="btn-delete-ckt" style="color: var(--osc-status-danger);">🗑️ Delete</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CIRCUIT LABEL</label>
          <input type="text" class="input" id="inp-label" value="${esc(ckt.label)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">PHASE (L1/L2/L3)</label>
            <select class="input" id="inp-phase">
              <option value="A" ${ckt.phase === 'A' ? 'selected' : ''}>Phase A (L1)</option>
              <option value="B" ${ckt.phase === 'B' ? 'selected' : ''}>Phase B (L2)</option>
              <option value="C" ${ckt.phase === 'C' ? 'selected' : ''}>Phase C (L3)</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">BREAKER RATING</label>
            <select class="input" id="inp-breaker">
              <option value="15" ${ckt.breakerAmps === 15 ? 'selected' : ''}>15 Amp</option>
              <option value="20" ${ckt.breakerAmps === 20 ? 'selected' : ''}>20 Amp</option>
              <option value="30" ${ckt.breakerAmps === 30 ? 'selected' : ''}>30 Amp</option>
              <option value="50" ${ckt.breakerAmps === 50 ? 'selected' : ''}>50 Amp</option>
            </select>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">VOLTAGE (V)</label>
            <input type="number" class="input" id="inp-volts" value="${esc(ckt.volts)}">
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">${hasLoads ? 'LOAD (VA, FROM ITS LOADS)' : 'PLANNED LOAD (VA)'}</label>
            <input type="number" class="input" id="inp-load-va" value="${esc(hasLoads ? r.va ?? '' : ckt.loadsVA)}" ${hasLoads ? 'readonly title="Derived: W / power factor of the loads below. The planned figure counts only while the circuit has no loads."' : ''}>
          </div>
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">REDUNDANT GROUP PAIRING</label>
          <input type="text" class="input" id="inp-redundant" value="${esc(ckt.redundantGroup || '')}" placeholder="e.g. CONSOLE, CORE_DSP, VISION">
          <small style="font-size: 9px; color: var(--osc-text-subtle);">Redundant feeds should be on different phases</small>
        </div>
        
        <div style="padding: 10px; background: var(--osc-bg-input); border: 1px solid var(--osc-border-default); border-radius: 4px; margin-top: 4px;">
          <div style="font-size: 10px; color: var(--osc-text-muted); margin-bottom: 4px;">ELECTRICAL TELEMETRY</div>
          <div style="display: flex; justify-content: space-between; font-weight: 600;">
            <span>Calculated Amperage:</span>
            <span style="color: var(--osc-accent-primary);">${amps} A</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 600; margin-top: 4px;">
            <span>Continuous Loading (NEC 80%):</span>
            <span style="color: ${capPct > 100 ? 'var(--osc-status-danger)' : 'var(--osc-status-success)'};">${capPct}%</span>
          </div>
          ${hasLoads ? `<div style="display: flex; justify-content: space-between; margin-top: 4px;"><span>Load / heat / weight:</span>
            <span>${figure(r.watts, 'W', r.partial.watts)} · ${figure(r.heatW, 'W', r.partial.heatW, r.heatAssumed)} · ${figure(r.weightKg, 'kg', r.partial.weightKg)}</span></div>` : ''}
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin: 4px 0;">
            <span style="font-size: 10px; color: var(--osc-text-muted);">LOADS (BIM PARTS)</span>
            <span id="add-load-slot"></span>
          </div>
          ${loadRows(ckt, r, roll)}
        </div>
      </div>
    `;

    const slot = document.getElementById('add-load-slot');
    if (slot) {
      slot.append(libraryButton((items) => {
        for (const it of items) model.addLoad({ part: (it.bim && it.bim.id) || (it.ref && it.ref.part), name: null, circuit: ckt.id });
        bridge.changed();
        renderAll();
        refreshParts();
      }, { label: '📚 Add load', title: 'Add a load to this circuit from the BIM library', className: 'btn btn-secondary btn-sm', multiple: true }));
    }
    container.querySelectorAll('[data-load]').forEach((el) => {
      const id = el.getAttribute('data-load');
      const field = el.getAttribute('data-field');
      const ev = el.tagName === 'SELECT' || el.tagName === 'BUTTON' ? (el.tagName === 'BUTTON' ? 'click' : 'change') : 'change';
      el.addEventListener(ev, () => {
        if (field === 'delete') model.deleteLoad(id);
        else if (field === 'feed') {
          const v = el.value;
          model.updateLoad(id, v.startsWith('load:') ? { fedBy: v.slice(5), circuit: null } : { circuit: v.slice(8), fedBy: null });
        } else if (field === 'rack' || field === 'name') model.updateLoad(id, { [field]: el.value.trim() || null });
        else {
          const x = el.value === '' ? null : Number(el.value);
          model.updateLoad(id, { [field]: Number.isFinite(x) ? x : null });
        }
        bridge.changed();
        renderAll();
      });
    });

    document.getElementById('btn-delete-ckt')?.addEventListener('click', () => {
      model.deleteCircuit(ckt.id);
      bridge.changed();
      renderAll();
    });

    const bindField = (id, prop, isNum = false) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = isNum ? parseFloat(e.target.value) || 0 : e.target.value;
        model.updateCircuit(ckt.id, { [prop]: val });
        bridge.changed();
        renderSvg();
        renderHeaderStats();
        renderClashes();
      });
    };

    bindField('inp-label', 'label');
    bindField('inp-phase', 'phase');
    bindField('inp-breaker', 'breakerAmps', true);
    bindField('inp-volts', 'volts', true);
    bindField('inp-load-va', 'loadsVA', true);
    bindField('inp-redundant', 'redundantGroup');

  } else {
    container.innerHTML = `
      <div style="padding: 20px 10px; text-align: center; color: var(--osc-text-muted);">
        <div style="font-size: 28px; margin-bottom: 8px; opacity: 0.5;">⚡</div>
        <div>Select a circuit row from the single-line diagram to inspect and edit load ratings.</div>
      </div>
    `;
  }
}

/** A roll-up figure: unknown is shown as unknown, never 0; a partial sum is marked ≥. */
function figure(v, unit, partial = false, assumed = false) {
  if (v == null) return '<span title="no part or load states it">unknown</span>';
  const t = `${partial ? '≥ ' : ''}${Math.round(v * 100) / 100} ${unit}`;
  return `<span title="${partial ? 'known part only: some loads state none' : ''}${assumed ? ' (heat assumed = power)' : ''}">${esc(t)}${assumed ? '*' : ''}</span>`;
}

/** The loads on a circuit (wired to its breaker, or plugged into a PDU on it), editable. */
function loadRows(ckt, r, roll) {
  const loads = model.loads.filter((l) => r.members.includes(l.id));
  const unplugged = model.loads.filter((l) => !l.circuit && !l.fedBy);
  if (!loads.length) {
    return `<div style="font-size: 10px; color: var(--osc-text-subtle);">No loads yet: the planned VA above stands. 📚 Add load picks BIM parts.${unplugged.length ? ` ${unplugged.length} load(s) are plugged into nothing.` : ''}</div>`;
  }
  const feeds = [`<option value="circuit:${esc(ckt.id)}">CB-${esc(ckt.number)} (this breaker)</option>`]
    .concat(loads.filter((l) => model.loads.some((x) => x.fedBy === l.id) || (l.part && model.partFacts.get(l.part)?.outlets?.length) || /pdu/i.test(l.part || '')).map((l) => `<option value="load:${esc(l.id)}">${esc(l.name || l.part || l.id)}</option>`));
  const cell = 'style="width: 100%; font-size: 10px; padding: 2px 4px;"';
  return loads.map((l) => {
    const f = roll.loads[l.id];
    const missing = l.part && missingParts.includes(l.part);
    const feed = l.fedBy ? `load:${l.fedBy}` : `circuit:${l.circuit}`;
    return `
      <div style="border: 1px solid var(--osc-border-default); border-radius: 4px; padding: 6px; margin-bottom: 6px; font-size: 10px;">
        <div style="display: flex; justify-content: space-between; gap: 6px;">
          <input class="input" ${cell} data-load="${esc(l.id)}" data-field="name" value="${esc(l.name || '')}" placeholder="${esc(f?.facts?.name || l.part || 'Planned load')}">
          <button class="btn btn-secondary btn-sm" data-load="${esc(l.id)}" data-field="delete" title="Remove this load">🗑️</button>
        </div>
        <div style="color: var(--osc-text-subtle); margin: 2px 0;">${esc(l.part || 'planned load (no part)')}${missing ? ' — the BIM library did not give its type: figures are this load\'s own only' : ''}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px;">
          <label>W <input class="input" ${cell} type="number" data-load="${esc(l.id)}" data-field="watts" value="${esc(l.watts ?? '')}" placeholder="${esc(f?.facts?.watts ?? '?')}"></label>
          <label>kg <input class="input" ${cell} type="number" data-load="${esc(l.id)}" data-field="weightKg" value="${esc(l.weightKg ?? '')}" placeholder="${esc(f?.facts?.weightKg ?? '?')}"></label>
          <label>rack <input class="input" ${cell} data-load="${esc(l.id)}" data-field="rack" value="${esc(l.rack || '')}"></label>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 6px; margin-top: 4px;">
          <select class="input" ${cell} data-load="${esc(l.id)}" data-field="feed">${feeds.map((o) => o.replace(`value="${esc(feed)}"`, `value="${esc(feed)}" selected`)).join('')}</select>
          <span style="white-space: nowrap;">${figure(f?.watts, 'W')} · ${figure(f?.weightKg, 'kg')}</span>
        </div>
      </div>`;
  }).join('');
}

function renderHeaderStats() {
  const container = document.getElementById('telemetry-metrics');
  if (!container) return;

  const rollup = model.getPhaseRollup();
  const b = model.rollup().board;
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 14px; font-size: 10px; color: var(--osc-text-muted);">
      <span>TOTAL LOAD: <strong style="color: var(--osc-accent-primary);">${(rollup.total_VA / 1000).toFixed(2)} kVA</strong></span>
      ${model.loads.length ? `<span>DEVICES: <strong>${figure(b.watts, 'W', b.partial.watts)}</strong> · HEAT <strong>${figure(b.heatW, 'W', b.partial.heatW)}</strong></span>` : ''}
      <span>PHASE UNBALANCE: <strong style="color: ${rollup.unbalancePercent > 20 ? 'var(--osc-status-warning)' : 'var(--osc-status-success)'};">${esc(rollup.unbalancePercent)}%</strong></span>
      <span>CIRCUITS: <strong style="color: var(--osc-text-primary);">${esc(model.circuits.length)}</strong></span>
    </div>
  `;
}

function renderClashes() {
  const container = document.getElementById('redundancy-clashes');
  if (!container) return;

  const clashes = model.checkRedundancyClashes();
  if (clashes.length === 0) {
    container.innerHTML = `
      <div style="padding: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--osc-status-success); border-radius: 4px; font-size: 10px; color: var(--osc-status-success);">
        ✓ Redundancy Audit: All dual-feed groups correctly isolated across different phases.
      </div>
    `;
  } else {
    container.innerHTML = clashes.map((c) => `
      <div style="padding: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid var(--osc-status-danger); border-radius: 4px; font-size: 10px; color: var(--osc-status-danger); margin-bottom: 6px;">
        ⚠️ <strong>${esc(c.group)}:</strong> ${esc(c.reason)}
      </div>
    `).join('');
  }
}

function renderSvg() {
  const container = document.getElementById('canvas-wrapper');
  if (!container) return;

  container.innerHTML = renderPowerDiagramSvg(model, {
    selectedCircuitId: model.selectedCircuitId,
  });

  const svg = container.querySelector('#power-canvas-svg');
  if (!svg) return;

  svg.querySelectorAll('.circuit-row').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-circuit-id');
      model.selectedCircuitId = id;
      renderAll();
    });
  });

  svg.addEventListener('click', () => {
    model.selectedCircuitId = null;
    renderAll();
  });
}

function renderAll() {
  renderSvg();
  renderInspector();
  renderHeaderStats();
  renderClashes();
}

document.addEventListener('DOMContentLoaded', () => {
  S.describe({
    name: 'Power Chain Editor',
    does: 'Lays out a power panel: breaker circuits per phase, their load against rating, and a redundancy audit of dual-feed groups.',
    inputs: [
      { name: 'Power chain block', from: 'the CAD block this editor was opened on (host@1 load)', kind: 'cad' },
      { name: 'Block file', from: '.json or its .ifc twin picked with Open (APKSoftapp.openModel)', kind: 'file' },
      { name: 'Load part types', from: 'GET /api/bim/parts/<maker>/<model>.ifc: power, heat, weight and connector of each load\'s BIM part', kind: 'http' },
      { name: 'BIM library picker', from: '📚 Add load (APKLibrary.pick): {bim, ref} of each part placed as a load', kind: 'http' },
      { name: 'Discovered things', from: 'APKSoftapp.discovered() on the bus, filtered by config/discovered.json kinds', kind: 'bus' },
    ],
    outputs: [
      { name: 'Power chain block', to: 'the CAD drawing on Save & Return, or a .json download standalone', kind: 'cad' },
      { name: 'Model + .ifc twin', to: '💾 Save Model: <panel>.json and <panel>.ifc (IFC4X3_ADD2: board, breakers, IfcDistributionCircuit per circuit, loads typed by their BIM parts, roll-ups)', kind: 'file' },
      { name: 'Live edits', to: 'the CAD after every change (blockChanged)', kind: 'cad' },
      { name: 'Redundancy audit', to: 'on screen: groups whose feeds share a phase', kind: 'screen' },
    ],
    controls: [
      { name: '➕ Add Breaker Circuit', how: 'adds a circuit and selects it' },
      { name: 'Click a circuit', how: 'inspect it: label, phase, breaker rating, voltage, planned VA, redundant group, its loads; 🗑️ deletes it' },
      { name: '📚 Add load', how: 'pick BIM parts as loads on the circuit; per load: own W / kg (else its part\'s), rack, breaker or PDU it plugs into' },
      { name: '💾 Save Model', how: 'write the block as .json and its .ifc twin, both or neither' },
      { name: '⚡ Discovered', how: 'show / hide what the bus knows' },
      { name: 'Save & Return / ✕', how: 'save into the CAD (or download) / close the editor' },
    ],
    problems: ['bad_json', 'bad_input', 'file_unreadable', 'bus_missing', 'not_in_cad', 'save_failed'],
  });
  renderAll();
  refreshParts();

  document.getElementById('btn-add-circuit')?.addEventListener('click', () => {
    const newCkt = model.addCircuit({});
    model.selectedCircuitId = newCkt.id;
    bridge.changed();
    renderAll();
  });

  let opened = new Map();
  document.getElementById('btn-open-block')?.addEventListener('click', async () => {
    const o = await S.openModel({
      fromIfc: (text) => {
        const m = modelFromIfc(text, PowerChainModel).model;
        opened = m.partFacts; // the part types the file itself embeds: the roll-ups work offline too
        return m.toJSON();
      },
      fromJson: (data) => data,
    });
    if (!o.ok) {
      if (!o.cancelled && o.problem) {
        S.showProblem(o.problem, { fix: ['Open a power chain block saved by this editor (.json, blockType powerchain) or its .ifc twin.'] });
      }
      return;
    }
    bridge.openLocal(o.model, { filename: o.name });
    for (const [pid, f] of opened) if (!model.partFacts.has(pid)) model.setPartFacts(pid, f);
    opened = new Map();
    renderAll();
  });

  document.getElementById('btn-save-model')?.addEventListener('click', async () => {
    const r = await S.saveModel(model, {
      name: model.panelName.toLowerCase().replace(/\s+/g, '_'),
      toJson: (m) => m.toJSON(),
      toIfc: async (m) => powerToIfc(m, { types: (await loadPartTypes(m, typeCache)).types }),
    });
    if (!r.ok && !r.cancelled && r.problem) S.showProblem(r.problem);
  });

  mountDiscovered(S, window.APKTable, {
    button: document.getElementById('btn-discovered'),
    panel: document.getElementById('discovered-panel'),
    status: document.getElementById('discovered-status'),
    tableHost: document.getElementById('discovered-table'),
    tableId: 'powerchain-discovered',
  });

  document.getElementById('btn-save-block')?.addEventListener('click', () => {
    bridge.save();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    bridge.close();
  });
});
