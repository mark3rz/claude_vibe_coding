/* ============================================================
   TASK 05 — DCF Engine Core Logic
   Implements calculateDCF(inputs, historicalData) with:
   - Mid-year discounting convention
   - Terminal value (Gordon Growth Model)
   - IRR solver (bisection method)
   - Default assumptions from 3-year historical averages
   - Validation: WACC > terminal growth rate
   Stores results in state.dcf.
   NO charts. NO sensitivity tables. NO UI rendering.
============================================================ */

// --- 3-year trailing average of a series (ignores nulls) ---
function trailingAvg(series, years = 3) {
  if (!series) return null;
  const valid = series.slice(-years).filter(v => v !== null && isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// --- Last non-null value in a series ---
function lastValue(series) {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && isFinite(series[i])) return series[i];
  }
  return null;
}

// --- Build default inputs from historical data ---
// Called once after normalizeData + computeDerivedMetrics.
// Only sets keys that aren't already in state.inputs.
function buildDefaultInputs(historicalData) {
  if (!historicalData) return;
  const m = historicalData.metrics  || {};
  const d = historicalData.derived  || {};

  const defaults = {
    forecastYears:    5,
    revenueGrowth:    trailingAvg(d.revenueGrowth)  ?? 0.05,
    ebitMargin:       trailingAvg(d.ebitMargin)      ?? 0.12,
    taxRate:          0.25,
    capexPct:         safeDivide(trailingAvg(m.capex), trailingAvg(m.revenue)) != null
                        ? Math.abs(trailingAvg(m.capex) / trailingAvg(m.revenue))
                        : 0.05,
    // Working capital change as % of revenue change (simplified)
    nwcPct:           0.02,
    // WACC components
    costOfEquity:     0.10,
    costOfDebt:       0.05,
    debtWeight:       0.30,
    equityWeight:     0.70,
    // Derived WACC (overridable)
    wacc:             null,   // computed below if null
    terminalGrowth:   0.025,
    // Current share price (for upside calc)
    currentPrice:     null,
    sharesOutstanding: lastValue(m.sharesOutstanding) ?? null,
    // Balance sheet items for bridge
    netDebt:          lastValue(d.netDebt)   ?? 0,
    minorityInterest: 0,
    cashAndEquiv:     lastValue(m.cash)      ?? 0,
  };

  // Compute WACC from components if not set
  defaults.wacc = defaults.costOfEquity * defaults.equityWeight
                + defaults.costOfDebt   * defaults.debtWeight * (1 - defaults.taxRate);

  // Merge: only fill keys missing from state.inputs
  for (const [key, val] of Object.entries(defaults)) {
    if (state.inputs[key] === undefined || state.inputs[key] === null) {
      state.inputs[key] = val;
    }
  }

  console.log('[DCF] Default inputs built:', state.inputs);
}

// --- NPV of a cash flow array ---
// cashFlows[i] discounted at period (i+0.5) — mid-year convention
function npvMidYear(cashFlows, discountRate) {
  return cashFlows.reduce((sum, cf, i) => {
    if (cf === null || !isFinite(cf)) return sum;
    return sum + cf / Math.pow(1 + discountRate, i + 0.5);
  }, 0);
}

// --- IRR solver via bisection ---
// cashFlows[0] is typically the negative initial investment (equity value)
function solveIRR(cashFlows, maxIter = 200, tol = 1e-7) {
  // Simple NPV function (period 0 = now, period i+1 for subsequent)
  const npv = rate => cashFlows.reduce((sum, cf, i) =>
    sum + cf / Math.pow(1 + rate, i), 0
  );

  let lo = -0.999, hi = 10.0;

  // Verify sign change exists
  if (npv(lo) * npv(hi) > 0) return null;

  let mid;
  for (let i = 0; i < maxIter; i++) {
    mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < tol) break;
    if (npv(lo) * fMid < 0) hi = mid;
    else lo = mid;
  }
  return mid;
}

