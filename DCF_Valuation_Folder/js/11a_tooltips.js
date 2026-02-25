/* ============================================================
   TASK 11A — Tooltip Engine
   Lightweight, cursor-following tooltips for key financial terms.
   Attaches to elements with [data-tooltip] attribute OR matches
   known term patterns in rendered content via initTooltips().
   Style matches dark design system tokens.
============================================================ */

/* ----------------------------------------------------------
   GLOSSARY — plain-English definitions
---------------------------------------------------------- */
const TOOLTIP_GLOSSARY = {
  // Valuation core
  'wacc':                    'Weighted Average Cost of Capital — the blended rate a company must earn on its assets to satisfy both debt and equity holders. Higher WACC = higher discount rate = lower present value.',
  'terminal growth rate':    'The perpetual annual growth rate assumed for free cash flows beyond the explicit forecast period. Usually set near long-run GDP growth (1–3%).',
  'terminal value':          'The present value of all cash flows beyond the forecast horizon, calculated as a growing perpetuity. Often represents 60–80% of total DCF value.',
  'discount rate':           'The rate used to convert future cash flows into today\'s dollars. In a DCF this is the WACC — higher rates penalise far-future cash flows more heavily.',

  // Cash flow
  'fcf':                     'Free Cash Flow — cash generated after operating expenses and capital expenditures. The raw input to a DCF: FCF = EBIT × (1 − Tax Rate) + D&A − ΔWorking Capital − CapEx.',
  'free cash flow':          'Cash generated after operating expenses and capital expenditures. The raw input to a DCF: FCF = EBIT × (1 − Tax Rate) + D&A − ΔWorking Capital − CapEx.',
  'unlevered fcf':           'Free cash flow calculated before deducting interest payments — treats the business as if it were all-equity financed. Standard input for an enterprise-value DCF.',
  'capex':                   'Capital Expenditures — money spent on acquiring or maintaining fixed assets (property, plant, equipment). Subtracted from operating cash flow to arrive at FCF.',
  'capital expenditures':    'Money spent on acquiring or maintaining fixed assets (property, plant, equipment). Subtracted from operating cash flow to arrive at FCF.',
  'd&a':                     'Depreciation & Amortisation — non-cash charges that reduce reported earnings but are added back in a cash-flow analysis because no cash actually leaves the business.',
  'depreciation':            'A non-cash charge that spreads the cost of a tangible asset over its useful life. Added back in cash-flow analysis because no cash is spent in the period.',
  'working capital':         'Current assets minus current liabilities. An increase in working capital consumes cash; a decrease releases it. Changes in working capital affect FCF directly.',
  'nwc':                     'Net Working Capital — current assets minus current liabilities. Increases in NWC consume cash and reduce free cash flow.',

  // Income statement
  'revenue':                 'Total sales or income generated from the company\'s primary business operations before any costs are deducted.',
  'ebit':                    'Earnings Before Interest & Taxes — operating profit. Measures profitability from core operations, independent of financing structure and tax jurisdiction.',
  'ebit margin':             'EBIT as a percentage of revenue. A key indicator of operating efficiency — how many cents of operating profit are earned per dollar of sales.',
  'ebitda':                  'Earnings Before Interest, Taxes, Depreciation & Amortisation. Commonly used as a proxy for operating cash flow and for cross-company valuation comparisons.',
  'ebitda margin':           'EBITDA as a percentage of revenue. A widely used profitability measure that strips out non-cash and financing items.',
  'net income':              'The "bottom line" — profit remaining after all expenses, interest, taxes, and other charges. Used to calculate earnings per share.',
  'gross profit':            'Revenue minus cost of goods sold. Measures the profitability of the core product or service before overhead expenses.',
  'gross margin':            'Gross profit as a percentage of revenue. Indicates how efficiently the company produces its goods or services.',
  'operating income':        'Revenue minus operating expenses (including D&A). Equivalent to EBIT — measures profit from core operations.',

  // Returns & rates
  'irr':                     'Internal Rate of Return — the discount rate at which the NPV of all cash flows equals zero. Represents the annualised implied return of the investment at the current price.',
  'roic':                    'Return on Invested Capital — NOPAT divided by invested capital. Measures how efficiently management deploys capital to generate profit.',
  'roe':                     'Return on Equity — net income divided by shareholders\' equity. Measures how effectively the company generates profit for equity holders.',
  'roa':                     'Return on Assets — net income divided by total assets. Indicates how efficiently assets are used to generate earnings.',
  'cagr':                    'Compound Annual Growth Rate — the steady annual rate at which a value would grow to reach a target over a period. Smooths out year-to-year volatility.',

  // Enterprise & equity value
  'ev':                      'Enterprise Value — the theoretical takeover price of the whole business: Market Cap + Net Debt + Minority Interest − Cash. Capital-structure neutral.',
  'enterprise value':        'The theoretical takeover price of the whole business: Market Cap + Net Debt + Minority Interest − Cash. Capital-structure neutral.',
  'equity value':            'The portion of enterprise value attributable to common shareholders: EV − Net Debt. Divide by shares outstanding to get intrinsic value per share.',
  'equity value per share':  'Intrinsic value per share from the DCF — equity value divided by diluted shares outstanding. Compare to the current stock price to assess upside/downside.',
  'intrinsic value':         'The fundamental, model-derived value of an asset based on its expected future cash flows discounted to the present. Contrasted with market price.',
  'market cap':              'Market capitalisation — current share price multiplied by diluted shares outstanding. Represents total market value of equity.',
  'net debt':                'Total debt minus cash and cash equivalents. Added to equity value to bridge to enterprise value (or subtracted to go from EV to equity value).',

  // Sensitivity & scenario
  'sensitivity':             'A table showing how the output (e.g. price per share) changes as two key inputs (e.g. WACC and terminal growth rate) vary simultaneously. Reveals robustness of the valuation.',
  'bull case':               'An optimistic scenario where assumptions (growth rate, margins, multiples) are set at favourable levels. Represents an upper bound on potential value.',
  'bear case':               'A pessimistic scenario where assumptions are set at unfavourable levels. Represents a lower bound and stress-tests the downside.',
  'base case':               'The most likely scenario using management guidance or analyst consensus assumptions. The central estimate around which bull/bear cases are framed.',
  'tornado chart':           'A bar chart ranking assumptions by their impact on the output — the widest bars represent the biggest value drivers. Used to prioritise analytical focus.',
  'margin of safety':        'The percentage discount between intrinsic value and current market price. A larger margin of safety provides more buffer against modelling errors.',

  // Other financial terms
  'shares outstanding':      'Total number of diluted shares including options, warrants, and convertibles. Used to convert aggregate equity value into per-share intrinsic value.',
  'tax rate':                'Effective corporate income tax rate applied to EBIT to arrive at NOPAT (net operating profit after tax). Typically 20–30% for US companies.',
  'beta':                    'A measure of a stock\'s volatility relative to the market. Beta > 1 means more volatile than the market. Used in CAPM to calculate the cost of equity.',
  'cost of equity':          'The return shareholders require to hold the stock, estimated via CAPM: Risk-Free Rate + Beta × Equity Risk Premium. A component of WACC.',
  'cost of debt':            'The effective interest rate the company pays on its borrowings (after tax shield). A component of WACC.',
  'risk-free rate':          'The theoretical return on a zero-risk investment — typically the yield on 10-year government bonds. The base rate for all asset pricing models.',
  'equity risk premium':     'The excess return investors demand above the risk-free rate for investing in equities. Multiplied by beta in the CAPM formula.',
  'erp':                     'Equity Risk Premium — the excess return investors demand above the risk-free rate for holding equities. Multiplied by beta in the CAPM formula.',
  'npv':                     'Net Present Value — the sum of all discounted future cash flows minus initial investment. Positive NPV means the investment creates value at the given discount rate.',
  'pv':                      'Present Value — the current worth of a future cash flow, discounted at the required rate of return.',

  // ── TASK 11B EXPANSION ────────────────────────────────────

  // Balance sheet
  'total assets':            'Everything a company owns or controls that has economic value: current assets (cash, receivables, inventory) plus long-term assets (PP&E, intangibles, goodwill).',
  'total liabilities':       'All financial obligations of the company — current liabilities due within a year plus long-term debt and other non-current obligations.',
  'shareholders equity':     'Book value of equity: Total Assets − Total Liabilities. Represents cumulative retained earnings plus paid-in capital. Not the same as market value.',
  'book value':              'The net asset value of the company per the balance sheet: Total Assets − Total Liabilities. Often compared to market cap to compute Price-to-Book ratio.',
  'book value per share':    'Shareholders\' equity divided by shares outstanding. Compares to stock price via the Price-to-Book (P/B) multiple.',
  'current assets':          'Assets expected to be converted to cash within one year: cash, short-term investments, accounts receivable, and inventory.',
  'current liabilities':     'Obligations due within one year: accounts payable, short-term debt, accrued expenses. Used to calculate working capital.',
  'current ratio':           'Current Assets ÷ Current Liabilities. Measures short-term liquidity. A ratio above 1× means current assets exceed near-term obligations.',
  'quick ratio':             '(Cash + Receivables) ÷ Current Liabilities. A stricter liquidity measure that excludes inventory, which may not be quickly converted to cash.',
  'cash and equivalents':    'Highly liquid assets — cash on hand plus money market instruments with maturities under 90 days. Subtracted from debt to compute net debt.',
  'accounts receivable':     'Money owed to the company by customers who purchased on credit. An increase in receivables consumes working capital and reduces free cash flow.',
  'accounts payable':        'Money owed to suppliers for goods or services received but not yet paid. An increase in payables provides a working capital benefit (source of cash).',
  'inventory':               'Raw materials, work-in-progress, and finished goods held for sale. Rising inventory can signal slowing demand and ties up working capital.',
  'goodwill':                'The premium paid in an acquisition above the fair value of identifiable net assets. Reflects brand, customer relationships, and other intangible value.',
  'intangibles':             'Non-physical assets with economic value: patents, trademarks, customer lists, software. Amortised over their useful life.',
  'long-term debt':          'Debt obligations with maturities beyond one year — bonds, term loans, finance leases. Added to equity value to bridge to enterprise value.',
  'retained earnings':       'Cumulative net income not paid out as dividends. Increases shareholders\' equity and funds future growth or debt repayment.',

  // Income statement expansion
  'cost of goods sold':      'Direct costs of producing the goods or services sold — materials, direct labour, manufacturing overhead. Subtracted from revenue to get gross profit.',
  'cogs':                    'Cost of Goods Sold — direct costs of producing the goods or services sold. Subtracted from revenue to arrive at gross profit.',
  'sg&a':                    'Selling, General & Administrative expenses — overhead costs not directly tied to production: salaries, rent, marketing, legal. Part of operating expenses.',
  'r&d':                     'Research & Development — investment in new products, processes, or technologies. Expensed as incurred under GAAP; capitalised under IFRS in some cases.',
  'interest expense':        'Cost of carrying debt — interest paid on bonds, loans, and credit facilities. Deducted after EBIT to arrive at pre-tax income.',
  'income tax':              'Corporate taxes paid on pre-tax income. The effective tax rate can differ from the statutory rate due to deferred taxes and tax planning.',
  'eps':                     'Earnings Per Share — net income divided by diluted shares outstanding. The most widely cited per-share profitability metric.',
  'diluted eps':             'EPS calculated using the fully diluted share count, including options, warrants, and convertibles. More conservative than basic EPS.',
  'revenue growth':          'Year-over-year percentage change in total revenue. A primary driver of DCF value — small differences in long-run growth assumptions have large valuation effects.',
  'operating leverage':      'The sensitivity of operating income to changes in revenue. High fixed costs create high operating leverage: revenue upside amplifies profit, but so does downside.',
  'nopat':                   'Net Operating Profit After Tax — EBIT × (1 − Tax Rate). The after-tax operating profit available to all capital providers; the numerator in ROIC calculations.',

  // Cash flow expansion
  'operating cash flow':     'Cash generated from core business operations: net income adjusted for non-cash items and working capital changes. Reported on the cash flow statement.',
  'ocf':                     'Operating Cash Flow — cash generated from core business operations, adjusted for non-cash items and working capital movements.',
  'investing activities':    'Cash flows from acquiring or disposing of long-term assets: CapEx, acquisitions, asset sales. Typically negative as companies invest for growth.',
  'financing activities':    'Cash flows related to debt and equity: borrowings, repayments, dividends, share buybacks. Shows how the company funds itself and returns capital.',
  'free cash flow yield':    'FCF per share divided by the stock price, expressed as a percentage. Analogous to an earnings yield but based on actual cash generation.',
  'cash conversion':         'The proportion of net income that converts to free cash flow. High conversion indicates quality earnings; low conversion may signal working capital drag or aggressive accruals.',

  // DCF model expansion
  'explicit forecast period': 'The number of years modelled individually in the DCF — typically 5 to 10 years. Beyond this horizon, a terminal value captures remaining cash flows.',
  'projection period':        'Synonymous with explicit forecast period — the span of years for which individual cash flow estimates are made before the terminal value takes over.',
  'mid-year convention':      'Assumes cash flows occur at the mid-point of each year rather than year-end, producing a more realistic present value when cash flows are spread throughout the year.',
  'gordon growth model':      'Terminal value method: FCF_n × (1 + g) ÷ (WACC − g). Treats the terminal cash flow as a growing perpetuity. Sensitive to the assumed growth rate.',
  'exit multiple method':     'Terminal value method that applies an industry EV/EBITDA multiple to the final forecast year\'s EBITDA. Cross-checks the Gordon Growth Model result.',
  'bridge':                   'The reconciliation from Enterprise Value to Equity Value: EV − Net Debt − Minority Interest + Cash = Equity Value. Then divided by shares for per-share price.',
  'upside':                   'The percentage difference between the DCF intrinsic value and the current market price, when the DCF value is higher. Positive upside = potential undervaluation.',
  'downside':                 'The percentage by which the current stock price exceeds the DCF intrinsic value. Negative upside / downside = potential overvaluation.',

  // Valuation multiples
  'ev/ebitda':               'Enterprise Value divided by EBITDA. The most common cross-company valuation multiple — capital-structure neutral and less affected by accounting choices than P/E.',
  'ev/ebit':                 'Enterprise Value divided by EBIT. Similar to EV/EBITDA but penalises companies with high capex requirements, since D&A is deducted.',
  'ev/revenue':              'Enterprise Value divided by annual revenue. Used for early-stage or loss-making companies where earnings multiples are not meaningful.',
  'p/e':                     'Price-to-Earnings ratio — stock price divided by EPS. The most widely known valuation multiple; heavily influenced by capital structure and accounting.',
  'p/b':                     'Price-to-Book ratio — market cap divided by book value of equity. Low P/B can signal value; high P/B often reflects intangible value not on the balance sheet.',
  'p/fcf':                   'Price-to-Free-Cash-Flow — market cap divided by annual free cash flow. Preferred by many value investors as a more cash-based alternative to P/E.',
  'ev/fcf':                  'Enterprise Value divided by unlevered free cash flow. Capital-structure neutral equivalent of P/FCF.',
  'peg ratio':               'P/E divided by the expected earnings growth rate. A PEG below 1× is often considered cheap relative to growth; above 1× suggests growth is expensive.',

  // Capital structure
  'leverage':                'The use of debt to amplify returns. Higher leverage increases both potential upside and downside. Measured by Debt/EBITDA, Net Debt/Equity, or interest coverage.',
  'debt/ebitda':             'A common leverage measure — total debt divided by EBITDA. Indicates how many years of operating earnings it would take to repay all debt.',
  'interest coverage':       'EBIT divided by interest expense. Measures the company\'s ability to service its debt. A ratio below 2× is generally considered a warning sign.',
  'debt/equity':             'Total debt divided by shareholders\' equity. Measures the proportion of financing from debt versus equity. Higher ratios imply more financial risk.',
  'minority interest':       'The portion of a subsidiary not owned by the parent company. Added to debt in the EV bridge because it represents a claim on enterprise assets.',
  'preferred equity':        'A class of equity senior to common shares, typically with fixed dividends. Treated as a debt-like claim in the bridge from EV to equity value.',
  'dilution':                'The reduction in EPS or per-share value caused by issuing new shares — via stock options, convertibles, or secondary offerings.',

  // Market & price
  'stock price':             'Current market price of one common share. Compare to intrinsic value per share to assess whether the stock appears overvalued or undervalued.',
  'share price':             'Current market price per common share. The DCF output (equity value per share) is compared to this to gauge upside or downside potential.',
  '52-week high':            'The highest closing price over the past 52 weeks. Used as a reference point for momentum and relative valuation context.',
  '52-week low':             'The lowest closing price over the past 52 weeks. Provides context for recent price range and potential support levels.',
  'market price':            'The price at which the security last traded in the open market. Compared to intrinsic value to assess relative attractiveness.',
  'price target':            'An analyst\'s or model\'s estimated fair value for the stock — often the DCF output equity value per share.',

  // Risk & scenario
  'downside protection':     'The degree to which the current valuation provides a cushion against adverse outcomes. Quantified by margin of safety or downside scenario price.',
  'stress test':             'Running the valuation model under severe adverse assumptions to understand the worst-case equity value. Informs position sizing and risk management.',
  'upside scenario':         'A bull-case analysis using optimistic but plausible inputs — higher revenue growth, better margins, or lower WACC.',
  'downside scenario':       'A bear-case analysis using pessimistic inputs — lower growth, margin compression, or higher discount rates.',
  'revenue growth rate':     'The year-over-year percentage increase in revenue. One of the most impactful assumptions in a DCF — small changes compound significantly over the forecast horizon.',
  'fcf margin':              'Free Cash Flow as a percentage of revenue. Measures how efficiently revenue converts into cash available for investors after operating costs and capex.',
  'terminal fcf margin':     'The FCF margin assumed in the terminal year — should reflect a normalised, steady-state level of profitability consistent with the industry.',
};

