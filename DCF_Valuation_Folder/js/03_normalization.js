/* ============================================================
   TASK 03 — Number Parsing + Fuzzy Line-Item Matching
   Reads state.rawData (set by Task 02) and populates
   state.historical.metrics with aligned numeric series.
   NO derived calculations. NO DCF. NO layout changes.
============================================================ */

// --- parseNumber ---
// Handles: commas, parentheses for negatives, % suffix,
// currency symbols, leading/trailing whitespace, blank/null.
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;

  let s = String(val).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a' || s === '—') return null;

  // Strip currency symbols and spaces
  s = s.replace(/[$£€¥,\s]/g, '');

  // Parentheses → negative: (123) → -123
  const isNeg = /^\(.*\)$/.test(s);
  if (isNeg) s = '-' + s.replace(/[()]/g, '');

  // Strip trailing % (store as decimal fraction)
  const isPct = s.endsWith('%');
  if (isPct) s = s.slice(0, -1);

  const num = parseFloat(s);
  if (isNaN(num)) return null;

  return isPct ? num / 100 : num;
}

// --- safeDivide (shared utility, used by Task 04 onwards) ---
function safeDivide(numerator, denominator) {
  if (denominator === null || denominator === undefined || denominator === 0) return null;
  if (numerator  === null || numerator  === undefined) return null;
  return numerator / denominator;
}

// --- Fuzzy match: score a row label against a list of aliases ---
// Returns true if the label contains any alias keyword.
// Strips leading/trailing whitespace (Capital IQ uses "  Total Revenue" etc.)
function fuzzyMatch(label, aliases) {
  if (!label) return false;
  const lower = String(label).toLowerCase().trim();
  // Exact alias anywhere in the label, or label starts with alias
  return aliases.some(alias => lower.includes(alias.toLowerCase()));
}

// --- Line-item alias map ---
// Keys become property names in state.historical.metrics.
// Each value is a list of substrings to match against row[0].
const LINE_ITEM_ALIASES = {
  // Revenue -- Capital IQ: "Total Revenue" (with leading spaces), also "Revenue"
  revenue:          ['total revenue', 'net revenue', 'net sales', 'revenue', 'sales'],
  // COGS -- Capital IQ: "Cost Of Goods Sold"
  cogs:             ['cost of goods sold', 'cost of goods', 'cogs', 'cost of revenue', 'cost of sales'],
  // Gross Profit -- Capital IQ: "  Gross Profit"
  grossProfit:      ['gross profit'],
  // EBITDA -- Capital IQ Key Stats: "EBITDA"
  ebitda:           ['ebitda'],
  // EBIT -- Capital IQ: "  Operating Income", "EBIT"
  ebit:             ['operating income', 'ebit', 'operating profit'],
  // D&A -- Capital IQ: "Depreciation & Amort.", "Depreciation & Amort., Total"
  depreciation:     ['depreciation & amort., total', 'depreciation & amort.', 'depreciation & amortization',
                     'depreciation and amort', 'd&a', 'da'],
  // Interest Expense -- Capital IQ: "Interest Expense"
  interestExpense:  ['interest expense', 'net interest exp', 'interest cost', 'finance cost'],
  // Tax -- Capital IQ: "Income Tax Expense"
  incomeTax:        ['income tax expense', 'income tax', 'tax expense', 'provision for tax'],
  // Net Income -- Capital IQ: "  Net Income" (with leading spaces), "Net Income to Company"
  netIncome:        ['net income', 'net profit', 'net earnings', 'profit after tax', 'pat',
                     'earnings from cont. ops'],
  // CapEx -- Capital IQ: "Capital Expenditure"
  capex:            ['capital expenditure', 'capital expenditures', 'capex',
                     'purchases of property', 'ppe purchase'],
  // Operating Cash Flow -- Capital IQ: "  Cash from Ops."
  operatingCashFlow:['cash from ops', 'cash from operations', 'operating cash flow',
                     'net cash from operating', 'cfo'],
  // Free Cash Flow
  freeCashFlow:     ['free cash flow', 'fcf', 'levered free cash flow',
                     'unlevered free cash flow'],
  // Total Assets -- Capital IQ: "Total Assets" (no leading spaces)
  totalAssets:      ['total assets'],
  // Total Debt -- Capital IQ: "Long-Term Debt", "Curr. Port. of LT Debt"
  totalDebt:        ['long-term debt', 'total debt', 'total borrowings', 'total debt issued'],
  // Cash -- Capital IQ: "Cash And Equivalents", "  Total Cash & ST Investments"
  cash:             ['total cash & st invest', 'cash and equivalents', 'cash & equivalents',
                     'cash and cash equiv', 'cash & cash equiv'],
  // Total Equity -- Capital IQ Balance Sheet rows 60+
  totalEquity:      ['total equity', "total shareholders' equity", 'stockholders equity',
                     'shareholders equity', 'book value of common equity', 'common equity'],
  // Shares -- Capital IQ Key Stats: "Shares Out."
  sharesOutstanding:['shares out.', 'shares outstanding', 'diluted shares',
                     'weighted average shares', 'diluted weighted average',
                     'basic shares outstanding'],
  // --- Additional Capital IQ metrics per DCF_Tutor spec ---
  // Change in NWC -- Capital IQ Cash Flow: "Change In Net Working Capital"
  changeInNWC:      ['change in net working capital', 'changes in working capital',
                     'change in working capital', 'net working capital change',
                     'working capital changes'],
  // Current Assets -- for NWC derivation
  currentAssets:    ['total current assets', 'current assets'],
  // Current Liabilities -- for NWC derivation
  currentLiabilities: ['total current liabilities', 'current liabilities'],
  // EV/EBITDA -- Capital IQ Multiples sheet (for exit multiple suggestion)
  evToEbitda:       ['ev/ebitda', 'tev/ebitda', 'enterprise value/ebitda',
                     'total enterprise value / ebitda'],
  // Short-term debt -- Capital IQ: "Curr. Port. of LT Debt"
  shortTermDebt:    ['curr. port. of lt debt', 'current portion of long-term debt',
                     'short-term debt', 'short term borrowings'],
  // Preferred equity -- for equity bridge
  preferredEquity:  ['preferred stock', 'preferred equity', 'preferred shares'],
  // Minority interest -- for equity bridge
  minorityInterest: ['minority interest', 'non-controlling interest',
                     'noncontrolling interest'],
};

