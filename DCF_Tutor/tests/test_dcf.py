"""Tests for DCF math, terminal value, and equity bridge."""

from __future__ import annotations

import pytest
import math

from src.models import DCFAssumptions, StandardizedFinancials
from src.dcf import run_dcf, build_default_assumptions, run_sensitivity, run_tornado


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def simple_assumptions() -> DCFAssumptions:
    """Minimal assumptions for math verification."""
    a = DCFAssumptions(
        scenario_name="Test",
        forecast_years=3,
        wacc=0.10,
        terminal_growth_rate=0.02,
        terminal_method="perpetuity",
        net_debt=100.0,
        preferred_equity=0.0,
        minority_interest=0.0,
        other_adjustments=0.0,
        diluted_shares=10.0,
    )
    for y in [2025, 2026, 2027]:
        a.revenue_growth[y] = 0.10
        a.ebitda_margin[y] = 0.30
        a.da_pct_revenue[y] = 0.05
        a.tax_rate[y] = 0.25
        a.capex_pct_revenue[y] = 0.06
        a.nwc_pct_revenue[y] = 0.02
    return a


@pytest.fixture
def simple_std() -> StandardizedFinancials:
    """StandardizedFinancials with just revenue for the base year."""
    import pandas as pd
    is_df = pd.DataFrame(
        {"Revenue": [1000.0], "EBITDA": [300.0]},
        index=["Revenue", "EBITDA"],
    ).T
    # Make columns = years
    is_df = pd.DataFrame(
        {2024: [1000.0, 300.0]},
        index=["Revenue", "EBITDA"],
    )
    return StandardizedFinancials(income_statement=is_df)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDCFMath:
    def test_revenue_forecast(self, simple_std, simple_assumptions):
        """Revenue should compound at 10% growth."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        ft = result.forecast_table
        # Base revenue = 1000, 10% growth
        assert abs(ft.at["Revenue", 2025] - 1100.0) < 0.01
        assert abs(ft.at["Revenue", 2026] - 1210.0) < 0.01
        assert abs(ft.at["Revenue", 2027] - 1331.0) < 0.01

    def test_ebitda_margin(self, simple_std, simple_assumptions):
        """EBITDA = Revenue * 30%."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        ft = result.forecast_table
        assert abs(ft.at["EBITDA", 2025] - 330.0) < 0.01

    def test_fcff_formula(self, simple_std, simple_assumptions):
        """FCFF = NOPAT + D&A - Capex - dNWC."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        ft = result.forecast_table
        y = 2025
        nopat = ft.at["NOPAT", y]
        da = ft.at["D&A", y]
        capex = ft.at["Capex", y]
        dnwc = ft.at["Change in NWC", y]
        fcff_expected = nopat + da - capex - dnwc
        assert abs(ft.at["FCFF", y] - fcff_expected) < 0.01

    def test_mid_year_discounting(self, simple_std, simple_assumptions):
        """PV should use mid-year convention: PV = FCFF / (1+WACC)^0.5 for year 1."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        fcff_y1 = result.forecast_table.at["FCFF", 2025]
        expected_pv = fcff_y1 / ((1.10) ** 0.5)
        assert abs(result.pv_fcff[2025] - expected_pv) < 0.01

    def test_enterprise_value_positive(self, simple_std, simple_assumptions):
        """EV should be positive for positive cash flows."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        assert result.enterprise_value > 0

    def test_equity_bridge(self, simple_std, simple_assumptions):
        """Equity = EV - Net Debt."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        expected_equity = result.enterprise_value - 100.0  # net_debt = 100
        assert abs(result.equity_value - expected_equity) < 0.01

    def test_price_per_share(self, simple_std, simple_assumptions):
        """PPS = Equity / Shares."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        expected_pps = result.equity_value / 10.0
        assert abs(result.price_per_share - expected_pps) < 0.01


class TestTerminalValue:
    def test_perpetuity_growth(self, simple_std, simple_assumptions):
        """TV = FCFF_n+1 / (WACC - g)."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        last_fcff = result.forecast_table.at["FCFF", 2027]
        fcff_next = last_fcff * (1 + 0.02)
        expected_tv = fcff_next / (0.10 - 0.02)
        assert abs(result.terminal_value - expected_tv) < 0.01

    def test_exit_multiple(self, simple_std, simple_assumptions):
        """TV = EBITDA_n * Multiple."""
        simple_assumptions.terminal_method = "exit_multiple"
        simple_assumptions.exit_multiple = 12.0
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        last_ebitda = result.forecast_table.at["EBITDA", 2027]
        expected_tv = last_ebitda * 12.0
        assert abs(result.terminal_value - expected_tv) < 0.01

    def test_tv_discount(self, simple_std, simple_assumptions):
        """PV of TV should be TV / (1+WACC)^n."""
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        expected_pv_tv = result.terminal_value / ((1.10) ** 3)
        assert abs(result.pv_terminal - expected_pv_tv) < 0.1