/* ----------------------------------------------------------
   TOOLTIP DOM ELEMENT — one shared floating element
---------------------------------------------------------- */
let _tooltipEl = null;
let _tooltipVisible = false;

function _getTooltipEl() {
  if (_tooltipEl) return _tooltipEl;

  _tooltipEl = document.createElement('div');
  _tooltipEl.id = 'dcf-tooltip';
  _tooltipEl.setAttribute('role', 'tooltip');
  _tooltipEl.setAttribute('aria-hidden', 'true');

  Object.assign(_tooltipEl.style, {
    position:        'fixed',
    zIndex:          '9999',
    maxWidth:        '300px',
    padding:         '10px 14px',
    background:      'var(--bg-elevated)',
    border:          '1px solid var(--border-strong)',
    borderRadius:    'var(--radius-md)',
    color:           'var(--text-secondary)',
    fontSize:        '12px',
    lineHeight:      '1.55',
    fontFamily:      'inherit',
    boxShadow:       'var(--shadow-md)',
    pointerEvents:   'none',
    opacity:         '0',
    transform:       'translateY(4px)',
    transition:      'opacity 160ms ease, transform 160ms ease',
    wordBreak:       'break-word',
    display:         'none',
  });

  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}

/* ----------------------------------------------------------
   CORE SHOW / HIDE
---------------------------------------------------------- */
function _showTooltip(text, x, y) {
  const el = _getTooltipEl();
  el.textContent = text;
  el.style.display = 'block';
  el.removeAttribute('aria-hidden');

  // Position — keep within viewport
  _positionTooltip(el, x, y);

  // Trigger transition
  requestAnimationFrame(() => {
    el.style.opacity   = '1';
    el.style.transform = 'translateY(0)';
  });

  _tooltipVisible = true;
}

