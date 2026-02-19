/* ============================================================
   TASK 09 — Core Charts
   Three Chart.js charts rendered into #section-charts:
     1. EV Waterfall  — NPV of FCFs + PV Terminal = EV bridge
     2. Historical FCF — bar chart of historical free cash flow
     3. Revenue + EBITDA — combo bar/line chart
   All charts:
     - Use CHART_COLORS / DESIGN_TOKENS from constants.js
     - Use dark theme (no Chart.js defaults)
     - Are safely destroyed before recreation (no duplication)
     - Update whenever renderCharts() is called
============================================================ */

// --- Chart instance registry (destroy before recreate) ---
const _chartInstances = {};

function destroyChart(key) {
  if (_chartInstances[key]) {
    _chartInstances[key].destroy();
    _chartInstances[key] = null;
  }
}

// --- Shared dark theme defaults applied to every chart ---
function darkDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        labels: {
          color: DESIGN_TOKENS.textSecondary,
          font: { family: 'Inter, system-ui, sans-serif', size: 12 },
          boxWidth: 12,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: DESIGN_TOKENS.bgElevated,
        titleColor: DESIGN_TOKENS.textPrimary,
        bodyColor: DESIGN_TOKENS.textSecondary,
        borderColor: DESIGN_TOKENS.borderStrong,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        titleFont: { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' },
        bodyFont: { family: 'Inter, system-ui, sans-serif', size: 11 },
      },
    },
    scales: {
      x: {
        grid:  { color: DESIGN_TOKENS.borderSubtle, drawBorder: false },
        ticks: { color: DESIGN_TOKENS.textMuted, font: { size: 11 } },
      },
      y: {
        grid:  { color: DESIGN_TOKENS.borderSubtle, drawBorder: false },
        ticks: { color: DESIGN_TOKENS.textMuted, font: { size: 11 } },
      },
    },
  };
}

// --- Format axis tick values compactly ---
function compactFmt(val) {
  if (val === null || !isFinite(val)) return '';
  const abs = Math.abs(val);
  if (abs >= 1e9)  return (val / 1e9).toFixed(1)  + 'B';
  if (abs >= 1e6)  return (val / 1e6).toFixed(1)  + 'M';
  if (abs >= 1e3)  return (val / 1e3).toFixed(0)  + 'K';
  return val.toFixed(1);
}

// ──────────────────────────────────────────────────────────────
// CHART 1 — EV Waterfall
// Shows: NPV of FCFs (stacked bars per year) + PV Terminal = EV
// ──────────────────────────────────────────────────────────────
function renderEVWaterfall(canvasId) {
  destroyChart('evWaterfall');
  const canvas = document.getElementById(canvasId);
  if (!canvas || !state.dcf?.valid) return;

  const d      = state.dcf;
  const n      = d.inputs.forecastYears;
  const labels = [...d.forecastYearLabels, 'Terminal\nValue', 'Enterprise\nValue'];

  // Per-year PV FCF bars + terminal + total
  const pvFCFData    = [...d.forecast.pvFCF, null, null];
  const terminalData = [...Array(n).fill(null), d.summary.pvTerminal, null];
  const evTotalData  = [...Array(n + 1).fill(null), d.summary.enterpriseValue];

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'PV of FCF',
          data: pvFCFData,
          backgroundColor: CHART_COLORS.primary + 'cc',
          borderColor: CHART_COLORS.primary,
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'PV of Terminal Value',
          data: terminalData,
          backgroundColor: CHART_COLORS.secondary + 'cc',
          borderColor: CHART_COLORS.secondary,
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Enterprise Value',
          data: evTotalData,
          backgroundColor: CHART_COLORS.terminal + 'cc',
          borderColor: CHART_COLORS.terminal,
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      ...darkDefaults(),
      plugins: {
        ...darkDefaults().plugins,
        title: {
          display: true,
          text: 'Enterprise Value Bridge',
          color: DESIGN_TOKENS.textPrimary,
          font: { size: 13, weight: '600', family: 'Inter, system-ui, sans-serif' },
          padding: { bottom: 16 },
        },
        tooltip: {
          ...darkDefaults().plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${compactFmt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: darkDefaults().scales.x,
        y: {
          ...darkDefaults().scales.y,
          ticks: {
            ...darkDefaults().scales.y.ticks,
            callback: v => compactFmt(v),
          },
        },
      },
    },
  };

  _chartInstances.evWaterfall = new Chart(canvas, cfg);
}

