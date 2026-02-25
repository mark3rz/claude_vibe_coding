/* ============================================================
   TASK 08 — DCF Projection Table
   Renders the full DCF model table into #section-dcf-table.
   Sections:
     1. Historical actuals + projection rows (base year + forecast years)
     2. Discounting rows (mid-year convention)
     3. Valuation bridge (EV → equity → implied price)
   Table ties out exactly to state.dcf.summary.enterpriseValue.
   Called by recalculate() and on initial load.
============================================================ */

// --- Local formatting helpers (mirror 06_executive_summary.js) ---
function tblFmt(val, decimals = 1) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return val.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function tblFmtPct(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return (val * 100).toFixed(1) + '%';
}

// --- Build a table row <tr> ---
// cellClasses: optional array of CSS class strings, one per value cell
function tableRow(label, values, opts = {}) {
  const {
    bold        = false,
    highlight   = false,
    indent      = false,
    isTotal     = false,
    isPct       = false,
    decimals    = 1,
    topBorder   = false,
    accentClass = '',
    cellClasses = null,
  } = opts;

  const labelStyle = [
    bold   ? 'font-weight:600;color:var(--text-primary);' : '',
    indent ? 'padding-left:var(--space-6);' : '',
  ].join('');

  const rowClass = [
    'table-row',
    highlight ? 'row-highlight' : '',
    isTotal   ? 'row-total'     : '',
    topBorder ? 'row-top-border': '',
  ].filter(Boolean).join(' ');

  const cells = values.map((v, i) => {
    const formatted = isPct ? tblFmtPct(v) : tblFmt(v, decimals);
    const cls = [accentClass, cellClasses ? cellClasses[i] || '' : ''].filter(Boolean).join(' ');
    return `<td class="${cls}">${formatted}</td>`;
  }).join('');

  return `
    <tr class="${rowClass}">
      <td style="${labelStyle}">${label}</td>
      ${cells}
    </tr>
  `;
}

// --- Build a section header row ---
function sectionHeaderRow(label, colCount) {
  return `
    <tr class="table-row section-header-row">
      <td colspan="${colCount + 1}" style="
        background:var(--bg-secondary);
        color:var(--text-muted);
        font-size:0.6875rem;
        font-weight:600;
        letter-spacing:0.06em;
        text-transform:uppercase;
        padding:var(--space-2) var(--space-4);
      ">${label}</td>
    </tr>
  `;
}

// --- Inject sticky-column CSS (idempotent) ---
function injectDCFTableStickyStyle() {
  if (document.getElementById('dcf-table-sticky-style')) return;
  const style = document.createElement('style');
  style.id = 'dcf-table-sticky-style';
  style.textContent = `
    /* Safari fix: sticky doesn't work with border-collapse: collapse */
    #dcfTable {
      border-collapse: separate !important;
      border-spacing: 0;
    }

    /* Freeze first column in every row (th and td) */
    #dcfTable thead tr th:first-child,
    #dcfTable tbody tr:not(.section-header-row) td:first-child {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--bg-tertiary);
      border-right: 1px solid var(--border-strong);
      box-shadow: 2px 0 4px rgba(0, 0, 0, 0.15);
    }

    /* Header cells get the header background */
    #dcfTable thead tr th:first-child {
      background: var(--bg-secondary);
      z-index: 3;
    }

    /* Section header rows span full width — not sticky */
    #dcfTable tbody tr.section-header-row td {
      position: static;
    }

    /* Row hover: sticky cell inherits the hover background */
    #dcfTable tbody tr.table-row:hover td:first-child {
      background: var(--bg-elevated);
    }

    /* Highlighted row sticky cell */
    #dcfTable tbody tr.row-highlight td:first-child {
      background: var(--bg-elevated);
    }
    #dcfTable tbody tr.row-highlight:hover td:first-child {
      background: var(--bg-elevated);
    }
  `;
  document.head.appendChild(style);
}

