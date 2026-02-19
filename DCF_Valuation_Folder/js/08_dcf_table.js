/* ============================================================
   TASK 08 — DCF Projection Table
   Renders the full DCF model table into #section-dcf-table.
   Sections:
     1. Projection rows (base year + forecast years)
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

  const cells = values.map(v => {
    const formatted = isPct ? tblFmtPct(v) : tblFmt(v, decimals);
    return `<td class="${accentClass}">${formatted}</td>`;
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

// --- Main render function ---
function renderDCFTable() {
  const container = document.getElementById('section-dcf-table');
  if (!container) return;

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

  // Column headers: Base Year + Forecast Years + Terminal
  const baseLabel = String(d.baseYear);
  const yearCols  = [baseLabel, ...d.forecastYearLabels, 'Terminal'];
  const colCount  = yearCols.length; // base + forecast + terminal col

  // Base-year actuals from historical (last value of each series)
  const hist = state.historical?.metrics || {};
  const lastRev  = lastValue(hist.revenue)  ?? null;
  const lastEBIT = lastValue(hist.ebit)     ?? null;
  const lastNI   = lastValue(hist.netIncome) ?? null;
  const lastFCF  = lastValue(state.historical?.derived?.fcf) ?? null;

  // Pad base-year column with actuals, forecast cols from engine, terminal col blank/special
  function row(label, baseVal, forecastArr, terminalVal, opts = {}) {
    const values = [baseVal, ...forecastArr, terminalVal];
    return tableRow(label, values, opts);
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

  // ── Build HTML ──────────────────────────────────────────────────
  const html = `
    <div class="card-elevated" style="margin-bottom:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-5);">
        <h2 class="h2">DCF Projection</h2>
        <span class="caption">${units} · Mid-year discounting · Gordon Growth terminal value</span>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th class="table-header" style="text-align:left;min-width:200px;">Line Item</th>
              ${yearCols.map((y, i) => `
                <th class="table-header ${i === 0 ? 'col-base' : i === yearCols.length - 1 ? 'col-terminal' : ''}">${y}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>

            ${sectionHeaderRow('Income Statement Bridge', colCount)}

            ${row('Revenue', lastRev, f.revenue, null, { indent: false })}
            ${row('EBIT', lastEBIT, f.ebit, null, { indent: true })}
            ${row('EBIT Margin', null, f.ebit.map((e, i) => {
              const rev = f.revenue[i];
              return (e !== null && rev !== null && rev !== 0) ? e / rev : null;
            }), null, { indent: true, isPct: true })}
            ${row('(-) Taxes', null, f.nopat.map((np, i) => {
              const e = f.ebit[i];
              return (e !== null && np !== null) ? e - np : null;
            }), null, { indent: true })}
            ${row('NOPAT', null, f.nopat, null, { bold: true })}

            ${sectionHeaderRow('Free Cash Flow Build', colCount)}

            ${row('(+) D&A', null, f.da, null, { indent: true })}
            ${row('(-) CapEx', null, f.capex.map(v => v !== null ? -v : null), null, { indent: true })}
            ${row('(-) ΔWorking Capital', null, f.nwcDelta.map(v => v !== null ? -v : null), null, { indent: true })}
            ${row('Unlevered Free Cash Flow', lastFCF, f.fcf, termFCF, { bold: true, topBorder: true })}

            ${sectionHeaderRow('Discounting (Mid-Year Convention)', colCount)}

            ${row('Discount Factor', null, discFactors, termFactor, { decimals: 4 })}
            ${row('PV of FCF', null, f.pvFCF, null, { bold: true })}

            ${sectionHeaderRow('Terminal Value', colCount)}
            ${row('Terminal FCF (×1+g)', null, [...Array(n - 1).fill(null), termFCF], null, { indent: true })}
            ${row('Terminal Value', null, Array(n).fill(null), termTV, { indent: true })}
            ${row('PV of Terminal Value', null, Array(n).fill(null), termPV, { bold: true })}

            ${sectionHeaderRow('Valuation Bridge', colCount)}

            ${tableRow('NPV of FCFs', [null, ...Array(n).fill(null), pvFCFTotal], { bold: false })}
            ${tableRow('(+) PV of Terminal Value', [null, ...Array(n).fill(null), termPV], {})}
            ${tableRow('Enterprise Value', [null, ...Array(n).fill(null), evCheck], { bold: true, topBorder: true, accentClass: 'text-terminal' })}
            ${tableRow('(-) Net Debt', [null, ...Array(n).fill(null), s.netDebt !== null ? -s.netDebt : null], {})}
            ${tableRow('(-) Minority Interest', [null, ...Array(n).fill(null), s.minorityInterest !== null ? -s.minorityInterest : null], {})}
            ${tableRow('Equity Value', [null, ...Array(n).fill(null), s.equityValue], { bold: true })}
            ${tableRow('÷ Shares Outstanding', [null, ...Array(n).fill(null), inp.sharesOutstanding], { indent: true })}
            ${tableRow('Implied Share Price', [null, ...Array(n).fill(null), s.impliedPrice], {
              bold: true,
              highlight: true,
              accentClass: s.upside == null ? '' : s.upside >= 0 ? 'text-success' : 'text-danger',
              decimals: 2,
            })}
            ${inp.currentPrice ? tableRow('Current Price', [null, ...Array(n).fill(null), inp.currentPrice], { indent: true, decimals: 2 }) : ''}
            ${s.upside != null ? tableRow('Upside / Downside', [null, ...Array(n).fill(null), s.upside], {
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
