/* ============================================================
   TASK 11B — Searchable Glossary Panel
   Renders an alphabetically-sorted, filterable glossary card grid
   into #section-tooltips. Reads from TOOLTIP_GLOSSARY (11a_tooltips.js).
   No modifications to tooltip engine logic.
============================================================ */

/* Injected once — use a CSS class for hide/show to avoid style attribute
   mutations that would fire the MutationObserver in 11a_tooltips.js */
(function _injectGlossaryStyles() {
  if (document.getElementById('glossary-styles')) return;
  const s = document.createElement('style');
  s.id = 'glossary-styles';
  s.textContent = `
    .glossary-card--hidden { display: none !important; }
    .glossary-cat-btn {
      border: 1px solid var(--border-strong);
      background: var(--bg-elevated);
      color: var(--text-secondary);
      transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
    }
    .glossary-cat-btn.active {
      border-color: var(--accent-primary) !important;
      background: rgba(79,142,247,0.12) !important;
      color: var(--accent-primary) !important;
    }
  `;
  document.head.appendChild(s);
}());

/* ----------------------------------------------------------
   CATEGORY LABELS — maps first-word patterns to display groups
---------------------------------------------------------- */
const _GLOSSARY_CATEGORIES = [
  { label: 'DCF Core',          keys: ['wacc','terminal growth rate','terminal value','discount rate','explicit forecast','projection period','mid-year','gordon growth','exit multiple','bridge','upside','downside'] },
  { label: 'Free Cash Flow',    keys: ['fcf','free cash flow','unlevered','capex','capital expenditures','d&a','depreciation','working capital','nwc','operating cash flow','ocf','investing activities','financing activities','free cash flow yield','cash conversion','fcf margin','terminal fcf margin'] },
  { label: 'Income Statement',  keys: ['revenue','ebit','ebitda','net income','gross profit','gross margin','operating income','cogs','cost of goods sold','sg&a','r&d','interest expense','income tax','eps','diluted eps','revenue growth','operating leverage','nopat','ebit margin','ebitda margin'] },
  { label: 'Balance Sheet',     keys: ['total assets','total liabilities','shareholders equity','book value','current assets','current liabilities','current ratio','quick ratio','cash and equivalents','accounts receivable','accounts payable','inventory','goodwill','intangibles','long-term debt','retained earnings','book value per share'] },
  { label: 'Enterprise Value',  keys: ['ev','enterprise value','equity value','equity value per share','market cap','net debt','intrinsic value','minority interest','preferred equity','dilution'] },
  { label: 'Returns & Rates',   keys: ['irr','roic','roe','roa','cagr','npv','pv','beta','cost of equity','cost of debt','risk-free rate','equity risk premium','erp'] },
  { label: 'Capital Structure', keys: ['leverage','debt/ebitda','interest coverage','debt/equity'] },
  { label: 'Multiples',         keys: ['ev/ebitda','ev/ebit','ev/revenue','p/e','p/b','p/fcf','ev/fcf','peg ratio'] },
  { label: 'Scenario & Risk',   keys: ['sensitivity','bull case','bear case','base case','tornado chart','margin of safety','downside protection','stress test','upside scenario','downside scenario','revenue growth rate'] },
  { label: 'Market & Price',    keys: ['stock price','share price','52-week high','52-week low','market price','price target'] },
  { label: 'Shares & Tax',      keys: ['shares outstanding','tax rate'] },
];

/* ----------------------------------------------------------
   BUILD SORTED TERM LIST from TOOLTIP_GLOSSARY
   Returns [{ term, definition, category }] sorted A→Z
---------------------------------------------------------- */
function _buildGlossaryList() {
  if (typeof TOOLTIP_GLOSSARY === 'undefined') return [];

  // Build reverse lookup: key → category label
  const catMap = {};
  for (const cat of _GLOSSARY_CATEGORIES) {
    for (const k of cat.keys) {
      catMap[k] = cat.label;
    }
  }

  return Object.entries(TOOLTIP_GLOSSARY)
    .map(([term, definition]) => ({
      term,
      definition,
      category: catMap[term] || 'General',
      displayTerm: term.toUpperCase(),
    }))
    .sort((a, b) => a.term.localeCompare(b.term));
}

