/* ============================================================
   TASK 07 — Assumptions Panel + "Why did valuation move?" Learning Panel
   Renders editable input fields for all DCF assumptions into
   #section-assumptions. Auto-recalculates on input changes (debounced).
   Right-hand panel explains valuation changes vs a saved Base Case
   using one-at-a-time attribution reruns.
============================================================ */

// ======================================================================
// LEARNING OVERLAY STATE
// ======================================================================
window.learningState = {
  baseInputs: null,
  baseOutputs: null,     // { enterpriseValue, impliedPrice, irr, pvTerminal, terminalValue, npvFCF }
  isBaseAutoCaptured: false,
};

// ======================================================================
// INPUT FIELD DEFINITION SCHEMA
// ======================================================================
const ASSUMPTION_GROUPS = [
  {
    label: 'Forecast Settings',
    fields: [
      { key: 'forecastYears',  label: 'Forecast Years',    type: 'int',  suffix: 'yrs', min: 1,   max: 20,  step: 1 },
      { key: 'currentPrice',   label: 'Current Share Price', type: 'float', prefix: '$', min: 0,   max: null, step: 0.01 },
    ],
  },
  {
    label: 'Revenue & Margins',
    fields: [
      { key: 'revenueGrowth', label: 'Revenue Growth',  type: 'pct', suffix: '%', min: -50, max: 100, step: 0.1 },
      { key: 'ebitMargin',    label: 'EBIT Margin',     type: 'pct', suffix: '%', min: -100, max: 100, step: 0.1 },
      { key: 'taxRate',       label: 'Tax Rate',        type: 'pct', suffix: '%', min: 0,   max: 60,  step: 0.1 },
      { key: 'capexPct',      label: 'CapEx (% Rev)',   type: 'pct', suffix: '%', min: 0,   max: 50,  step: 0.1 },
      { key: 'nwcPct',        label: 'NWC Change (% Rev)', type: 'pct', suffix: '%', min: -20, max: 20, step: 0.1 },
    ],
  },
  {
    label: 'WACC Components',
    fields: [
      { key: 'costOfEquity',  label: 'Cost of Equity',  type: 'pct', suffix: '%', min: 0, max: 50, step: 0.1 },
      { key: 'costOfDebt',    label: 'Cost of Debt',    type: 'pct', suffix: '%', min: 0, max: 30, step: 0.1 },
      { key: 'equityWeight',  label: 'Equity Weight',   type: 'pct', suffix: '%', min: 0, max: 100, step: 1 },
      { key: 'debtWeight',    label: 'Debt Weight',     type: 'pct', suffix: '%', min: 0, max: 100, step: 1 },
      { key: 'wacc',          label: 'WACC (override)', type: 'pct', suffix: '%', min: 0, max: 50, step: 0.1 },
    ],
  },
  {
    label: 'Terminal Value',
    fields: [
      { key: 'terminalGrowth', label: 'Terminal Growth Rate', type: 'pct', suffix: '%', min: 0, max: 10, step: 0.1 },
    ],
  },
  {
    label: 'Balance Sheet Bridge',
    fields: [
      { key: 'netDebt',          label: 'Net Debt',           type: 'float', suffix: '', min: null, max: null, step: 1 },
      { key: 'minorityInterest', label: 'Minority Interest',  type: 'float', suffix: '', min: 0,    max: null, step: 1 },
      { key: 'sharesOutstanding',label: 'Shares Outstanding', type: 'float', suffix: '', min: 0,    max: null, step: 0.1 },
    ],
  },
];