// ──────────────────────────────────────────────────────────────
// CHART 2 — Historical Free Cash Flow
// ──────────────────────────────────────────────────────────────
function renderFCFChart(canvasId) {
  destroyChart('fcfChart');
  const canvas = document.getElementById(canvasId);
  if (!canvas || !state.historical) return;

  const years = state.historical.years;
  const fcf   = state.historical.derived?.fcf || state.historical.metrics?.freeCashFlow;
  if (!fcf) return;

  // Color bars: green if positive, red if negative
  const barColors = fcf.map(v =>
    v === null ? CHART_COLORS.neutral + '66' :
    v >= 0     ? CHART_COLORS.success + 'cc' : CHART_COLORS.danger + 'cc'
  );
  const borderColors = fcf.map(v =>
    v === null ? CHART_COLORS.neutral :
    v >= 0     ? CHART_COLORS.success : CHART_COLORS.danger
  );

  const cfg = {
    type: 'bar',
    data: {
      labels: years,
      datasets: [{
        label: 'Free Cash Flow',
        data: fcf,
        backgroundColor: barColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      ...darkDefaults(),
      plugins: {
        ...darkDefaults().plugins,
        title: {
          display: true,
          text: 'Historical Free Cash Flow',
          color: DESIGN_TOKENS.textPrimary,
          font: { size: 13, weight: '600', family: 'Inter, system-ui, sans-serif' },
          padding: { bottom: 16 },
        },
        tooltip: {
          ...darkDefaults().plugins.tooltip,
          callbacks: {
            label: ctx => ` FCF: ${compactFmt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: darkDefaults().scales.x,
        y: {
          ...darkDefaults().scales.y,
          ticks: { ...darkDefaults().scales.y.ticks, callback: v => compactFmt(v) },
        },
      },
    },
  };

  _chartInstances.fcfChart = new Chart(canvas, cfg);
}

// ──────────────────────────────────────────────────────────────
// CHART 3 — Revenue + EBITDA combo (bar + line)
// ──────────────────────────────────────────────────────────────
function renderRevenueEBITDAChart(canvasId) {
  destroyChart('revenueChart');
  const canvas = document.getElementById(canvasId);
  if (!canvas || !state.historical) return;

  const years   = state.historical.years;
  const revenue = state.historical.metrics?.revenue;
  const ebitda  = state.historical.metrics?.ebitda;
  const ebit    = state.historical.metrics?.ebit; // fallback if no EBITDA

  if (!revenue) return;

  const datasets = [
    {
      type: 'bar',
      label: 'Revenue',
      data: revenue,
      backgroundColor: CHART_COLORS.primary + '66',
      borderColor: CHART_COLORS.primary,
      borderWidth: 1,
      borderRadius: 4,
      yAxisID: 'y',
    },
  ];

  if (ebitda) {
    datasets.push({
      type: 'line',
      label: 'EBITDA',
      data: ebitda,
      borderColor: CHART_COLORS.terminal,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointBackgroundColor: CHART_COLORS.terminal,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      yAxisID: 'y',
    });
  } else if (ebit) {
    datasets.push({
      type: 'line',
      label: 'EBIT',
      data: ebit,
      borderColor: CHART_COLORS.warning,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointBackgroundColor: CHART_COLORS.warning,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      yAxisID: 'y',
    });
  }

  const cfg = {
    type: 'bar',
    data: { labels: years, datasets },
    options: {
      ...darkDefaults(),
      plugins: {
        ...darkDefaults().plugins,
        title: {
          display: true,
          text: 'Revenue & ' + (ebitda ? 'EBITDA' : ebit ? 'EBIT' : 'Margins'),
          color: DESIGN_TOKENS.textPrimary,
          font: { size: 13, weight: '600', family: 'Inter, system-ui, sans-serif' },
          padding: { bottom: 16 },
        },
        tooltip: {
          ...darkDefaults().plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${compactFmt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: darkDefaults().scales.x,
        y: {
          ...darkDefaults().scales.y,
          ticks: { ...darkDefaults().scales.y.ticks, callback: v => compactFmt(v) },
        },
      },
    },
  };

  _chartInstances.revenueChart = new Chart(canvas, cfg);
}

// ──────────────────────────────────────────────────────────────
// Main render function — builds the section HTML then draws charts
// ──────────────────────────────────────────────────────────────
function renderCharts() {
  const container = document.getElementById('section-charts');
  if (!container) return;

  const hasHistorical = !!state.historical;
  const hasDCF        = !!(state.dcf?.valid);

  if (!hasHistorical) {
    container.innerHTML = `<div class="card"><p class="body text-muted">Charts will appear after a file is loaded.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="card-elevated" style="margin-bottom:0;">
      <h2 class="h2" style="margin-bottom:var(--space-5);">Charts</h2>
      <div class="charts-grid">

        ${hasDCF ? `
        <div class="chart-card">
          <div class="chart-wrapper">
            <canvas id="canvas-ev-waterfall"></canvas>
          </div>
        </div>` : ''}

        <div class="chart-card">
          <div class="chart-wrapper">
            <canvas id="canvas-revenue-ebitda"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-wrapper">
            <canvas id="canvas-fcf"></canvas>
          </div>
        </div>

      </div>
    </div>
  `;

  // Small defer to let the DOM paint before Chart.js measures canvas size
  requestAnimationFrame(() => {
    if (hasDCF)  renderEVWaterfall('canvas-ev-waterfall');
    renderRevenueEBITDAChart('canvas-revenue-ebitda');
    renderFCFChart('canvas-fcf');
  });
}
