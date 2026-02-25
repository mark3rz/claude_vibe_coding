/* ============================================================
   TASK 14 — Context Benchmarks (Data Layer)
   Static sector benchmark ranges and regime presets.
   Used by the Context Engine (15_context_engine.js) for
   institutional-style realism checks.

   To update: edit the ranges below. All values are in decimal
   form where applicable (e.g. 0.25 = 25%).
============================================================ */

const CONTEXT_BENCHMARKS = {

  /* --------------------------------------------------------
     SECTOR BENCHMARKS
     Each sector has ranges for key valuation multiples and
     operating metrics. "lo" and "hi" define the normal band;
     values outside trigger yellow/red flags.
  -------------------------------------------------------- */
  sectors: {
    Tech: {
      EV_EBITDA:        { lo: 12, hi: 30,  label: 'EV/EBITDA' },
      PE:               { lo: 18, hi: 40,  label: 'P/E' },
      FCF_YIELD:        { lo: 0.02, hi: 0.06, label: 'FCF Yield' },
      ROIC:             { lo: 0.12, hi: 0.40, label: 'ROIC' },
      ROIC_WACC_SPREAD: { lo: 0.02, hi: 0.25, label: 'ROIC-WACC Spread' },
      EBITDA_MARGIN:    { lo: 0.20, hi: 0.50, label: 'EBITDA Margin' },
      EBIT_MARGIN:      { lo: 0.12, hi: 0.40, label: 'EBIT Margin' },
    },
    Generic: {
      EV_EBITDA:        { lo: 6, hi: 14,   label: 'EV/EBITDA' },
      PE:               { lo: 10, hi: 22,  label: 'P/E' },
      FCF_YIELD:        { lo: 0.04, hi: 0.10, label: 'FCF Yield' },
      ROIC:             { lo: 0.08, hi: 0.20, label: 'ROIC' },
      ROIC_WACC_SPREAD: { lo: 0.01, hi: 0.10, label: 'ROIC-WACC Spread' },
      EBITDA_MARGIN:    { lo: 0.10, hi: 0.25, label: 'EBITDA Margin' },
      EBIT_MARGIN:      { lo: 0.06, hi: 0.18, label: 'EBIT Margin' },
    },
  },

  /* --------------------------------------------------------
     REGIME PRESETS
     Typical risk-free rate and equity risk premium ranges
     for bull / base / bear market environments.
  -------------------------------------------------------- */
  regimes: {
    bull: { rfr: 0.035, erp: 0.04, label: 'Bull' },
    base: { rfr: 0.04,  erp: 0.055, label: 'Base' },
    bear: { rfr: 0.045, erp: 0.07, label: 'Bear' },
  },

  /* --------------------------------------------------------
     HARD-RULE THRESHOLDS
     Used by the context engine for red/yellow/green flags.
     Centralised here so they are easy to tweak.
  -------------------------------------------------------- */
  thresholds: {
    // Terminal value as % of EV
    tvDominance: {
      yellow: 0.70,   // >70% = yellow
      red:    0.85,   // >85% = red
    },
    // Perpetuity growth rate absolute limits
    perpetuityGrowth: {
      yellow: 0.035,  // >3.5% = yellow
      red:    0.05,   // >5% = red (exceeds most long-run GDP estimates)
    },
    // Implied EV/EBITDA — how far outside sector range triggers flags
    // (multiples of the range width beyond the band edges)
    evEbitdaStretch: {
      yellow: 0,      // any amount outside = yellow
      red:    0.5,    // >50% of range width beyond edge = red
    },
    // ROIC vs WACC: negative spread flags
    roicWaccSpread: {
      yellow: 0.0,    // spread <= 0 = yellow (value destruction)
      red:   -0.02,   // spread < -2pp = red
    },
    // Leverage: Net Debt / EBITDA
    leverage: {
      yellow: 3.0,
      red:    5.0,
    },
    // Interest coverage: EBIT / Interest Expense
    interestCoverage: {
      yellow: 3.0,    // < 3x = yellow
      red:    1.5,    // < 1.5x = red
    },
    // NWC trend: year-over-year increase in NWC/Revenue
    nwcTrend: {
      yellow: 0.03,   // >3pp increase = yellow
      red:    0.06,   // >6pp increase = red
    },
  },
};
