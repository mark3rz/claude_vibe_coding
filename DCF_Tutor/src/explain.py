"""Educational explanation entries for DCF concepts."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExplainEntry:
    """One educational explanation."""
    key: str
    title: str
    definition: str
    formula: str           # LaTeX-style formula
    directionality: str    # e.g. "Higher → Lower valuation"


EXPLANATIONS: dict[str, ExplainEntry] = {}


def _add(key: str, title: str, definition: str, formula: str, directionality: str):
    EXPLANATIONS[key] = ExplainEntry(key=key, title=title, definition=definition, formula=formula, directionality=directionality)


# --- Assumptions ---

_add(
    "revenue_growth", "Revenue Growth Rate",
    "The year-over-year percentage increase in revenue. Reflects the company's top-line momentum, driven by pricing, volume, and new products.",
    r"\text{Revenue}_t = \text{Revenue}_{t-1} \times (1 + g_t)",
    "Higher growth → Higher revenue → Higher FCFF → Higher valuation",
)

_add(
    "ebitda_margin", "EBITDA Margin",
    "EBITDA as a percentage of revenue. Measures operating profitability before depreciation, amortization, interest, and taxes.",
    r"\text{EBITDA Margin} = \frac{\text{EBITDA}}{\text{Revenue}}",
    "Higher margin → More cash available → Higher valuation",
)

_add(
    "da_pct_revenue", "D&A % of Revenue",
    "Depreciation & amortization as a percentage of revenue. A non-cash charge that reduces EBIT but is added back in FCFF.",
    r"\text{D\&A}_t = \text{Revenue}_t \times \text{D\&A \%}",
    "Higher D&A → Lower EBIT and taxes, but added back in FCFF (partial offset)",
)

_add(
    "tax_rate", "Effective Tax Rate",
    "The percentage of pre-tax operating income paid in taxes. Applied to EBIT to calculate NOPAT.",
    r"\text{Taxes}_t = \max(0, \text{EBIT}_t) \times \tau",
    "Higher tax rate → Lower NOPAT → Lower FCFF → Lower valuation",
)

_add(
    "capex_pct_revenue", "Capex % of Revenue",
    "Capital expenditures as a percentage of revenue. Represents investment in long-term assets needed to sustain and grow operations.",
    r"\text{Capex}_t = \text{Revenue}_t \times \text{Capex \%}",
    "Higher capex → Lower FCFF → Lower valuation (but supports future growth)",
)

_add(
    "nwc_pct_revenue", "NWC % of Revenue",
    "Change in net working capital as a percentage of revenue. Captures cash tied up in receivables, inventory, and payables as the business grows.",
    r"\Delta\text{NWC}_t = \text{Revenue}_t \times \text{NWC \%}",
    "Higher NWC investment → Lower FCFF → Lower valuation",
)

# --- WACC Components ---

_add(
    "wacc", "WACC (Weighted Average Cost of Capital)",
    "The blended cost of financing from both equity and debt investors. Used as the discount rate for unlevered free cash flows.",
    r"\text{WACC} = w_e \cdot R_e + w_d \cdot R_d \cdot (1 - \tau)",
    "Higher WACC → More discounting → Lower present values → Lower valuation",
)

_add(
    "cost_of_equity", "Cost of Equity (CAPM)",
    "The return required by equity investors, estimated via the Capital Asset Pricing Model. Compensates for systematic risk.",
    r"R_e = R_f + \beta \cdot \text{ERP} + \text{Size Premium} + \text{CRP}",
    "Higher cost of equity → Higher WACC → Lower valuation",
)

_add(
    "risk_free_rate", "Risk-Free Rate",
    "The theoretical return on a zero-risk investment, typically proxied by long-term government bond yields (e.g., 10-year US Treasury).",
    r"R_f \approx \text{10Y Treasury Yield}",
    "Higher risk-free rate → Higher cost of equity → Higher WACC",
)

_add(
    "beta", "Beta",
    "A measure of a stock's sensitivity to market movements. Beta = 1 means the stock moves with the market; >1 means more volatile.",
    r"\beta = \frac{\text{Cov}(R_i, R_m)}{\text{Var}(R_m)}",
    "Higher beta → Higher cost of equity → Higher WACC → Lower valuation",
)

_add(
    "equity_risk_premium", "Equity Risk Premium (ERP)",
    "The excess return investors demand for holding equities over risk-free assets. Represents the market's risk appetite.",
    r"\text{ERP} = E[R_m] - R_f",
    "Higher ERP → Higher cost of equity → Lower valuation",
)

# --- Terminal Value ---

_add(
    "terminal_growth_rate", "Terminal Growth Rate",
    "The perpetual growth rate of free cash flows beyond the explicit forecast period. Typically set at or below long-term GDP growth.",
    r"\text{TV} = \frac{\text{FCFF}_{n+1}}{\text{WACC} - g}",
    "Higher terminal growth → Higher terminal value → Higher valuation (very sensitive!)",
)

_add(
    "exit_multiple", "Exit Multiple (EV/EBITDA)",
    "An alternative terminal value method using a market-based multiple applied to the final-year EBITDA.",
    r"\text{TV} = \text{EBITDA}_n \times \text{Exit Multiple}",
    "Higher exit multiple → Higher terminal value → Higher valuation",
)

_add(
    "terminal_value", "Terminal Value",
    "The estimated value of all cash flows beyond the explicit forecast period. Often represents 60-80% of total enterprise value.",
    r"\text{TV}_{\text{perp}} = \frac{\text{FCFF}_{n+1}}{WACC - g} \quad \text{or} \quad \text{TV}_{\text{exit}} = \text{EBITDA}_n \times M",
    "Terminal value is the single largest component — small changes have outsized impact",
)

# --- Output Concepts ---

_add(
    "fcff", "Free Cash Flow to the Firm (FCFF)",
    "Cash generated by operations available to all capital providers (debt and equity), after taxes and reinvestment.",
    r"\text{FCFF} = \text{NOPAT} + \text{D\&A} - \text{Capex} - \Delta\text{NWC}",
    "Higher FCFF → Higher enterprise value",
)

_add(
    "nopat", "NOPAT (Net Operating Profit After Tax)",
    "Operating profit after taxes but before interest. Represents the profit available if the firm had no debt.",
    r"\text{NOPAT} = \text{EBIT} \times (1 - \tau)",
    "Higher NOPAT → Higher FCFF → Higher valuation",
)

_add(
    "enterprise_value", "Enterprise Value (EV)",
    "The total value of the firm's operations, representing the present value of all expected future free cash flows. Includes both explicit-period and terminal value.",
    r"\text{EV} = \sum_{t=1}^{n} \frac{\text{FCFF}_t}{(1+\text{WACC})^{t-0.5}} + \frac{\text{TV}}{(1+\text{WACC})^n}",
    "EV = value of operations before adjusting for capital structure",
)

_add(
    "equity_value", "Equity Value",
    "The value attributable to common shareholders after subtracting claims from debt holders and other claimants.",
    r"\text{Equity} = \text{EV} - \text{Net Debt} - \text{Preferred} - \text{Minority} + \text{Other}",
    "Equity Value = Enterprise Value minus prior claims",
)

_add(
    "price_per_share", "Implied Price per Share",
    "Equity value divided by diluted shares outstanding. Represents the intrinsic value per share implied by the DCF model.",
    r"\text{PPS} = \frac{\text{Equity Value}}{\text{Diluted Shares}}",
    "Compare to current market price to assess upside/downside",
)

_add(
    "mid_year_convention", "Mid-Year Discounting Convention",
    "Assumes cash flows arrive at the midpoint of each year rather than year-end, resulting in slightly higher present values.",
    r"\text{PV}_t = \frac{\text{FCFF}_t}{(1 + \text{WACC})^{t - 0.5}}",
    "Mid-year convention → ~2-4% higher PV than year-end convention",
)


def get_explanation(key: str) -> ExplainEntry | None:
    """Look up an explanation by key."""
    return EXPLANATIONS.get(key)


def all_keys() -> list[str]:
    """Return all available explanation keys."""
    return list(EXPLANATIONS.keys())
