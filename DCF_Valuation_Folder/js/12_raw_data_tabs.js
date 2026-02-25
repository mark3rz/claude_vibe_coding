/* ============================================================
   TASK 12 -- Raw Source Data Tabs
   Renders one tab per ingested sheet so users can inspect the
   raw Capital IQ / Excel data that feeds the dashboard.
   Rows used by the normalization layer are highlighted with
   a blue accent and tagged with the canonical metric name.
   Reads state.rawData (set by 02_ingestion.js).
   NO calculations. NO mutations to state.
============================================================ */

// --- Reverse lookup: for each sheet row label, find which canonical
//     metric(s) it matched (if any) in LINE_ITEM_ALIASES.
function buildMatchedLabelsMap() {
  const map = {};
  if (typeof LINE_ITEM_ALIASES === 'undefined') return map;
  for (const [metricKey, aliases] of Object.entries(LINE_ITEM_ALIASES)) {
    for (const alias of aliases) {
      map[alias.toLowerCase()] = metricKey;
    }
  }
  return map;
}

// Try to find a canonical match for a given row label
function findCanonicalMatch(label, aliasMap) {
  if (!label) return null;
  const lower = String(label).toLowerCase().trim();
  // Check if any alias substring appears in the label
  for (const [alias, metricKey] of Object.entries(aliasMap)) {
    if (lower.includes(alias)) return metricKey;
  }
  return null;
}

// --- Format a cell value for display ---
function rawCellFmt(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    // Format with commas, keep reasonable precision
    if (Number.isInteger(val) || Math.abs(val) >= 100) {
      return val.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    if (Math.abs(val) < 0.01) return val.toExponential(2);
    return val.toFixed(4);
  }
  return String(val);
}

// --- Friendly display name for sheet types ---
const SHEET_TYPE_LABELS = {
  income:    'IS',
  balance:   'BS',
  cashflow:  'CF',
  multiples: 'Mult',
  summary:   'Stats',
  unknown:   '',
};

// --- Main render function ---
function renderRawDataTabs() {
  const container = document.getElementById('section-raw-data');
  if (!container) return;

  if (!state.rawData || !state.rawData.sheets) {
    container.innerHTML = '';
    return;
  }

  const { sheets, sheetNames, years, companyName, units } = state.rawData;
  const aliasMap = buildMatchedLabelsMap();

  // Build tabs HTML
  const tabButtons = sheetNames.map((name, idx) => {
    const s = sheets[name];
    const typeBadge = SHEET_TYPE_LABELS[s.type] || '';
    const activeClass = idx === 0 ? ' active' : '';
    return `<button class="raw-data-tab${activeClass}"
                    data-tab-index="${idx}"
                    data-sheet-name="${name}">
              ${name}
              ${typeBadge ? `<span class="tab-badge">${typeBadge}</span>` : ''}
            </button>`;
  }).join('');

  // Build tab panels HTML
  const tabPanels = sheetNames.map((name, idx) => {
    const s = sheets[name];
    const meta = s.meta || {};
    const sheetYears = meta.years || [];
    const rows = s.rows || [];
    const activeClass = idx === 0 ? ' active' : '';

    // Build column headers: "Line Item" + years
    const yearHeaders = sheetYears.map(y => {
      const ym = (meta.yearMetadata || {})[y];
      const isEst = ym && ym.is_estimate;
      return `<th class="table-header${isEst ? ' col-terminal' : ''}">${y}${isEst ? 'E' : ''}</th>`;
    }).join('');

    // Build data rows
    const dataRows = rows.map(row => {
      const label = row[0] != null ? String(row[0]).trim() : '';
      if (!label) return ''; // skip blank-label rows

      const match = findCanonicalMatch(label, aliasMap);
      const rowClass = match ? ' raw-row-matched' : '';
      const matchTag = match
        ? `<span class="raw-match-tag">${match}</span>`
        : '';

      // Cell values: row[1] through row[yearCount]
      const cells = sheetYears.map((_, yi) => {
        const val = row[yi + 1];
        return `<td>${rawCellFmt(val)}</td>`;
      }).join('');

      return `<tr class="table-row${rowClass}">
                <td>${label}${matchTag}</td>
                ${cells}
              </tr>`;
    }).join('');

    // Sheet metadata summary
    const metaLine = [
      meta.company ? meta.company : '',
      meta.units ? meta.units : '',
      meta.format === 'capiq' ? 'Capital IQ format' : '',
      `${rows.length} rows`,
      `${sheetYears.length} years`,
    ].filter(Boolean).join('  /  ');

    return `<div class="raw-data-panel${activeClass}" data-panel-index="${idx}">
              <p class="caption" style="padding:6px 8px;color:var(--text-muted);">${metaLine}</p>
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th class="table-header" style="text-align:left;min-width:220px;">Line Item</th>
                      ${yearHeaders}
                    </tr>
                  </thead>
                  <tbody>
                    ${dataRows || '<tr><td colspan="100" style="text-align:center;padding:16px;color:var(--text-muted);">No data rows found</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>`;
  }).join('');

  // Matched metrics count
  const totalMatched = (() => {
    if (!state.historical || !state.historical.metrics) return 0;
    return Object.values(state.historical.metrics).filter(v => v !== null).length;
  })();

  container.innerHTML = `
    <div class="card-elevated">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <h2 class="h2">Source Data</h2>
        <span class="caption">${sheetNames.length} sheets / ${totalMatched} metrics matched / ${units}</span>
      </div>
      <div class="raw-data-tabs" id="raw-data-tab-bar">
        ${tabButtons}
      </div>
      ${tabPanels}
    </div>
  `;

  // Wire up tab switching
  const tabBar = document.getElementById('raw-data-tab-bar');
  if (tabBar) {
    tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.raw-data-tab');
      if (!btn) return;
      const idx = btn.dataset.tabIndex;

      // Deactivate all tabs and panels
      container.querySelectorAll('.raw-data-tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.raw-data-panel').forEach(p => p.classList.remove('active'));

      // Activate clicked tab and matching panel
      btn.classList.add('active');
      const panel = container.querySelector(`.raw-data-panel[data-panel-index="${idx}"]`);
      if (panel) panel.classList.add('active');
    });
  }

  console.log('[DCF] Raw data tabs rendered:', sheetNames.length, 'sheets');
}