// ======================================================================
// ATTRIBUTION DRIVER DEFINITIONS
// ======================================================================
const ATTRIBUTION_DRIVERS = [
  { key: 'revenueGrowth',  label: 'Revenue Growth',       type: 'rate' },
  { key: 'ebitMargin',     label: 'EBIT Margin',          type: 'rate' },
  { key: 'taxRate',        label: 'Tax Rate',             type: 'rate' },
  { key: 'capexPct',       label: 'CapEx (% Rev)',        type: 'rate' },
  { key: 'nwcPct',         label: 'NWC Change (% Rev)',   type: 'rate' },
  { key: 'wacc',           label: 'WACC',                 type: 'rate' },
  { key: 'terminalGrowth', label: 'Terminal Growth Rate', type: 'rate' },
  { key: 'netDebt',        label: 'Net Debt',             type: 'dollar' },
  { key: 'sharesOutstanding', label: 'Shares Outstanding', type: 'shares' },
];

// ======================================================================
// FORMAT / PARSE HELPERS
// ======================================================================
function inputDisplayValue(field, rawVal) {
  if (rawVal === null || rawVal === undefined) return '';
  if (field.type === 'pct') return (rawVal * 100).toFixed(field.step < 1 ? 1 : 0);
  if (field.type === 'int') return Math.round(rawVal);
  return Number(rawVal).toFixed(field.step < 1 ? 2 : 0);
}

function parseInputValue(field, strVal) {
  const n = parseFloat(strVal);
  if (isNaN(n)) return null;
  if (field.type === 'pct') return n / 100;
  if (field.type === 'int') return Math.round(n);
  return n;
}

// ======================================================================
// BUILD INPUT ROWS
// ======================================================================
function buildInputRow(field) {
  const val = inputDisplayValue(field, state.inputs[field.key]);
  const prefix = field.prefix ? `<span class="input-affix">${field.prefix}</span>` : '';
  const suffix = field.suffix ? `<span class="input-affix">${field.suffix}</span>` : '';

  return `
    <div class="assumption-field">
      <label for="inp-${field.key}">${field.label}</label>
      <div class="input-wrap">
        ${prefix}
        <input
          class="input-control"
          type="number"
          id="inp-${field.key}"
          data-key="${field.key}"
          value="${val}"
          ${field.min !== null ? `min="${field.min}"` : ''}
          ${field.max !== null ? `max="${field.max}"` : ''}
          step="${field.step}"
        />
        ${suffix}
      </div>
    </div>
  `;
}

function buildGroupCard(group) {
  return `
    <div class="assumption-group">
      <p class="assumption-group-title">${group.label}</p>
      <div class="assumption-fields">
        ${group.fields.map(buildInputRow).join('')}
      </div>
    </div>
  `;
}

// ======================================================================
// COLLECT INPUTS FROM DOM
// ======================================================================
function collectInputs() {
  for (const group of ASSUMPTION_GROUPS) {
    for (const field of group.fields) {
      const el = document.getElementById(`inp-${field.key}`);
      if (!el) continue;
      const parsed = parseInputValue(field, el.value);
      if (parsed !== null) state.inputs[field.key] = parsed;
    }
  }

  const computed = state.inputs.costOfEquity * state.inputs.equityWeight
                 + state.inputs.costOfDebt   * state.inputs.debtWeight * (1 - state.inputs.taxRate);

  const waccEl = document.getElementById('inp-wacc');
  if (waccEl && Math.abs(parseInputValue({ type: 'pct', step: 0.1 }, waccEl.value) - state.inputs.wacc) < 0.0005) {
    state.inputs.wacc = computed;
  }
}

// ======================================================================
// DEBOUNCED RECALCULATION
// ======================================================================
let _recalcTimer = null;
function recalculateDebounced() {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(recalculate, 200);
}

function recalculate() {
  collectInputs();
  calculateDCF(state.inputs, state.historical);

  // Auto-capture base case on first successful run
  if (!window.learningState.baseInputs && state.dcf && state.dcf.valid) {
    captureBaseCase();
    window.learningState.isBaseAutoCaptured = true;
  }

  if (typeof renderExecutiveMetrics === 'function') renderExecutiveMetrics();
  if (typeof renderDCFTable        === 'function') renderDCFTable();
  if (typeof renderCharts          === 'function') renderCharts();
  if (typeof renderSensitivity     === 'function') renderSensitivity();
  if (typeof renderScenario        === 'function') renderScenario();
  if (typeof renderDiagnostics     === 'function') renderDiagnostics();
  if (typeof refreshContextPanel   === 'function') refreshContextPanel();

  // Refresh WACC display after recompute
  const waccEl = document.getElementById('inp-wacc');
  if (waccEl) waccEl.value = inputDisplayValue({ type: 'pct', step: 0.1 }, state.inputs.wacc);

  // Update learning panel
  updateLearningPanel();
}