function _hideTooltip() {
  if (!_tooltipEl || !_tooltipVisible) return;
  _tooltipEl.style.opacity   = '0';
  _tooltipEl.style.transform = 'translateY(4px)';
  _tooltipEl.setAttribute('aria-hidden', 'true');
  _tooltipVisible = false;

  // Hide from layout after transition
  setTimeout(() => {
    if (!_tooltipVisible && _tooltipEl) {
      _tooltipEl.style.display = 'none';
    }
  }, 180);
}

function _positionTooltip(el, cursorX, cursorY) {
  const GAP    = 14;  // px offset from cursor
  const margin = 8;   // minimum distance from viewport edge
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;

  // Measure tooltip (needs display:block first)
  const w = el.offsetWidth  || 300;
  const h = el.offsetHeight || 60;

  let left = cursorX + GAP;
  let top  = cursorY - h / 2;  // vertically centred on cursor

  // Flip horizontally if too close to right edge
  if (left + w > vw - margin) {
    left = cursorX - w - GAP;
  }

  // Clamp vertically
  top = Math.max(margin, Math.min(top, vh - h - margin));

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
}

/* ----------------------------------------------------------
   LOOKUP — normalise term then find definition
---------------------------------------------------------- */
function _lookupTerm(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9& %/]/g, ' ').replace(/\s+/g, ' ').trim();

  // Exact match
  if (TOOLTIP_GLOSSARY[key]) return TOOLTIP_GLOSSARY[key];

  // Prefix / substring match (longest key wins)
  let best = null;
  let bestLen = 0;
  for (const [k, v] of Object.entries(TOOLTIP_GLOSSARY)) {
    if (key.includes(k) && k.length > bestLen) {
      best    = v;
      bestLen = k.length;
    }
  }
  return best;
}

