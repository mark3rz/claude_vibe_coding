/* ============================================================
   TASK 02 — Excel Ingestion (Updated for Capital IQ / FactSet format)
   Handles two file layouts:
     A) Simple format — company in A1, units in A2, years in row 4
     B) Capital IQ/FactSet format — metadata rows 1-14, year headers
        in row 15 as "12 months\nNov-29-2019" multiline strings,
        data from row 17 onward.
   Detects format automatically. Stores into state.rawData.
   NO number parsing. NO calculations. NO layout changes.
============================================================ */

// --- Sheet keyword groups for detection ---
const SHEET_KEYWORDS = {
  income:   ['income', 'p&l', 'profit', 'loss', 'pnl', 'revenue', 'is'],
  balance:  ['balance', 'bs', 'assets', 'liabilities', 'equity'],
  cashflow: ['cash flow', 'cashflow', 'cf', 'cash'],
  summary:  ['summary', 'overview', 'model', 'dcf', 'valuation', 'key stats'],
};

// --- Detect sheet type from name ---
function detectSheetType(name) {
  const lower = name.toLowerCase();
  for (const [type, keywords] of Object.entries(SHEET_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return type;
  }
  return 'unknown';
}

// --- Extract a 4-digit year from various string formats ---
// Handles: "2021", "FY2021", "2021A", "2021E",
//          "12 months\nNov-29-2019", "Restated\n12 months\nNov-30-2018",
//          Excel date serial numbers
function extractYear(cellValue, dateMode) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;

  // Numeric — could be Excel date serial
  if (typeof cellValue === 'number') {
    // Plausible year integer
    if (cellValue >= 1990 && cellValue <= 2100) return String(Math.round(cellValue));
    // Excel date serial (> 40000 ≈ year 2009+)
    if (cellValue > 40000 && typeof XLSX !== 'undefined') {
      try {
        const d = XLSX.SSF.parse_date_code(cellValue);
        if (d && d.y >= 1990) return String(d.y);
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  const s = String(cellValue).trim();

  // Direct 4-digit year or labelled year: "FY2021", "2021A", "2021E"
  const direct = s.match(/\b(19|20)\d{2}\b/);
  if (direct) return direct[0];

  // Multiline format: "12 months\nNov-29-2019" or "Restated\n12 months\nNov-30-2018"
  const monthYear = s.match(/[A-Za-z]{3}[-\s](\d{1,2})[-\s]((?:19|20)\d{2})/);
  if (monthYear) return monthYear[2];

  // "Nov-2019" shorthand
  const shortYear = s.match(/((?:19|20)\d{2})/);
  if (shortYear) return shortYear[1];

  return null;
}

// --- Scan a worksheet to find the year-header row ---
// Looks for the first row where ≥3 consecutive columns contain 4-digit years.
// Returns { headerRow (0-based), dataStartRow (0-based), yearCols [] }
function findYearHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const maxScanRow = Math.min(range.e.r, 30); // only scan first 30 rows

  for (let r = 0; r <= maxScanRow; r++) {
    const yearsFound = [];
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const yr = extractYear(cell.v);
      if (yr) yearsFound.push({ col: c, year: yr });
    }
    if (yearsFound.length >= 3) {
      // Found year header row
      // Data starts 1-2 rows after — skip any "Currency" row
      let dataStartRow = r + 1;
      const nextAddr = XLSX.utils.encode_cell({ r: dataStartRow, c: 0 });
      const nextCell = ws[nextAddr];
      if (nextCell && String(nextCell.v).toLowerCase().includes('currency')) {
        dataStartRow += 1; // skip currency row
      }
      return { headerRow: r, dataStartRow, yearCols: yearsFound };
    }
  }
  return null;
}

// --- Extract company name from Capital IQ title row ---
// Title typically looks like: "Adobe Inc. (NasdaqGS:ADBE) > Financials > Income Statement"
function extractCompanyFromTitle(titleStr) {
  if (!titleStr) return null;
  const s = String(titleStr).trim();
  // Grab everything before " (" or " >"
  const match = s.match(/^([^(>]+)/);
  return match ? match[1].trim() : s;
}

// --- Extract units from metadata rows (rows 5-14) ---
function extractUnitsFromMeta(ws, maxRow = 14) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = 0; r <= Math.min(range.e.r, maxRow); r++) {
    const aAddr = XLSX.utils.encode_cell({ r, c: 0 });
    const aCell = ws[aAddr];
    if (!aCell) continue;
    const label = String(aCell.v).toLowerCase();
    if (label.includes('decimal') || label.includes('unit') || label.includes('in million') || label.includes('in thousand') || label.includes('in billion')) {
      // Try to get the value from column B
      const bAddr = XLSX.utils.encode_cell({ r, c: 1 });
      const bCell = ws[bAddr];
      if (bCell) return String(bCell.v).trim();
      return label.includes('million') ? '$M' : label.includes('thousand') ? '$K' : label.includes('billion') ? '$B' : null;
    }
    // Look for "Decimals" row value
    if (label.includes('decimals')) {
      const bAddr = XLSX.utils.encode_cell({ r, c: 1 });
      const bCell = ws[bAddr];
      if (bCell) {
        const dec = String(bCell.v).toLowerCase();
        if (dec.includes('million') || dec === '-6') return '$M';
        if (dec.includes('thousand') || dec === '-3') return '$K';
        if (dec.includes('billion') || dec === '-9') return '$B';
      }
    }
  }
  return null;
}

