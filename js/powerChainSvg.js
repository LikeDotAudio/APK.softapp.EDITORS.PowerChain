// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.


/* Every text from the model is escaped before it goes into the SVG markup. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function renderPowerDiagramSvg(model, options = {}) {
  const { selectedCircuitId = null } = options;
  const rollup = model.getPhaseRollup();

  const phaseColors = {
    A: '#EF4444', // Red (Phase A / L1)
    B: '#000000', // Black (Phase B / L2) - rendered as #3B82F6 in dark mode
    C: '#3B82F6', // Blue (Phase C / L3)
  };
  const phaseDisplayColors = {
    A: '#EF4444',
    B: '#F59E0B',
    C: '#3B82F6',
  };

  const svgWidth = 840;
  const svgHeight = 480;

  // Render 3-phase bar telemetry
  const maxPhaseVA = Math.max(1, rollup.phaseA_VA, rollup.phaseB_VA, rollup.phaseC_VA);
  const barMaxH = 90;

  const hA = Math.round((rollup.phaseA_VA / maxPhaseVA) * barMaxH);
  const hB = Math.round((rollup.phaseB_VA / maxPhaseVA) * barMaxH);
  const hC = Math.round((rollup.phaseC_VA / maxPhaseVA) * barMaxH);

  // Circuits grid
  const rowHeight = 28;
  const startY = 160;

  const circuitsRowsSvg = model.circuits.map((ckt, idx) => {
    const isSelected = ckt.id === selectedCircuitId;
    const y = startY + idx * rowHeight;
    const amps = model.calculateCircuitAmps(ckt);
    const capPct = model.getCircuitCapacityPercent(ckt);
    const pColor = phaseDisplayColors[ckt.phase] || '#888888';
    const isOverload = capPct > 100;
    const isNearLimit = capPct > 80;

    return `
      <g class="circuit-row" data-circuit-id="${esc(ckt.id)}" style="cursor: pointer;">
        <rect x="20" y="${y}" width="${svgWidth - 40}" height="${rowHeight - 4}" rx="4"
          fill="${isSelected ? '#2c2c2c' : '#18181b'}"
          stroke="${isSelected ? '#F4902C' : isOverload ? '#EF4444' : '#2c2c2c'}"
          stroke-width="${isSelected ? 2 : 1}"
        />
        <!-- Phase Indicator Pill -->
        <circle cx="40" cy="${y + 12}" r="6" fill="${pColor}"/>
        <text x="56" y="${y + 16}" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#f4f4f5">CKT ${String(ckt.number).padStart(2, '0')}</text>
        <text x="120" y="${y + 16}" font-family="-apple-system, sans-serif" font-size="11" fill="#f4f4f5">${esc(ckt.label)}</text>
        
        <!-- Redundancy badge -->
        ${ckt.redundantGroup ? `
          <rect x="360" y="${y + 4}" width="${ckt.redundantGroup.length * 7 + 14}" height="16" rx="3" fill="#2c2c2c" stroke="#F4902C" stroke-width="0.75"/>
          <text x="367" y="${y + 15}" font-family="'JetBrains Mono', monospace" font-size="9" fill="#F4902C">GRP:${esc(ckt.redundantGroup)}</text>
        ` : ''}

        <text x="480" y="${y + 16}" font-family="'JetBrains Mono', monospace" font-size="11" fill="#888888">${esc(ckt.volts)}V · ${esc(ckt.breakerAmps)}A</text>
        <text x="580" y="${y + 16}" font-family="'JetBrains Mono', monospace" font-size="11" fill="#f4f4f5">${esc(ckt.loadsVA)} VA</text>
        <text x="660" y="${y + 16}" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" fill="${isOverload ? '#EF4444' : isNearLimit ? '#F59E0B' : '#10B981'}">${amps} A (${capPct}%)</text>
        
        <!-- Progress mini bar -->
        <rect x="750" y="${y + 8}" width="60" height="8" rx="2" fill="#121212"/>
        <rect x="750" y="${y + 8}" width="${Math.min(60, (capPct / 100) * 60)}" height="8" rx="2" fill="${isOverload ? '#EF4444' : isNearLimit ? '#F59E0B' : '#10B981'}"/>
      </g>
    `;
  }).join('');

  return `
    <svg id="power-canvas-svg" width="${svgWidth}" height="${Math.max(svgHeight, startY + model.circuits.length * rowHeight + 40)}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#121212"/>

      <!-- Panel Summary Header Card -->
      <g transform="translate(20, 20)">
        <rect width="${svgWidth - 40}" height="120" rx="6" fill="#18181b" stroke="#2c2c2c" stroke-width="1"/>
        <text x="20" y="28" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#f4f4f5">${esc(model.panelName)} — MAIN DISTRIBUTION</text>
        <text x="20" y="46" font-family="'JetBrains Mono', monospace" font-size="11" fill="#888888">${esc(model.mainsConfig)} · ${esc(model.mainBreakerAmps)}A Main Breaker</text>
        <text x="20" y="66" font-family="'JetBrains Mono', monospace" font-size="11" fill="#F4902C">Total Load: ${(rollup.total_VA / 1000).toFixed(2)} kVA · Unbalance: ${esc(rollup.unbalancePercent)}%</text>

        <!-- Phase Balance Bars -->
        <g transform="translate(${svgWidth - 280}, 16)">
          <text x="0" y="12" font-family="-apple-system, sans-serif" font-size="10" font-weight="600" fill="#888888">3-PHASE BALANCE</text>
          
          <!-- Phase A -->
          <rect x="0" y="${20 + (barMaxH - hA)}" width="22" height="${hA}" rx="2" fill="${phaseDisplayColors.A}"/>
          <text x="11" y="102" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="#888888">A</text>
          
          <!-- Phase B -->
          <rect x="34" y="${20 + (barMaxH - hB)}" width="22" height="${hB}" rx="2" fill="${phaseDisplayColors.B}"/>
          <text x="45" y="102" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="#888888">B</text>

          <!-- Phase C -->
          <rect x="68" y="${20 + (barMaxH - hC)}" width="22" height="${hC}" rx="2" fill="${phaseDisplayColors.C}"/>
          <text x="79" y="102" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="#888888">C</text>
        </g>
      </g>

      <!-- Circuits schedule list -->
      ${circuitsRowsSvg}
    </svg>
  `;
}
