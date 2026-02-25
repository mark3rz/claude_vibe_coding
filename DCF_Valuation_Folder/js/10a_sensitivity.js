/* ============================================================
   TASK 10A — Sensitivity Tables
   Two sensitivity tables rendered into #section-sensitivity:
     Table A: Implied Share Price — WACC vs Terminal Growth Rate
     Table B: Implied Share Price — Revenue Growth vs EBIT Margin
   Uses buildSensitivityTable() helper.
   Red → white → green color scale centered on base case.
   Base case cell highlighted with strong border.
   NO sliders. NO tornado chart. NO refactoring of existing logic.
============================================================ */

// --- Lightweight DCF for sensitivity: only returns implied share price ---
// Avoids recalculating full state.dcf — runs a minimal in-memory pass.
function sensitivityPrice(overrides) {
  if (!state.historical?.metrics) return null;

  const inp = { ...state.inputs, ...overrides };

  // Validate WACC > terminal growth
  if (inp.wacc <= inp.terminalGrowth) return null;

  const m    = state.historical.metrics;
  const n    = inp.forecastYears;
  const wacc = inp.wacc;
  const g    = inp.terminalGrowth;

  // Base year revenue
  let rev = null;
  if (m.revenue) {
    for (let i = m.revenue.length - 1; i >= 0; i--) {
      if (m.revenue[i] !== null && isFinite(m.revenue[i])) { rev = m.revenue[i]; break; }
    }
  }
  if (!rev) return null;

  // Project FCFs
  let pvFCFSum = 0;
  let prevRev  = rev;
  let lastFCF  = 0;

  for (let i = 0; i < n; i++) {
    const r      = prevRev * (1 + inp.revenueGrowth);
    const nopat  = r * inp.ebitMargin * (1 - inp.taxRate);
    const capex  = r * inp.capexPct;
    const da     = capex * 0.8;
    const nwc    = (r - prevRev) * inp.nwcPct;
    const fcf    = nopat + da - capex - nwc;
    pvFCFSum    += fcf / Math.pow(1 + wacc, i + 0.5);
    lastFCF      = fcf;
    prevRev      = r;
  }

  const terminalValue = (lastFCF * (1 + g)) / (wacc - g);
  const pvTerminal    = terminalValue / Math.pow(1 + wacc, n);
  const ev            = pvFCFSum + pvTerminal;
  const equity        = ev - (inp.netDebt || 0) - (inp.minorityInterest || 0) + (inp.cashAndEquiv || 0);
  const shares        = inp.sharesOutstanding;

  if (!shares || shares <= 0) return equity; // return equity value if no shares
  return equity / shares;
}

// --- Color interpolation: red(0) → white(0.5) → green(1) ---
function sensitivityColor(t) {
  // t in [0, 1]
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {
    // red → white
    const f = t / 0.5;
    const r = 220;
    const g = Math.round(60  + f * (255 - 60));
    const b = Math.round(60  + f * (255 - 60));
    return `rgba(${r},${g},${b},0.75)`;
  } else {
    // white → green
    const f = (t - 0.5) / 0.5;
    const r = Math.round(255 - f * (255 - 40));
    const g = Math.round(255 - f * (255 - 167));
    const b = Math.round(255 - f * (255 - 69));
    return `rgba(${r},${g},${b},0.75)`;
  }
}