// --- Main DCF calculation ---
// inputs: from state.inputs (populated by buildDefaultInputs + user edits)
// historicalData: state.historical
// Returns result object; also stores in state.dcf.
function calculateDCF(inputs, historicalData) {
  // --- Validate ---
  const errors = [];
  if (!historicalData || !historicalData.metrics) {
    errors.push('Historical data not loaded.');
  }
  if (inputs.wacc <= inputs.terminalGrowth) {
    errors.push(`WACC (${(inputs.wacc * 100).toFixed(1)}%) must exceed terminal growth rate (${(inputs.terminalGrowth * 100).toFixed(1)}%).`);
  }
  if (errors.length) {
    state.dcf = { errors, valid: false };
    console.warn('[DCF] calculateDCF validation failed:', errors);
    return state.dcf;
  }

  const m = historicalData.metrics;
  const n = inputs.forecastYears;
  const wacc = inputs.wacc;
  const g    = inputs.terminalGrowth;

  // --- Base year revenue ---
  const baseRevenue = lastValue(m.revenue);
  if (!baseRevenue) {
    state.dcf = { errors: ['No base revenue found.'], valid: false };
    return state.dcf;
  }

  // --- Project forecast years ---
  const forecastRevenue  = [];
  const forecastEBIT     = [];
  const forecastNOPAT    = [];
  const forecastCapex    = [];
  const forecastNWCDelta = [];
  const forecastDA       = [];
  const forecastFCF      = [];

  let prevRevenue = baseRevenue;

  for (let i = 0; i < n; i++) {
    const rev    = prevRevenue * (1 + inputs.revenueGrowth);
    const ebit   = rev * inputs.ebitMargin;
    const nopat  = ebit * (1 - inputs.taxRate);
    const capex  = rev * inputs.capexPct;
    // D&A estimated as % of capex (simplified: DA = capex * 0.8)
    const da     = capex * 0.8;
    // NWC change = nwcPct * change in revenue
    const nwcDelta = (rev - prevRevenue) * inputs.nwcPct;
    const fcf    = nopat + da - capex - nwcDelta;

    forecastRevenue.push(rev);
    forecastEBIT.push(ebit);
    forecastNOPAT.push(nopat);
    forecastCapex.push(capex);
    forecastDA.push(da);
    forecastNWCDelta.push(nwcDelta);
    forecastFCF.push(fcf);

    prevRevenue = rev;
  }

  // --- Terminal value (Gordon Growth Model on final FCF) ---
  const terminalFCF   = forecastFCF[n - 1] * (1 + g);
  const terminalValue = terminalFCF / (wacc - g);

  // --- Discount FCFs (mid-year convention) ---
  const pvFCFs = forecastFCF.map((fcf, i) =>
    fcf / Math.pow(1 + wacc, i + 0.5)
  );
  const npvFCF = pvFCFs.reduce((s, v) => s + v, 0);

  // --- Discount terminal value (end of forecast period) ---
  const pvTerminal = terminalValue / Math.pow(1 + wacc, n);

  // --- Enterprise value ---
  const enterpriseValue = npvFCF + pvTerminal;

  // --- Equity bridge ---
  const equityValue = enterpriseValue
    - inputs.netDebt
    - inputs.minorityInterest
    + inputs.cashAndEquiv;

  // --- Implied share price ---
  const impliedPrice = inputs.sharesOutstanding && inputs.sharesOutstanding > 0
    ? equityValue / inputs.sharesOutstanding
    : null;

  // --- Upside / downside vs current price ---
  const upside = inputs.currentPrice && impliedPrice
    ? (impliedPrice - inputs.currentPrice) / inputs.currentPrice
    : null;

  // --- IRR (Year 0 = -equity value, Years 1..n = FCFs, Year n += terminal value) ---
  const irrCashFlows = [-equityValue, ...forecastFCF];
  irrCashFlows[irrCashFlows.length - 1] += terminalValue;
  const irr = solveIRR(irrCashFlows);

  // --- Build label array for forecast years ---
  const baseYear = historicalData.years.length > 0
    ? (() => {
        const last = historicalData.years[historicalData.years.length - 1];
        const match = String(last).match(/\d{4}/);
        return match ? parseInt(match[0]) : new Date().getFullYear();
      })()
    : new Date().getFullYear();

  const forecastYearLabels = Array.from({ length: n }, (_, i) => `${baseYear + i + 1}E`);

  // --- Store result ---
  state.dcf = {
    valid: true,
    errors: [],
    inputs: { ...inputs },
    baseYear,
    forecastYearLabels,
    forecast: {
      revenue:    forecastRevenue,
      ebit:       forecastEBIT,
      nopat:      forecastNOPAT,
      capex:      forecastCapex,
      da:         forecastDA,
      nwcDelta:   forecastNWCDelta,
      fcf:        forecastFCF,
      pvFCF:      pvFCFs,
    },
    summary: {
      npvFCF,
      pvTerminal,
      terminalValue,
      enterpriseValue,
      netDebt:           inputs.netDebt,
      minorityInterest:  inputs.minorityInterest,
      cashAndEquiv:      inputs.cashAndEquiv,
      equityValue,
      impliedPrice,
      currentPrice:      inputs.currentPrice,
      upside,
      irr,
      wacc,
      terminalGrowth:    g,
    },
  };

  console.log('[DCF] calculateDCF result:', {
    enterpriseValue: enterpriseValue.toFixed(1),
    equityValue:     equityValue.toFixed(1),
    impliedPrice:    impliedPrice?.toFixed(2) ?? 'n/a',
    upside:          upside != null ? (upside * 100).toFixed(1) + '%' : 'n/a',
    irr:             irr != null ? (irr * 100).toFixed(1) + '%' : 'n/a',
    npvFCF:          npvFCF.toFixed(1),
    pvTerminal:      pvTerminal.toFixed(1),
    terminalValue:   terminalValue.toFixed(1),
  });

  return state.dcf;
}
