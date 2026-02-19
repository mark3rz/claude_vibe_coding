/* ============================================================
   TASK 06 — Header + Executive Metrics
   Wires state.dcf results to the sticky header metric strip.
   Animates numbers via requestAnimationFrame.
   Also renders a full executive summary card below the header.
   Called after calculateDCF() completes (and on recalculate).
============================================================ */

// --- Number formatting helpers ---

function fmtCurrency(val, units) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  // Detect magnitude and suffix
  const abs = Math.abs(val);
  if (abs >= 1e12) return (val / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return (val / 1e9).toFixed(2)  + 'B';
  if (abs >= 1e6)  return (val / 1e6).toFixed(2)  + 'M';
  if (abs >= 1e3)  return (val / 1e3).toFixed(1)  + 'K';
  return val.toFixed(2);
}

function fmtPct(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return (val * 100).toFixed(1) + '%';
}

function fmtPrice(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  return '$' + val.toFixed(2);
}

function fmtUpside(val) {
  if (val === null || val === undefined || !isFinite(val)) return '—';
  const sign = val >= 0 ? '+' : '';
  return sign + (val * 100).toFixed(1) + '%';
}

// --- Animated counter using requestAnimationFrame ---
// Tweens from `from` to `to` over `duration` ms, calling `setter(displayVal)` each frame.
function animateValue(from, to, duration, setter) {
  if (from === null || to === null || !isFinite(from) || !isFinite(to)) {
    setter(to);
    return;
  }
  const start = performance.now();
  const delta = to - from;

  function step(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    setter(from + delta * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Track previous raw values so animation tweens from last state
const _prevMetrics = {
  ev: 0, equity: 0, npvFCF: 0, irr: 0, wacc: 0, upside: 0,
};

// --- Update the sticky header metric strip ---
function updateHeaderMetrics(summary) {
  if (!summary) return;

  const units = state.rawData?.units || '';
  const dur   = 800; // animation duration ms

  // Enterprise Value
  const elEV = document.getElementById('hdr-ev');
  if (elEV && summary.enterpriseValue != null) {
    animateValue(_prevMetrics.ev, summary.enterpriseValue, dur, v => {
      elEV.textContent = fmtCurrency(v, units);
    });
    _prevMetrics.ev = summary.enterpriseValue;
  }

  // Equity Value per Share
  const elEquity = document.getElementById('hdr-equity');
  if (elEquity) {
    const target = summary.impliedPrice ?? summary.equityValue;
    animateValue(_prevMetrics.equity, target ?? 0, dur, v => {
      elEquity.textContent = summary.impliedPrice != null ? fmtPrice(v) : fmtCurrency(v, units);
    });
    _prevMetrics.equity = target ?? 0;
  }

  // IRR
  const elIRR = document.getElementById('hdr-irr');
  if (elIRR && summary.irr != null) {
    animateValue(_prevMetrics.irr, summary.irr, dur, v => {
      elIRR.textContent = fmtPct(v);
    });
    _prevMetrics.irr = summary.irr;
  }

  // WACC
  const elWACC = document.getElementById('hdr-wacc');
  if (elWACC && summary.wacc != null) {
    animateValue(_prevMetrics.wacc, summary.wacc, dur, v => {
      elWACC.textContent = fmtPct(v);
    });
    _prevMetrics.wacc = summary.wacc;
  }

  // Upside / Downside
  const elUpside = document.getElementById('hdr-upside');
  if (elUpside) {
    animateValue(_prevMetrics.upside, summary.upside ?? 0, dur, v => {
      elUpside.textContent = fmtUpside(summary.upside != null ? v : null);
      elUpside.className   = 'metric-value ' + (
        summary.upside == null ? '' :
        summary.upside >= 0 ? 'text-success' : 'text-danger'
      );
    });
    _prevMetrics.upside = summary.upside ?? 0;
  }
}

// --- Render the executive summary card ---
function renderExecutiveSummary() {
  const container = document.getElementById('section-executive');
  if (!container) return;
  if (!state.dcf || !state.dcf.valid) {
    container.innerHTML = state.dcf?.errors
      ? `<div class="card"><p class="body text-danger">${state.dcf.errors.join('<br>')}</p></div>`
      : '';
    return;
  }

  const s     = state.dcf.summary;
  const units = state.rawData?.units || '';

  const upsideClass = s.upside == null ? '' : s.upside >= 0 ? 'text-success' : 'text-danger';
  const irrVsWacc  = s.irr != null && s.wacc != null
    ? (s.irr >= s.wacc ? '<span class="text-success">IRR &gt; WACC ✓</span>' : '<span class="text-danger">IRR &lt; WACC ✗</span>')
    : '';

  container.innerHTML = `
    <div class="card-elevated" style="margin-bottom: 0;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--space-5);">
        <h2 class="h2">Executive Summary</h2>
        ${irrVsWacc ? `<span class="caption" style="font-size:0.8125rem;">${irrVsWacc}</span>` : ''}
      </div>

      <div class="grid-6">
        ${metricTile('Enterprise Value', fmtCurrency(s.enterpriseValue, units), 'text-terminal', 'EV = NPV of FCFs + PV of Terminal Value')}
        ${metricTile('Equity Value / Share', s.impliedPrice != null ? fmtPrice(s.impliedPrice) : fmtCurrency(s.equityValue, units), '', 'EV − Net Debt ÷ Shares Outstanding')}
        ${metricTile('NPV of FCFs', fmtCurrency(s.npvFCF, units), '', 'Sum of discounted forecast free cash flows')}
        ${metricTile('Terminal Value (PV)', fmtCurrency(s.pvTerminal, units), '', 'Gordon Growth: FCF × (1+g) ÷ (WACC − g), discounted')}
        ${metricTile('IRR', fmtPct(s.irr), s.irr != null && s.irr >= s.wacc ? 'text-success' : 'text-danger', 'Internal rate of return on equity cash flows')}
        ${metricTile('Upside / Downside', fmtUpside(s.upside), upsideClass, s.currentPrice ? `vs current price ${fmtPrice(s.currentPrice)}` : 'Set current price in assumptions to calculate')}
      </div>

      <hr class="section-divider" style="margin:var(--space-5) 0;" />

      <div class="grid-4">
        ${bridgeTile('WACC', fmtPct(s.wacc))}
        ${bridgeTile('Terminal Growth', fmtPct(s.terminalGrowth))}
        ${bridgeTile('Net Debt', fmtCurrency(s.netDebt, units))}
        ${bridgeTile('Forecast Years', state.dcf.inputs.forecastYears + 'Y')}
      </div>
    </div>
  `;
}

function metricTile(label, value, valueClass, tooltip) {
  return `
    <div class="metric-card" title="${tooltip}">
      <p class="caption" style="margin-bottom:var(--space-2);">${label}</p>
      <p class="metric-number ${valueClass}">${value}</p>
    </div>
  `;
}

function bridgeTile(label, value) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-1);">
      <span class="caption">${label}</span>
      <span style="font-family:monospace;font-size:0.9375rem;font-weight:600;color:var(--text-secondary);">${value}</span>
    </div>
  `;
}

// --- Main entry point — called after calculateDCF() ---
function renderExecutiveMetrics() {
  if (!state.dcf) return;
  updateHeaderMetrics(state.dcf.summary);
  renderExecutiveSummary();
}
