/* ============================================================
   TASK 13 -- Financial Diagnostics
   Config-driven multi-tab diagnostic panel with scoring engine.
   Reads state.historical (metrics + derived) and state.inputs /
   state.dcf. Renders into #section-diagnostics.

   HOW TO EXTEND:
   ---------------------------------------------------------------
   Add a new tab:
     1) Add an entry to DIAG_TAB_CONFIG with id, label, banner fn,
        tiles array, scenarios array, and questions array.
     2) The renderer picks it up automatically.

   Add a new metric tile:
     1) Add an object to the tab's `tiles` array with:
        { key, label, valueFn, formatFn, good, bad }
        - valueFn(yr, ctx) returns the value for the selected year
        - formatFn formats the value for display

   Add a new question:
     1) Add an object to the tab's `questions` array with:
        { id, theme, question, metricKey, evaluateFn, explanation }
        - evaluateFn(value, sector, conservative) => 'good'|'watch'|'concern'
        - explanation: string shown when expanded

   Extend thresholds for a new sector:
     1) Add a key to SECTOR_THRESHOLDS (e.g., 'healthcare').
     2) Add corresponding conservative overrides in
        SECTOR_THRESHOLDS_CONSERVATIVE.
     3) The evaluateStatus helper and scoring engine will pick it up.
============================================================ */

/* ----------------------------------------------------------
   SECTION 0 -- HELPERS & UTILITIES
---------------------------------------------------------- */

// Safe deep property access
function _fdSafeGet(obj, path, fallback) {
  if (!obj) return fallback;
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return fallback;
    cur = cur[k];
  }
  return (cur !== null && cur !== undefined && (typeof cur !== 'number' || isFinite(cur))) ? cur : fallback;
}

// Format helpers (scoped to avoid collisions)
function _fdPct(val) {
  if (val == null || !isFinite(val)) return '<span class="fd-na">n/a</span>';
  return (val * 100).toFixed(1) + '%';
}
function _fdMult(val) {
  if (val == null || !isFinite(val)) return '<span class="fd-na">n/a</span>';
  return val.toFixed(1) + 'x';
}
function _fdCurrency(val) {
  if (val == null || !isFinite(val)) return '<span class="fd-na">n/a</span>';
  const abs = Math.abs(val);
  let formatted;
  if (abs >= 1e12) formatted = (abs / 1e12).toFixed(2) + 'T';
  else if (abs >= 1e9) formatted = (abs / 1e9).toFixed(2) + 'B';
  else if (abs >= 1e6) formatted = (abs / 1e6).toFixed(1) + 'M';
  else if (abs >= 1e3) formatted = (abs / 1e3).toFixed(1) + 'K';
  else formatted = abs.toFixed(1);
  return (val < 0 ? '-$' : '$') + formatted;
}
function _fdNum(val, dec) {
  if (val == null || !isFinite(val)) return '<span class="fd-na">n/a</span>';
  return val.toFixed(dec != null ? dec : 1);
}
function _fdDelta(val) {
  if (val == null || !isFinite(val)) return '<span class="fd-na">n/a</span>';
  const sign = val > 0 ? '+' : '';
  return sign + (val * 100).toFixed(1) + 'pp';
}

// YoY change for a series at index i
function _fdYoY(series, i) {
  if (!series || i < 1) return null;
  const cur = series[i];
  const prev = series[i - 1];
  if (cur == null || prev == null || prev === 0 || !isFinite(cur) || !isFinite(prev)) return null;
  return (cur - prev) / Math.abs(prev);
}

// 3-year CAGR ending at index i
function _fdCagr3(series, i) {
  if (!series || i < 3) return null;
  const end = series[i];
  const start = series[i - 3];
  if (end == null || start == null || start <= 0 || end <= 0 || !isFinite(end) || !isFinite(start)) return null;
  return Math.pow(end / start, 1 / 3) - 1;
}

// Safe value from a series at index
function _fdVal(series, i) {
  if (!series || i < 0 || i >= series.length) return null;
  const v = series[i];
  return (v !== null && v !== undefined && isFinite(v)) ? v : null;
}

/* ----------------------------------------------------------
   SECTION 1 -- SECTOR THRESHOLDS
---------------------------------------------------------- */
const SECTOR_THRESHOLDS = {
  general: {
    revGrowth:       { good: 0.05,  watch: 0.00, concern: -0.05 },
    revCAGR3:        { good: 0.05,  watch: 0.02, concern: -0.02 },
    ebitdaMargin:    { good: 0.18,  watch: 0.10, concern: 0.05 },
    ebitMargin:      { good: 0.12,  watch: 0.06, concern: 0.00 },
    fcfConversion:   { good: 0.55,  watch: 0.30, concern: 0.10 },
    ndEbitda:        { good: 2.0,   watch: 3.5,  concern: 5.0,  invert: true },
    nwcPctRev:       { good: 0.02,  watch: 0.05, concern: 0.10, invert: true },
    capexPctRev:     { good: 0.04,  watch: 0.08, concern: 0.15, invert: true },
    intCoverage:     { good: 6.0,   watch: 3.0,  concern: 1.5 },
    roic:            { good: 0.12,  watch: 0.08, concern: 0.04 },
    roicSpread:      { good: 0.03,  watch: 0.00, concern: -0.03 },
    grossMargin:     { good: 0.35,  watch: 0.20, concern: 0.10 },
    netMargin:       { good: 0.08,  watch: 0.03, concern: -0.02 },
    currentRatio:    { good: 1.5,   watch: 1.0,  concern: 0.7 },
    debtToEquity:    { good: 0.8,   watch: 1.5,  concern: 2.5,  invert: true },
    cfoToNetIncome:  { good: 1.0,   watch: 0.7,  concern: 0.4 },
    capexToDa:       { good: 0.8,   watch: 1.3,  concern: 2.0,  invert: true },
  },
  tech: {
    revGrowth:       { good: 0.10,  watch: 0.03, concern: -0.03 },
    revCAGR3:        { good: 0.10,  watch: 0.05, concern: 0.00 },
    ebitdaMargin:    { good: 0.25,  watch: 0.15, concern: 0.05 },
    ebitMargin:      { good: 0.18,  watch: 0.10, concern: 0.00 },
    fcfConversion:   { good: 0.60,  watch: 0.35, concern: 0.15 },
    ndEbitda:        { good: 1.5,   watch: 3.0,  concern: 4.5,  invert: true },
    nwcPctRev:       { good: 0.01,  watch: 0.04, concern: 0.08, invert: true },
    capexPctRev:     { good: 0.03,  watch: 0.06, concern: 0.12, invert: true },
    intCoverage:     { good: 8.0,   watch: 4.0,  concern: 2.0 },
    roic:            { good: 0.15,  watch: 0.10, concern: 0.05 },
    roicSpread:      { good: 0.05,  watch: 0.00, concern: -0.05 },
    grossMargin:     { good: 0.55,  watch: 0.40, concern: 0.25 },
    netMargin:       { good: 0.12,  watch: 0.05, concern: -0.05 },
    currentRatio:    { good: 2.0,   watch: 1.2,  concern: 0.8 },
    debtToEquity:    { good: 0.5,   watch: 1.0,  concern: 2.0,  invert: true },
    cfoToNetIncome:  { good: 1.2,   watch: 0.8,  concern: 0.5 },
    capexToDa:       { good: 0.6,   watch: 1.0,  concern: 1.5,  invert: true },
  },
};

