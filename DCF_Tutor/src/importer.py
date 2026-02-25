"""Excel importer for Capital IQ exports."""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd

from .models import RawSheet, RawWorkbook
from .utils import clean_number, extract_year, detect_estimate, detect_magnitude

# ---------------------------------------------------------------------------
# Sheet type classification
# ---------------------------------------------------------------------------

_SHEET_CLASSIFIERS: list[tuple[str, list[str]]] = [
    ("income", ["income", "income statement", "p&l", "profit and loss"]),
    ("balance", ["balance", "balance sheet"]),
    ("cashflow", ["cash flow", "cashflow", "cash flows"]),
    ("multiples", ["multiple", "multiples", "valuation multiples"]),
    ("performance", ["performance", "performance analysis"]),
    ("segment", ["segment", "segment analysis"]),
    ("pension", ["pension"]),
    ("capstruct_summary", ["capital structure summary"]),
    ("capstruct_detail", ["capital structure detail"]),
]


def _classify_sheet(name: str) -> str:
    nl = name.lower().strip()
    for stype, keywords in _SHEET_CLASSIFIERS:
        for kw in keywords:
            if kw in nl:
                return stype
    return "unknown"


# ---------------------------------------------------------------------------
# Header / metadata detection
# ---------------------------------------------------------------------------

_YEAR_RE = re.compile(r"((?:19|20)\d{2})")


def _find_header_row(df: pd.DataFrame, max_scan: int = 20) -> int | None:
    """Scan rows for one containing >=3 year-like tokens."""
    for idx in range(min(max_scan, len(df))):
        row = df.iloc[idx]
        year_count = sum(1 for v in row if _YEAR_RE.search(str(v)))
        if year_count >= 3:
            return idx
    return None


def _extract_metadata(df: pd.DataFrame) -> dict[str, Any]:
    """Extract company name, currency, and magnitude from top metadata rows."""
    meta: dict[str, Any] = {"company_name": "", "currency": "USD", "magnitude": "thousands"}
    for idx in range(min(15, len(df))):
        row_text = " ".join(str(v) for v in df.iloc[idx] if v is not None and str(v).strip())
        rt = row_text.lower()
        # Company name is usually in the first few rows
        if idx <= 3 and row_text.strip() and "currency" not in rt and "magnitude" not in rt:
            if not meta["company_name"]:
                meta["company_name"] = row_text.strip()
        # Currency
        if "currency" in rt:
            if "usd" in rt:
                meta["currency"] = "USD"
            elif "eur" in rt:
                meta["currency"] = "EUR"
            elif "gbp" in rt:
                meta["currency"] = "GBP"
        # Magnitude
        if "magnitude" in rt or "thousand" in rt or "million" in rt or "billion" in rt:
            meta["magnitude"] = detect_magnitude(row_text)
    return meta


# ---------------------------------------------------------------------------
# Parse a single sheet
# ---------------------------------------------------------------------------

def _parse_sheet(name: str, df_raw: pd.DataFrame) -> RawSheet:
    """Parse one Excel sheet into a RawSheet."""
    sheet_type = _classify_sheet(name)
    meta = _extract_metadata(df_raw)

    # Find the header row
    header_idx = _find_header_row(df_raw)

    raw_table = df_raw.copy()

    if header_idx is None:
        # Could not find year headers — store raw only
        return RawSheet(
            name=name,
            raw_table=raw_table,
            statement_df=None,
            years=[],
            year_metadata={},
            sheet_type=sheet_type,
            magnitude=meta["magnitude"],
            company_name=meta["company_name"],
            currency=meta["currency"],
        )

    # Build statement_df
    header_row = df_raw.iloc[header_idx]

    # Identify year columns
    year_cols: dict[int, int] = {}  # col_idx → year
    year_meta: dict[int, dict[str, Any]] = {}
    for col_idx, val in enumerate(header_row):
        yr = extract_year(val)
        if yr is not None and yr not in year_cols.values():
            year_cols[col_idx] = yr
            year_meta[yr] = {
                "is_estimate": detect_estimate(val),
                "raw_header": str(val),
            }

    if not year_cols:
        return RawSheet(
            name=name,
            raw_table=raw_table,
            statement_df=None,
            years=[],
            year_metadata={},
            sheet_type=sheet_type,
            magnitude=meta["magnitude"],
            company_name=meta["company_name"],
            currency=meta["currency"],
        )

    years = sorted(year_cols.values())

    # Find the label column (first column with non-empty text below header)
    label_col = 0
    for col_idx in range(min(3, df_raw.shape[1])):
        non_empty = 0
        for row_idx in range(header_idx + 1, min(header_idx + 10, len(df_raw))):
            v = df_raw.iloc[row_idx, col_idx]
            if v is not None and str(v).strip():
                non_empty += 1
        if non_empty >= 2:
            label_col = col_idx
            break

    # Build the statement DataFrame
    data_rows = []
    for row_idx in range(header_idx + 1, len(df_raw)):
        label = df_raw.iloc[row_idx, label_col]
        if label is None or str(label).strip() == "":
            continue
        label_str = str(label).strip().strip("'\"")
        row_data = {"row_label": label_str}
        for col_idx, yr in year_cols.items():
            raw_val = df_raw.iloc[row_idx, col_idx]
            row_data[yr] = clean_number(raw_val)
        data_rows.append(row_data)

    if data_rows:
        stmt_df = pd.DataFrame(data_rows)
        stmt_df = stmt_df.set_index("row_label")
        # Sort columns
        int_cols = sorted([c for c in stmt_df.columns if isinstance(c, int)])
        stmt_df = stmt_df[int_cols]
    else:
        stmt_df = pd.DataFrame()

    return RawSheet(
        name=name,
        raw_table=raw_table,
        statement_df=stmt_df,
        years=years,
        year_metadata=year_meta,
        sheet_type=sheet_type,
        magnitude=meta["magnitude"],
        company_name=meta["company_name"],
        currency=meta["currency"],
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_workbook(file) -> RawWorkbook:
    """Parse an uploaded .xlsx file into a RawWorkbook.

    Args:
        file: file-like object or path to .xlsx
    """
    xls = pd.ExcelFile(file, engine="openpyxl")
    wb = RawWorkbook(file_name=getattr(file, "name", str(file)))

    for sheet_name in xls.sheet_names:
        df_raw = xls.parse(sheet_name, header=None)
        sheet = _parse_sheet(sheet_name, df_raw)
        wb.sheets[sheet_name] = sheet

    return wb
