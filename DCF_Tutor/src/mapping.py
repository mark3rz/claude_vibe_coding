"""Canonical field mapping via fuzzy matching."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .models import (
    MappingEntry, MappingReport, RawWorkbook, StandardizedFinancials,
)
from .utils import fuzzy_match, normalize_label, clean_number

# ---------------------------------------------------------------------------
# Canonical field dictionaries — key = canonical name, value = list of aliases
# ---------------------------------------------------------------------------

INCOME_STATEMENT_FIELDS: dict[str, list[str]] = {
    "Revenue": ["revenue", "total revenue", "net revenue", "sales", "total sales", "net sales"],
    "COGS": ["cost of goods sold", "cogs", "cost of revenue", "cost of sales", "total cost of revenue"],
    "Gross Profit": ["gross profit", "gross income", "gross margin"],
    "SGA": ["selling general and administrative", "sga", "sg&a", "selling general & administrative", "total selling general and administrative"],
    "RD": ["research and development", "r&d", "rd", "research & development"],
    "EBITDA": ["ebitda", "ebitda incl stock compensation", "ebitda excl stock compensation"],
    "DA": ["depreciation and amortization", "d&a", "depreciation & amortization", "depreciation amortization", "total depreciation and amortization", "total depreciation & amortization"],
    "EBIT": ["ebit", "operating income", "operating profit", "income from operations", "total operating profit"],
    "Pretax Income": ["pretax income", "income before tax", "earnings before tax", "ebt", "income before taxes"],
    "Taxes": ["income tax", "tax expense", "provision for income taxes", "income tax expense", "taxes"],
    "Net Income": ["net income", "net earnings", "net income common", "net income to common", "net income common stockholders"],
    "SBC": ["stock based compensation", "stock-based compensation", "share based compensation", "sbc"],
    "EPS Diluted": ["eps diluted", "diluted eps", "earnings per share diluted"],
    "Diluted Shares": ["diluted shares", "diluted shares outstanding", "diluted weighted average shares", "weighted average diluted shares outstanding"],
}

BALANCE_SHEET_FIELDS: dict[str, list[str]] = {
    "Cash": ["cash and equivalents", "cash & equivalents", "cash and cash equivalents", "total cash and short term investments", "cash and short term investments"],
    "Current Assets": ["total current assets", "current assets"],
    "PP&E": ["property plant and equipment", "ppe", "pp&e", "net property plant and equipment", "property plant & equipment net"],
    "Total Assets": ["total assets"],
    "Current Liabilities": ["total current liabilities", "current liabilities"],
    "Total Debt": ["total debt", "total borrowings", "total debt outstanding"],
    "Net Debt": ["net debt", "net financial debt"],
    "Total Liabilities": ["total liabilities"],
    "Shareholders Equity": ["shareholders equity", "stockholders equity", "total stockholders equity", "total equity", "total shareholders equity", "common equity"],
}

CASH_FLOW_FIELDS: dict[str, list[str]] = {
    "CFO": ["cash from operations", "operating cash flow", "cash flow from operations", "net cash from operating activities", "cash from operating activities"],
    "Capex": ["capital expenditure", "capex", "capital expenditures", "purchases of property and equipment", "purchase of property plant and equipment"],
    "FCF": ["free cash flow", "levered free cash flow", "unlevered free cash flow", "fcf"],
    "Change in NWC": ["change in net working capital", "change in working capital", "changes in working capital"],
    "DA CF": ["depreciation and amortization", "d&a", "depreciation & amortization"],
}

MULTIPLES_FIELDS: dict[str, list[str]] = {
    "EV/Revenue": ["tev/total revenue", "ev/revenue", "tev/revenue", "enterprise value/revenue"],
    "EV/EBITDA": ["tev/ebitda", "ev/ebitda", "enterprise value/ebitda"],
    "P/E": ["p/e", "price/earnings", "price to earnings", "pe ratio"],
    "P/B": ["p/b", "price/book", "price to book"],
    "Market Cap": ["market capitalization", "market cap"],
    "Enterprise Value": ["total enterprise value", "enterprise value", "tev"],
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_sheet_by_type(wb: RawWorkbook, sheet_type: str) -> str | None:
    """Return the first sheet name matching a type."""
    for name, sheet in wb.sheets.items():
        if sheet.sheet_type == sheet_type:
            return name
    return None


def _map_fields(
    field_dict: dict[str, list[str]],
    raw_labels: list[str],
    threshold: float = 0.80,
) -> list[MappingEntry]:
    """Map canonical fields to raw labels via fuzzy matching."""
    entries: list[MappingEntry] = []
    for canonical, aliases in field_dict.items():
        best_raw = ""
        best_score = 0.0
        # Try each alias, keep the best overall match
        for alias in [canonical] + aliases:
            match, score = fuzzy_match(alias, raw_labels, threshold=0.50)
            if score > best_score:
                best_raw, best_score = match, score
        entries.append(MappingEntry(
            canonical=canonical,
            raw_match=best_raw,
            confidence=best_score,
        ))
    return entries


def _build_canonical_df(
    statement_df: pd.DataFrame,
    mappings: list[MappingEntry],
    years: list[int],
    include_estimates: bool,
    year_metadata: dict,
) -> pd.DataFrame:
    """Build a canonical DataFrame from mappings."""
    if statement_df is None or statement_df.empty:
        return pd.DataFrame()

    # Filter to actual years only unless including estimates
    use_years = []
    for y in years:
        meta = year_metadata.get(y, {})
        if include_estimates or not meta.get("is_estimate", False):
            use_years.append(y)

    available_cols = [y for y in use_years if y in statement_df.columns]

    rows: dict[str, list[float | None]] = {}
    for m in mappings:
        resolved = m.resolved
        if resolved and resolved in statement_df.index:
            vals = [statement_df.at[resolved, y] if y in statement_df.columns else None
                    for y in available_cols]
            rows[m.canonical] = vals
        else:
            rows[m.canonical] = [None] * len(available_cols)

    df = pd.DataFrame(rows, index=available_cols).T
    df.columns = available_cols
    df.index.name = "Line Item"
    return df


# ---------------------------------------------------------------------------
# Multiples sheet special handling
# ---------------------------------------------------------------------------

def _map_multiples(
    wb: RawWorkbook,
    threshold: float = 0.80,
) -> tuple[list[MappingEntry], pd.DataFrame, float | None]:
    """Map the multiples sheet. Returns (mappings, canonical_df, exit_multiple_suggestion)."""
    sheet_name = _find_sheet_by_type(wb, "multiples")
    if sheet_name is None:
        return [], pd.DataFrame(), None

    sheet = wb.sheets[sheet_name]
    stmt = sheet.statement_df
    if stmt is None or stmt.empty:
        return [], pd.DataFrame(), None

    raw_labels = list(stmt.index)
    mappings = _map_fields(MULTIPLES_FIELDS, raw_labels, threshold)

    # For multiples, build a simplified canonical df
    canonical_df = _build_canonical_df(stmt, mappings, sheet.years, True, sheet.year_metadata)

    # Try to extract exit multiple from EV/EBITDA
    exit_multiple: float | None = None
    ev_ebitda_entry = next((m for m in mappings if m.canonical == "EV/EBITDA"), None)
    if ev_ebitda_entry and ev_ebitda_entry.resolved and ev_ebitda_entry.resolved in stmt.index:
        # Get the most recent value
        row = stmt.loc[ev_ebitda_entry.resolved]
        for yr in sorted(sheet.years, reverse=True):
            if yr in row.index:
                val = row[yr]
                if val is not None and not (isinstance(val, float) and np.isnan(val)):
                    exit_multiple = float(val)
                    break

    return mappings, canonical_df, exit_multiple


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_standardized(
    wb: RawWorkbook,
    include_estimates: bool = False,
    threshold: float = 0.80,
) -> tuple[StandardizedFinancials, MappingReport, float | None]:
    """Build canonical financials from a parsed workbook.

    Returns:
        (StandardizedFinancials, MappingReport, exit_multiple_suggestion)
    """
    report = MappingReport()
    std = StandardizedFinancials()
    exit_multiple: float | None = None

    # Income Statement
    is_name = _find_sheet_by_type(wb, "income")
    if is_name:
        sheet = wb.sheets[is_name]
        if sheet.statement_df is not None and not sheet.statement_df.empty:
            raw_labels = list(sheet.statement_df.index)
            report.income_statement = _map_fields(INCOME_STATEMENT_FIELDS, raw_labels, threshold)
            std.income_statement = _build_canonical_df(
                sheet.statement_df, report.income_statement,
                sheet.years, include_estimates, sheet.year_metadata,
            )

    # Balance Sheet
    bs_name = _find_sheet_by_type(wb, "balance")
    if bs_name:
        sheet = wb.sheets[bs_name]
        if sheet.statement_df is not None and not sheet.statement_df.empty:
            raw_labels = list(sheet.statement_df.index)
            report.balance_sheet = _map_fields(BALANCE_SHEET_FIELDS, raw_labels, threshold)
            std.balance_sheet = _build_canonical_df(
                sheet.statement_df, report.balance_sheet,
                sheet.years, include_estimates, sheet.year_metadata,
            )

    # Cash Flow
    cf_name = _find_sheet_by_type(wb, "cashflow")
    if cf_name:
        sheet = wb.sheets[cf_name]
        if sheet.statement_df is not None and not sheet.statement_df.empty:
            raw_labels = list(sheet.statement_df.index)
            report.cash_flow = _map_fields(CASH_FLOW_FIELDS, raw_labels, threshold)
            std.cash_flow = _build_canonical_df(
                sheet.statement_df, report.cash_flow,
                sheet.years, include_estimates, sheet.year_metadata,
            )

    # Multiples
    mult_mappings, mult_df, exit_multiple = _map_multiples(wb, threshold)
    report.multiples = mult_mappings
    std.multiples = mult_df

    return std, report, exit_multiple