// Conservative adjustments: tighten thresholds by moving good up, concern closer
const SECTOR_THRESHOLDS_CONSERVATIVE = {
  general: {
    revGrowth:       { good: 0.07,  watch: 0.02, concern: -0.03 },
    revCAGR3:        { good: 0.07,  watch: 0.03, concern: 0.00 },
    ebitdaMargin:    { good: 0.22,  watch: 0.14, concern: 0.08 },
    ebitMargin:      { good: 0.15,  watch: 0.09, concern: 0.03 },
    fcfConversion:   { good: 0.65,  watch: 0.40, concern: 0.20 },
    ndEbitda:        { good: 1.5,   watch: 2.5,  concern: 4.0,  invert: true },
    nwcPctRev:       { good: 0.01,  watch: 0.03, concern: 0.07, invert: true },
    capexPctRev:     { good: 0.03,  watch: 0.06, concern: 0.12, invert: true },
    intCoverage:     { good: 8.0,   watch: 4.5,  concern: 2.5 },
    roic:            { good: 0.15,  watch: 0.10, concern: 0.06 },
    roicSpread:      { good: 0.05,  watch: 0.02, concern: -0.02 },
    grossMargin:     { good: 0.40,  watch: 0.25, concern: 0.15 },
    netMargin:       { good: 0.10,  watch: 0.05, concern: 0.00 },
    currentRatio:    { good: 2.0,   watch: 1.3,  concern: 0.9 },
    debtToEquity:    { good: 0.5,   watch: 1.0,  concern: 2.0,  invert: true },
    cfoToNetIncome:  { good: 1.2,   watch: 0.85, concern: 0.5 },
    capexToDa:       { good: 0.6,   watch: 1.0,  concern: 1.5,  invert: true },
  },
  tech: {
    revGrowth:       { good: 0.15,  watch: 0.05, concern: 0.00 },
    revCAGR3:        { good: 0.12,  watch: 0.07, concern: 0.02 },
    ebitdaMargin:    { good: 0.30,  watch: 0.20, concern: 0.10 },
    ebitMargin:      { good: 0.22,  watch: 0.14, concern: 0.04 },
    fcfConversion:   { good: 0.70,  watch: 0.45, concern: 0.25 },
    ndEbitda:        { good: 1.0,   watch: 2.0,  concern: 3.5,  invert: true },
    nwcPctRev:       { good: 0.005, watch: 0.02, concern: 0.05, invert: true },
    capexPctRev:     { good: 0.02,  watch: 0.05, concern: 0.10, invert: true },
    intCoverage:     { good: 10.0,  watch: 6.0,  concern: 3.0 },
    roic:            { good: 0.18,  watch: 0.12, concern: 0.07 },
    roicSpread:      { good: 0.07,  watch: 0.02, concern: -0.03 },
    grossMargin:     { good: 0.60,  watch: 0.45, concern: 0.30 },
    netMargin:       { good: 0.15,  watch: 0.08, concern: 0.00 },
    currentRatio:    { good: 2.5,   watch: 1.5,  concern: 1.0 },
    debtToEquity:    { good: 0.3,   watch: 0.8,  concern: 1.5,  invert: true },
    cfoToNetIncome:  { good: 1.3,   watch: 0.9,  concern: 0.6 },
    capexToDa:       { good: 0.5,   watch: 0.8,  concern: 1.2,  invert: true },
  },
};

// Evaluate a metric against thresholds
// Returns { status: 'good'|'watch'|'concern', rationale: string }
function _fdEvaluateStatus(metricKey, value, sector, conservative) {
  if (value == null || !isFinite(value)) {
    return { status: 'watch', rationale: 'Insufficient data in source file' };
  }
  const pool = conservative
    ? (SECTOR_THRESHOLDS_CONSERVATIVE[sector] || SECTOR_THRESHOLDS_CONSERVATIVE.general)
    : (SECTOR_THRESHOLDS[sector] || SECTOR_THRESHOLDS.general);
  const t = pool[metricKey];
  if (!t) return { status: 'watch', rationale: 'No threshold defined for this metric' };

  if (t.invert) {
    // Lower is better (e.g., leverage, NWC drain)
    if (value <= t.good) return { status: 'good', rationale: 'Below ' + _fdNum(t.good, 2) + ' threshold' };
    if (value >= t.concern) return { status: 'concern', rationale: 'Above ' + _fdNum(t.concern, 2) + ' concern level' };
    return { status: 'watch', rationale: 'Between good and concern thresholds' };
  } else {
    // Higher is better
    if (value >= t.good) return { status: 'good', rationale: 'Above ' + _fdNum(t.good, 2) + ' threshold' };
    if (value <= t.concern) return { status: 'concern', rationale: 'Below ' + _fdNum(t.concern, 2) + ' concern level' };
    return { status: 'watch', rationale: 'Between good and concern thresholds' };
  }
}

/* ----------------------------------------------------------
   SECTION 2 -- DATA ADAPTER
---------------------------------------------------------- */
function _fdGetData() {
  const m   = (state.historical && state.historical.metrics)  || {};
  const d   = (state.historical && state.historical.derived)  || {};
  const yrs = (state.historical && state.historical.years)    || [];
  const inp = state.inputs || {};
  const dcf = state.dcf    || {};
  return { m, d, yrs, inp, dcf };
}

function _fdGetSectorMode() {
  // Read from context panel if available
  if (state.context && state.context.sector) {
    const s = state.context.sector.toLowerCase();
    if (s === 'tech' || s === 'technology') return 'tech';
  }
  return 'general';
}

/* ----------------------------------------------------------
   SECTION 3 -- YEAR-ROW BUILDER
   Computes all per-year metrics used across all tabs.
---------------------------------------------------------- */
function _fdBuildYearRows() {
  const { m, d, yrs, inp } = _fdGetData();
  if (!yrs.length || !m.revenue) return null;

  const n = yrs.length;
  const rows = [];

  for (let i = 0; i < n; i++) {
    const rev       = _fdVal(m.revenue, i);
    const ebitda    = _fdVal(m.ebitda, i);
    const ebit      = _fdVal(m.ebit, i);
    const da        = _fdVal(m.depreciation, i);
    const capex     = _fdVal(m.capex, i);
    const tax       = _fdVal(m.incomeTax, i);
    const intExp    = _fdVal(m.interestExpense, i);
    const nwcRaw    = _fdVal(m.changeInNWC, i);
    const tDebt     = _fdVal(m.totalDebt, i);
    const cash      = _fdVal(m.cash, i);
    const curA      = _fdVal(m.currentAssets, i);
    const curL      = _fdVal(m.currentLiabilities, i);
    const netInc    = _fdVal(m.netIncome, i);
    const cfo       = _fdVal(m.operatingCashFlow, i);
    const totAssets = _fdVal(m.totalAssets, i);
    const totEquity = _fdVal(m.totalEquity, i);
    const grossProf = _fdVal(m.grossProfit, i);
    const cogs      = _fdVal(m.cogs, i);
    const stDebt    = _fdVal(m.shortTermDebt, i);

    // Growth
    const revGrowth    = _fdYoY(m.revenue, i);
    const ebitdaGrowth = _fdYoY(m.ebitda, i);
    const ebitGrowth   = _fdYoY(m.ebit, i);
    const niGrowth     = _fdYoY(m.netIncome, i);
    const revCAGR3     = _fdCagr3(m.revenue, i);
    const ebitdaCAGR3  = _fdCagr3(m.ebitda, i);

    // Margins
    const ebitdaMargin = (ebitda != null && rev != null && rev !== 0) ? ebitda / rev : null;
    const ebitMargin   = (ebit != null && rev != null && rev !== 0)   ? ebit / rev   : null;
    const netMargin    = (netInc != null && rev != null && rev !== 0) ? netInc / rev  : null;

    // Gross margin
    let grossMargin = null;
    if (grossProf != null && rev != null && rev !== 0) grossMargin = grossProf / rev;
    else if (rev != null && cogs != null && rev !== 0) grossMargin = (rev - Math.abs(cogs)) / rev;

    // Effective tax rate
    const etr = (tax != null && ebit != null && ebit !== 0 && Math.abs(intExp || 0) < Math.abs(ebit))
      ? Math.abs(tax) / (ebit - Math.abs(intExp || 0)) : null;

    // Capex and D&A
    const absCapex   = capex != null ? Math.abs(capex) : null;
    const absDa      = da != null ? Math.abs(da) : null;
    const capexPctRev = (absCapex != null && rev != null && rev !== 0) ? absCapex / rev : null;
    const daPctRev    = (absDa != null && rev != null && rev !== 0) ? absDa / rev : null;
    const capexToDa   = (absCapex != null && absDa != null && absDa !== 0) ? absCapex / absDa : null;

    // NWC
    let nwc = nwcRaw;
    if (nwc == null && curA != null && curL != null && i > 0) {
      const prevCA = _fdVal(m.currentAssets, i - 1);
      const prevCL = _fdVal(m.currentLiabilities, i - 1);
      if (prevCA != null && prevCL != null) {
        nwc = (curA - curL) - (prevCA - prevCL);
      }
    }
    const nwcPctRev = (nwc != null && rev != null && rev !== 0) ? nwc / rev : null;
    const nwcLevel  = (curA != null && curL != null) ? curA - curL : null;

    // FCFF = EBIT*(1-t) + D&A - Capex - dNWC
    const taxRate = (etr != null && etr > 0 && etr < 1) ? etr : 0.25;
    let fcff = null;
    let nopat = null;
    if (ebit != null) {
      nopat = ebit * (1 - taxRate);
      fcff = nopat + (absDa || 0) - (absCapex || 0) - (nwc || 0);
    }

    // FCF conversion = FCFF / EBITDA
    const fcfConversion = (fcff != null && ebitda != null && ebitda !== 0) ? fcff / ebitda : null;

    // Leverage
    const netDebt = (tDebt != null && cash != null)
      ? tDebt - cash - (stDebt != null ? 0 : 0) // stDebt already in tDebt typically
      : null;
    const ndEbitda = (netDebt != null && ebitda != null && ebitda !== 0) ? netDebt / ebitda : null;

    // Interest coverage: EBIT / interest
    const intCoverage = (ebit != null && intExp != null && Math.abs(intExp) > 0)
      ? ebit / Math.abs(intExp) : null;

    // ROIC
    const roic = _fdVal(d.roic, i);

    // WACC (constant across years, from inputs)
    const wacc = _fdSafeGet(inp, 'wacc', null);

    // ROIC-WACC spread
    const roicSpread = (roic != null && wacc != null) ? roic - wacc : null;

    // Current ratio
    const currentRatio = (curA != null && curL != null && curL !== 0) ? curA / curL : null;

    // Debt / Equity
    const debtToEquity = (tDebt != null && totEquity != null && totEquity !== 0) ? tDebt / totEquity : null;

    // CFO / Net Income
    const cfoToNetIncome = (cfo != null && netInc != null && netInc !== 0) ? cfo / netInc : null;

    // Opex (revenue - cogs - ebit as proxy for SGA+other)
    let opex = null;
    if (rev != null && ebit != null && cogs != null) {
      opex = rev - Math.abs(cogs) - ebit;
    }
    const opexPctRev = (opex != null && rev != null && rev !== 0) ? opex / rev : null;

    rows.push({
      year: String(yrs[i]),
      idx: i,
      // Income statement
      rev, revGrowth, revCAGR3, ebitda, ebitdaGrowth, ebitdaCAGR3, ebitdaMargin,
      ebit, ebitGrowth, ebitMargin, grossMargin, grossProfit: grossProf,
      netInc, niGrowth, netMargin,
      etr: (etr != null && etr > 0 && etr < 1) ? etr : null,
      da: absDa, daPctRev, intExp,
      cogs, opex, opexPctRev,
      // Balance sheet
      cash, tDebt, netDebt, ndEbitda, intCoverage,
      curA, curL, currentRatio, nwcLevel,
      totAssets, totEquity, debtToEquity,
      // Cash flow
      capex: absCapex, capexPctRev, capexToDa,
      nwc, nwcPctRev, nopat,
      fcff, fcfConversion,
      cfo, cfoToNetIncome,
      // Returns
      roic, wacc, roicSpread,
      // Trends
      taxRate,
    });
  }

  return { rows, years: yrs, n };
}

