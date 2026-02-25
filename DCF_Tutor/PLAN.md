# DCF Tutor — Implementation Plan

## Overview
Streamlit app that imports S&P Capital IQ Excel exports, maps data to canonical financials via fuzzy matching, runs an unlevered FCFF DCF, and provides interactive Plotly charts, sensitivity, tornado, and educational explanations.

## Actual Excel Format (Adobe CIQ Export — 9 sheets)

### Common header (sheets 0-2, 4, 6-7):
- Rows 1-12: metadata (company name row 2, currency row 10, magnitude row 11)
- Row 11: `Magnitude: Thousands (K)` — all monetary values in USD thousands
- Row 13: year headers `"2011 FY"` ... `"2025 FY"` (cols B-P, 15 years)
- Row 15: period-end dates (datetime objects)
- Rows 20-21+: financial data (ints for $ values, floats for EPS/ratios)
- String `'NA'` = missing, `'NM'` = not meaningful
- Indented labels (8 spaces) = subtotals

### Sheets:
| # | Name | Key data |
|---|------|----------|
| 0 | Income Statement | Revenue through NI, EPS, EBITDA, SBC |
| 1 | Balance Sheet | Assets/Liabilities/Equity, Total Debt, Net Debt |
| 2 | Cash Flow | CFO, CapEx, Levered/Unlevered FCF |
| 3 | Multiples | Different structure: 5 date cols (2022-2026), Avg/High/Low/Close rows per multiple, TEV/Rev, TEV/EBITDA, P/E, P/B etc. |
| 4 | Performance Analysis | Profitability %, Turnover, Liquidity, Solvency, Growth rates, CAGRs |
| 5 | Segment Analysis | Revenue/GP by business segment and geography |
| 6 | Pension Details | Small — pension obligations |
| 7 | Capital Structure Summary | Debt breakdown, credit ratios, debt maturity schedule |
| 8 | Capital Structure Details | Point-in-time debt instrument table (not time series) |

### Special cases:
- Multiples sheet: only 12 cols, 5 date columns, grouped 4 rows per metric (Avg/High/Low/Close)
- Capital Structure Details: flat table, not time series
- Shares outstanding in actual units (not thousands)
- Per share items in actual dollars
- Percentages as decimals (e.g., 89.615 = 89.615%)

## File Structure
```
DCF_Tutor/
├── app.py
├── requirements.txt
├── src/
│   ├── __init__.py
│   ├── models.py
│   ├── utils.py
│   ├── importer.py
│   ├── mapping.py
│   ├── dcf.py
│   ├── charts.py
│   └── explain.py
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_parsing.py
    └── test_dcf.py
```

## Build Order

### Step 1: models.py + utils.py
- Dataclasses: RawSheet, RawWorkbook, MappingEntry, MappingReport, StandardizedFinancials, DCFAssumptions, DCFResult
- Helpers: clean_number (commas, parens, NA, NM, currency), normalize_label, fuzzy_match (rapidfuzz w/ difflib fallback), fmt_number, fmt_pct, extract_year, detect_estimate

### Step 2: importer.py
- parse_workbook(file) → RawWorkbook
- Skip metadata rows 1-12, detect header row by scanning for year patterns
- Extract years from `"YYYY FY"` format via regex
- Detect magnitude from row 11 text (Thousands/Millions/Billions)
- Handle `'NA'`, `'NM'` → NaN
- Strip leading quotes and whitespace from labels
- Classify sheet type by name keywords (income, balance, cash flow, multiples, performance, segment, pension, capital structure)
- Build statement_df: row_label column + integer year columns
- Special handling for Multiples sheet (different column structure, date-based headers)
- Special handling for Capital Structure Details (flat table, not time series)

### Step 3: mapping.py
- Canonical field dictionaries with aliases for IS, BS, CF, Multiples
- Fuzzy match raw row labels → canonical fields
- Confidence scoring with 0.80 threshold
- build_standardized() returns StandardizedFinancials + MappingReport + exit_multiple_suggestion
- Extract exit multiple from Multiples sheet TEV/EBITDA Close value

### Step 4: dcf.py
- DCFAssumptions: year-by-year dicts for all drivers, 3 scenarios
- Driver-based forecast: Revenue → EBITDA → D&A → EBIT → Taxes → NOPAT → Capex → ΔNWC → FCFF
- Mid-year discounting: PV = FCFF / (1+WACC)^(t-0.5)
- Terminal value: perpetuity growth AND exit multiple
- Equity bridge: EV - NetDebt - Preferred - Minority + Other
- WACC: direct or computed (CAPM for Re)
- Sensitivity grid runner (WACC vs g)
- Tornado runner (8 variables with +/- shocks)
- build_default_assumptions() from historical data

### Step 5: charts.py (Plotly, Stripe-inspired light theme)
- EV-to-Equity waterfall
- Revenue/EBITDA/FCFF trend bars (historical + forecast)
- Margin trend line
- PV of cash flows by year
- Explicit vs Terminal contribution
- Tornado chart (horizontal bars)
- Sensitivity heatmap
- Reinvestment vs growth chart

### Step 6: explain.py
- ~20 entries: definition, LaTeX formula, directionality
- Covers all DCF assumptions + key output concepts

### Step 7: app.py (5 Streamlit pages via sidebar)
1. Import — file uploader, show detected sheets/years/magnitude
2. Raw Data — tab per sheet, raw tables (all 9 sheets)
3. Mapping — confidence table per section, override dropdowns, rebuild button
4. Standardized Financials — IS/BS/CF/Multiples tabs, formatted numbers
5. DCF Valuation — summary cards, assumptions (basic+advanced), charts, sensitivity, tornado, WACC explanation, Explain panel

### Step 8: tests/
- Synthetic fixture generator (multi-sheet workbook mimicking CIQ format)
- test_clean_number, test_year_parsing, test_estimate_detection
- test_dcf_math, test_terminal_value, test_ev_to_equity_bridge

### Step 9: requirements.txt
streamlit, pandas, openpyxl, plotly, rapidfuzz, pytest

## Key Design Decisions
- Detect magnitude from Excel row 11 metadata (K/M/B) and normalize to millions internally
- Dataclasses over pydantic (simpler)
- Session state for all persistent data
- Year-by-year assumptions as dicts keyed by forecast year
- Mid-year discounting convention
- Net Debt from Balance Sheet for equity bridge (Total Debt - Cash)
- Stripe-inspired light theme: bg #F6F9FC, accent #635BFF, Inter font
- All 9 sheets displayed in Raw Data; only IS/BS/CF/Multiples used for canonical mapping
- Performance Analysis data available for cross-referencing margins/growth but not mapped to canonical