// --- Main render function ---
function renderDCFTable() {
  const container = document.getElementById('section-dcf-table');
  if (!container) return;

  injectDCFTableStickyStyle();

  if (!state.dcf || !state.dcf.valid) {
    container.innerHTML = `
      <div class="card">
        <p class="body text-muted">DCF table unavailable — run a valuation first.</p>
      </div>`;
    return;
  }

  const d   = state.dcf;
  const f   = d.forecast;
  const s   = d.summary;
  const inp = d.inputs;
  const n   = inp.forecastYears;
  const units = state.rawData?.units ? ` (${state.rawData.units})` : '';

  // --- Historical columns (years before the base year) ---
  const histLabels = d.historicalYearLabels || [];
  const h          = d.historical || {};
  const hCount     = histLabels.length; // number of historical columns

  // --- Projection columns: Base Year + Forecast Years + Terminal ---
  const baseLabel = String(d.baseYear);
  const projYearCols = [baseLabel, ...d.forecastYearLabels, 'Terminal'];

  // --- Full column set: Historical + Projection ---
  const allYearCols = [...histLabels, ...projYearCols];
  const colCount    = allYearCols.length;

  // --- Cell class arrays ---
  // Historical cells get muted styling; base year column gets a left-border divider
  function buildCellClasses() {
    const classes = [];
    for (let i = 0; i < hCount; i++) classes.push('col-historical');
    // Base year: divider + muted base style
    classes.push('col-divider col-base');
    // Forecast years: no special class
    for (let i = 0; i < n; i++) classes.push('');
    // Terminal column
    classes.push('col-terminal');
    return classes;
  }
  const cellCls = buildCellClasses();

  // Base-year actuals from historical (last value of each series)
  const hist = state.historical?.metrics || {};
  const lastRev   = lastValue(hist.revenue)      ?? null;
  const lastEBIT  = lastValue(hist.ebit)         ?? null;
  const lastNI    = lastValue(hist.netIncome)     ?? null;
  const lastFCF   = lastValue(state.historical?.derived?.fcf) ?? null;
  const lastDA    = lastValue(hist.depreciation)  ?? null;
  const lastCapex = lastValue(hist.capex)         ?? null;
  const lastNWC   = lastValue(hist.changeInNWC)   ?? null;
  const lastTax   = lastValue(hist.incomeTax)     ?? null;

  // --- Row builder: historical values + base + forecast + terminal ---
  // histArr: array of historical values (length hCount), or null/empty to fill with blanks
  function row(label, histArr, baseVal, forecastArr, terminalVal, opts = {}) {
    // Pad or replace histArr to match hCount columns
    let hVals;
    if (!histArr || histArr.length === 0) {
      hVals = Array(hCount).fill(null);
    } else if (histArr.length < hCount) {
      hVals = [...histArr, ...Array(hCount - histArr.length).fill(null)];
    } else {
      hVals = histArr.slice(0, hCount);
    }
    const values = [...hVals, baseVal, ...forecastArr, terminalVal];
    return tableRow(label, values, { ...opts, cellClasses: cellCls });
  }

  // --- Shorthand for valuation bridge rows (blank historical + blank base + blank forecast + value in terminal) ---
  function bridgeRow(label, termVal, opts = {}) {
    const values = [...Array(hCount).fill(null), null, ...Array(n).fill(null), termVal];
    return tableRow(label, values, { ...opts, cellClasses: cellCls });
  }

  // ── Terminal value column content ──────────────────────────────
  const termFCF      = f.fcf[n - 1] * (1 + inp.terminalGrowth);
  const termTV       = s.terminalValue;
  const termPV       = s.pvTerminal;

  // Discount factors for each forecast year (mid-year)
  const discFactors  = f.fcf.map((_, i) => 1 / Math.pow(1 + inp.wacc, i + 0.5));
  const termFactor   = 1 / Math.pow(1 + inp.wacc, n);

  // Running total check — should equal enterpriseValue
  const pvFCFTotal   = f.pvFCF.reduce((a, b) => a + b, 0);
  const evCheck      = pvFCFTotal + termPV;

  // ── Build table header ─────────────────────────────────────────
  const headerCells = allYearCols.map((y, i) => {
    const classes = ['table-header'];
    if (i < hCount) {
      classes.push('col-historical');
    } else if (i === hCount) {
      classes.push('col-divider', 'col-base');
    } else if (i === allYearCols.length - 1) {
      classes.push('col-terminal');
    }
    return `<th class="${classes.join(' ')}">${y}</th>`;
  }).join('');

  // ── Period label row (Historical | Projected) ──────────────────
  const periodLabelRow = (hCount > 0) ? `
    <tr>
      <th class="table-header" style="text-align:left;border-bottom:none;padding-bottom:0;"></th>
      ${hCount > 0 ? `<th class="table-header col-historical" colspan="${hCount}" style="text-align:center;border-bottom:none;padding-bottom:0;">
        <span class="period-badge badge-historical">Historical</span>
      </th>` : ''}
      <th class="table-header col-divider" colspan="${projYearCols.length}" style="text-align:center;border-bottom:none;padding-bottom:0;">
        <span class="period-badge badge-projected">Projected</span>
      </th>
    </tr>
  ` : '';

  // ── Build HTML ──────────────────────────────────────────────────
  const html = `
    <div class="card-elevated" style="margin-bottom:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-5);">
        <h2 class="h2">DCF Projection</h2>
        <span class="caption">${units} · Mid-year discounting · Gordon Growth terminal value</span>
      </div>

      <div class="table-container">
        <table id="dcfTable">
          <thead>
            ${periodLabelRow}
            <tr>
              <th class="table-header" style="text-align:left;min-width:200px;">Line Item</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>

            ${sectionHeaderRow('Income Statement Bridge', colCount)}

            ${row('Revenue', h.revenue, lastRev, f.revenue, null, { indent: false })}
            ${row('EBIT', h.ebit, lastEBIT, f.ebit, null, { indent: true })}
            ${row('EBIT Margin', h.ebitMargin,
              (lastEBIT != null && lastRev != null && lastRev !== 0) ? lastEBIT / lastRev : null,
              f.ebit.map((e, i) => {
                const rev = f.revenue[i];
                return (e !== null && rev !== null && rev !== 0) ? e / rev : null;
              }), null, { indent: true, isPct: true })}
            ${row('(-) Taxes',
              h.incomeTax ? h.incomeTax.map(v => v != null ? -Math.abs(v) : null) : null,
              lastTax != null ? -Math.abs(lastTax) : null,
              f.nopat.map((np, i) => {
                const e = f.ebit[i];
                return (e !== null && np !== null) ? -(e - np) : null;
              }), null, { indent: true })}
            ${row('NOPAT',
              (h.ebit && h.incomeTax) ? h.ebit.map((e, i) => {
                const tax = h.incomeTax[i];
                return (e != null && tax != null) ? e - Math.abs(tax) : null;
              }) : null,
              (lastEBIT != null && lastTax != null) ? lastEBIT - Math.abs(lastTax) : null,
              f.nopat, null, { bold: true })}

            ${sectionHeaderRow('Free Cash Flow Build', colCount)}

            ${row('(+) D&A',
              h.depreciation ? h.depreciation.map(v => v != null ? Math.abs(v) : null) : null,
              lastDA != null ? Math.abs(lastDA) : null,
              f.da, null, { indent: true })}
            ${row('(-) CapEx',
              h.capex ? h.capex.map(v => v != null ? -Math.abs(v) : null) : null,
              lastCapex != null ? -Math.abs(lastCapex) : null,
              f.capex.map(v => v !== null ? -v : null), null, { indent: true })}
            ${row('(-) \u0394Working Capital',
              h.nwcDelta ? h.nwcDelta.map(v => v != null ? -v : null) : null,
              lastNWC != null ? -lastNWC : null,
              f.nwcDelta.map(v => v !== null ? -v : null), null, { indent: true })}
            ${row('Unlevered Free Cash Flow', h.fcf, lastFCF, f.fcf, termFCF, { bold: true, topBorder: true })}

            ${sectionHeaderRow('Discounting (Mid-Year Convention)', colCount)}

            ${row('Discount Factor', null, null, discFactors, termFactor, { decimals: 4 })}
            ${row('PV of FCF', null, null, f.pvFCF, null, { bold: true })}

            ${sectionHeaderRow('Terminal Value', colCount)}
            ${row('Terminal FCF (×1+g)', null, null, [...Array(n - 1).fill(null), termFCF], null, { indent: true })}
            ${row('Terminal Value', null, null, Array(n).fill(null), termTV, { indent: true })}
            ${row('PV of Terminal Value', null, null, Array(n).fill(null), termPV, { bold: true })}

            ${sectionHeaderRow('Valuation Bridge', colCount)}

            ${bridgeRow('NPV of FCFs', pvFCFTotal, { bold: false })}
            ${bridgeRow('(+) PV of Terminal Value', termPV, {})}
            ${bridgeRow('Enterprise Value', evCheck, { bold: true, topBorder: true, accentClass: 'text-terminal' })}
            ${bridgeRow('(-) Net Debt', s.netDebt !== null ? -s.netDebt : null, {})}
            ${bridgeRow('(-) Minority Interest', s.minorityInterest !== null ? -s.minorityInterest : null, {})}
            ${bridgeRow('Equity Value', s.equityValue, { bold: true })}
            ${bridgeRow('÷ Shares Outstanding', inp.sharesOutstanding, { indent: true })}
            ${bridgeRow('Implied Share Price', s.impliedPrice, {
              bold: true,
              highlight: true,
              accentClass: s.upside == null ? '' : s.upside >= 0 ? 'text-success' : 'text-danger',
              decimals: 2,
            })}
            ${inp.currentPrice ? bridgeRow('Current Price', inp.currentPrice, { indent: true, decimals: 2 }) : ''}
            ${s.upside != null ? bridgeRow('Upside / Downside', s.upside, {
              indent: true,
              isPct: true,
              accentClass: s.upside >= 0 ? 'text-success' : 'text-danger',
            }) : ''}

          </tbody>
        </table>
      </div>

      <!-- Tie-out check -->
      <p class="caption" style="margin-top:var(--space-3);text-align:right;">
        EV tie-out: ${tblFmt(evCheck)} &nbsp;·&nbsp; Engine EV: ${tblFmt(s.enterpriseValue)} &nbsp;·&nbsp;
        ${Math.abs(evCheck - s.enterpriseValue) < 0.01
          ? '<span style="color:var(--accent-success);">✓ Ties out</span>'
          : '<span style="color:var(--accent-danger);">✗ Mismatch — check inputs</span>'}
      </p>
    </div>
  `;

  container.innerHTML = html;
}