/* ----------------------------------------------------------
   SECTION 4 -- FINANCIAL HEALTH SCORE
---------------------------------------------------------- */
const HEALTH_SCORE_SIGNALS = [
  { key: 'revGrowth',      weight: 0.10, field: 'revGrowth',     label: 'Revenue growth' },
  { key: 'ebitdaMargin',   weight: 0.12, field: 'ebitdaMargin',  label: 'EBITDA margin' },
  { key: 'fcfConversion',  weight: 0.12, field: 'fcfConversion', label: 'FCF conversion' },
  { key: 'roic',           weight: 0.10, field: 'roic',          label: 'ROIC' },
  { key: 'ndEbitda',       weight: 0.10, field: 'ndEbitda',      label: 'Net debt / EBITDA' },
  { key: 'intCoverage',    weight: 0.08, field: 'intCoverage',   label: 'Interest coverage' },
  { key: 'nwcPctRev',      weight: 0.08, field: 'nwcPctRev',     label: 'NWC % revenue' },
  { key: 'capexPctRev',    weight: 0.07, field: 'capexPctRev',   label: 'Capex intensity' },
  { key: 'grossMargin',    weight: 0.08, field: 'grossMargin',   label: 'Gross margin' },
  { key: 'currentRatio',   weight: 0.05, field: 'currentRatio',  label: 'Current ratio' },
  { key: 'cfoToNetIncome', weight: 0.05, field: 'cfoToNetIncome',label: 'CFO / Net income' },
  { key: 'revCAGR3',       weight: 0.05, field: 'revCAGR3',      label: '3Y revenue CAGR' },
];

function _fdComputeHealthScore(yr, sector, conservative) {
  let totalWeight = 0;
  let weightedScore = 0;
  const drivers = [];

  for (const sig of HEALTH_SCORE_SIGNALS) {
    const value = yr[sig.field];
    if (value == null || !isFinite(value)) continue;

    const eval_ = _fdEvaluateStatus(sig.key, value, sector, conservative);
    let score;
    if (eval_.status === 'good') score = 100;
    else if (eval_.status === 'watch') score = 55;
    else score = 15;

    weightedScore += score * sig.weight;
    totalWeight += sig.weight;
    drivers.push({ label: sig.label, score, status: eval_.status, weight: sig.weight, value });
  }

  const finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : null;

  // Sort by impact (weight * deviation from neutral)
  drivers.sort((a, b) => {
    const impA = Math.abs(a.score - 55) * a.weight;
    const impB = Math.abs(b.score - 55) * b.weight;
    return impB - impA;
  });

  const positives = drivers.filter(d => d.status === 'good').slice(0, 3);
  const negatives = drivers.filter(d => d.status === 'concern').slice(0, 3);
  const topDrivers = drivers.slice(0, 3);

  return { score: finalScore, positives, negatives, topDrivers, allDrivers: drivers };
}

/* ----------------------------------------------------------
   SECTION 5 -- TAB CONFIGURATION
   Each tab: { id, label, bannerFn, tiles, scenarios, questions }
---------------------------------------------------------- */

