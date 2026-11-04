// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { linkBlock, mountDiscovered } from './softappLink.js';
import { PowerChainModel } from './powerChainModel.js';
import { renderPowerDiagramSvg } from './powerChainSvg.js';

let model = new PowerChainModel();

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
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CONNECTED LOAD (VA)</label>
            <input type="number" class="input" id="inp-load-va" value="${esc(ckt.loadsVA)}">
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
        </div>
      </div>
    `;

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

function renderHeaderStats() {
  const container = document.getElementById('telemetry-metrics');
  if (!container) return;

  const rollup = model.getPhaseRollup();
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 14px; font-size: 10px; color: var(--osc-text-muted);">
      <span>TOTAL LOAD: <strong style="color: var(--osc-accent-primary);">${(rollup.total_VA / 1000).toFixed(2)} kVA</strong></span>
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
  renderAll();

  document.getElementById('btn-add-circuit')?.addEventListener('click', () => {
    const newCkt = model.addCircuit({});
    model.selectedCircuitId = newCkt.id;
    bridge.changed();
    renderAll();
  });

  document.getElementById('btn-open-block')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          bridge.openLocal(parsed, { filename: file.name });
        } catch (err) {
          alert('Failed to parse power file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
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