// ======================================================================
// BASE CASE MANAGEMENT
// ======================================================================
function captureBaseCase() {
  const s = state.dcf && state.dcf.summary;
  window.learningState.baseInputs = { ...state.inputs };
  window.learningState.baseOutputs = s ? {
    enterpriseValue: s.enterpriseValue,
    equityValue: s.equityValue,
    impliedPrice: s.impliedPrice,
    irr: s.irr,
    pvTerminal: s.pvTerminal,
    terminalValue: s.terminalValue,
    npvFCF: s.npvFCF,
  } : null;
}

function onSetBaseCase() {
  captureBaseCase();
  window.learningState.isBaseAutoCaptured = false;
  updateLearningPanel();
}

// ======================================================================
// ATTRIBUTION ENGINE
// ======================================================================
function hasDriverChanged(driverDef, baseInputs, currentInputs) {
  const bv = baseInputs[driverDef.key];
  const cv = currentInputs[driverDef.key];
  if (bv == null || cv == null) return false;

  if (driverDef.type === 'rate') {
    // threshold: 0.05 percentage points = 0.0005 in decimal
    return Math.abs(cv - bv) >= 0.0005;
  }
  // dollar or shares: 0.5% relative
  if (bv === 0) return cv !== 0;
  return Math.abs((cv - bv) / bv) >= 0.005;
}

function computeAttribution() {
  const ls = window.learningState;
  if (!ls.baseInputs || !ls.baseOutputs || !state.dcf || !state.dcf.valid) return null;
  if (!state.historical) return null;

  const baseIn = ls.baseInputs;
  const baseOut = ls.baseOutputs;
  const currIn = { ...state.inputs };
  const currSummary = state.dcf.summary;

  const currentOutputs = {
    enterpriseValue: currSummary.enterpriseValue,
    impliedPrice: currSummary.impliedPrice,
    irr: currSummary.irr,
  };

  // Find which drivers changed
  const changedDrivers = ATTRIBUTION_DRIVERS.filter(d => hasDriverChanged(d, baseIn, currIn));

  // One-at-a-time reruns (max 10)
  const impacts = [];
  const maxReruns = 10;
  const driversToRun = changedDrivers.slice(0, maxReruns);

  for (const driver of driversToRun) {
    const scenarioInputs = { ...baseIn, [driver.key]: currIn[driver.key] };
    const result = calculateDCFPure(scenarioInputs, state.historical);
    if (!result || !result.valid) continue;

    impacts.push({
      key: driver.key,
      label: driver.label,
      type: driver.type,
      baseVal: baseIn[driver.key],
      currVal: currIn[driver.key],
      evImpact: result.enterpriseValue - baseOut.enterpriseValue,
      priceImpact: (result.impliedPrice != null && baseOut.impliedPrice != null)
        ? result.impliedPrice - baseOut.impliedPrice : null,
      irrImpact: (result.irr != null && baseOut.irr != null)
        ? result.irr - baseOut.irr : null,
    });
  }

  // Sort by absolute EV impact descending
  impacts.sort((a, b) => Math.abs(b.evImpact) - Math.abs(a.evImpact));

  // Terminal value % of EV
  const baseTVPct = (baseOut.pvTerminal != null && baseOut.enterpriseValue)
    ? baseOut.pvTerminal / baseOut.enterpriseValue : null;
  const currTVPct = (currSummary.pvTerminal != null && currSummary.enterpriseValue)
    ? currSummary.pvTerminal / currSummary.enterpriseValue : null;

  return {
    baseOut,
    currentOutputs,
    impacts,
    baseTVPct,
    currTVPct,
  };
}

