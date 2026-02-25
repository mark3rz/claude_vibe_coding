"""Data models for the DCF Tutor application."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Raw import models
# ---------------------------------------------------------------------------

@dataclass
class RawSheet:
    """One sheet from the uploaded workbook."""
    name: str
    raw_table: pd.DataFrame          # exact cell values as imported
    statement_df: pd.DataFrame | None = None  # row_label + int-year columns
    years: list[int] = field(default_factory=list)
    year_metadata: dict[int, dict[str, Any]] = field(default_factory=dict)
    sheet_type: str = "unknown"       # income, balance, cashflow, multiples, performance, segment, pension, capstruct_summary, capstruct_detail
    magnitude: str = "thousands"      # thousands, millions, billions
    company_name: str = ""
    currency: str = "USD"


@dataclass
class RawWorkbook:
    """All sheets from one upload."""
    sheets: dict[str, RawSheet] = field(default_factory=dict)
    file_name: str = ""


# ---------------------------------------------------------------------------
# Mapping models
# ---------------------------------------------------------------------------

@dataclass
class MappingEntry:
    """One canonical-field → raw-label mapping."""
    canonical: str
    raw_match: str
    confidence: float
    user_override: str | None = None

    @property
    def resolved(self) -> str:
        return self.user_override if self.user_override else self.raw_match


@dataclass
class MappingReport:
    """Mapping results per section."""
    income_statement: list[MappingEntry] = field(default_factory=list)
    balance_sheet: list[MappingEntry] = field(default_factory=list)
    cash_flow: list[MappingEntry] = field(default_factory=list)
    multiples: list[MappingEntry] = field(default_factory=list)


@dataclass
class StandardizedFinancials:
    """Canonical DataFrames for the four sections."""
    income_statement: pd.DataFrame = field(default_factory=pd.DataFrame)
    balance_sheet: pd.DataFrame = field(default_factory=pd.DataFrame)
    cash_flow: pd.DataFrame = field(default_factory=pd.DataFrame)
    multiples: pd.DataFrame = field(default_factory=pd.DataFrame)


# ---------------------------------------------------------------------------
# DCF models
# ---------------------------------------------------------------------------

@dataclass
class DCFAssumptions:
    """Year-by-year assumptions for a single scenario."""
    scenario_name: str = "Base"
    forecast_years: int = 5

    # Driver assumptions — dict keyed by forecast year (int)
    revenue_growth: dict[int, float] = field(default_factory=dict)      # e.g. 0.10 = 10%
    ebitda_margin: dict[int, float] = field(default_factory=dict)       # e.g. 0.25 = 25%
    da_pct_revenue: dict[int, float] = field(default_factory=dict)      # D&A as % of revenue
    tax_rate: dict[int, float] = field(default_factory=dict)            # e.g. 0.21 = 21%
    capex_pct_revenue: dict[int, float] = field(default_factory=dict)   # CapEx as % of revenue
    nwc_pct_revenue: dict[int, float] = field(default_factory=dict)     # Change in NWC as % of revenue

    # WACC — direct or computed
    wacc: float = 0.10
    use_computed_wacc: bool = False
    risk_free_rate: float = 0.04
    equity_risk_premium: float = 0.06
    beta: float = 1.0
    size_premium: float = 0.0
    country_risk_premium: float = 0.0
    pre_tax_cost_of_debt: float = 0.05
    target_debt_weight: float = 0.30       # Wd
    wacc_tax_rate: float = 0.21

    # Terminal value
    terminal_method: str = "perpetuity"    # "perpetuity" or "exit_multiple"
    terminal_growth_rate: float = 0.025
    exit_multiple: float = 10.0

    # Equity bridge
    net_debt: float = 0.0
    preferred_equity: float = 0.0
    minority_interest: float = 0.0
    other_adjustments: float = 0.0
    diluted_shares: float = 1.0            # in millions

    @property
    def target_equity_weight(self) -> float:
        return 1.0 - self.target_debt_weight

    @property
    def cost_of_equity(self) -> float:
        return (self.risk_free_rate
                + self.beta * self.equity_risk_premium
                + self.size_premium
                + self.country_risk_premium)

    @property
    def after_tax_cost_of_debt(self) -> float:
        return self.pre_tax_cost_of_debt * (1.0 - self.wacc_tax_rate)

    @property
    def computed_wacc(self) -> float:
        we = self.target_equity_weight
        wd = self.target_debt_weight
        return we * self.cost_of_equity + wd * self.after_tax_cost_of_debt

    @property
    def effective_wacc(self) -> float:
        return self.computed_wacc if self.use_computed_wacc else self.wacc


@dataclass
class DCFResult:
    """Output of a DCF run."""
    scenario_name: str = "Base"

    # Forecast table (DataFrame: rows = line items, columns = years)
    forecast_table: pd.DataFrame = field(default_factory=pd.DataFrame)

    # Present values
    pv_fcff: dict[int, float] = field(default_factory=dict)   # year → PV of FCFF
    terminal_value: float = 0.0
    pv_terminal: float = 0.0
    pv_explicit: float = 0.0

    # Valuation
    enterprise_value: float = 0.0
    equity_value: float = 0.0
    price_per_share: float = 0.0

    # Bridge components
    net_debt: float = 0.0
    preferred_equity: float = 0.0
    minority_interest: float = 0.0
    other_adjustments: float = 0.0

    # Metadata
    wacc_used: float = 0.0
    terminal_method: str = "perpetuity"
    terminal_growth_rate: float = 0.0
    exit_multiple_used: float = 0.0