class TestEquityBridge:
    def test_preferred_equity(self, simple_std, simple_assumptions):
        """Preferred equity should reduce equity value."""
        simple_assumptions.preferred_equity = 50.0
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        assert result.equity_value == pytest.approx(
            result.enterprise_value - 100.0 - 50.0, abs=0.01,
        )

    def test_minority_interest(self, simple_std, simple_assumptions):
        """Minority interest should reduce equity value."""
        simple_assumptions.minority_interest = 25.0
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        assert result.equity_value == pytest.approx(
            result.enterprise_value - 100.0 - 25.0, abs=0.01,
        )

    def test_other_adjustments(self, simple_std, simple_assumptions):
        """Other adjustments should increase equity value."""
        simple_assumptions.other_adjustments = 30.0
        result = run_dcf(simple_std, simple_assumptions, magnitude="millions")
        assert result.equity_value == pytest.approx(
            result.enterprise_value - 100.0 + 30.0, abs=0.01,
        )


class TestWACC:
    def test_computed_wacc(self):
        a = DCFAssumptions(
            risk_free_rate=0.04,
            beta=1.2,
            equity_risk_premium=0.06,
            size_premium=0.0,
            country_risk_premium=0.0,
            pre_tax_cost_of_debt=0.05,
            wacc_tax_rate=0.25,
            target_debt_weight=0.30,
        )
        # Re = 0.04 + 1.2*0.06 = 0.112
        # Rd_at = 0.05 * 0.75 = 0.0375
        # WACC = 0.70 * 0.112 + 0.30 * 0.0375 = 0.0784 + 0.01125 = 0.08965
        assert abs(a.computed_wacc - 0.08965) < 0.0001


class TestSensitivity:
    def test_grid_shape(self, simple_std, simple_assumptions):
        result = run_sensitivity(simple_std, simple_assumptions, magnitude="millions")
        assert result.shape[0] == 7  # default WACC range
        assert result.shape[1] == 5  # default growth range

    def test_higher_wacc_lower_price(self, simple_std, simple_assumptions):
        result = run_sensitivity(simple_std, simple_assumptions, magnitude="millions")
        # Higher WACC (later rows) should have lower PPS
        col = result.columns[2]  # middle growth column
        assert result.iloc[0, 2] > result.iloc[-1, 2]


class TestTornado:
    def test_tornado_count(self, simple_std, simple_assumptions):
        result = run_tornado(simple_std, simple_assumptions, magnitude="millions")
        assert len(result) == 8

    def test_tornado_sorted_by_spread(self, simple_std, simple_assumptions):
        result = run_tornado(simple_std, simple_assumptions, magnitude="millions")
        spreads = [abs(d["high"] - d["low"]) for d in result]
        assert spreads == sorted(spreads, reverse=True)


class TestBuildDefaultAssumptions:
    def test_from_standardized(self, standardized_data):
        std, _, exit_mult = standardized_data
        a = build_default_assumptions(std, forecast_years=5, magnitude="thousands", exit_multiple_suggestion=exit_mult)
        assert len(a.revenue_growth) == 5
        assert all(0 <= v <= 0.30 for v in a.revenue_growth.values())