// ======================================================================
// NARRATIVE GENERATOR
// ======================================================================
function generateNarrative(attribution) {
  if (!attribution || attribution.impacts.length === 0) {
    return ['No meaningful changes from the base case.'];
  }

  const bullets = [];
  // Take top 3 drivers by absolute EV impact
  const top = attribution.impacts.slice(0, 3);

  for (const imp of top) {
    const direction = imp.evImpact > 0 ? 'increases' : 'decreases';
    const absEV = fmtCompact(Math.abs(imp.evImpact));

    switch (imp.key) {
      case 'revenueGrowth':
        bullets.push(imp.evImpact > 0
          ? `Higher revenue growth compounds across the forecast, lifting projected free cash flows and adding ${absEV} to EV.`
          : `Lower revenue growth reduces projected free cash flows across every forecast year, reducing EV by ${absEV}.`);
        break;
      case 'ebitMargin':
        bullets.push(imp.evImpact > 0
          ? `Higher EBIT margin raises NOPAT in each year, increasing free cash flow and adding ${absEV} to EV.`
          : `Lower EBIT margin compresses NOPAT, reducing free cash flow and cutting ${absEV} from EV.`);
        break;
      case 'taxRate':
        bullets.push(imp.evImpact > 0
          ? `A lower tax rate keeps more of EBIT as after-tax income, adding ${absEV} to EV.`
          : `A higher tax rate reduces after-tax income (NOPAT), removing ${absEV} from EV.`);
        break;
      case 'capexPct':
        bullets.push(imp.evImpact > 0
          ? `Lower CapEx as a share of revenue frees up more cash flow, adding ${absEV} to EV.`
          : `Higher CapEx consumes more cash flow, reducing EV by ${absEV}.`);
        break;
      case 'nwcPct':
        bullets.push(imp.evImpact > 0
          ? `Lower working capital requirements release cash, adding ${absEV} to EV.`
          : `Higher working capital needs absorb cash, reducing EV by ${absEV}.`);
        break;
      case 'wacc':
        bullets.push(imp.evImpact > 0
          ? `Lower WACC increases all present values, especially terminal value, adding ${absEV} to EV.`
          : `Higher WACC discounts future cash flows more heavily, reducing EV by ${absEV}.`);
        break;
      case 'terminalGrowth':
        bullets.push(imp.evImpact > 0
          ? `Higher terminal growth rate raises the perpetuity value, adding ${absEV} to EV.`
          : `Lower terminal growth rate reduces the perpetuity value, cutting ${absEV} from EV.`);
        break;
      case 'netDebt':
        bullets.push(imp.evImpact > 0
          ? `Lower net debt ${direction} equity value by ${absEV} (EV unchanged, but bridge improves).`
          : `Higher net debt ${direction} equity value by ${absEV} through the equity bridge.`);
        break;
      case 'sharesOutstanding':
        bullets.push(imp.priceImpact != null && imp.priceImpact > 0
          ? `Fewer shares outstanding raise the per-share implied price.`
          : `More shares outstanding dilute the per-share implied price.`);
        break;
      default:
        bullets.push(`${imp.label} ${direction} EV by ${absEV}.`);
    }
  }

  return bullets;
}

// ======================================================================
// FORMAT HELPERS
// ======================================================================
function fmtDollar(v) {
  if (v == null || !isFinite(v)) return 'N/A';
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v < 0 ? '-' : '') + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (v < 0 ? '-' : '') + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v < 0 ? '-' : '') + '$' + (abs / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
}

