/* ============================================================
   TASK 10B — Scenario Builder: Sliders + Tornado Chart
   Renders into #section-scenario:
     - 7 interactive sliders (WACC, Revenue Growth, EBIT Margin,
       Tax Rate, CapEx %, Terminal Growth, Exit Multiple)
     - Live delta panel (implied price vs base case)
     - Tornado chart ranking input sensitivity largest → smallest
   Uses sensitivityPrice() from 10a_sensitivity.js.
   Does NOT modify sensitivity tables from 10A.
   Throttles recalculation to prevent excessive execution.
============================================================ */

// --- Slider definitions ---
const SCENARIO_SLIDERS = [
  { key: 'wacc',          label: 'WACC',            type: 'pct',   min: 0.04, max: 0.20,  step: 0.001, delta: 0.01  },
  { key: 'revenueGrowth', label: 'Revenue Growth',  type: 'pct',   min: -0.10, max: 0.30, step: 0.001, delta: 0.02  },
  { key: 'ebitMargin',    label: 'EBIT Margin',      type: 'pct',   min: 0.02, max: 0.50,  step: 0.001, delta: 0.02  },
  { key: 'taxRate',       label: 'Tax Rate',          type: 'pct',   min: 0.05, max: 0.45,  step: 0.001, delta: 0.02  },
  { key: 'capexPct',      label: 'CapEx (% Rev)',     type: 'pct',   min: 0.00, max: 0.20,  step: 0.001, delta: 0.01  },
  { key: 'terminalGrowth',label: 'Terminal Growth',  type: 'pct',   min: 0.00, max: 0.06,  step: 0.001, delta: 0.005 },
  { key: 'exitMultiple',  label: 'Exit EV/EBITDA',   type: 'float', min: 5,    max: 30,    step: 0.5,   delta: 2     },
];

// --- Throttle helper ---
function throttle(fn, ms) {
  let last = 0, timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = ms - (now - last);
    clearTimeout(timer);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else {
      timer = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, remaining);
    }
  };
}

// --- Store base-case price (set when section first renders) ---
let _scenarioBasePrice = null;
let _scenarioBaseInputs = null;

// --- Compute tornado: vary each slider ±delta, measure price impact ---
function computeTornado() {
  const basePrice = sensitivityPrice({});
  if (!basePrice) return [];

  return SCENARIO_SLIDERS
    .filter(s => s.key !== 'exitMultiple') // exit multiple not in core DCF engine yet
    .map(s => {
      const hi = sensitivityPrice({ [s.key]: state.inputs[s.key] + s.delta });
      const lo = sensitivityPrice({ [s.key]: state.inputs[s.key] - s.delta });
      const hiDelta = hi !== null ? hi - basePrice : 0;
      const loDelta = lo !== null ? lo - basePrice : 0;
      return {
        label:   s.label,
        key:     s.key,
        hiDelta,
        loDelta,
        spread:  Math.abs(hiDelta) + Math.abs(loDelta),
      };
    })
    .sort((a, b) => b.spread - a.spread);
}