// --- Extract a numeric series for a matched label ---
// rows: array-of-arrays (row[0] = label, row[1..n] = year values)
// yearCount: how many year columns to capture
function extractSeries(rows, aliases, yearCount) {
  for (const row of rows) {
    if (fuzzyMatch(row[0], aliases)) {
      const series = [];
      for (let i = 1; i <= yearCount; i++) {
        series.push(parseNumber(row[i]));
      }
      return series;
    }
  }
  return null; // not found
}

// --- Combine rows from multiple sheet types for broader matching ---
function collectRows(sheets, preferredTypes) {
  const combined = [];
  // Preferred types first, then everything else
  for (const type of preferredTypes) {
    for (const sheet of Object.values(sheets)) {
      if (sheet.type === type) combined.push(...sheet.rows);
    }
  }
  // Remaining sheets
  for (const sheet of Object.values(sheets)) {
    if (!preferredTypes.includes(sheet.type)) combined.push(...sheet.rows);
  }
  return combined;
}

// --- Main normalization function ---
// Reads state.rawData, writes state.historical
function normalizeData() {
  if (!state.rawData) {
    console.warn('[DCF] normalizeData() called before rawData was populated.');
    return;
  }

  const { sheets, years } = state.rawData;
  const yearCount = years.length;

  if (yearCount === 0) {
    state.warnings.push('Normalization skipped: no year columns detected.');
    renderWarnings();
    return;
  }

  // Gather rows -- income statement data first, then cash flow, then rest
  const incomeRows    = collectRows(sheets, ['income']);
  const cashRows      = collectRows(sheets, ['cashflow']);
  const balanceRows   = collectRows(sheets, ['balance']);
  const multiplesRows = collectRows(sheets, ['multiples']);
  const summaryRows   = collectRows(sheets, ['summary']);
  const allRows       = collectRows(sheets, ['income', 'cashflow', 'balance',
                                              'multiples', 'summary', 'unknown']);

  const metrics = {};

  // Pull each line item, falling back to allRows if not found in preferred source
  for (const [key, aliases] of Object.entries(LINE_ITEM_ALIASES)) {
    // Choose preferred row pool by metric type
    // Note: ebitda and sharesOutstanding live in Key Stats (summary) for Capital IQ files
    let preferredRows;
    if (['revenue','cogs','grossProfit','ebit','depreciation','interestExpense','incomeTax','netIncome'].includes(key)) {
      preferredRows = incomeRows;
    } else if (['capex','operatingCashFlow','freeCashFlow','changeInNWC'].includes(key)) {
      preferredRows = cashRows;
    } else if (['totalAssets','totalDebt','cash','totalEquity','currentAssets',
                'currentLiabilities','shortTermDebt','preferredEquity','minorityInterest'].includes(key)) {
      preferredRows = balanceRows;
    } else if (['evToEbitda'].includes(key)) {
      // EV/EBITDA lives in Multiples or Key Stats sheets
      preferredRows = multiplesRows.length > 0 ? multiplesRows : summaryRows;
    } else {
      // ebitda, sharesOutstanding -- search everywhere
      preferredRows = allRows;
    }

    let series = extractSeries(preferredRows, aliases, yearCount);
    // Fallback: try allRows if preferred pool missed
    if (!series) series = extractSeries(allRows, aliases, yearCount);

    if (series) {
      metrics[key] = series;
      console.log(`[DCF] ✓ ${key}:`, series.map(v => v !== null ? v : 'null'));
    } else {
      metrics[key] = null;
      console.log(`[DCF] ✗ ${key}: not found`);
    }
  }

  // Warn on missing critical metrics
  const critical = ['revenue', 'ebit', 'netIncome'];
  for (const key of critical) {
    if (!metrics[key]) {
      state.warnings.push(`Could not find "${key}" in the uploaded file. Check row labels.`);
    }
  }

  // Store result
  state.historical = {
    years,
    yearMetadata: state.rawData.yearMetadata || {},
    metrics,
    derived: {}, // Task 04 will populate this
  };

  // -- PHASE 4: Normalization validation summary --
  const foundCount = Object.values(metrics).filter(v => v !== null).length;
  const totalCount = Object.keys(metrics).length;
  console.log('[DCF] === Normalization Summary ===');
  console.log('[DCF] Years:', years.join(', '));
  console.log('[DCF] Metrics found:', foundCount, '/', totalCount);
  if (metrics.revenue) {
    console.log('[DCF] Sample revenue:', metrics.revenue);
  }
  console.log('[DCF] === End Normalization Summary ===');
  renderWarnings();
}