function fmtCompact(v) {
  if (v == null || !isFinite(v)) return 'N/A';
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v < 0 ? '-' : '') + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (v < 0 ? '-' : '') + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v < 0 ? '-' : '') + '$' + (abs / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

function fmtPrice(v) {
  if (v == null || !isFinite(v)) return 'N/A';
  return '$' + v.toFixed(2);
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

function fmtPP(v) {
  if (v == null || !isFinite(v)) return 'N/A';
  const pp = v * 100;
  return (pp >= 0 ? '+' : '') + pp.toFixed(2) + ' pp';
}

function fmtDelta(v, formatter) {
  if (v == null || !isFinite(v)) return 'N/A';
  const sign = v > 0 ? '+' : '';
  return sign + formatter(v);
}

function deltaColor(v) {
  if (v == null || !isFinite(v)) return 'lp-neutral';
  return v > 0 ? 'lp-positive' : v < 0 ? 'lp-negative' : 'lp-neutral';
}

function deltaColorReverse(v) {
  // For metrics where negative is good (like WACC impact on price)
  if (v == null || !isFinite(v)) return 'lp-neutral';
  return v > 0 ? 'lp-positive' : v < 0 ? 'lp-negative' : 'lp-neutral';
}

// ======================================================================
// LEARNING PANEL RENDERING
// ======================================================================
function updateLearningPanel() {
  const container = document.getElementById('learning-panel-content');
  if (!container) return;

  const ls = window.learningState;

  // No base case yet
  if (!ls.baseInputs || !ls.baseOutputs) {
    container.innerHTML = `
      <div class="lp-empty">
        <p class="lp-empty-text">Waiting for first model run to capture base case...</p>
      </div>
    `;
    return;
  }

  // DCF not valid
  if (!state.dcf || !state.dcf.valid) {
    const errMsg = state.dcf && state.dcf.errors ? state.dcf.errors.join(' ') : 'Model not ready.';
    container.innerHTML = `
      <div class="lp-empty">
        <p class="lp-empty-text lp-negative">${errMsg}</p>
      </div>
    `;
    return;
  }

  const attribution = computeAttribution();
  if (!attribution) {
    container.innerHTML = `<div class="lp-empty"><p class="lp-empty-text">Unable to compute attribution.</p></div>`;
    return;
  }

  const bo = attribution.baseOut;
  const co = attribution.currentOutputs;

  // Deltas
  const evDelta = co.enterpriseValue - bo.enterpriseValue;
  const evPctDelta = bo.enterpriseValue ? evDelta / Math.abs(bo.enterpriseValue) : null;
  const priceDelta = (co.impliedPrice != null && bo.impliedPrice != null) ? co.impliedPrice - bo.impliedPrice : null;
  const pricePctDelta = (bo.impliedPrice && priceDelta != null) ? priceDelta / Math.abs(bo.impliedPrice) : null;
  const irrDelta = (co.irr != null && bo.irr != null) ? co.irr - bo.irr : null;

  // Auto-captured note
  const autoNote = ls.isBaseAutoCaptured
    ? `<div class="lp-auto-note">Base case captured from initial run.</div>` : '';

  // Summary cards
  const summaryHTML = `
    ${autoNote}
    <div class="lp-summary-cards">
      <div class="lp-summary-card">
        <div class="lp-summary-label">Enterprise Value</div>
        <div class="lp-summary-row">
          <span class="lp-summary-base">${fmtDollar(bo.enterpriseValue)}</span>
          <span class="lp-summary-arrow">&#8594;</span>
          <span class="lp-summary-current">${fmtDollar(co.enterpriseValue)}</span>
        </div>
        <div class="lp-summary-delta ${deltaColor(evDelta)}">
          ${fmtDelta(evDelta, fmtCompact)}${evPctDelta != null ? ' (' + fmtDelta(evPctDelta, fmtPct) + ')' : ''}
        </div>
      </div>
      <div class="lp-summary-card">
        <div class="lp-summary-label">Implied Share Price</div>
        <div class="lp-summary-row">
          <span class="lp-summary-base">${fmtPrice(bo.impliedPrice)}</span>
          <span class="lp-summary-arrow">&#8594;</span>
          <span class="lp-summary-current">${fmtPrice(co.impliedPrice)}</span>
        </div>
        <div class="lp-summary-delta ${deltaColor(priceDelta)}">
          ${priceDelta != null ? fmtDelta(priceDelta, fmtPrice) : 'N/A'}${pricePctDelta != null ? ' (' + fmtDelta(pricePctDelta, fmtPct) + ')' : ''}
        </div>
      </div>
      <div class="lp-summary-card">
        <div class="lp-summary-label">IRR</div>
        <div class="lp-summary-row">
          <span class="lp-summary-base">${fmtPct(bo.irr)}</span>
          <span class="lp-summary-arrow">&#8594;</span>
          <span class="lp-summary-current">${fmtPct(co.irr)}</span>
        </div>
        <div class="lp-summary-delta ${deltaColor(irrDelta)}">
          ${fmtPP(irrDelta)}
        </div>
      </div>
    </div>
  `;

  // Narrative
  const narrative = generateNarrative(attribution);
  const narrativeHTML = narrative.length > 0 ? `
    <div class="lp-section">
      <div class="lp-section-title">What's driving the change?</div>
      <ul class="lp-narrative-list">
        ${narrative.map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  // Attribution table
  let attrTableHTML = '';
  if (attribution.impacts.length > 0) {
    const rows = attribution.impacts.map(imp => {
      const evCell = `<span class="${deltaColor(imp.evImpact)}">${fmtDelta(imp.evImpact, fmtCompact)}</span>`;
      const priceCell = imp.priceImpact != null
        ? `<span class="${deltaColor(imp.priceImpact)}">${fmtDelta(imp.priceImpact, fmtPrice)}</span>`
        : `<span class="lp-neutral">N/A</span>`;
      const irrCell = imp.irrImpact != null
        ? `<span class="${deltaColor(imp.irrImpact)}">${fmtPP(imp.irrImpact)}</span>`
        : `<span class="lp-neutral">N/A</span>`;

      return `
        <tr>
          <td class="lp-attr-driver">${imp.label}</td>
          <td class="lp-attr-val">${evCell}</td>
          <td class="lp-attr-val">${priceCell}</td>
          <td class="lp-attr-val">${irrCell}</td>
        </tr>
      `;
    }).join('');

    attrTableHTML = `
      <div class="lp-section">
        <div class="lp-section-title">Quantified Attribution</div>
        <div class="lp-attr-table-wrap">
          <table class="lp-attr-table">
            <thead>
              <tr>
                <th class="lp-attr-th-driver">Driver</th>
                <th class="lp-attr-th">EV Impact</th>
                <th class="lp-attr-th">Price Impact</th>
                <th class="lp-attr-th">IRR Impact</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <div class="lp-attr-note">Attribution is an approximation using one-at-a-time changes from the base case.</div>
      </div>
    `;
  }

  // Terminal value dependency callout
  let tvCalloutHTML = '';
  if (attribution.baseTVPct != null || attribution.currTVPct != null) {
    const baseTVStr = attribution.baseTVPct != null ? (attribution.baseTVPct * 100).toFixed(1) + '%' : 'N/A';
    const currTVStr = attribution.currTVPct != null ? (attribution.currTVPct * 100).toFixed(1) + '%' : 'N/A';
    const tvIncreased = attribution.currTVPct != null && attribution.baseTVPct != null
      && attribution.currTVPct > attribution.baseTVPct + 0.01;

    tvCalloutHTML = `
      <div class="lp-section lp-tv-callout">
        <div class="lp-section-title">Model Dependency</div>
        <div class="lp-tv-row">
          <span class="lp-tv-label">Terminal Value % of EV</span>
          <span class="lp-tv-values">${baseTVStr} &#8594; ${currTVStr}</span>
        </div>
        ${tvIncreased ? '<div class="lp-tv-warn">Terminal value now accounts for a larger share of EV. The model is more sensitive to long-term assumptions (WACC, terminal growth).</div>' : ''}
      </div>
    `;
  }

  container.innerHTML = summaryHTML + narrativeHTML + attrTableHTML + tvCalloutHTML;
}

// ======================================================================
// MARKET CONTEXT ACCORDION (collapsed by default)
// Stores values under state.context, separate from core DCF assumptions.
// ======================================================================
function _initContextState() {
  if (!state.context) {
    const baseRegime = (typeof CONTEXT_BENCHMARKS !== 'undefined')
      ? CONTEXT_BENCHMARKS.regimes.base : { rfr: 0.04, erp: 0.055 };
    state.context = {
      sector: 'Tech',
      regime: 'base',
      rfr: baseRegime.rfr,
      erp: baseRegime.erp,
      useContextForWacc: false,
    };
  }
}

function _buildMarketContextAccordion() {
  _initContextState();
  const ctx = state.context;
  const regimes = (typeof CONTEXT_BENCHMARKS !== 'undefined') ? CONTEXT_BENCHMARKS.regimes : {};
  const sectors = (typeof CONTEXT_BENCHMARKS !== 'undefined') ? Object.keys(CONTEXT_BENCHMARKS.sectors) : ['Tech', 'Generic'];

  return `
    <details class="ctx-accordion" id="ctx-accordion">
      <summary class="ctx-accordion-summary">
        <span class="ctx-accordion-label">Market Context</span>
        <span class="ctx-accordion-badge">Advanced</span>
      </summary>
      <div class="ctx-accordion-body">
        <div class="ctx-accordion-fields">
          <div class="assumption-field">
            <label for="ctx-sector">Sector</label>
            <select id="ctx-sector" class="input-control" style="width:90px;text-align:left;">
              ${sectors.map(s => `<option value="${s}" ${s === ctx.sector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="assumption-field">
            <label for="ctx-regime">Regime</label>
            <select id="ctx-regime" class="input-control" style="width:90px;text-align:left;">
              ${Object.entries(regimes).map(([k, v]) => `<option value="${k}" ${k === ctx.regime ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="assumption-field">
            <label for="ctx-rfr">Risk-Free Rate</label>
            <div class="input-wrap">
              <input class="input-control" type="number" id="ctx-rfr" value="${(ctx.rfr * 100).toFixed(1)}" step="0.1" min="0" max="15" />
              <span class="input-affix">%</span>
            </div>
          </div>
          <div class="assumption-field">
            <label for="ctx-erp">Equity Risk Premium</label>
            <div class="input-wrap">
              <input class="input-control" type="number" id="ctx-erp" value="${(ctx.erp * 100).toFixed(1)}" step="0.1" min="0" max="15" />
              <span class="input-affix">%</span>
            </div>
          </div>
          <div class="assumption-field">
            <label for="ctx-use-wacc">Use for WACC</label>
            <input type="checkbox" id="ctx-use-wacc" ${ctx.useContextForWacc ? 'checked' : ''} style="accent-color:var(--accent-primary);" />
          </div>
        </div>
      </div>
    </details>
  `;
}

function _wireMarketContextListeners() {
  const sectorEl  = document.getElementById('ctx-sector');
  const regimeEl  = document.getElementById('ctx-regime');
  const rfrEl     = document.getElementById('ctx-rfr');
  const erpEl     = document.getElementById('ctx-erp');
  const toggleEl  = document.getElementById('ctx-use-wacc');

  if (!sectorEl) return; // accordion not rendered

  _initContextState();

  function onContextChange() {
    const ctx = state.context;
    if (sectorEl) ctx.sector = sectorEl.value;
    if (regimeEl) ctx.regime = regimeEl.value;
    if (rfrEl)    ctx.rfr    = parseFloat(rfrEl.value) / 100;
    if (erpEl)    ctx.erp    = parseFloat(erpEl.value) / 100;
    if (toggleEl) ctx.useContextForWacc = toggleEl.checked;

    // Refresh context panel (does NOT trigger DCF recalc unless toggle is on)
    if (ctx.useContextForWacc) {
      // Feed RFR+ERP into WACC: simplified CAPM for cost of equity
      // CoE = RFR + Beta * ERP; assume beta = 1 for simplicity
      const contextCoE = ctx.rfr + ctx.erp;
      const ceEl = document.getElementById('inp-costOfEquity');
      if (ceEl) {
        ceEl.value = (contextCoE * 100).toFixed(1);
        // Trigger input event to propagate WACC recalculation
        ceEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // Always refresh the context panel on context input changes
    if (typeof refreshContextPanel === 'function') {
      _ctxDebounce(refreshContextPanel, 60);
    }
  }

  // Regime change auto-fills RFR and ERP
  function onRegimeChange() {
    const regimes = (typeof CONTEXT_BENCHMARKS !== 'undefined') ? CONTEXT_BENCHMARKS.regimes : {};
    const preset = regimes[regimeEl.value];
    if (preset && rfrEl && erpEl) {
      rfrEl.value = (preset.rfr * 100).toFixed(1);
      erpEl.value = (preset.erp * 100).toFixed(1);
    }
    onContextChange();
  }

  sectorEl.addEventListener('change', onContextChange);
  regimeEl.addEventListener('change', onRegimeChange);
  rfrEl.addEventListener('input', onContextChange);
  erpEl.addEventListener('input', onContextChange);
  toggleEl.addEventListener('change', onContextChange);
}

// ======================================================================
// MAIN RENDER FUNCTION
// ======================================================================
function renderAssumptionsPanel() {
  const container = document.getElementById('section-assumptions');
  if (!container) return;

  container.innerHTML = `
    <div class="assumptions-learning-layout">
      <div class="assumptions-left-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <p class="caption">Assumptions</p>
        </div>
        <div class="assumptions-grid">
          ${ASSUMPTION_GROUPS.map(buildGroupCard).join('')}
        </div>
        ${_buildMarketContextAccordion()}
      </div>
      <div class="learning-right-panel">
        <div class="lp-header">
          <p class="lp-title">Why did valuation move?</p>
          <button class="btn-secondary lp-base-btn" id="btn-set-base">Set Base Case</button>
        </div>
        <div id="learning-panel-content" class="lp-content">
          <div class="lp-empty">
            <p class="lp-empty-text">Change an assumption to see how it affects the valuation.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire set base case button
  document.getElementById('btn-set-base').addEventListener('click', onSetBaseCase);

  // Live-update WACC display as components change (fires immediately for UI feel)
  ['inp-costOfEquity','inp-costOfDebt','inp-equityWeight','inp-debtWeight','inp-taxRate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      const ce = parseInputValue({ type: 'pct', step: 0.1 }, document.getElementById('inp-costOfEquity')?.value) ?? state.inputs.costOfEquity;
      const cd = parseInputValue({ type: 'pct', step: 0.1 }, document.getElementById('inp-costOfDebt')?.value)   ?? state.inputs.costOfDebt;
      const ew = parseInputValue({ type: 'pct', step: 1   }, document.getElementById('inp-equityWeight')?.value) ?? state.inputs.equityWeight;
      const dw = parseInputValue({ type: 'pct', step: 1   }, document.getElementById('inp-debtWeight')?.value)   ?? state.inputs.debtWeight;
      const tr = parseInputValue({ type: 'pct', step: 0.1 }, document.getElementById('inp-taxRate')?.value)      ?? state.inputs.taxRate;
      const waccComputed = ce * ew + cd * dw * (1 - tr);
      const waccEl = document.getElementById('inp-wacc');
      if (waccEl) waccEl.value = (waccComputed * 100).toFixed(1);
    });
  });

  // Auto-recalculate on any assumption input change (debounced 200ms)
  for (const group of ASSUMPTION_GROUPS) {
    for (const field of group.fields) {
      const el = document.getElementById(`inp-${field.key}`);
      if (el) el.addEventListener('input', recalculateDebounced);
    }
  }

  // Wire Market Context accordion listeners
  _wireMarketContextListeners();

  // Initialize context panel if mount point exists
  if (typeof initContextPanel === 'function') initContextPanel();
}