// --- Render tornado chart ---
function renderTornadoChart() {
  destroyChart('tornadoChart');
  const canvas = document.getElementById('canvas-tornado');
  if (!canvas) return;

  const items = computeTornado();
  if (!items.length) return;

  const labels   = items.map(i => i.label);
  const hiData   = items.map(i => i.hiDelta);
  const loData   = items.map(i => i.loDelta);

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '+Δ (input increased)',
          data: hiData,
          backgroundColor: CHART_COLORS.success + 'cc',
          borderColor: CHART_COLORS.success,
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: '−Δ (input decreased)',
          data: loData,
          backgroundColor: CHART_COLORS.danger + 'cc',
          borderColor: CHART_COLORS.danger,
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: 'y',           // horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          labels: {
            color: DESIGN_TOKENS.textSecondary,
            font: { family: 'Inter, system-ui, sans-serif', size: 11 },
            boxWidth: 10,
          },
        },
        title: {
          display: true,
          text: 'Sensitivity to Key Inputs (Impact on Implied Share Price)',
          color: DESIGN_TOKENS.textPrimary,
          font: { size: 13, weight: '600', family: 'Inter, system-ui, sans-serif' },
          padding: { bottom: 12 },
        },
        tooltip: {
          backgroundColor: DESIGN_TOKENS.bgElevated,
          titleColor: DESIGN_TOKENS.textPrimary,
          bodyColor: DESIGN_TOKENS.textSecondary,
          borderColor: DESIGN_TOKENS.borderStrong,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: ctx => {
              const sign = ctx.raw >= 0 ? '+' : '';
              return ` ${ctx.dataset.label}: ${sign}$${ctx.raw.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid:  { color: DESIGN_TOKENS.borderSubtle },
          ticks: {
            color: DESIGN_TOKENS.textMuted,
            font: { size: 10 },
            callback: v => (v >= 0 ? '+' : '') + '$' + v.toFixed(1),
          },
        },
        y: {
          grid:  { display: false },
          ticks: { color: DESIGN_TOKENS.textSecondary, font: { size: 11 } },
        },
      },
    },
  };

  _chartInstances.tornadoChart = new Chart(canvas, cfg);
}

// --- Update output delta panel ---
function updateScenarioDelta() {
  const el = document.getElementById('scenario-delta-panel');
  if (!el) return;

  const current = sensitivityPrice({});
  const base    = _scenarioBasePrice;

  if (!current || !base) { el.innerHTML = ''; return; }

  const delta    = current - base;
  const deltaPct = delta / Math.abs(base);
  const sign     = delta >= 0 ? '+' : '';
  const cls      = delta >= 0 ? 'text-success' : 'text-danger';

  el.innerHTML = `
    <div class="scenario-delta-grid">
      <div class="scenario-delta-item">
        <span class="caption">Base Case Price</span>
        <span class="metric-number">${base !== null ? '$' + base.toFixed(2) : '—'}</span>
      </div>
      <div class="scenario-delta-item">
        <span class="caption">Scenario Price</span>
        <span class="metric-number ${cls}">${current !== null ? '$' + current.toFixed(2) : '—'}</span>
      </div>
      <div class="scenario-delta-item">
        <span class="caption">Delta ($)</span>
        <span class="metric-number ${cls}">${sign}$${delta.toFixed(2)}</span>
      </div>
      <div class="scenario-delta-item">
        <span class="caption">Delta (%)</span>
        <span class="metric-number ${cls}">${sign}${(deltaPct * 100).toFixed(1)}%</span>
      </div>
    </div>
  `;
}

// --- Throttled on-slider-change handler ---
const _onSliderChange = throttle(function () {
  // Collect all slider values into state.inputs
  SCENARIO_SLIDERS.forEach(s => {
    if (s.key === 'exitMultiple') return; // not used in core engine yet
    const el = document.getElementById(`slider-${s.key}`);
    if (!el) return;
    const raw = parseFloat(el.value);
    state.inputs[s.key] = isNaN(raw) ? state.inputs[s.key] : raw;
  });

  // Re-run DCF engine with updated inputs
  calculateDCF(state.inputs, state.historical);

  // Update delta display
  updateScenarioDelta();

  // Refresh tornado
  renderTornadoChart();

  // Refresh executive metrics (animated)
  if (typeof renderExecutiveMetrics === 'function') renderExecutiveMetrics();
}, 80); // 80ms throttle — smooth but not blocking

// --- Format slider display value ---
function sliderDisplay(s, val) {
  if (s.type === 'pct') return (val * 100).toFixed(1) + '%';
  return val.toFixed(1);
}

// --- Build one slider row ---
function buildSliderRow(s) {
  const val    = state.inputs[s.key] ?? s.min + (s.max - s.min) / 2;
  const display = sliderDisplay(s, val);

  return `
    <div class="slider-row">
      <div class="slider-header">
        <span class="slider-label">${s.label}</span>
        <span class="slider-value" id="slider-val-${s.key}">${display}</span>
      </div>
      <input
        type="range"
        id="slider-${s.key}"
        min="${s.min}"
        max="${s.max}"
        step="${s.step}"
        value="${val}"
        data-key="${s.key}"
        data-type="${s.type}"
      />
    </div>
  `;
}

// --- Main render function ---
function renderScenario() {
  const container = document.getElementById('section-scenario');
  if (!container) return;

  if (!state.dcf?.valid || !state.inputs) {
    container.innerHTML = `<div class="card"><p class="body text-muted">Scenario builder will appear after a valuation is run.</p></div>`;
    return;
  }

  // Snapshot base case on first render
  _scenarioBasePrice  = sensitivityPrice({});
  _scenarioBaseInputs = { ...state.inputs };

  container.innerHTML = `
    <div class="card-elevated" style="margin-bottom:0;">
      <h2 class="h2" style="margin-bottom:var(--space-2);">Scenario Builder</h2>
      <p class="body" style="margin-bottom:var(--space-5);">Adjust sliders to explore scenarios. Valuation updates live.</p>

      <div class="scenario-layout">

        <!-- LEFT: Sliders -->
        <div class="scenario-sliders">
          <p class="h3" style="margin-bottom:var(--space-4);">Input Assumptions</p>
          <div class="sliders-list">
            ${SCENARIO_SLIDERS.filter(s => s.key !== 'exitMultiple').map(buildSliderRow).join('')}
          </div>
          <button class="btn-secondary" id="btn-reset-scenario" style="margin-top:var(--space-4);width:100%;">
            ↺ Reset to Base Case
          </button>
        </div>

        <!-- RIGHT: Delta output -->
        <div class="scenario-output">
          <p class="h3" style="margin-bottom:var(--space-4);">Scenario vs Base Case</p>
          <div id="scenario-delta-panel"></div>

          <!-- Tornado chart -->
          <div style="margin-top:var(--space-5);">
            <div style="position:relative;height:280px;">
              <canvas id="canvas-tornado"></canvas>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  // Initialise delta display
  updateScenarioDelta();

  // Wire slider events
  SCENARIO_SLIDERS.forEach(s => {
    if (s.key === 'exitMultiple') return;
    const input = document.getElementById(`slider-${s.key}`);
    const label = document.getElementById(`slider-val-${s.key}`);
    if (!input) return;

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      if (label) label.textContent = sliderDisplay(s, val);
      _onSliderChange();
    });
  });

  // Reset button: restore base-case inputs, re-render panel
  document.getElementById('btn-reset-scenario')?.addEventListener('click', () => {
    Object.assign(state.inputs, _scenarioBaseInputs);
    calculateDCF(state.inputs, state.historical);
    if (typeof renderExecutiveMetrics === 'function') renderExecutiveMetrics();
    // Reset slider positions
    SCENARIO_SLIDERS.forEach(s => {
      if (s.key === 'exitMultiple') return;
      const input = document.getElementById(`slider-${s.key}`);
      const label = document.getElementById(`slider-val-${s.key}`);
      if (input) input.value = _scenarioBaseInputs[s.key];
      if (label) label.textContent = sliderDisplay(s, _scenarioBaseInputs[s.key]);
    });
    updateScenarioDelta();
    renderTornadoChart();
  });

  // Draw tornado after DOM paints
  requestAnimationFrame(() => renderTornadoChart());
}
