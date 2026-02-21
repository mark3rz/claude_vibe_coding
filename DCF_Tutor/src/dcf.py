"""Unlevered FCFF DCF engine with scenarios, sensitivity, and tornado analysis."""

from __future__ import annotations

import copy
from typing import Any

import numpy as np
import pandas as pd

from .models import DCFAssumptions, DCFResult, StandardizedFinancials
from .utils import magnitude_multiplier


# ---------------------------------------------------------------------------
# Build default assumptions from historical data
# ---------------------------------------------------------------------------

def build_default_assumptions(
    std: StandardizedFinancials,
    forecast_years: int = 5,
    last_actual_year: int | None = None,
    magnitude: str = "thousands",
    exit_multiple_suggestion: float | None = None,
) -> DCFAssumptions:
    """Create sensible default assumptions from standardized historical data."""
    a = DCFAssumptions(forecast_years=forecast_years)
    mult = magnitude_multiplier(magnitude)
    is_df = std.income_statement
    bs_df = std.balance_sheet
    cf_df = std.cash_flow

    # Determine base year
    if last_actual_year:
        base_year = last_actual_year
    elif not is_df.empty:
        base_year = max(int(c) for c in is_df.columns)
    else:
        base_year = 2024

    forecast_start = base_year + 1
    fyears = list(range(forecast_start, forecast_start + forecast_years))

    # Revenue growth — average of last 3 years, clamped
    rev_growth = 0.05
    if not is_df.empty and "Revenue" in is_df.index:
        revs = is_df.loc["Revenue"].dropna()
        if len(revs) >= 2:
            growths = revs.pct_change().dropna().tail(3)
            if len(growths) > 0:
                avg_g = float(growths.mean())
                rev_growth = max(-0.10, min(avg_g, 0.30))

    # EBITDA margin — last year
    ebitda_margin = 0.20
    if not is_df.empty and "Revenue" in is_df.index and "EBITDA" in is_df.index:
        revs = is_df.loc["Revenue"].dropna()
        ebs = is_df.loc["EBITDA"].dropna()
        common = revs.index.intersection(ebs.index)
        if len(common) > 0:
            last = common[-1]
            r, e = revs[last], ebs[last]
            if r and r != 0:
                ebitda_margin = max(0.0, min(float(e / r), 0.60))

    # D&A % of revenue
    da_pct = 0.03
    if not is_df.empty and "Revenue" in is_df.index and "DA" in is_df.index:
        revs = is_df.loc["Revenue"].dropna()
        das = is_df.loc["DA"].dropna()
        common = revs.index.intersection(das.index)
        if len(common) > 0:
            last = common[-1]
            r, d = revs[last], das[last]
            if r and r != 0:
                da_pct = max(0.0, min(abs(float(d / r)), 0.15))

    # Tax rate
    tax_rate = 0.21
    if not is_df.empty and "Pretax Income" in is_df.index and "Taxes" in is_df.index:
        pti = is_df.loc["Pretax Income"].dropna()
        taxes = is_df.loc["Taxes"].dropna()
        common = pti.index.intersection(taxes.index)
        if len(common) > 0:
            last = common[-1]
            p, t = pti[last], taxes[last]
            if p and p != 0:
                implied = abs(float(t / p))
                tax_rate = max(0.0, min(implied, 0.40))

    # Capex % of revenue
    capex_pct = 0.05
    if not cf_df.empty and "Capex" in cf_df.index and not is_df.empty and "Revenue" in is_df.index:
        revs = is_df.loc["Revenue"].dropna()
        capexes = cf_df.loc["Capex"].dropna()
        common = revs.index.intersection(capexes.index)
        if len(common) > 0:
            last = common[-1]
            r, c = revs[last], capexes[last]
            if r and r != 0:
                capex_pct = max(0.0, min(abs(float(c / r)), 0.20))

    # NWC % of revenue
    nwc_pct = 0.02

    # Populate year-by-year dicts
    for y in fyears:
        a.revenue_growth[y] = rev_growth
        a.ebitda_margin[y] = ebitda_margin
        a.da_pct_revenue[y] = da_pct
        a.tax_rate[y] = tax_rate
        a.capex_pct_revenue[y] = capex_pct
        a.nwc_pct_revenue[y] = nwc_pct

    # Net Debt from balance sheet
    if not bs_df.empty and "Net Debt" in bs_df.index:
        nd_row = bs_df.loc["Net Debt"].dropna()
        if len(nd_row) > 0:
            a.net_debt = float(nd_row.iloc[-1]) * mult  # convert to millions
    elif not bs_df.empty and "Total Debt" in bs_df.index and "Cash" in bs_df.index:
        debt_row = bs_df.loc["Total Debt"].dropna()
        cash_row = bs_df.loc["Cash"].dropna()
        common = debt_row.index.intersection(cash_row.index)
        if len(common) > 0:
            last = common[-1]
            a.net_debt = (float(debt_row[last]) - float(cash_row[last])) * mult

    # Diluted shares
    if not is_df.empty and "Diluted Shares" in is_df.index:
        shares_row = is_df.loc["Diluted Shares"].dropna()
        if len(shares_row) > 0:
            # Shares in CIQ are actual units; convert to millions
            a.diluted_shares = float(shares_row.iloc[-1]) / 1_000_000.0
            if a.diluted_shares < 0.001:
                # Likely already in millions
                a.diluted_shares = float(shares_row.iloc[-1])

    # Exit multiple
    if exit_multiple_suggestion:
        a.exit_multiple = exit_multiple_suggestion

    return a