// --- Extract metadata + rows from a worksheet ---
function extractSheetMeta(ws) {
  const meta = {
    company:       null,
    units:         null,
    years:         [],
    headerRow:     null,
    dataStartRow:  null,
  };

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // ── Try to find year header row (works for both simple and Capital IQ) ──
  const found = findYearHeaderRow(ws);

  if (found) {
    meta.headerRow    = found.headerRow;
    meta.dataStartRow = found.dataStartRow;
    meta.years        = found.yearCols.map(yc => yc.year);

    // Company name: scan rows above headerRow for a title string
    for (let r = 0; r < found.headerRow; r++) {
      const aAddr = XLSX.utils.encode_cell({ r, c: 0 });
      const aCell = ws[aAddr];
      if (aCell && String(aCell.v).trim().length > 5) {
        const candidate = extractCompanyFromTitle(aCell.v);
        if (candidate && candidate.length > 2) {
          meta.company = candidate;
          break;
        }
      }
    }

    // Units: scan metadata rows
    meta.units = extractUnitsFromMeta(ws, found.headerRow);

  } else {
    // Fallback: simple format — A1=company, A2=units, row 4=years
    const a1 = ws['A1'];
    if (a1) meta.company = String(a1.v).trim();
    const a2 = ws['A2'];
    if (a2) meta.units = String(a2.v).trim();

    meta.headerRow    = 3; // row 4 (0-based)
    meta.dataStartRow = 4; // row 5

    for (let col = 1; col <= range.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: 3, c: col });
      const cell = ws[addr];
      if (!cell || cell.v === undefined || cell.v === '') break;
      const yr = extractYear(cell.v);
      if (yr) meta.years.push(yr);
    }
  }

  return meta;
}

// --- Extract all data rows from a worksheet ---
// Starts from meta.dataStartRow, column 0 = label, cols 1+ = values
function extractRows(ws, dataStartRow) {
  const startRow = dataStartRow != null ? dataStartRow : 4;
  const range    = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const rows     = [];

  for (let r = startRow; r <= range.e.r; r++) {
    const row = [];
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      row.push(cell ? cell.v : null);
    }
    if (row.every(v => v === null || v === '')) continue;
    rows.push(row);
  }

  return rows;
}