// --- OVERVIEW TAB ---
const TAB_OVERVIEW = {
  id: 'overview',
  label: 'Overview',
  bannerFn: function(yr, sector, conservative) {
    const health = _fdComputeHealthScore(yr, sector, conservative);
    if (!health.score) return { text: 'Insufficient data to compute overall health score', color: 'neutral' };
    if (health.score >= 75) return { text: 'Financial profile looks solid - score ' + health.score + '/100', color: 'success' };
    if (health.score >= 50) return { text: 'Mixed signals across key metrics - score ' + health.score + '/100', color: 'warning' };
    return { text: 'Multiple areas of concern identified - score ' + health.score + '/100', color: 'danger' };
  },
  tiles: [
    { key: 'revGrowth',     label: 'Revenue Growth YoY',  valueFn: yr => yr.revGrowth,     formatFn: _fdPct, threshKey: 'revGrowth' },
    { key: 'revCAGR3',      label: '3Y Rev CAGR',         valueFn: yr => yr.revCAGR3,      formatFn: _fdPct, threshKey: 'revCAGR3' },
    { key: 'ebitdaMargin',  label: 'EBITDA Margin',       valueFn: yr => yr.ebitdaMargin,  formatFn: _fdPct, threshKey: 'ebitdaMargin' },
    { key: 'ebitMargin',    label: 'EBIT Margin',         valueFn: yr => yr.ebitMargin,    formatFn: _fdPct, threshKey: 'ebitMargin' },
    { key: 'fcff',          label: 'FCFF',                valueFn: yr => yr.fcff,          formatFn: _fdCurrency },
    { key: 'fcfConversion', label: 'FCF Conversion',      valueFn: yr => yr.fcfConversion, formatFn: _fdPct, threshKey: 'fcfConversion' },
    { key: 'roic',          label: 'ROIC',                valueFn: yr => yr.roic,          formatFn: _fdPct, threshKey: 'roic' },
    { key: 'roicSpread',    label: 'ROIC - WACC',         valueFn: yr => yr.roicSpread,    formatFn: _fdDelta, threshKey: 'roicSpread' },
    { key: 'ndEbitda',      label: 'Net Debt / EBITDA',   valueFn: yr => yr.ndEbitda,      formatFn: _fdMult, threshKey: 'ndEbitda' },
    { key: 'nwcPctRev',     label: 'NWC % Revenue',       valueFn: yr => yr.nwcPctRev,     formatFn: _fdPct, threshKey: 'nwcPctRev' },
    { key: 'capexPctRev',   label: 'Capex % Revenue',     valueFn: yr => yr.capexPctRev,   formatFn: _fdPct, threshKey: 'capexPctRev' },
    { key: 'intCoverage',   label: 'Interest Coverage',   valueFn: yr => yr.intCoverage,   formatFn: _fdMult, threshKey: 'intCoverage' },
  ],
  scenarios: [
    'Revenue growing but margins compressing - check if cost structure is scaling',
    'EBITDA up but FCFF declining - investigate capex spikes or NWC absorption',
    'Leverage increasing while coverage ratios decline - review refinancing risk',
    'ROIC below WACC despite top-line growth - question whether growth creates value',
    'Strong cash conversion with negative NWC trend - sustainable or timing?',
    'Capex intensity rising above D&A - asset base expanding, verify growth thesis',
  ],
  questions: [
    { id: 'ov1', theme: 'Growth Quality', question: 'Is revenue growth accelerating, stable, or decelerating?',
      metricKey: 'revGrowth', threshKey: 'revGrowth',
      explanation: 'Compare YoY growth rates across years. Accelerating growth supports higher multiples; decelerating growth may signal market saturation or competitive pressure. Cross-check with the 3Y CAGR to filter out single-year noise.' },
    { id: 'ov2', theme: 'Growth Quality', question: 'Is EBITDA growing at least as fast as revenue?',
      metricKey: 'ebitdaGrowth', threshKey: 'revGrowth',
      explanation: 'If EBITDA growth lags revenue growth, margins are compressing. This could mean the company is buying growth at the expense of profitability - a common trap. Look at opex line items to find the culprit.' },
    { id: 'ov3', theme: 'Profitability', question: 'Is the EBITDA margin stable or improving over the last 3 years?',
      metricKey: 'ebitdaMargin', threshKey: 'ebitdaMargin',
      explanation: 'Margin stability indicates pricing power and cost discipline. Check whether improvements come from operating leverage (fixed costs being spread) or from mix shift to higher-margin products.' },
    { id: 'ov4', theme: 'Profitability', question: 'Does ROIC exceed the cost of capital?',
      metricKey: 'roicSpread', threshKey: 'roicSpread',
      explanation: 'ROIC above WACC means every dollar reinvested creates value. Below WACC means the company is destroying value through reinvestment. This is the single most important long-run profitability signal for a DCF.' },
    { id: 'ov5', theme: 'Cash Conversion', question: 'What share of EBITDA actually converts to free cash flow?',
      metricKey: 'fcfConversion', threshKey: 'fcfConversion',
      explanation: 'Healthy industrial companies convert 50-70% of EBITDA to FCFF. Asset-light tech should convert 60-80%+. Low conversion means cash is being absorbed by capex, NWC, or taxes. Identify which one.' },
    { id: 'ov6', theme: 'Cash Conversion', question: 'Is NWC absorbing an increasing share of revenue as the company grows?',
      metricKey: 'nwcPctRev', threshKey: 'nwcPctRev',
      explanation: 'Rising NWC/revenue means each incremental dollar of growth requires more working capital, reducing FCFF. Look at receivables (slow-paying customers?) and inventory (building stock or demand weakness?).' },
    { id: 'ov7', theme: 'Reinvestment', question: 'Is capex intensity (capex/revenue) rising or falling?',
      metricKey: 'capexPctRev', threshKey: 'capexPctRev',
      explanation: 'Rising capex intensity can be a positive (growth investment) or negative (maintenance escalation). Compare capex to D&A: if capex/D&A > 1.5x, the asset base is expanding. Ask whether the return on those assets justifies the outlay.' },
    { id: 'ov8', theme: 'Reinvestment', question: 'Is capex growth capex or maintenance capex?',
      metricKey: 'capexToDa', threshKey: 'capexToDa',
      explanation: 'D&A approximates maintenance capex. If total capex is far above D&A, the excess is likely growth capex. This matters for forecasting: growth capex should taper, maintenance capex persists.' },
    { id: 'ov9', theme: 'Balance Sheet', question: 'Is leverage (Net Debt / EBITDA) within reasonable bounds for this sector?',
      metricKey: 'ndEbitda', threshKey: 'ndEbitda',
      explanation: 'Below 2x is generally comfortable. 2-4x is manageable but watch coverage ratios. Above 4x is elevated and requires strong, predictable cash flows. Negative net debt (net cash) is the strongest position.' },
    { id: 'ov10', theme: 'Balance Sheet', question: 'Can the company comfortably service its debt from operating earnings?',
      metricKey: 'intCoverage', threshKey: 'intCoverage',
      explanation: 'EBIT/interest below 3x in a normal rate environment signals stress. Below 1.5x means the company cannot cover interest from operations alone. Check maturity schedule for near-term refinancing risk.' },
    { id: 'ov11', theme: 'Cash Conversion', question: 'Is operating cash flow tracking net income, or are there quality-of-earnings concerns?',
      metricKey: 'cfoToNetIncome', threshKey: 'cfoToNetIncome',
      explanation: 'CFO/Net Income near or above 1.0x suggests earnings are backed by real cash. A persistent ratio below 0.7x means accruals, non-cash items, or WC movements are inflating reported earnings relative to actual cash generation.' },
    { id: 'ov12', theme: 'Growth Quality', question: 'Is the 3-year revenue CAGR consistent with recent YoY growth, or are trends diverging?',
      metricKey: 'revCAGR3', threshKey: 'revCAGR3',
      explanation: 'If YoY growth is well below the 3Y CAGR, growth is decelerating. If well above, it may be accelerating or benefiting from a one-time step-up. CAGR smooths noise and gives a better baseline for forecasting.' },
  ],
};

// --- INCOME STATEMENT TAB ---
const TAB_INCOME = {
  id: 'income',
  label: 'Income Statement',
  bannerFn: function(yr) {
    if (yr.revGrowth != null && yr.ebitdaMargin != null) {
      if (yr.revGrowth > 0 && yr.ebitdaMargin > yr.ebitMargin)
        return { text: 'Top line growing with positive operating leverage', color: 'success' };
      if (yr.revGrowth > 0 && yr.ebitdaGrowth != null && yr.ebitdaGrowth < yr.revGrowth)
        return { text: 'Revenue growing but margin pressure detected', color: 'warning' };
    }
    return { text: 'Review margin stack and growth quality metrics below', color: 'neutral' };
  },
  tiles: [
    { key: 'rev',           label: 'Revenue',           valueFn: yr => yr.rev,           formatFn: _fdCurrency },
    { key: 'revGrowth',     label: 'Revenue Growth',    valueFn: yr => yr.revGrowth,     formatFn: _fdPct, threshKey: 'revGrowth' },
    { key: 'revCAGR3',      label: '3Y Rev CAGR',       valueFn: yr => yr.revCAGR3,      formatFn: _fdPct, threshKey: 'revCAGR3' },
    { key: 'grossMargin',   label: 'Gross Margin',      valueFn: yr => yr.grossMargin,   formatFn: _fdPct, threshKey: 'grossMargin' },
    { key: 'ebitdaMargin',  label: 'EBITDA Margin',     valueFn: yr => yr.ebitdaMargin,  formatFn: _fdPct, threshKey: 'ebitdaMargin' },
    { key: 'ebitMargin',    label: 'EBIT Margin',       valueFn: yr => yr.ebitMargin,    formatFn: _fdPct, threshKey: 'ebitMargin' },
    { key: 'netMargin',     label: 'Net Margin',        valueFn: yr => yr.netMargin,     formatFn: _fdPct, threshKey: 'netMargin' },
    { key: 'ebitdaGrowth',  label: 'EBITDA Growth',     valueFn: yr => yr.ebitdaGrowth,  formatFn: _fdPct, threshKey: 'revGrowth' },
    { key: 'opexPctRev',    label: 'Opex % Revenue',    valueFn: yr => yr.opexPctRev,    formatFn: _fdPct },
    { key: 'etr',           label: 'Eff. Tax Rate',     valueFn: yr => yr.etr,           formatFn: _fdPct },
    { key: 'daPctRev',      label: 'D&A % Revenue',     valueFn: yr => yr.daPctRev,      formatFn: _fdPct },
  ],
  scenarios: [
    'Gross margin declining while revenue grows - check input cost inflation or pricing pressure',
    'EBITDA margin expanding but EBIT margin flat - D&A growing faster, could signal heavy prior capex',
    'Opex as % of revenue rising - investigate SG&A discipline and R&D step-ups',
    'Revenue growth slowing while margins stable - the easy growth phase may be ending',
    'Net margin improving despite flat EBIT margin - check below-the-line items for sustainability',
    'Effective tax rate materially below statutory - identify one-time credits vs structural benefits',
  ],
  questions: [
    { id: 'is1', theme: 'Top-Line', question: 'Is revenue growth organic, or driven by M&A or FX tailwinds?',
      metricKey: 'revGrowth', threshKey: 'revGrowth',
      explanation: 'Check footnotes or management commentary. Inorganic growth may not be sustainable at the same rate. FX tailwinds reverse. Strip these out mentally to estimate core organic growth for your DCF forecast.' },
    { id: 'is2', theme: 'Top-Line', question: 'What is the revenue mix between recurring and non-recurring?',
      metricKey: 'rev', threshKey: 'revGrowth',
      explanation: 'Recurring revenue (subscriptions, contracts) is more predictable and commands higher multiples. If a high % is one-time (project-based, lumpy orders), your DCF forecast carries more uncertainty.' },
    { id: 'is3', theme: 'Margin Stack', question: 'Is the gross margin expanding, stable, or compressing?',
      metricKey: 'grossMargin', threshKey: 'grossMargin',
      explanation: 'Gross margin reflects pricing power vs. input costs. If it is declining while revenue grows, the company may be competing on price or facing cost inflation. This directly feeds through to EBITDA.' },
    { id: 'is4', theme: 'Margin Stack', question: 'Is there operating leverage - are margins expanding faster than revenue?',
      metricKey: 'ebitdaMargin', threshKey: 'ebitdaMargin',
      explanation: 'Operating leverage means a high fixed-cost base. When revenue grows, margins expand because fixed costs are spread over more units. When revenue contracts, the reverse is painful. Understand the cost structure.' },
    { id: 'is5', theme: 'Margin Stack', question: 'What is driving the gap between EBITDA margin and EBIT margin?',
      metricKey: 'daPctRev', threshKey: 'capexPctRev',
      explanation: 'D&A is the wedge between EBITDA and EBIT. A large or growing D&A/revenue ratio signals capital-intensive operations. Check if D&A relates to historical acquisitions (amortization of intangibles) or ongoing PP&E investment.' },
    { id: 'is6', theme: 'Cost Discipline', question: 'Is SG&A/opex scaling efficiently with revenue, or growing disproportionately?',
      metricKey: 'opexPctRev', threshKey: 'ebitdaMargin',
      explanation: 'If opex as % of revenue is flat or declining, the company has operational discipline. Rising opex/revenue means either deliberate investment (sales ramp, R&D push) or bloat. Check which and whether it has a clear return horizon.' },
    { id: 'is7', theme: 'Cost Discipline', question: 'Is the effective tax rate stable, or are there one-off benefits inflating net income?',
      metricKey: 'etr', threshKey: 'ebitdaMargin',
      explanation: 'A materially below-statutory ETR is great if structural (IP domicile, R&D credits). If due to loss carryforwards or one-time settlements, it will normalize. Use a normalized rate in your DCF.' },
    { id: 'is8', theme: 'Profitability Quality', question: 'Is net margin improving on its own, or only because of below-the-line items?',
      metricKey: 'netMargin', threshKey: 'netMargin',
      explanation: 'Compare EBIT margin trend to net margin trend. If net margin is improving faster, check for favorable interest rates, FX gains, or asset sales. These may not recur and should not be projected forward.' },
    { id: 'is9', theme: 'Profitability Quality', question: 'How does EBITDA growth compare to revenue growth? Is the margin story consistent?',
      metricKey: 'ebitdaGrowth', threshKey: 'revGrowth',
      explanation: 'EBITDA growing faster than revenue = expanding margins. EBITDA growing slower = compressing margins. If EBITDA is declining while revenue grows, something is structurally wrong with the cost base.' },
    { id: 'is10', theme: 'Growth Quality', question: 'Is the 3-year EBITDA CAGR consistent with the revenue CAGR, or are they diverging?',
      metricKey: 'ebitdaCAGR3', threshKey: 'revCAGR3',
      explanation: 'Divergence between revenue and EBITDA CAGRs tells you whether margin expansion or compression is a multi-year trend vs. a one-year blip. A structural trend is far more important for your terminal year assumptions.' },
    { id: 'is11', theme: 'Non-Recurring', question: 'Are there material non-recurring items in EBIT that should be normalized?',
      metricKey: 'ebitMargin', threshKey: 'ebitMargin',
      explanation: 'Restructuring charges, impairments, or one-time gains can distort EBIT. Identify these and compute a normalized EBIT margin. Your DCF should forecast off the normalized base, not the reported number.' },
    { id: 'is12', theme: 'Profitability Quality', question: 'Is the spread between gross margin and net margin widening or narrowing?',
      metricKey: 'grossMargin', threshKey: 'grossMargin',
      explanation: 'The spread captures all operating costs, D&A, interest, and taxes. A widening spread means costs below gross profit are growing faster than revenue. Decompose the waterfall: COGS, opex, D&A, interest, tax. Where is the leakage?' },
  ],
};