# ---------------------------------------------------------------------------
# Run DCF
# ---------------------------------------------------------------------------

def run_dcf(
    std: StandardizedFinancials,
    assumptions: DCFAssumptions,
    magnitude: str = "thousands",
) -> DCFResult:
    """Execute the DCF and return full results."""
    mult = magnitude_multiplier(magnitude)
    is_df = std.income_statement
    a = assumptions
    wacc = a.effective_wacc

    # Determine base-year revenue
    base_revenue = 0.0
    if not is_df.empty and "Revenue" in is_df.index:
        revs = is_df.loc["Revenue"].dropna()
        if len(revs) > 0:
            base_revenue = float(revs.iloc[-1]) * mult  # convert to millions

    if base_revenue == 0:
        base_revenue = 1000.0  # fallback

    fyears = sorted(a.revenue_growth.keys())
    if not fyears:
        return DCFResult(scenario_name=a.scenario_name)

    # Build forecast table
    rows: dict[str, dict[int, float]] = {
        "Revenue": {},
        "Revenue Growth": {},
        "EBITDA": {},
        "EBITDA Margin": {},
        "D&A": {},
        "EBIT": {},
        "Taxes": {},
        "NOPAT": {},
        "Capex": {},
        "Change in NWC": {},
        "FCFF": {},
    }

    prev_revenue = base_revenue
    for y in fyears:
        g = a.revenue_growth.get(y, 0.05)
        revenue = prev_revenue * (1.0 + g)
        ebitda = revenue * a.ebitda_margin.get(y, 0.20)
        da = revenue * a.da_pct_revenue.get(y, 0.03)
        ebit = ebitda - da
        tax = max(0.0, ebit) * a.tax_rate.get(y, 0.21)
        nopat = ebit - tax
        capex = revenue * a.capex_pct_revenue.get(y, 0.05)
        dnwc = revenue * a.nwc_pct_revenue.get(y, 0.02)
        fcff = nopat + da - capex - dnwc

        rows["Revenue"][y] = revenue
        rows["Revenue Growth"][y] = g
        rows["EBITDA"][y] = ebitda
        rows["EBITDA Margin"][y] = a.ebitda_margin.get(y, 0.20)
        rows["D&A"][y] = da
        rows["EBIT"][y] = ebit
        rows["Taxes"][y] = tax
        rows["NOPAT"][y] = nopat
        rows["Capex"][y] = capex
        rows["Change in NWC"][y] = dnwc
        rows["FCFF"][y] = fcff

        prev_revenue = revenue

    forecast_table = pd.DataFrame(rows).T
    forecast_table.columns = fyears

    # Discount FCFF — mid-year convention
    pv_fcff: dict[int, float] = {}
    for i, y in enumerate(fyears):
        t = i + 0.5  # mid-year
        pv = rows["FCFF"][y] / ((1.0 + wacc) ** t)
        pv_fcff[y] = pv

    pv_explicit = sum(pv_fcff.values())

    # Terminal value
    last_year = fyears[-1]
    last_fcff = rows["FCFF"][last_year]
    n = len(fyears)  # number of explicit forecast years

    if a.terminal_method == "exit_multiple":
        last_ebitda = rows["EBITDA"][last_year]
        tv = last_ebitda * a.exit_multiple
    else:
        # Perpetuity growth
        fcff_next = last_fcff * (1.0 + a.terminal_growth_rate)
        tv = fcff_next / (wacc - a.terminal_growth_rate) if wacc > a.terminal_growth_rate else 0.0

    # Discount TV to present (end of last forecast year)
    pv_tv = tv / ((1.0 + wacc) ** n)

    # Enterprise and equity value
    ev = pv_explicit + pv_tv
    equity = ev - a.net_debt - a.preferred_equity - a.minority_interest + a.other_adjustments
    pps = equity / a.diluted_shares if a.diluted_shares > 0 else 0.0

    return DCFResult(
        scenario_name=a.scenario_name,
        forecast_table=forecast_table,
        pv_fcff=pv_fcff,
        terminal_value=tv,
        pv_terminal=pv_tv,
        pv_explicit=pv_explicit,
        enterprise_value=ev,
        equity_value=equity,
        price_per_share=pps,
        net_debt=a.net_debt,
        preferred_equity=a.preferred_equity,
        minority_interest=a.minority_interest,
        other_adjustments=a.other_adjustments,
        wacc_used=wacc,
        terminal_method=a.terminal_method,
        terminal_growth_rate=a.terminal_growth_rate,
        exit_multiple_used=a.exit_multiple if a.terminal_method == "exit_multiple" else 0.0,
    )