// --- buildSensitivityTable() ---
// rowValues:    array of row axis values (e.g. WACC values)
// colValues:    array of col axis values (e.g. terminal growth values)
// rowKey:       state.inputs key for row axis
// colKey:       state.inputs key for col axis
// rowLabel:     display label for row axis
// colLabel:     display label for col axis
// formatVal:    fn(val) → display string for each cell
// formatAxis:   fn(val) → display string for axis labels
// baseRowVal:   base case value of row axis (for highlighting)
// baseColVal:   base case value of col axis (for highlighting)
function buildSensitivityTable(opts) {
  const {
    rowValues, colValues,
    rowKey, colKey,
    rowLabel, colLabel,
    formatVal, formatAxis,
    baseRowVal, baseColVal,
  } = opts;

  // Compute all prices
  const prices = rowValues.map(rv =>
    colValues.map(cv => sensitivityPrice({ [rowKey]: rv, [colKey]: cv }))
  );

  // Find min/max for color scale
  const flat   = prices.flat().filter(v => v !== null && isFinite(v));
  const minVal = Math.min(...flat);
  const maxVal = Math.max(...flat);
  const range  = maxVal - minVal || 1;

  // Build HTML
  const colHeaders = colValues.map(cv => {
    const isBase = Math.abs(cv - baseColVal) < 1e-9;
    return `<th class="sens-header ${isBase ? 'sens-base-col' : ''}">${formatAxis(cv)}</th>`;
  }).join('');

  const rows = rowValues.map((rv, ri) => {
    const isBaseRow = Math.abs(rv - baseRowVal) < 1e-9;
    const cells = colValues.map((cv, ci) => {
      const price   = prices[ri][ci];
      const isBase  = isBaseRow && Math.abs(cv - baseColVal) < 1e-9;
      const t       = price !== null ? (price - minVal) / range : 0.5;
      const bg      = sensitivityColor(t);
      const display = price !== null ? formatVal(price) : '—';
      return `<td class="sens-cell ${isBase ? 'sens-base-cell' : ''}" style="background:${bg};">${display}</td>`;
    }).join('');

    return `
      <tr>
        <td class="sens-row-header ${isBaseRow ? 'sens-base-row' : ''}">${formatAxis(rv)}</td>
        ${cells}
      </tr>`;
  }).join('');

  return `
    <div class="sens-table-wrap">
      <div class="sens-axis-label sens-col-axis">${colLabel}</div>
      <div class="sens-axis-label sens-row-axis">${rowLabel}</div>
      <div class="table-container">
        <table class="sens-table">
          <thead>
            <tr>
              <th class="sens-corner">${rowLabel} \\ ${colLabel}</th>
              ${colHeaders}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// --- Main render function ---
function renderSensitivity() {
  const container = document.getElementById('section-sensitivity');
  if (!container) return;

  if (!state.dcf?.valid || !state.inputs) {
    container.innerHTML = `<div class="card"><p class="body text-muted">Sensitivity tables will appear after a valuation is run.</p></div>`;
    return;
  }

  const inp = state.inputs;
  const fmt = v => v !== null && isFinite(v) ? '$' + v.toFixed(2) : '—';

  // ── Table A: WACC vs Terminal Growth ───────────────────────
  const waccBase  = inp.wacc;
  const tgBase    = inp.terminalGrowth;
  const waccStep  = 0.005; // 0.5% steps
  const tgStep    = 0.0025; // 0.25% steps

  const waccVals = [-2, -1, 0, 1, 2].map(d => +(waccBase + d * waccStep).toFixed(4));
  const tgVals   = [-2, -1, 0, 1, 2].map(d => +(tgBase   + d * tgStep).toFixed(4));

  // ── Table B: Revenue Growth vs EBIT Margin ─────────────────
  const revBase  = inp.revenueGrowth;
  const ebitBase = inp.ebitMargin;
  const revStep  = 0.005;  // 0.5% steps
  const mgnStep  = 0.01;   // 1% steps

  const revVals  = [-2, -1, 0, 1, 2].map(d => +(revBase  + d * revStep).toFixed(4));
  const mgnVals  = [-2, -1, 0, 1, 2].map(d => +(ebitBase + d * mgnStep).toFixed(4));

  const tableA = buildSensitivityTable({
    rowValues:  waccVals,
    colValues:  tgVals,
    rowKey:     'wacc',
    colKey:     'terminalGrowth',
    rowLabel:   'WACC',
    colLabel:   'Terminal Growth',
    formatVal:  fmt,
    formatAxis: v => (v * 100).toFixed(1) + '%',
    baseRowVal: waccBase,
    baseColVal: tgBase,
  });

  const tableB = buildSensitivityTable({
    rowValues:  revVals,
    colValues:  mgnVals,
    rowKey:     'revenueGrowth',
    colKey:     'ebitMargin',
    rowLabel:   'Revenue Growth',
    colLabel:   'EBIT Margin',
    formatVal:  fmt,
    formatAxis: v => (v * 100).toFixed(1) + '%',
    baseRowVal: revBase,
    baseColVal: ebitBase,
  });

  container.innerHTML = `
    <p class="caption" style="margin-bottom:6px;">Sensitivity Analysis</p>
    <div class="sens-grid">
      <div>
        <p class="caption" style="margin-bottom:4px;font-size:0.5625rem;">WACC vs Terminal Growth</p>
        ${tableA}
      </div>
      <div>
        <p class="caption" style="margin-bottom:4px;font-size:0.5625rem;">Rev Growth vs EBIT Margin</p>
        ${tableB}
      </div>
    </div>
    <div class="sens-legend" style="margin-top:6px;">
      <div class="sens-legend-bar" style="height:6px;"></div>
      <div class="sens-legend-labels">
        <span>Lower</span><span>Base</span><span>Higher</span>
      </div>
    </div>
  `;
}