// --- BALANCE SHEET TAB ---
const TAB_BALANCE = {
  id: 'balance',
  label: 'Balance Sheet',
  bannerFn: function(yr) {
    if (yr.netDebt != null && yr.netDebt < 0)
      return { text: 'Net cash position - strong balance sheet flexibility', color: 'success' };
    if (yr.ndEbitda != null && yr.ndEbitda > 4.0)
      return { text: 'Elevated leverage - review debt serviceability and covenants', color: 'danger' };
    if (yr.currentRatio != null && yr.currentRatio < 1.0)
      return { text: 'Current ratio below 1.0 - near-term liquidity pressure', color: 'danger' };
    return { text: 'Review leverage, liquidity, and capital structure below', color: 'neutral' };
  },
  tiles: [
    { key: 'cash',         label: 'Cash',              valueFn: yr => yr.cash,         formatFn: _fdCurrency },
    { key: 'tDebt',        label: 'Total Debt',        valueFn: yr => yr.tDebt,        formatFn: _fdCurrency },
    { key: 'netDebt',      label: 'Net Debt',          valueFn: yr => yr.netDebt,      formatFn: _fdCurrency },
    { key: 'ndEbitda',     label: 'Net Debt / EBITDA', valueFn: yr => yr.ndEbitda,     formatFn: _fdMult, threshKey: 'ndEbitda' },
    { key: 'currentRatio', label: 'Current Ratio',     valueFn: yr => yr.currentRatio, formatFn: _fdMult, threshKey: 'currentRatio' },
    { key: 'debtToEquity', label: 'Debt / Equity',     valueFn: yr => yr.debtToEquity, formatFn: _fdMult, threshKey: 'debtToEquity' },
    { key: 'intCoverage',  label: 'Interest Coverage', valueFn: yr => yr.intCoverage,  formatFn: _fdMult, threshKey: 'intCoverage' },
    { key: 'nwcLevel',     label: 'NWC (level)',       valueFn: yr => yr.nwcLevel,     formatFn: _fdCurrency },
    { key: 'nwcPctRev',    label: 'NWC % Revenue',    valueFn: yr => yr.nwcPctRev,    formatFn: _fdPct, threshKey: 'nwcPctRev' },
    { key: 'totEquity',    label: 'Total Equity',      valueFn: yr => yr.totEquity,    formatFn: _fdCurrency },
    { key: 'totAssets',    label: 'Total Assets',      valueFn: yr => yr.totAssets,    formatFn: _fdCurrency },
  ],
  scenarios: [
    'Net debt rising while EBITDA flat - leverage ratio deteriorating, review debt capacity',
    'Current ratio declining toward 1.0x - short-term liquidity tightening, check upcoming maturities',
    'Receivables growing faster than revenue - collection issues or customer quality change',
    'Inventory build exceeding revenue growth - potential demand weakness or supply chain stockpiling',
    'Equity base shrinking from buybacks or losses - may increase leverage ratios mechanically',
    'NWC level swinging negative - favorable payables terms or aggressive accounting, verify sustainability',
  ],
  questions: [
    { id: 'bs1', theme: 'Leverage', question: 'Is Net Debt / EBITDA within sector norms, and what is the trend?',
      metricKey: 'ndEbitda', threshKey: 'ndEbitda',
      explanation: 'Compare to sector medians and to prior years. If leverage is rising while EBITDA growth is modest, the company is taking on risk. Declining leverage from EBITDA growth is the healthy scenario.' },
    { id: 'bs2', theme: 'Leverage', question: 'How much of total debt is short-term vs. long-term?',
      metricKey: 'tDebt', threshKey: 'ndEbitda',
      explanation: 'High short-term debt relative to total creates refinancing risk. If near-term maturities exceed available cash + revolver capacity, the company may need to issue at unfavorable terms. Check maturity schedule.' },
    { id: 'bs3', theme: 'Leverage', question: 'Is the debt-to-equity ratio stable, or shifting the capital structure?',
      metricKey: 'debtToEquity', threshKey: 'debtToEquity',
      explanation: 'Rising D/E could mean the company is levering up for acquisitions or buybacks. Falling D/E could be organic delevering. Understand what is driving the change - equity growth, debt paydown, or both.' },
    { id: 'bs4', theme: 'Liquidity', question: 'Is the current ratio adequate to cover near-term obligations?',
      metricKey: 'currentRatio', threshKey: 'currentRatio',
      explanation: 'Below 1.0x means current liabilities exceed current assets - the company may struggle to pay obligations within 12 months. Above 2.0x is generally comfortable but can also signal unproductive cash or inventory.' },
    { id: 'bs5', theme: 'Liquidity', question: 'Is cash on hand sufficient to cover 12-18 months of operations if revenue drops?',
      metricKey: 'cash', threshKey: 'currentRatio',
      explanation: 'Estimate quarterly cash burn (opex + interest + capex - revenue) under a downside scenario. Compare to available cash. This gives you a runway estimate. Companies with less than 6 months of runway need external funding.' },
    { id: 'bs6', theme: 'Working Capital', question: 'Is NWC absorbing more capital as the company grows?',
      metricKey: 'nwcPctRev', threshKey: 'nwcPctRev',
      explanation: 'Rising NWC/revenue means the business model requires more capital per unit of growth. This directly reduces FCFF. Break it down: is it receivables (collection issues), inventory (demand or supply), or payables (lost bargaining power)?' },
    { id: 'bs7', theme: 'Working Capital', question: 'Is the absolute NWC level growing faster than revenue?',
      metricKey: 'nwcLevel', threshKey: 'nwcPctRev',
      explanation: 'NWC level growth above revenue growth is a red flag for cash conversion. It means the incremental working capital drag is accelerating, and your DCF NWC assumptions may need to be higher.' },
    { id: 'bs8', theme: 'Capital Structure', question: 'Can the company comfortably service its debt from EBIT?',
      metricKey: 'intCoverage', threshKey: 'intCoverage',
      explanation: 'EBIT/interest below 3x is tight. Below 1.5x means the company is not covering interest from operations and must rely on non-operating income or asset sales. This directly affects cost of debt assumptions in your WACC.' },
    { id: 'bs9', theme: 'Capital Structure', question: 'Is the equity base growing from retained earnings or external issuance?',
      metricKey: 'totEquity', threshKey: 'debtToEquity',
      explanation: 'Growing equity from earnings is healthy. Growing it from stock issuance dilutes existing holders. Shrinking equity from persistent losses erodes the balance sheet and mechanically increases leverage ratios.' },
    { id: 'bs10', theme: 'Capital Intensity', question: 'What portion of total assets is fixed vs. current?',
      metricKey: 'totAssets', threshKey: 'debtToEquity',
      explanation: 'A high fixed-asset ratio means capital-intensive operations. This implies higher maintenance capex requirements and less flexibility. Asset-light businesses typically have higher returns on capital.' },
    { id: 'bs11', theme: 'Leverage', question: 'Is the company in a net cash or net debt position, and how is the trend?',
      metricKey: 'netDebt', threshKey: 'ndEbitda',
      explanation: 'Net cash (negative net debt) gives maximum strategic flexibility. Trending from net cash to net debt is a yellow flag unless clearly tied to value-creating investments. Track the direction over 3+ years.' },
    { id: 'bs12', theme: 'Liquidity', question: 'Is there a mismatch between asset duration and liability duration?',
      metricKey: 'currentRatio', threshKey: 'currentRatio',
      explanation: 'If long-term assets are funded by short-term debt, the company faces rollover risk. Ideally, long-lived assets should be funded by equity or long-term debt. This is an ALM (asset-liability matching) question.' },
  ],
};