# ---------------------------------------------------------------------------
# Sensitivity grid
# ---------------------------------------------------------------------------

def run_sensitivity(
    std: StandardizedFinancials,
    base_assumptions: DCFAssumptions,
    wacc_range: list[float] | None = None,
    growth_range: list[float] | None = None,
    magnitude: str = "thousands",
) -> pd.DataFrame:
    """Run a WACC vs terminal growth sensitivity grid.

    Returns DataFrame where index = WACC values, columns = growth rates,
    values = implied price per share.
    """
    if wacc_range is None:
        w = base_assumptions.effective_wacc
        wacc_range = [w - 0.02, w - 0.01, w - 0.005, w, w + 0.005, w + 0.01, w + 0.02]
    if growth_range is None:
        g = base_assumptions.terminal_growth_rate
        growth_range = [g - 0.01, g - 0.005, g, g + 0.005, g + 0.01]

    grid: dict[float, dict[float, float]] = {}
    for w in wacc_range:
        grid[w] = {}
        for g in growth_range:
            a = copy.deepcopy(base_assumptions)
            a.wacc = w
            a.use_computed_wacc = False
            a.terminal_growth_rate = g
            result = run_dcf(std, a, magnitude)
            grid[w][g] = result.price_per_share

    df = pd.DataFrame(grid).T
    df.index.name = "WACC"
    df.columns.name = "Terminal Growth"
    return df


# ---------------------------------------------------------------------------
# Tornado analysis
# ---------------------------------------------------------------------------

_TORNADO_VARIABLES = [
    ("revenue_growth", "Revenue Growth", 0.02),
    ("ebitda_margin", "EBITDA Margin", 0.02),
    ("wacc", "WACC", 0.01),
    ("terminal_growth_rate", "Terminal Growth", 0.005),
    ("da_pct_revenue", "D&A % Revenue", 0.01),
    ("capex_pct_revenue", "Capex % Revenue", 0.01),
    ("nwc_pct_revenue", "NWC % Revenue", 0.01),
    ("tax_rate", "Tax Rate", 0.02),
]


def run_tornado(
    std: StandardizedFinancials,
    base_assumptions: DCFAssumptions,
    magnitude: str = "thousands",
) -> list[dict[str, Any]]:
    """Run tornado analysis — shock each variable +/- and return PPS impact.

    Returns list of dicts with keys:
        variable, label, base, low, high, low_value, high_value
    """
    base_result = run_dcf(std, base_assumptions, magnitude)
    base_pps = base_result.price_per_share

    results = []
    for attr, label, shock in _TORNADO_VARIABLES:
        a_low = copy.deepcopy(base_assumptions)
        a_high = copy.deepcopy(base_assumptions)

        if attr in ("wacc", "terminal_growth_rate"):
            # Scalar attributes
            base_val = getattr(base_assumptions, attr)
            setattr(a_low, attr, base_val - shock)
            setattr(a_high, attr, base_val + shock)
            if attr == "wacc":
                a_low.use_computed_wacc = False
                a_high.use_computed_wacc = False
        else:
            # Year-by-year dict attributes
            base_dict = getattr(base_assumptions, attr)
            low_dict = {y: v - shock for y, v in base_dict.items()}
            high_dict = {y: v + shock for y, v in base_dict.items()}
            setattr(a_low, attr, low_dict)
            setattr(a_high, attr, high_dict)

        r_low = run_dcf(std, a_low, magnitude)
        r_high = run_dcf(std, a_high, magnitude)

        results.append({
            "variable": attr,
            "label": label,
            "base": base_pps,
            "low": r_low.price_per_share,
            "high": r_high.price_per_share,
            "low_shock": -shock,
            "high_shock": shock,
        })

    # Sort by spread (descending)
    results.sort(key=lambda x: abs(x["high"] - x["low"]), reverse=True)
    return results