/* ----------------------------------------------------------
   BIND TO A SINGLE ELEMENT
   Reads [data-tooltip] if present; falls back to text content lookup.
---------------------------------------------------------- */
function _bindElement(el) {
  // Avoid double-binding
  if (el._dcfTooltipBound) return;
  el._dcfTooltipBound = true;

  // Resolve the tooltip text
  let tip = el.getAttribute('data-tooltip') || null;
  if (!tip) {
    tip = _lookupTerm(el.textContent);
  }
  if (!tip) return; // nothing to show

  // Add visual affordance
  el.style.cursor            = 'help';
  el.style.textDecorationLine     = 'underline';
  el.style.textDecorationStyle    = 'dotted';
  el.style.textDecorationColor    = 'var(--text-muted)';
  el.style.textUnderlineOffset    = '3px';

  el.addEventListener('mouseenter', e => {
    _showTooltip(tip, e.clientX, e.clientY);
  });

  el.addEventListener('mousemove', e => {
    if (_tooltipVisible && _tooltipEl) {
      _positionTooltip(_tooltipEl, e.clientX, e.clientY);
    }
  });

  el.addEventListener('mouseleave', _hideTooltip);
  el.addEventListener('focus',      () => { /* keep accessible */ });
  el.addEventListener('blur',       _hideTooltip);
}