// --- CASH FLOW TAB ---
const TAB_CASHFLOW = {
  id: 'cashflow',
  label: 'Cash Flow',
  bannerFn: function(yr) {
    if (yr.fcff != null && yr.fcff > 0 && yr.fcfConversion != null && yr.fcfConversion > 0.5)
      return { text: 'Strong FCFF generation with healthy conversion', color: 'success' };
    if (yr.fcff != null && yr.fcff < 0)
      return { text: 'Negative FCFF - investigate whether this is a reinvestment phase or a structural issue', color: 'danger' };
    if (yr.cfoToNetIncome != null && yr.cfoToNetIncome < 0.7)
      return { text: 'Cash flow quality concern - CFO significantly trailing net income', color: 'warning' };
    return { text: 'Analyze cash generation, conversion, and capital allocation below', color: 'neutral' };
  },
  tiles: [
    { key: 'cfo',           label: 'CFO',              valueFn: yr => yr.cfo,           formatFn: _fdCurrency },
    { key: 'capex',         label: 'Capex',            valueFn: yr => yr.capex,         formatFn: _fdCurrency },
    { key: 'fcff',          label: 'FCFF',             valueFn: yr => yr.fcff,          formatFn: _fdCurrency },
    { key: 'fcfConversion', label: 'FCF Conversion',   valueFn: yr => yr.fcfConversion, formatFn: _fdPct, threshKey: 'fcfConversion' },
    { key: 'nwc',           label: 'Change in NWC',    valueFn: yr => yr.nwc,           formatFn: _fdCurrency },
    { key: 'nwcPctRev',     label: 'NWC % Revenue',    valueFn: yr => yr.nwcPctRev,     formatFn: _fdPct, threshKey: 'nwcPctRev' },
    { key: 'capexPctRev',   label: 'Capex % Revenue',  valueFn: yr => yr.capexPctRev,   formatFn: _fdPct, threshKey: 'capexPctRev' },
    { key: 'capexToDa',     label: 'Capex / D&A',      valueFn: yr => yr.capexToDa,     formatFn: _fdMult, threshKey: 'capexToDa' },
    { key: 'cfoToNetIncome',label: 'CFO / Net Income', valueFn: yr => yr.cfoToNetIncome,formatFn: _fdMult, threshKey: 'cfoToNetIncome' },
    { key: 'nopat',         label: 'NOPAT',            valueFn: yr => yr.nopat,         formatFn: _fdCurrency },
    { key: 'etr',           label: 'Eff. Tax Rate',    valueFn: yr => yr.etr,           formatFn: _fdPct },
  ],
  scenarios: [
    'EBITDA growing but FCFF declining - capex or NWC absorbing the growth in cash earnings',
    'CFO significantly below net income - accruals overstating earnings, check non-cash items',
    'Capex spiking above D&A - major investment cycle, verify it is growth-driven not maintenance',
    'NWC swing distorting one year of FCFF - normalize by using multi-year average NWC/revenue',
    'Tax payments deviating from reported tax expense - timing differences or disputes, adjust ETR',
    'Positive FCFF but declining trend - the cash machine is losing momentum, investigate root cause',
  ],
  questions: [
    { id: 'cf1', theme: 'Earnings-to-Cash', question: 'Does CFO track net income, or is there a persistent gap?',
      metricKey: 'cfoToNetIncome', threshKey: 'cfoToNetIncome',
      explanation: 'CFO/NI above 1.0x is strong - earnings are backed by cash. Below 0.7x persistently means non-cash items are inflating earnings. Common culprits: stock-based comp, deferred revenue recognition, or receivables buildup.' },
    { id: 'cf2', theme: 'Earnings-to-Cash', question: 'What is the primary bridge from EBITDA to FCFF - where does cash get absorbed?',
      metricKey: 'fcfConversion', threshKey: 'fcfConversion',
      explanation: 'FCFF = NOPAT + D&A - Capex - dNWC. Decompose the gap between EBITDA and FCFF. Usually capex is the biggest cash consumer, followed by NWC. Taxes are the third leakage. Know which one dominates for this company.' },
    { id: 'cf3', theme: 'Capex Quality', question: 'Is capex growth capex (expanding capacity) or maintenance capex (sustaining operations)?',
      metricKey: 'capexToDa', threshKey: 'capexToDa',
      explanation: 'D&A is a rough proxy for maintenance capex. If capex materially exceeds D&A, the excess is likely growth capex. Growth capex should generate incremental returns (check ROIC trend). Maintenance capex is a permanent cash drain.' },
    { id: 'cf4', theme: 'Capex Quality', question: 'Is capex intensity (capex/revenue) elevated relative to peers or historical average?',
      metricKey: 'capexPctRev', threshKey: 'capexPctRev',
      explanation: 'Compare current capex/revenue to the 3-year average. A spike may indicate a one-time investment that will normalize. A persistent upward trend means the business model is becoming more capital-intensive.' },
    { id: 'cf5', theme: 'Working Capital', question: 'Is the change in NWC a persistent drag or a one-year blip?',
      metricKey: 'nwcPctRev', threshKey: 'nwcPctRev',
      explanation: 'Compare NWC/revenue across 3+ years. If rising consistently, the business structurally absorbs more capital as it grows. If volatile year-to-year, consider using a normalized average in your DCF.' },
    { id: 'cf6', theme: 'Working Capital', question: 'Is the receivables balance growing faster than revenue?',
      metricKey: 'nwc', threshKey: 'nwcPctRev',
      explanation: 'Receivables growth above revenue growth means DSO is extending. This ties up cash and may signal changing customer mix (slower-paying clients) or aggressive revenue recognition. It directly affects NWC and FCFF.' },
    { id: 'cf7', theme: 'FCF Sustainability', question: 'Is FCFF positive and growing, or is the trend deteriorating?',
      metricKey: 'fcff', threshKey: 'fcfConversion',
      explanation: 'A positive but declining FCFF trend is concerning because the DCF values future cash flows. If the trend continues, your terminal FCFF assumption may be too high. Examine whether the decline is from margin compression, capex ramp, or WC.' },
    { id: 'cf8', theme: 'FCF Sustainability', question: 'What percentage of EBITDA converts to free cash flow, and is this ratio stable?',
      metricKey: 'fcfConversion', threshKey: 'fcfConversion',
      explanation: 'FCF conversion = FCFF/EBITDA. A declining ratio means increasing cash leakage. Track this over 3-5 years. If it is structurally declining, your DCF terminal year FCFF should reflect a lower conversion rate than historical peak.' },
    { id: 'cf9', theme: 'Tax Efficiency', question: 'Are cash taxes paid significantly different from reported tax expense?',
      metricKey: 'etr', threshKey: 'ebitdaMargin',
      explanation: 'If cash taxes paid diverge from reported tax expense, deferred taxes are building. This can reverse. Use the cash tax rate (taxes paid / pre-tax income) for FCFF computation rather than the reported ETR.' },
    { id: 'cf10', theme: 'One-Time Items', question: 'Are there material one-time cash inflows or outflows distorting CFO?',
      metricKey: 'cfo', threshKey: 'cfoToNetIncome',
      explanation: 'Asset sales, legal settlements, and large customer prepayments can inflate CFO temporarily. Identify and strip these out to get a normalized CFO. Your DCF should be based on recurring, sustainable cash generation.' },
    { id: 'cf11', theme: 'Capex Quality', question: 'Is the company underinvesting (capex below D&A) to artificially boost FCFF?',
      metricKey: 'capexToDa', threshKey: 'capexToDa',
      explanation: 'Capex below D&A for multiple years means the asset base is depreciating faster than being replaced. This inflates current FCFF but creates future liability - either a capex catch-up or declining capacity. Both reduce long-term value.' },
    { id: 'cf12', theme: 'FCF Sustainability', question: 'How does NOPAT compare to FCFF - is reinvestment consuming excess returns?',
      metricKey: 'nopat', threshKey: 'roic',
      explanation: 'NOPAT represents the after-tax operating earnings before reinvestment. The gap between NOPAT and FCFF is the total reinvestment (capex - D&A + NWC). If reinvestment consistently exceeds half of NOPAT, the business needs a lot of capital to grow.' },
  ],
};

