/* ============================================================
   TASK 15 — Context Engine (Analytics Layer)
   Pure functions only — NO DOM access.

   Input:  dcfState (state.dcf + state.historical + state.inputs)
           contextInputs (sector, regime, rfr, erp, useContextForWacc)
   Output: contextReport object with summary, cards[], diagnostics[]

   Each card: { id, title, status, metrics, why, nextStep,
                severityRank, relatedAssumptions }
   status: 'red' | 'yellow' | 'green' | 'na'
   severityRank: 0 = red, 1 = yellow, 2 = green, 3 = na
============================================================ */

/* ----------------------------------------------------------
   HELPERS
---------------------------------------------------------- */
function _ctxSafe(v) {
  return v !== null && v !== undefined && isFinite(v);
}

function _ctxPct(v) {
  if (!_ctxSafe(v)) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

function _ctxMult(v) {
  if (!_ctxSafe(v)) return 'N/A';
  return v.toFixed(1) + 'x';
}

function _ctxDollar(v) {
  if (!_ctxSafe(v)) return 'N/A';
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v < 0 ? '-' : '') + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return (v < 0 ? '-' : '') + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6)  return (v < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(1) + 'M';
  return '$' + v.toFixed(0);
}

const _SEVERITY = { red: 0, yellow: 1, green: 2, na: 3 };