/* ----------------------------------------------------------
   SCAN DOM — attach tooltips to matching elements
   Scoped to #dashboard-body only — never touches upload screen.
---------------------------------------------------------- */
let _scanning = false;

function _scanAndBind() {
  if (_scanning) return; // prevent re-entrant calls
  _scanning = true;

  // Only scan within the dashboard, not the upload screen
  const root = document.getElementById('dashboard-body') || document.body;

  // Pause observer while we mutate styles to prevent feedback loop
  if (_observer) _observer.disconnect();

  // 1. Explicit [data-tooltip] attributes (highest priority)
  root.querySelectorAll('[data-tooltip]').forEach(_bindElement);

  // 2. Table <th> elements — match header text to glossary
  root.querySelectorAll('th').forEach(th => {
    if (!th._dcfTooltipBound && _lookupTerm(th.textContent)) {
      _bindElement(th);
    }
  });

  // 3. .metric-label, .kpi-label, .stat-label, .section-label classes
  const labelSelectors = [
    '.metric-label',
    '.kpi-label',
    '.stat-label',
    '.label',
    '.metric-name',
    '.assumption-label',
  ];
  root.querySelectorAll(labelSelectors.join(',')).forEach(el => {
    if (!el._dcfTooltipBound && _lookupTerm(el.textContent)) {
      _bindElement(el);
    }
  });

  // 4. Chart titles / section headings that contain known terms
  root.querySelectorAll('.chart-title, .section-title, h3, h4').forEach(el => {
    if (!el._dcfTooltipBound && _lookupTerm(el.textContent)) {
      _bindElement(el);
    }
  });

  // 5. Any element whose text exactly matches a glossary term
  //    (scoped to table cells, metric values, assumption rows)
  const termSelectors = 'td, .metric-value, .assumption-row span, .pill, .badge';
  root.querySelectorAll(termSelectors).forEach(el => {
    if (!el._dcfTooltipBound) {
      const text = el.textContent.trim();
      // Only bind if the entire text content is a known term (avoid binding paragraphs)
      if (text.length < 60 && _lookupTerm(text)) {
        _bindElement(el);
      }
    }
  });

  // Resume observer now that style mutations are done
  _scanning = false;
  _resumeObserver();
}