// Full tab config array
const DIAG_TAB_CONFIG = [TAB_OVERVIEW, TAB_INCOME, TAB_BALANCE, TAB_CASHFLOW];

/* ----------------------------------------------------------
   SECTION 6 -- RENDERER
---------------------------------------------------------- */
function renderDiagnostics() {
  const container = document.getElementById('section-diagnostics');
  if (!container) return;

  const data = _fdBuildYearRows();
  if (!data) {
    container.innerHTML = '';
    return;
  }

  const { rows, years, n } = data;

  // UI State
  let selectedYearIdx = n - 1;
  let conservative = false;
  let activeTab = 'overview';
  const expandedQuestions = {};

  function render() {
    const yr = rows[selectedYearIdx];
    const sector = _fdGetSectorMode();
    const tabConfig = DIAG_TAB_CONFIG.find(t => t.id === activeTab) || DIAG_TAB_CONFIG[0];

    // Banner
    const banner = tabConfig.bannerFn(yr, sector, conservative);
    const bannerColorMap = { success: 'accent-success', danger: 'accent-danger', warning: 'accent-warning', neutral: 'text-muted' };
    const bannerCss = bannerColorMap[banner.color] || 'text-muted';

    // Tiles
    const tilesHtml = tabConfig.tiles.map(tile => {
      const value = tile.valueFn(yr);
      const formatted = tile.formatFn(value);
      let statusCls = '';
      if (tile.threshKey && value != null && isFinite(value)) {
        const ev = _fdEvaluateStatus(tile.threshKey, value, sector, conservative);
        statusCls = 'fd-status-' + ev.status;
      }
      // YoY delta where applicable
      let deltaHtml = '';
      if (selectedYearIdx > 0 && tile.valueFn) {
        const prevYr = rows[selectedYearIdx - 1];
        const prevVal = tile.valueFn(prevYr);
        if (value != null && prevVal != null && isFinite(value) && isFinite(prevVal) && prevVal !== 0) {
          const pctChg = (value - prevVal) / Math.abs(prevVal);
          const sign = pctChg >= 0 ? '+' : '';
          deltaHtml = '<span class="fd-tile-delta ' + (pctChg >= 0 ? 'fd-delta-up' : 'fd-delta-down') + '">'
            + sign + (pctChg * 100).toFixed(1) + '% YoY</span>';
        }
      }
      return '<div class="fd-tile ' + statusCls + '">'
        + '<span class="fd-tile-label">' + tile.label + '</span>'
        + '<span class="fd-tile-value">' + formatted + '</span>'
        + deltaHtml
        + '</div>';
    }).join('');

    // Scenarios
    const scenariosHtml = tabConfig.scenarios.map(s =>
      '<li class="fd-scenario-item">' + s + '</li>'
    ).join('');

    // Questions with status pills
    const questionsHtml = tabConfig.questions.map(q => {
      const value = yr[q.metricKey];
      const ev = q.threshKey
        ? _fdEvaluateStatus(q.threshKey, value, sector, conservative)
        : { status: 'watch', rationale: '' };

      const pillClass = 'fd-pill-' + ev.status;
      const pillLabel = ev.status === 'good' ? 'Good' : ev.status === 'concern' ? 'Concern' : 'Watch';
      const isExpanded = !!expandedQuestions[q.id];

      // Format value for display
      let valDisplay = '';
      if (value != null && isFinite(value)) {
        if (q.metricKey.includes('Margin') || q.metricKey.includes('Growth') || q.metricKey.includes('Pct') || q.metricKey.includes('CAGR') || q.metricKey === 'etr' || q.metricKey === 'roicSpread' || q.metricKey === 'revGrowth' || q.metricKey === 'ebitdaGrowth' || q.metricKey === 'ebitGrowth' || q.metricKey === 'niGrowth' || q.metricKey === 'grossMargin' || q.metricKey === 'ebitdaMargin' || q.metricKey === 'ebitMargin' || q.metricKey === 'netMargin' || q.metricKey === 'fcfConversion' || q.metricKey === 'nwcPctRev' || q.metricKey === 'capexPctRev' || q.metricKey === 'daPctRev' || q.metricKey === 'opexPctRev' || q.metricKey === 'roic') {
          valDisplay = _fdPct(value);
        } else if (q.metricKey === 'ndEbitda' || q.metricKey === 'intCoverage' || q.metricKey === 'currentRatio' || q.metricKey === 'debtToEquity' || q.metricKey === 'cfoToNetIncome' || q.metricKey === 'capexToDa') {
          valDisplay = _fdMult(value);
        } else {
          valDisplay = _fdCurrency(value);
        }
      } else {
        valDisplay = '<span class="fd-na">n/a</span>';
      }

      const explanationHtml = isExpanded
        ? '<div class="fd-q-explanation">' + q.explanation + '</div>' : '';

      return '<div class="fd-question' + (isExpanded ? ' fd-q-expanded' : '') + '" data-qid="' + q.id + '">'
        + '<div class="fd-q-header">'
        + '<div class="fd-q-left">'
        + '<span class="fd-q-theme">' + q.theme + '</span>'
        + '<span class="fd-q-text">' + q.question + '</span>'
        + '</div>'
        + '<div class="fd-q-right">'
        + '<span class="fd-q-value">' + valDisplay + '</span>'
        + '<span class="fd-pill ' + pillClass + '">' + pillLabel + '</span>'
        + '<span class="fd-q-chevron">' + (isExpanded ? '&#9650;' : '&#9660;') + '</span>'
        + '</div>'
        + '</div>'
        + explanationHtml
        + '</div>';
    }).join('');

    // Health score (overview only)
    let healthScoreHtml = '';
    if (activeTab === 'overview') {
      const health = _fdComputeHealthScore(yr, sector, conservative);
      if (health.score != null) {
        const scoreColor = health.score >= 75 ? 'accent-success' : health.score >= 50 ? 'accent-warning' : 'accent-danger';
        const driversHtml = health.topDrivers.map(d => {
          const icon = d.status === 'good' ? '+' : d.status === 'concern' ? '-' : '~';
          const cls = d.status === 'good' ? 'fd-driver-good' : d.status === 'concern' ? 'fd-driver-concern' : 'fd-driver-watch';
          return '<div class="fd-driver-row ' + cls + '">'
            + '<span class="fd-driver-icon">' + icon + '</span>'
            + '<span class="fd-driver-label">' + d.label + '</span>'
            + '<span class="fd-driver-status">' + d.status + '</span>'
            + '</div>';
        }).join('');

        healthScoreHtml = '<div class="fd-health-score">'
          + '<div class="fd-health-gauge">'
          + '<span class="fd-health-number" style="color:var(--' + scoreColor + ');">' + health.score + '</span>'
          + '<span class="fd-health-label">/ 100</span>'
          + '</div>'
          + '<div class="fd-health-title">Financial Health Score</div>'
          + '<div class="fd-health-drivers">'
          + '<span class="fd-health-drivers-label">Key drivers</span>'
          + driversHtml
          + '</div>'
          + '</div>';
      }
    }

    // Year selector options
    const yearOptions = rows.map((r, i) =>
      '<option value="' + i + '"' + (i === selectedYearIdx ? ' selected' : '') + '>' + r.year + '</option>'
    ).join('');

    // Tab bar
    const tabBarHtml = DIAG_TAB_CONFIG.map(t =>
      '<button class="fd-tab-btn' + (t.id === activeTab ? ' fd-tab-active' : '') + '" data-tab="' + t.id + '">'
      + t.label + '</button>'
    ).join('');

    // Assemble
    container.innerHTML = '<div class="card-elevated" id="fd-root">'
      + '<div class="fd-header">'
      + '<h2 class="h2">Financial Diagnostics</h2>'
      + '<div class="fd-controls">'
      + '<select id="fd-year-select" class="fd-select">' + yearOptions + '</select>'
      + '<label class="fd-toggle-label">'
      + '<input type="checkbox" id="fd-conservative" ' + (conservative ? 'checked' : '') + ' />'
      + ' Conservative'
      + '</label>'
      + '</div>'
      + '</div>'
      + '<div class="fd-tab-bar">' + tabBarHtml + '</div>'
      + '<div class="fd-banner" style="border-left-color:var(--' + bannerCss + ');">'
      + '<span style="color:var(--' + bannerCss + ');">' + banner.text + '</span>'
      + '<span class="fd-banner-year">' + yr.year + '</span>'
      + '</div>'
      + healthScoreHtml
      + '<div class="fd-tiles-row">' + tilesHtml + '</div>'
      + '<div class="fd-section">'
      + '<h3 class="fd-sub-heading">Scenario Analysis</h3>'
      + '<ul class="fd-scenario-list">' + scenariosHtml + '</ul>'
      + '</div>'
      + '<div class="fd-section">'
      + '<h3 class="fd-sub-heading">Decision Questions</h3>'
      + '<div class="fd-questions-list">' + questionsHtml + '</div>'
      + '</div>'
      + '</div>';

    // Wire controls
    document.getElementById('fd-year-select').addEventListener('change', function(e) {
      selectedYearIdx = parseInt(e.target.value);
      render();
    });
    document.getElementById('fd-conservative').addEventListener('change', function(e) {
      conservative = e.target.checked;
      render();
    });

    // Tab buttons
    container.querySelectorAll('.fd-tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        activeTab = btn.getAttribute('data-tab');
        render();
      });
    });

    // Question expand/collapse
    container.querySelectorAll('.fd-question').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const qid = el.getAttribute('data-qid');
        expandedQuestions[qid] = !expandedQuestions[qid];
        render();
      });
    });
  }

  render();
  console.log('[DCF] Financial Diagnostics rendered. Years:', years.length, 'Tabs:', DIAG_TAB_CONFIG.length);
}