/* ----------------------------------------------------------
   MAIN: computeContextReport
   Returns { summary, cards, diagnostics }
---------------------------------------------------------- */
function computeContextReport(dcfState, contextInputs) {
  const cards = [];
  const diagnostics = [];

  const dcf       = dcfState.dcf;
  const hist      = dcfState.historical;
  const inputs    = dcfState.inputs || {};
  const ctx       = contextInputs || {};
  const sector    = ctx.sector || 'Tech';
  const benchmarks = CONTEXT_BENCHMARKS.sectors[sector] || CONTEXT_BENCHMARKS.sectors.Tech;
  const thresholds = CONTEXT_BENCHMARKS.thresholds;

  // Guard: no valid DCF
  if (!dcf || !dcf.valid || !dcf.summary) {
    return {
      summary: { redCount: 0, yellowCount: 0, greenCount: 0 },
      cards: [],
      diagnostics: ['DCF model not yet calculated.'],
    };
  }

  const s = dcf.summary;
  const f = dcf.forecast;
  const m = (hist && hist.metrics) || {};
  const d = (hist && hist.derived) || {};

  // ── A) Terminal Value Dominance ──────────────────────────
  (function checkTVDominance() {
    let tvPct = null;
    // Prefer direct terminal contribution if available
    if (_ctxSafe(s.pvTerminal) && _ctxSafe(s.enterpriseValue) && s.enterpriseValue !== 0) {
      tvPct = s.pvTerminal / s.enterpriseValue;
    }
    if (!_ctxSafe(tvPct)) {
      cards.push({ id: 'tv-dominance', title: 'Terminal Value Dominance', status: 'na',
        metrics: 'N/A', why: 'Insufficient data to compute TV contribution.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    let status = 'green';
    if (tvPct > thresholds.tvDominance.red)       status = 'red';
    else if (tvPct > thresholds.tvDominance.yellow) status = 'yellow';

    const why = status === 'red'
      ? `Terminal value is ${_ctxPct(tvPct)} of EV — this model is dangerously dependent on perpetuity assumptions.`
      : status === 'yellow'
        ? `Terminal value is ${_ctxPct(tvPct)} of EV — somewhat high; forecast-period cash flows contribute relatively little.`
        : `Terminal value is ${_ctxPct(tvPct)} of EV — within normal range.`;

    const nextStep = status !== 'green'
      ? 'Extend the explicit forecast period or revisit Terminal Growth Rate and WACC to reduce TV reliance.'
      : '';

    cards.push({ id: 'tv-dominance', title: 'Terminal Value Dominance', status,
      metrics: _ctxPct(tvPct), why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['terminalGrowth', 'wacc', 'forecastYears'] });

    if (status === 'red') diagnostics.push(`TV at ${_ctxPct(tvPct)} of EV signals over-reliance on terminal assumptions.`);
  })();

  // ── B) Implied EV/EBITDA ────────────────────────────────
  (function checkImpliedEVEBITDA() {
    // Next-year implied
    const nextEbitda = f && f.ebit && f.ebit[0] != null
      ? f.ebit[0] / (inputs.ebitMargin || 1) * (inputs.ebitMargin + (_getDaPctProxy() || 0))
      : null;
    // Simpler approach: use EBIT + D&A for EBITDA proxy
    const ebitdaY1 = (f && f.ebit && f.da && f.ebit[0] != null && f.da[0] != null)
      ? f.ebit[0] + f.da[0] : null;
    const impliedMultY1 = (_ctxSafe(ebitdaY1) && ebitdaY1 > 0 && _ctxSafe(s.enterpriseValue))
      ? s.enterpriseValue / ebitdaY1 : null;

    // Terminal implied
    const lastIdx = f && f.ebit ? f.ebit.length - 1 : -1;
    const ebitdaTerm = (lastIdx >= 0 && f.ebit[lastIdx] != null && f.da[lastIdx] != null)
      ? f.ebit[lastIdx] + f.da[lastIdx] : null;
    const impliedMultTerm = (_ctxSafe(ebitdaTerm) && ebitdaTerm > 0 && _ctxSafe(s.terminalValue))
      ? s.terminalValue / ebitdaTerm : null;

    if (!_ctxSafe(impliedMultY1) && !_ctxSafe(impliedMultTerm)) {
      cards.push({ id: 'ev-ebitda', title: 'Implied EV/EBITDA', status: 'na',
        metrics: 'N/A', why: 'Cannot compute implied multiple — EBITDA data missing.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    // Check Y1 against sector benchmarks
    const range = benchmarks.EV_EBITDA;
    const rangeWidth = range.hi - range.lo;
    let status = 'green';
    const testVal = _ctxSafe(impliedMultY1) ? impliedMultY1 : impliedMultTerm;

    if (testVal < range.lo - rangeWidth * thresholds.evEbitdaStretch.red ||
        testVal > range.hi + rangeWidth * thresholds.evEbitdaStretch.red) {
      status = 'red';
    } else if (testVal < range.lo || testVal > range.hi) {
      status = 'yellow';
    }

    const metricsStr = [
      _ctxSafe(impliedMultY1)   ? `Y1: ${_ctxMult(impliedMultY1)}`   : null,
      _ctxSafe(impliedMultTerm) ? `Term: ${_ctxMult(impliedMultTerm)}` : null,
    ].filter(Boolean).join(' · ');

    const why = status === 'red'
      ? `Implied EV/EBITDA (${metricsStr}) is far outside the ${sector} sector range of ${range.lo}–${range.hi}x. This valuation may be unrealistic.`
      : status === 'yellow'
        ? `Implied EV/EBITDA (${metricsStr}) sits outside the typical ${sector} range of ${range.lo}–${range.hi}x.`
        : `Implied EV/EBITDA (${metricsStr}) is within the ${sector} sector range.`;

    const nextStep = status !== 'green'
      ? 'Check Revenue Growth, EBIT Margin, and WACC — these drive the implied multiple most.'
      : '';

    cards.push({ id: 'ev-ebitda', title: 'Implied EV/EBITDA', status,
      metrics: metricsStr, why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['revenueGrowth', 'ebitMargin', 'wacc'] });

    if (status === 'red') diagnostics.push(`Implied EV/EBITDA of ${metricsStr} is extreme for ${sector}.`);
  })();

  // ── C) Implied P/E ──────────────────────────────────────
  (function checkImpliedPE() {
    // Only if net income exists in historical data
    const lastNetIncome = _lastVal(m.netIncome);
    if (!_ctxSafe(lastNetIncome) || lastNetIncome <= 0) {
      cards.push({ id: 'implied-pe', title: 'Implied P/E', status: 'na',
        metrics: 'N/A', why: 'Net income data not available or negative — P/E not meaningful.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    const equityValue = s.equityValue;
    if (!_ctxSafe(equityValue) || equityValue <= 0) {
      cards.push({ id: 'implied-pe', title: 'Implied P/E', status: 'na',
        metrics: 'N/A', why: 'Equity value not positive — P/E not meaningful.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    const impliedPE = equityValue / lastNetIncome;
    const range = benchmarks.PE;
    const rangeWidth = range.hi - range.lo;
    let status = 'green';

    if (impliedPE > range.hi + rangeWidth * 0.5 || impliedPE < range.lo * 0.5) {
      status = 'red';
    } else if (impliedPE > range.hi || impliedPE < range.lo) {
      status = 'yellow';
    }

    const why = status === 'red'
      ? `Implied P/E of ${_ctxMult(impliedPE)} is far outside the ${sector} range of ${range.lo}–${range.hi}x.`
      : status === 'yellow'
        ? `Implied P/E of ${_ctxMult(impliedPE)} is outside the typical ${sector} range.`
        : `Implied P/E of ${_ctxMult(impliedPE)} is within sector norms.`;

    const nextStep = status !== 'green'
      ? 'Review EBIT Margin, Tax Rate, and Net Debt — these affect the equity-to-earnings ratio.'
      : '';

    cards.push({ id: 'implied-pe', title: 'Implied P/E', status,
      metrics: _ctxMult(impliedPE), why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['ebitMargin', 'taxRate', 'netDebt'] });
  })();

  // ── D) ROIC vs WACC Spread ──────────────────────────────
  (function checkROICSpread() {
    // Compute ROIC from forecast year 1 if possible: NOPAT / Invested Capital proxy
    const nopat1 = f && f.nopat ? f.nopat[0] : null;
    // Invested capital proxy: last revenue as a rough base (or use EV as proxy)
    const lastRev = _lastVal(m.revenue);
    // Better proxy: use total assets or (equity + debt) if available
    // For now, use EV as invested capital proxy
    const investedCapital = _ctxSafe(s.enterpriseValue) ? s.enterpriseValue : null;

    if (!_ctxSafe(nopat1) || !_ctxSafe(investedCapital) || investedCapital <= 0) {
      cards.push({ id: 'roic-spread', title: 'ROIC vs WACC Spread', status: 'na',
        metrics: 'N/A', why: 'Insufficient data to estimate ROIC.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    const roic = nopat1 / investedCapital;
    const wacc = inputs.wacc || 0;
    const spread = roic - wacc;
    let status = 'green';

    if (spread < thresholds.roicWaccSpread.red)         status = 'red';
    else if (spread <= thresholds.roicWaccSpread.yellow) status = 'yellow';

    const metricsStr = `ROIC ${_ctxPct(roic)} · WACC ${_ctxPct(wacc)} · Spread ${(spread * 100).toFixed(1)}pp`;

    const why = status === 'red'
      ? `ROIC-WACC spread of ${(spread * 100).toFixed(1)}pp is deeply negative — this model implies value destruction.`
      : status === 'yellow'
        ? `ROIC barely covers WACC — the model implies minimal value creation above cost of capital.`
        : `Positive ROIC-WACC spread indicates value creation.`;

    const nextStep = status !== 'green'
      ? 'Increase EBIT Margin or Revenue Growth to raise ROIC, or lower WACC components.'
      : '';

    cards.push({ id: 'roic-spread', title: 'ROIC vs WACC Spread', status,
      metrics: metricsStr, why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['ebitMargin', 'revenueGrowth', 'wacc', 'costOfEquity'] });

    if (status === 'red') diagnostics.push('Negative ROIC-WACC spread: the model implies the business destroys value.');
  })();

  // ── E) Perpetuity Growth Sanity ─────────────────────────
  (function checkPerpetuityGrowth() {
    const g = inputs.terminalGrowth;
    if (!_ctxSafe(g)) {
      cards.push({ id: 'perp-growth', title: 'Perpetuity Growth Rate', status: 'na',
        metrics: 'N/A', why: 'Terminal growth rate not set.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    let status = 'green';
    if (g > thresholds.perpetuityGrowth.red)         status = 'red';
    else if (g > thresholds.perpetuityGrowth.yellow) status = 'yellow';

    // Also flag if g is very close to WACC (within 1pp)
    const wacc = inputs.wacc || 0;
    if (wacc - g < 0.01 && wacc - g > 0) {
      status = status === 'green' ? 'yellow' : status;
    }

    const why = status === 'red'
      ? `Terminal growth of ${_ctxPct(g)} exceeds long-run GDP growth estimates. No business grows faster than the economy in perpetuity.`
      : status === 'yellow'
        ? `Terminal growth of ${_ctxPct(g)} is on the high end. Verify this is consistent with the company's long-run maturity profile.`
        : `Terminal growth of ${_ctxPct(g)} is within a reasonable range.`;

    const nextStep = status !== 'green'
      ? 'Reduce Terminal Growth Rate — most practitioners use 2.0%–3.0% for developed markets.'
      : '';

    cards.push({ id: 'perp-growth', title: 'Perpetuity Growth Rate', status,
      metrics: _ctxPct(g), why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['terminalGrowth'] });

    if (status === 'red') diagnostics.push(`Terminal growth of ${_ctxPct(g)} is unrealistically high.`);
  })();

  // ── F) Growth vs Reinvestment Proxy ─────────────────────
  (function checkGrowthReinvestment() {
    const capexPct = inputs.capexPct;
    const nwcPct   = inputs.nwcPct;
    const revGrowth = inputs.revenueGrowth;

    if (!_ctxSafe(capexPct) || !_ctxSafe(revGrowth)) {
      cards.push({ id: 'growth-reinvest', title: 'Growth vs Reinvestment', status: 'na',
        metrics: 'N/A', why: 'CapEx or growth data missing.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    // Reinvestment rate proxy: capex + nwc as % of revenue
    const reinvestRate = capexPct + (nwcPct || 0);
    // High growth with low reinvestment is suspicious
    let status = 'green';
    if (revGrowth > 0.15 && reinvestRate < 0.04) {
      status = 'red';
    } else if (revGrowth > 0.10 && reinvestRate < 0.03) {
      status = 'yellow';
    } else if (revGrowth > 0.08 && reinvestRate < 0.02) {
      status = 'yellow';
    }

    const metricsStr = `Growth ${_ctxPct(revGrowth)} · Reinvest ${_ctxPct(reinvestRate)}`;

    const why = status === 'red'
      ? `Revenue growth of ${_ctxPct(revGrowth)} with only ${_ctxPct(reinvestRate)} reinvestment is implausible — high growth requires capital.`
      : status === 'yellow'
        ? `Growth-to-reinvestment ratio looks optimistic. Verify that CapEx and NWC assumptions support the projected growth.`
        : `Reinvestment level appears consistent with projected growth.`;

    const nextStep = status !== 'green'
      ? 'Increase CapEx (% Rev) or NWC Change (% Rev) to better support the projected growth rate.'
      : '';

    cards.push({ id: 'growth-reinvest', title: 'Growth vs Reinvestment', status,
      metrics: metricsStr, why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['capexPct', 'nwcPct', 'revenueGrowth'] });
  })();

  // ── G) Margin Realism vs Sector Ranges ──────────────────
  (function checkMarginRealism() {
    const ebitMargin = inputs.ebitMargin;
    if (!_ctxSafe(ebitMargin)) {
      cards.push({ id: 'margin-realism', title: 'Margin Realism', status: 'na',
        metrics: 'N/A', why: 'EBIT margin not set.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    const range = benchmarks.EBIT_MARGIN;
    let status = 'green';
    const rangeWidth = range.hi - range.lo;

    if (ebitMargin > range.hi + rangeWidth * 0.5 || ebitMargin < range.lo - rangeWidth * 0.5) {
      status = 'red';
    } else if (ebitMargin > range.hi || ebitMargin < range.lo) {
      status = 'yellow';
    }

    const why = status === 'red'
      ? `EBIT margin of ${_ctxPct(ebitMargin)} is far outside the ${sector} sector range of ${_ctxPct(range.lo)}–${_ctxPct(range.hi)}.`
      : status === 'yellow'
        ? `EBIT margin of ${_ctxPct(ebitMargin)} sits outside the typical ${sector} band.`
        : `EBIT margin of ${_ctxPct(ebitMargin)} is within ${sector} sector norms.`;

    const nextStep = status !== 'green'
      ? 'Adjust EBIT Margin to align with sector peers, or document why this company is an outlier.'
      : '';

    cards.push({ id: 'margin-realism', title: 'Margin Realism', status,
      metrics: _ctxPct(ebitMargin) + ` (${sector}: ${_ctxPct(range.lo)}–${_ctxPct(range.hi)})`,
      why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['ebitMargin'] });
  })();

  // ── H) Working Capital & Cash Conversion Risk ───────────
  (function checkNWCTrend() {
    // Check NWC trend from historical data if available
    const nwcSeries = m.changeInNWC;
    const revSeries = m.revenue;
    if (!nwcSeries || !revSeries || nwcSeries.length < 2 || revSeries.length < 2) {
      cards.push({ id: 'nwc-risk', title: 'Working Capital Risk', status: 'na',
        metrics: 'N/A', why: 'Insufficient historical NWC data to assess trend.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    // Compute NWC/Revenue ratio for last two data points
    const len = Math.min(nwcSeries.length, revSeries.length);
    const nwcRatios = [];
    for (let i = 0; i < len; i++) {
      if (_ctxSafe(nwcSeries[i]) && _ctxSafe(revSeries[i]) && revSeries[i] !== 0) {
        nwcRatios.push({ idx: i, ratio: Math.abs(nwcSeries[i]) / revSeries[i] });
      }
    }

    if (nwcRatios.length < 2) {
      cards.push({ id: 'nwc-risk', title: 'Working Capital Risk', status: 'na',
        metrics: 'N/A', why: 'Not enough NWC data points to detect a trend.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    // Compare last two ratios
    const recent = nwcRatios[nwcRatios.length - 1].ratio;
    const prior  = nwcRatios[nwcRatios.length - 2].ratio;
    const delta  = recent - prior;

    let status = 'green';
    if (delta > thresholds.nwcTrend.red)         status = 'red';
    else if (delta > thresholds.nwcTrend.yellow) status = 'yellow';

    const metricsStr = `NWC/Rev: ${_ctxPct(recent)} (Δ ${(delta * 100).toFixed(1)}pp)`;

    const why = status === 'red'
      ? `Working capital as a share of revenue jumped ${(delta * 100).toFixed(1)}pp — this signals deteriorating cash conversion.`
      : status === 'yellow'
        ? `NWC/Revenue increased by ${(delta * 100).toFixed(1)}pp — monitor for cash conversion pressure.`
        : `Working capital trend appears stable.`;

    const nextStep = status !== 'green'
      ? 'Review NWC Change (% Rev) assumption — the projection may understate working capital drag.'
      : '';

    cards.push({ id: 'nwc-risk', title: 'Working Capital Risk', status,
      metrics: metricsStr, why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['nwcPct'] });
  })();

  // ── I) Leverage / Coverage Checks ───────────────────────
  (function checkLeverage() {
    const netDebt = inputs.netDebt;
    // Compute latest EBITDA from historical
    const lastEbit = _lastVal(m.ebit);
    const lastDA   = _lastVal(m.depreciation);
    const lastEbitda = (_ctxSafe(lastEbit) && _ctxSafe(lastDA))
      ? lastEbit + Math.abs(lastDA) : _lastVal(m.ebitda);

    // Interest expense from historical (try interestExpense or similar)
    const lastInterest = _lastVal(m.interestExpense);

    const hasLeverage = _ctxSafe(netDebt) && _ctxSafe(lastEbitda) && lastEbitda > 0;
    const hasCoverage = _ctxSafe(lastEbit) && _ctxSafe(lastInterest) && lastInterest > 0;

    if (!hasLeverage && !hasCoverage) {
      cards.push({ id: 'leverage', title: 'Leverage & Coverage', status: 'na',
        metrics: 'N/A', why: 'Net debt, EBITDA, or interest data not available.',
        nextStep: '', severityRank: _SEVERITY.na, relatedAssumptions: [] });
      return;
    }

    let status = 'green';
    const metrics = [];

    if (hasLeverage) {
      const ndEbitda = netDebt / lastEbitda;
      metrics.push(`ND/EBITDA: ${ndEbitda.toFixed(1)}x`);
      if (ndEbitda > thresholds.leverage.red)         status = 'red';
      else if (ndEbitda > thresholds.leverage.yellow) status = status === 'red' ? 'red' : 'yellow';
    }

    if (hasCoverage) {
      const coverage = lastEbit / lastInterest;
      metrics.push(`EBIT/Int: ${coverage.toFixed(1)}x`);
      if (coverage < thresholds.interestCoverage.red)         status = 'red';
      else if (coverage < thresholds.interestCoverage.yellow) status = status === 'red' ? 'red' : 'yellow';
    }

    const metricsStr = metrics.join(' · ');

    const why = status === 'red'
      ? `Leverage metrics (${metricsStr}) signal significant financial risk. Debt levels may impair equity value.`
      : status === 'yellow'
        ? `Leverage metrics (${metricsStr}) are elevated. Factor in refinancing or default risk.`
        : `Leverage and coverage metrics appear manageable.`;

    const nextStep = status !== 'green'
      ? 'Review Net Debt and consider whether the equity bridge properly accounts for debt-related risks.'
      : '';

    cards.push({ id: 'leverage', title: 'Leverage & Coverage', status,
      metrics: metricsStr, why, nextStep, severityRank: _SEVERITY[status],
      relatedAssumptions: ['netDebt'] });
  })();

  // ── Sort cards by severity (reds first, then yellows, greens, NAs) ──
  cards.sort((a, b) => a.severityRank - b.severityRank);

  // ── Build summary counts ────────────────────────────────
  const summary = {
    redCount:    cards.filter(c => c.status === 'red').length,
    yellowCount: cards.filter(c => c.status === 'yellow').length,
    greenCount:  cards.filter(c => c.status === 'green').length,
  };

  return { summary, cards, diagnostics };
}

/* ----------------------------------------------------------
   INTERNAL HELPERS
---------------------------------------------------------- */
function _lastVal(series) {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined && isFinite(series[i])) return series[i];
  }
  return null;
}

function _getDaPctProxy() {
  // D&A % of revenue from current inputs
  const inp = (typeof state !== 'undefined') ? state.inputs : {};
  return inp.daPct || null;
}