/* ----------------------------------------------------------
   MUTATION OBSERVER — re-scan when new content renders
   Watches childList only (not attribute/style changes) to avoid
   triggering on the inline styles _bindElement sets.
---------------------------------------------------------- */
let _observer = null;
let _scanTimer = null;

function _resumeObserver() {
  if (!_observer) return;
  const root = document.getElementById('dashboard-body') || document.body;
  _observer.observe(root, {
    childList: true,
    subtree:   true,
  });
}

function _startObserver() {
  if (_observer) return;

  _observer = new MutationObserver(mutations => {
    // Only re-scan if actual nodes were added (ignore attribute/style changes)
    const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
    if (!hasNewNodes) return;

    clearTimeout(_scanTimer);
    _scanTimer = setTimeout(_scanAndBind, 300);
  });

  _resumeObserver();
}

/* ----------------------------------------------------------
   PUBLIC API
---------------------------------------------------------- */

/**
 * initTooltips()
 * Call once after the dashboard has rendered initial content.
 * Scans the DOM for known financial terms, binds tooltips,
 * and watches for future renders via MutationObserver.
 */
function initTooltips() {
  _getTooltipEl(); // pre-create element
  _scanAndBind();  // bind current DOM
  _startObserver(); // watch for future renders
}

/**
 * addTooltip(selector, text)
 * Programmatically attach a custom tooltip to elements matching selector.
 * Call after initTooltips() if needed for dynamic content.
 */
function addTooltip(selector, text) {
  document.querySelectorAll(selector).forEach(el => {
    el.setAttribute('data-tooltip', text);
    _bindElement(el);
  });
}