/* ----------------------------------------------------------
   RENDER GLOSSARY PANEL into #section-tooltips
---------------------------------------------------------- */
function renderGlossary() {
  const section = document.getElementById('section-tooltips');
  if (!section) return;

  const allTerms = _buildGlossaryList();
  if (allTerms.length === 0) {
    section.innerHTML = '<p style="color:var(--text-muted);padding:var(--space-5)">Glossary unavailable — load 11a_tooltips.js first.</p>';
    return;
  }

  section.innerHTML = `
    <div class="layout-container" style="padding-top:var(--space-6);padding-bottom:var(--space-8)">

      <!-- Header -->
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:var(--space-5);gap:var(--space-4);flex-wrap:wrap">
        <div>
          <p class="caption" style="margin-bottom:var(--space-1)">Reference</p>
          <h2 class="h2">Financial Glossary</h2>
          <p class="body" style="margin-top:var(--space-2)">
            Plain-English definitions for every metric in this dashboard.
            Hover any underlined label in the dashboard to see its tooltip inline.
          </p>
        </div>
        <div id="glossary-count" class="caption" style="white-space:nowrap;padding-bottom:2px">
          ${allTerms.length} terms
        </div>
      </div>

      <!-- Search bar -->
      <div style="position:relative;max-width:420px;margin-bottom:var(--space-5)">
        <svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text-muted);pointer-events:none"
             viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="9" r="6"/><line x1="15" y1="15" x2="19" y2="19"/>
        </svg>
        <input
          id="glossary-search"
          type="search"
          placeholder="Search terms…"
          autocomplete="off"
          spellcheck="false"
          style="
            width:100%;
            padding:10px 12px 10px 38px;
            background:var(--bg-elevated);
            border:1px solid var(--border-strong);
            border-radius:var(--radius-md);
            color:var(--text-primary);
            font-family:inherit;
            font-size:14px;
            outline:none;
            transition:border-color var(--transition-fast),box-shadow var(--transition-fast);
          "
        />
      </div>

      <!-- Category filter pills -->
      <div id="glossary-cats" style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-5)">
        <button class="glossary-cat-btn active" data-cat="All"
          style="${_catBtnStyle(true)}">All</button>
        ${[..._GLOSSARY_CATEGORIES.map(c => c.label), 'General']
            .filter((v, i, a) => a.indexOf(v) === i) // unique
            .filter(label => allTerms.some(t => t.category === label))
            .map(label => `<button class="glossary-cat-btn" data-cat="${label}" style="${_catBtnStyle(false)}">${label}</button>`)
            .join('')}
      </div>

      <!-- No-results message (hidden by default) -->
      <p id="glossary-no-results" style="display:none;color:var(--text-muted);font-size:14px;padding:var(--space-4) 0">
        No terms match your search.
      </p>

      <!-- Cards grid -->
      <div id="glossary-grid" style="
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(320px,1fr));
        gap:var(--space-4);
      ">
        ${allTerms.map(_renderCard).join('')}
      </div>

    </div>
  `;

  _wireGlossaryInteractions(allTerms);
}

function _catBtnStyle(active) {
  return `
    display:inline-flex;align-items:center;
    padding:5px 12px;
    border-radius:var(--radius-sm);
    font-family:inherit;font-size:12px;font-weight:500;
    cursor:pointer;
  `;
}

function _renderCard(item) {
  // Highlight the term abbreviation vs full name
  const termHtml = item.displayTerm.replace(/[()]/g, '');
  return `
    <div class="glossary-card metric-card"
         data-term="${_escAttr(item.term)}"
         data-cat="${_escAttr(item.category)}"
         style="display:flex;flex-direction:column;gap:var(--space-2)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-2)">
        <span style="
          font-family:'SF Mono','Fira Code','Cascadia Code',monospace;
          font-size:11px;font-weight:600;letter-spacing:0.04em;
          color:var(--accent-primary);
        ">${termHtml}</span>
        <span style="
          font-size:10px;font-weight:500;letter-spacing:0.04em;
          color:var(--text-muted);text-transform:uppercase;
          white-space:nowrap;margin-top:1px;
        ">${_escHtml(item.category)}</span>
      </div>
      <p style="font-size:13px;line-height:1.6;color:var(--text-secondary);margin:0"
         class="glossary-def">${_escHtml(item.definition)}</p>
    </div>
  `;
}

/* ----------------------------------------------------------
   INTERACTION — search + category filter
---------------------------------------------------------- */
function _wireGlossaryInteractions(allTerms) {
  const searchInput = document.getElementById('glossary-search');
  const catContainer = document.getElementById('glossary-cats');
  const grid = document.getElementById('glossary-grid');
  const noResults = document.getElementById('glossary-no-results');
  const countEl = document.getElementById('glossary-count');

  let activeCat = 'All';
  let searchQuery = '';

  function applyFilter() {
    const q = searchQuery.toLowerCase().trim();
    let visible = 0;

    grid.querySelectorAll('.glossary-card').forEach(card => {
      const term = card.dataset.term;
      const cat  = card.dataset.cat;
      const def  = card.querySelector('.glossary-def').textContent.toLowerCase();

      const catMatch  = activeCat === 'All' || cat === activeCat;
      const termMatch = !q || term.includes(q) || def.includes(q);

      if (catMatch && termMatch) {
        card.classList.remove('glossary-card--hidden');
        // Highlight matching text in definition
        const defEl = card.querySelector('.glossary-def');
        if (q) {
          defEl.innerHTML = _highlight(_escHtml(allTerms.find(t => t.term === term)?.definition || ''), q);
        } else {
          defEl.textContent = allTerms.find(t => t.term === term)?.definition || '';
        }
        visible++;
      } else {
        card.classList.add('glossary-card--hidden');
      }
    });

    noResults.style.display = visible === 0 ? 'block' : 'none';
    if (countEl) countEl.textContent = `${visible} of ${allTerms.length} terms`;
  }

  // Search
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value;
      applyFilter();
    });

    // Focus styles
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = 'var(--accent-primary)';
      searchInput.style.boxShadow   = '0 0 0 3px rgba(79,142,247,0.15)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = 'var(--border-strong)';
      searchInput.style.boxShadow   = 'none';
    });
  }

  // Category pills
  if (catContainer) {
    catContainer.addEventListener('click', e => {
      const btn = e.target.closest('.glossary-cat-btn');
      if (!btn) return;

      activeCat = btn.dataset.cat;

      catContainer.querySelectorAll('.glossary-cat-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });

      applyFilter();
    });
  }
}

/* ----------------------------------------------------------
   HELPERS
---------------------------------------------------------- */
function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function _highlight(escapedHtml, query) {
  if (!query) return escapedHtml;
  // Case-insensitive highlight — operate on already-escaped string so we don't double-escape
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escapedHtml.replace(re, '<mark style="background:rgba(79,142,247,0.25);color:var(--text-primary);border-radius:2px;padding:0 1px">$1</mark>');
}
