/* ============================================================
   TASK 04 — Derived Historical Metrics
   Reads state.historical.metrics (set by Task 03) and
   populates state.historical.derived with calculated series.
   All arrays align 1-to-1 with state.historical.years.
   Uses safeDivide() from 03_normalization.js.
   NO DCF logic. NO layout changes.
============================================================ */

// --- Element-wise array operation helper ---
// Applies fn(a, b) element-by-element across two parallel arrays.
// Either arg may be null (whole series missing) or contain null elements.
function arrayOp(a, b, fn) {
  if (!a || !b) return null;
  const len = Math.min(a.length, b.length);
  const result = [];
  for (let i = 0; i < len; i++) {
    result.push(fn(a[i], b[i]));
  }
  return result;
}

// --- YoY growth rate for a single series ---
// Index 0 → null (no prior year). Index i → (v[i] - v[i-1]) / |v[i-1]|
function yoyGrowth(series) {
  if (!series) return null;
  return series.map((v, i) => {
    if (i === 0) return null;
    const prev = series[i - 1];
    if (prev === null || prev === 0) return null;
    return (v - prev) / Math.abs(prev);
  });
}

// --- Main derived metrics function ---
function computeDerivedMetrics() {
  if (!state.historical || !state.historical.metrics) {
    console.warn('[DCF] computeDerivedMetrics() called before historical.metrics was set.');
    return;
  }

  const m = state.historical.metrics;
  const derived = {};

  // ----------------------------------------------------------
  // YoY GROWTH
  // ----------------------------------------------------------
  derived.revenueGrowth  = yoyGrowth(m.revenue);
  derived.ebitdaGrowth   = yoyGrowth(m.ebitda);
  derived.netIncomeGrowth = yoyGrowth(m.netIncome);

  // ----------------------------------------------------------
  // MARGINS (all vs revenue)
  // ----------------------------------------------------------
  derived.grossMargin = arrayOp(m.grossProfit, m.revenue, safeDivide);

  // If grossProfit not found, derive from revenue - cogs
  if (!derived.grossMargin && m.revenue && m.cogs) {
    const gp = arrayOp(m.revenue, m.cogs, (r, c) =>
      r !== null && c !== null ? r - c : null
    );
    derived.grossMargin = arrayOp(gp, m.revenue, safeDivide);
  }

  derived.ebitdaMargin  = arrayOp(m.ebitda,    m.revenue, safeDivide);
  derived.ebitMargin    = arrayOp(m.ebit,       m.revenue, safeDivide);
  derived.netMargin     = arrayOp(m.netIncome,  m.revenue, safeDivide);

  // ----------------------------------------------------------
  // FREE CASH FLOW & FCF MARGIN
  // ----------------------------------------------------------
  // Use FCF directly if available; otherwise derive OCF - Capex
  if (m.freeCashFlow) {
    derived.fcf = m.freeCashFlow;
  } else if (m.operatingCashFlow && m.capex) {
    derived.fcf = arrayOp(m.operatingCashFlow, m.capex, (ocf, cx) => {
      if (ocf === null) return null;
      // Capex is often reported as a positive number; subtract it
      const capexAbs = cx !== null ? Math.abs(cx) : 0;
      return ocf - capexAbs;
    });
  } else {
    derived.fcf = null;
  }

  derived.fcfMargin = arrayOp(derived.fcf, m.revenue, safeDivide);

  // ----------------------------------------------------------
  // NET DEBT  =  Total Debt - Cash
  // ----------------------------------------------------------
  if (m.totalDebt && m.cash) {
    derived.netDebt = arrayOp(m.totalDebt, m.cash, (d, c) =>
      d !== null && c !== null ? d - c : null
    );
  } else {
    derived.netDebt = null;
  }

  // ----------------------------------------------------------
  // NET DEBT / EBITDA
  // ----------------------------------------------------------
  derived.netDebtToEbitda = arrayOp(derived.netDebt, m.ebitda, safeDivide);

  // ----------------------------------------------------------
  // ROE  =  Net Income / Total Equity
  // ----------------------------------------------------------
  derived.roe = arrayOp(m.netIncome, m.totalEquity, safeDivide);

  // ----------------------------------------------------------
  // ROA  =  Net Income / Total Assets
  // ----------------------------------------------------------
  derived.roa = arrayOp(m.netIncome, m.totalAssets, safeDivide);

  // ----------------------------------------------------------
  // ROIC  =  EBIT * (1 - tax rate) / Invested Capital
  // Invested Capital = Total Equity + Total Debt - Cash
  // Tax rate derived from Income Tax / Pre-tax income where possible,
  // else defaulted to 25%.
  // ----------------------------------------------------------
  const taxRate = (() => {
    if (m.incomeTax && m.ebit && m.interestExpense) {
      // Pre-tax income ≈ EBIT - Interest Expense
      return m.ebit.map((ebit, i) => {
        const interest = m.interestExpense[i] ?? 0;
        const pretax   = ebit !== null ? ebit - Math.abs(interest) : null;
        const tax      = m.incomeTax[i];
        return safeDivide(tax, pretax);
      });
    }
    return null; // will default to 0.25 below
  })();

  if (m.ebit && m.totalEquity && m.totalDebt && m.cash) {
    derived.roic = m.ebit.map((ebit, i) => {
      if (ebit === null) return null;
      const tr  = taxRate ? (taxRate[i] ?? 0.25) : 0.25;
      const nopat = ebit * (1 - tr);
      const eq  = m.totalEquity[i];
      const dbt = m.totalDebt[i];
      const csh = m.cash[i];
      if (eq === null || dbt === null || csh === null) return null;
      const investedCapital = eq + dbt - csh;
      return safeDivide(nopat, investedCapital);
    });
  } else {
    derived.roic = null;
  }

  // ----------------------------------------------------------
  // Store and log
  // ----------------------------------------------------------
  state.historical.derived = derived;

  console.log('[DCF] state.historical.derived populated:');
  for (const [key, val] of Object.entries(derived)) {
    if (val) {
      console.log(`  ${key}:`, val.map(v => v !== null ? +v.toFixed(4) : null));
    } else {
      console.log(`  ${key}: null (insufficient source data)`);
    }
  }
}
