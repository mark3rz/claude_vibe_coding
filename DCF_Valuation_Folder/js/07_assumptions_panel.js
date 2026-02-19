/* ============================================================
   TASK 07 — Assumptions Panel
   Renders editable input fields for all DCF assumptions into
   #section-assumptions. Reads from state.inputs (set by Task 05).
   On Recalculate: writes back to state.inputs, calls calculateDCF,
   then re-renders all downstream sections.
============================================================ */

// --- Input field definition schema ---
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

// --- Format value for input display ---
function inputDisplayValue(field, rawVal) {
  if (rawVal === null || rawVal === undefined) return '';
  if (field.type === 'pct') return (rawVal * 100).toFixed(field.step < 1 ? 1 : 0);
  if (field.type === 'int') return Math.round(rawVal);
  return Number(rawVal).toFixed(field.step < 1 ? 2 : 0);
}

// --- Parse value from input back to state format ---
function parseInputValue(field, strVal) {
  const n = parseFloat(strVal);
  if (isNaN(n)) return null;
  if (field.type === 'pct') return n / 100;
  if (field.type === 'int') return Math.round(n);
  return n;
}

// --- Build a single input row ---
function buildInputRow(field) {
  const val = inputDisplayValue(field, state.inputs[field.key]);
  const prefix = field.prefix ? `<span class="input-affix">${field.prefix}</span>` : '';
  const suffix = field.suffix ? `<span class="input-affix">${field.suffix}</span>` : '';

  return `
    <div class="assumption-field">
      <label class="input-label" for="inp-${field.key}">${field.label}</label>
      <div class="input-wrap">
        ${prefix}
        <input
          class="input-control"
          type="number"
          id="inp-${field.key}"
          data-key="${field.key}"
          value="${val}"
          ${field.min !== null ? `min="${field.type === 'pct' ? field.min : field.min}"` : ''}
          ${field.max !== null ? `max="${field.type === 'pct' ? field.max : field.max}"` : ''}
          step="${field.step}"
        />
        ${suffix}
      </div>
    </div>
  `;
}

// --- Build a group card ---
function buildGroupCard(group) {
  return `
    <div class="card assumption-group">
      <p class="h3" style="margin-bottom:var(--space-4);">${group.label}</p>
      <div class="assumption-fields">
        ${group.fields.map(buildInputRow).join('')}
      </div>
    </div>
  `;
}

// --- Collect all input values from DOM into state.inputs ---
function collectInputs() {
  for (const group of ASSUMPTION_GROUPS) {
    for (const field of group.fields) {
      const el = document.getElementById(`inp-${field.key}`);
      if (!el) continue;
      const parsed = parseInputValue(field, el.value);
      if (parsed !== null) state.inputs[field.key] = parsed;
    }
  }

  // Recompute WACC from components if the user hasn't directly edited it
  // (we recompute only if costOfEquity/debtWeight fields were changed)
  const computed = state.inputs.costOfEquity * state.inputs.equityWeight
                 + state.inputs.costOfDebt   * state.inputs.debtWeight * (1 - state.inputs.taxRate);

  // Only override WACC if the user hasn't manually set it to something different
  const waccEl = document.getElementById('inp-wacc');
  if (waccEl && Math.abs(parseInputValue({ type: 'pct', step: 0.1 }, waccEl.value) - state.inputs.wacc) < 0.0005) {
    state.inputs.wacc = computed;
  }
}

// --- Full recalculation pipeline ---
function recalculate() {
  collectInputs();
  calculateDCF(state.inputs, state.historical);
  if (typeof renderExecutiveMetrics === 'function') renderExecutiveMetrics();
  if (typeof renderDCFTable        === 'function') renderDCFTable();
  if (typeof renderCharts          === 'function') renderCharts();
  if (typeof renderSensitivity     === 'function') renderSensitivity();
  if (typeof renderScenario        === 'function') renderScenario();
  // Refresh WACC display after recompute
  const waccEl = document.getElementById('inp-wacc');
  if (waccEl) waccEl.value = inputDisplayValue({ type: 'pct', step: 0.1 }, state.inputs.wacc);
}

// --- Main render function ---
function renderAssumptionsPanel() {
  const container = document.getElementById('section-assumptions');
  if (!container) return;

  container.innerHTML = `
    <div class="card-elevated" style="margin-bottom:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-5);">
        <h2 class="h2">Assumptions</h2>
        <button class="btn-primary" id="btn-recalc-panel">&#8635; Recalculate</button>
      </div>
      <div class="assumptions-grid">
        ${ASSUMPTION_GROUPS.map(buildGroupCard).join('')}
      </div>
    </div>
  `;

  // Wire recalculate button
  document.getElementById('btn-recalc-panel').addEventListener('click', recalculate);

  // Live-update WACC display as components change
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
}
