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

  container.innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      gap:16px;
      flex-wrap:wrap;
      padding:6px 10px;
      background:var(--bg-tertiary);
      border:1px solid var(--border-subtle);
      border-radius:var(--radius-lg);
    ">
      ${inlineTile('EV', fmtCurrency(s.enterpriseValue, units), 'text-terminal')}
      ${inlineTile('Equity/Share', s.impliedPrice != null ? fmtPrice(s.impliedPrice) : fmtCurrency(s.equityValue, units), '')}
      ${inlineTile('NPV FCFs', fmtCurrency(s.npvFCF, units), '')}
      ${inlineTile('PV Terminal', fmtCurrency(s.pvTerminal, units), '')}
      ${inlineTile('IRR', fmtPct(s.irr), s.irr != null && s.irr >= s.wacc ? 'text-success' : 'text-danger')}
      ${inlineTile('Upside', fmtUpside(s.upside), upsideClass)}
      <span style="border-left:1px solid var(--border-subtle);height:24px;margin:0 2px;"></span>
      ${inlineTile('WACC', fmtPct(s.wacc), 'text-secondary')}
      ${inlineTile('Term. Growth', fmtPct(s.terminalGrowth), 'text-secondary')}
      ${inlineTile('Net Debt', fmtCurrency(s.netDebt, units), 'text-secondary')}
      ${inlineTile('Forecast', state.dcf.inputs.forecastYears + 'Y', 'text-secondary')}
    </div>
  `;
}

function inlineTile(label, value, valueClass) {
  return `
    <div style="display:flex;flex-direction:column;gap:0;min-width:0;">
      <span style="font-size:0.5625rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);white-space:nowrap;">${label}</span>
      <span class="${valueClass}" style="font-family:'SF Mono','Fira Code',monospace;font-size:0.8125rem;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;">${value}</span>
    </div>
  `;
}

// Keep legacy functions for backward compatibility (unused but harmless)
function metricTile(label, value, valueClass, tooltip) {
  return inlineTile(label, value, valueClass);
}

function bridgeTile(label, value) {
  return inlineTile(label, value, 'text-secondary');
}

// --- Main entry point — called after calculateDCF() ---
function renderExecutiveMetrics() {
  if (!state.dcf) return;
  updateHeaderMetrics(state.dcf.summary);
  renderExecutiveSummary();
}