// --- Main ingestion function ---
function ingestFile(file) {
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });

      const detected   = {};
      const sheetNames = workbook.SheetNames;

      console.log('[DCF] Sheets found:', sheetNames);

      for (const name of sheetNames) {
        const type = detectSheetType(name);
        const ws   = workbook.Sheets[name];
        const meta = extractSheetMeta(ws);
        const rows = extractRows(ws, meta.dataStartRow);

        detected[name] = { type, meta, rows };

        console.log(`[DCF] Sheet "${name}" → type: ${type}, years: [${meta.years.join(', ')}], rows: ${rows.length}, dataStartRow: ${meta.dataStartRow}`);
      }

      // Pick best company name — prefer income or cash flow sheet title
      let companyName = null;
      let units       = null;
      let years       = [];

      const preferred = ['Income Statement', 'Cash Flow', 'Balance Sheet'];
      const orderedNames = [
        ...preferred.filter(n => sheetNames.includes(n)),
        ...sheetNames.filter(n => !preferred.includes(n)),
      ];

      for (const name of orderedNames) {
        const s = detected[name];
        if (!companyName && s.meta.company) companyName = s.meta.company;
        if (!units       && s.meta.units)   units       = s.meta.units;
        if (s.meta.years.length > years.length) years   = s.meta.years;
      }

      // Warn if still no years
      if (years.length === 0) {
        state.warnings.push('Could not detect fiscal year headers. Please check the file format.');
      }

      const types = Object.values(detected).map(s => s.type);
      if (!types.includes('income') && !types.includes('cashflow') && !types.includes('summary')) {
        state.warnings.push('No income statement, cash flow, or summary sheet detected. Check sheet names.');
      }

      state.rawData = {
        fileName:    file.name,
        sheetNames,
        sheets:      detected,
        companyName: companyName || file.name.replace(/\.[^.]+$/, ''),
        units:       units || '$M',
        years,
      };

      console.log('[DCF] state.rawData populated:', {
        company: state.rawData.companyName,
        units:   state.rawData.units,
        years:   state.rawData.years,
        sheets:  Object.keys(detected).map(n => `${n} (${detected[n].type})`),
      });

      // Task 03: parse numbers + fuzzy-match line items
      if (typeof normalizeData === 'function') normalizeData();

      // Task 04: compute derived historical metrics
      if (typeof computeDerivedMetrics === 'function') computeDerivedMetrics();

      // Task 05: build default DCF inputs then run the engine
      if (typeof buildDefaultInputs === 'function') buildDefaultInputs(state.historical);
      if (typeof calculateDCF === 'function') calculateDCF(state.inputs, state.historical);

      // Task 06: render executive summary + animate header metrics
      if (typeof renderExecutiveMetrics === 'function') renderExecutiveMetrics();

      // Task 07: render assumptions panel
      if (typeof renderAssumptionsPanel === 'function') renderAssumptionsPanel();

      // Task 08: render DCF projection table
      if (typeof renderDCFTable === 'function') renderDCFTable();

      // Task 09: render core charts
      if (typeof renderCharts === 'function') renderCharts();

      // Task 10A: render sensitivity tables
      if (typeof renderSensitivity === 'function') renderSensitivity();

      // Task 10B: render scenario builder + tornado
      if (typeof renderScenario === 'function') renderScenario();

      // Task 11A: attach tooltips to rendered content
      if (typeof initTooltips === 'function') initTooltips();

      // Task 11B: render searchable glossary panel
      if (typeof renderGlossary === 'function') renderGlossary();

      // Update header brand
      const elName = document.getElementById('company-name');
      const elMeta = document.getElementById('company-meta');
      if (elName) elName.textContent = state.rawData.companyName;
      if (elMeta) elMeta.textContent = [state.rawData.units, state.rawData.years.join(' · ')].filter(Boolean).join(' · ');

      renderWarnings();
      hideUploadScreen();

    } catch (err) {
      state.warnings.push(`File read error: ${err.message}`);
      console.error('[DCF] Ingestion error:', err);
      renderWarnings();
      hideUploadScreen();
    }
  };

  reader.onerror = function () {
    state.warnings.push('Could not read file. Please try again with a valid Excel or CSV file.');
    renderWarnings();
  };

  reader.readAsArrayBuffer(file);
}