/* ----------------------------------------------------------
   SECTION 7 -- SCOPED STYLES
   Injected once into <head>. Uses fd- prefix to avoid
   collisions with existing diag- styles.
---------------------------------------------------------- */
(function injectFDStyles() {
  if (document.getElementById('fd-styles')) return;
  const style = document.createElement('style');
  style.id = 'fd-styles';
  style.textContent = `
    /* -- Header -- */
    .fd-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .fd-controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fd-select {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
    }
    .fd-select:focus { border-color: var(--accent-primary); }
    .fd-toggle-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .fd-toggle-label input[type="checkbox"] {
      accent-color: var(--accent-primary);
    }

    /* -- Tab bar -- */
    .fd-tab-bar {
      display: flex;
      gap: 2px;
      margin-bottom: 10px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0;
    }
    .fd-tab-btn {
      background: transparent;
      color: var(--text-muted);
      border: none;
      border-bottom: 2px solid transparent;
      padding: 6px 14px;
      font-size: 0.75rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: color 150ms, border-color 150ms;
    }
    .fd-tab-btn:hover {
      color: var(--text-secondary);
    }
    .fd-tab-active {
      color: var(--accent-primary);
      border-bottom-color: var(--accent-primary);
    }

    /* -- Banner -- */
    .fd-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-secondary);
      border-left: 3px solid;
      border-radius: var(--radius-sm);
      padding: 6px 12px;
      margin-bottom: 10px;
      font-size: 0.8125rem;
      font-weight: 500;
    }
    .fd-banner-year {
      font-size: 0.6875rem;
      color: var(--text-muted);
      font-weight: 400;
    }

    /* -- Health Score -- */
    .fd-health-score {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 10px 16px;
      margin-bottom: 10px;
    }
    .fd-health-gauge {
      display: flex;
      align-items: baseline;
      gap: 2px;
      min-width: 70px;
    }
    .fd-health-number {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
    }
    .fd-health-label {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .fd-health-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-primary);
      min-width: 120px;
    }
    .fd-health-drivers {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .fd-health-drivers-label {
      font-size: 0.6875rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    .fd-driver-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
    }
    .fd-driver-icon {
      width: 14px;
      text-align: center;
      font-weight: 700;
      font-family: monospace;
    }
    .fd-driver-good .fd-driver-icon { color: var(--accent-success); }
    .fd-driver-concern .fd-driver-icon { color: var(--accent-danger); }
    .fd-driver-watch .fd-driver-icon { color: var(--accent-warning); }
    .fd-driver-label { color: var(--text-secondary); flex: 1; }
    .fd-driver-status {
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .fd-driver-good .fd-driver-status { color: var(--accent-success); }
    .fd-driver-concern .fd-driver-status { color: var(--accent-danger); }
    .fd-driver-watch .fd-driver-status { color: var(--accent-warning); }

    /* -- Tiles -- */
    .fd-tiles-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 6px;
      margin-bottom: 12px;
    }
    .fd-tile {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: border-color 150ms;
    }
    .fd-tile:hover { border-color: var(--border-strong); }
    .fd-tile-label {
      font-size: 0.6875rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .fd-tile-value {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .fd-tile-delta {
      font-size: 0.6875rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }
    .fd-delta-up { color: var(--accent-success); }
    .fd-delta-down { color: var(--accent-danger); }

    /* Tile status borders */
    .fd-status-good { border-left: 3px solid var(--accent-success); }
    .fd-status-watch { border-left: 3px solid var(--accent-warning); }
    .fd-status-concern { border-left: 3px solid var(--accent-danger); }

    /* -- Sections -- */
    .fd-section { margin-bottom: 12px; }
    .fd-sub-heading {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }

    /* -- Scenarios -- */
    .fd-scenario-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .fd-scenario-item {
      position: relative;
      padding: 5px 0 5px 16px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      line-height: 1.5;
      border-bottom: 1px solid var(--border-subtle);
    }
    .fd-scenario-item:last-child { border-bottom: none; }
    .fd-scenario-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 11px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-primary);
      opacity: 0.5;
    }

    /* -- Questions -- */
    .fd-questions-list { display: flex; flex-direction: column; gap: 2px; }
    .fd-question {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: border-color 150ms, background 150ms;
    }
    .fd-question:hover {
      border-color: var(--border-strong);
      background: var(--bg-elevated);
    }
    .fd-q-expanded {
      border-color: var(--accent-primary);
      background: var(--bg-elevated);
    }
    .fd-q-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      gap: 8px;
    }
    .fd-q-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .fd-q-theme {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent-primary);
      white-space: nowrap;
      min-width: 80px;
    }
    .fd-q-text {
      font-size: 0.75rem;
      color: var(--text-primary);
      line-height: 1.4;
    }
    .fd-q-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .fd-q-value {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .fd-pill {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .fd-pill-good {
      background: rgba(34, 197, 94, 0.15);
      color: var(--accent-success);
    }
    .fd-pill-watch {
      background: rgba(245, 158, 11, 0.15);
      color: var(--accent-warning);
    }
    .fd-pill-concern {
      background: rgba(239, 68, 68, 0.15);
      color: var(--accent-danger);
    }
    .fd-q-chevron {
      font-size: 0.625rem;
      color: var(--text-muted);
      width: 12px;
      text-align: center;
    }
    .fd-q-explanation {
      padding: 0 10px 8px 10px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      line-height: 1.6;
      border-top: 1px solid var(--border-subtle);
      margin-top: 0;
      padding-top: 6px;
    }

    /* -- N/A -- */
    .fd-na {
      color: var(--text-muted);
      font-style: italic;
      font-size: 0.75rem;
    }

    /* -- Responsive -- */
    @media (max-width: 900px) {
      .fd-tiles-row { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
      .fd-q-theme { display: none; }
      .fd-health-score { flex-wrap: wrap; }
    }
    @media (max-width: 640px) {
      .fd-tiles-row { grid-template-columns: repeat(2, 1fr); }
      .fd-tab-btn { padding: 5px 8px; font-size: 0.6875rem; }
    }
  `;
  document.head.appendChild(style);
})();
