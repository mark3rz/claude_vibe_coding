"""DCF Tutor — Streamlit application entry point."""

from __future__ import annotations

import copy
import streamlit as st
import pandas as pd
import numpy as np

from src.models import (
    RawWorkbook, StandardizedFinancials, MappingReport,
    DCFAssumptions, DCFResult,
)
from src.importer import parse_workbook
from src.mapping import build_standardized
from src.dcf import build_default_assumptions, run_dcf, run_sensitivity, run_tornado
from src.charts import (
    ev_to_equity_waterfall, revenue_ebitda_fcff_bars, margin_trend,
    pv_cash_flows_chart, explicit_vs_terminal_pie, tornado_chart,
    sensitivity_heatmap, reinvestment_vs_growth,
)
from src.explain import get_explanation, all_keys, EXPLANATIONS
from src.utils import fmt_number, fmt_pct, fmt_multiple, magnitude_multiplier

# ═══════════════════════════════════════════════════════════════════════════
# Page config & global CSS
# ═══════════════════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="DCF Tutor",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

STRIPE_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

:root {
    --bg: #F6F9FC;
    --card-bg: #FFFFFF;
    --border: #E6EBF1;
    --accent: #635BFF;
    --accent-light: #7C72FF;
    --dark: #0A2540;
    --text-secondary: #475467;
    --positive: #16B364;
    --negative: #D92D20;
}

.stApp {
    background-color: var(--bg);
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Cards */
.metric-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.metric-card h3 {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
}
.metric-card .value {
    color: var(--dark);
    font-size: 28px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* Section headers */
.section-header {
    color: var(--dark);
    font-size: 20px;
    font-weight: 600;
    margin: 32px 0 16px 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
}

/* Explain panel */
.explain-box {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-top: 12px;
}
.explain-box h4 {
    color: var(--accent);
    font-size: 16px;
    margin-bottom: 8px;
}
.explain-box p {
    color: var(--dark);
    font-size: 14px;
    line-height: 1.6;
}
.explain-direction {
    color: var(--text-secondary);
    font-size: 13px;
    font-style: italic;
    margin-top: 8px;
}

/* Tables */
[data-testid="stDataFrame"] table {
    font-variant-numeric: tabular-nums;
}

/* Sidebar */
[data-testid="stSidebar"] {
    background-color: var(--card-bg);
    border-right: 1px solid var(--border);
}

/* Tabs */
.stTabs [data-baseweb="tab-list"] {
    gap: 4px;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 6px 6px 0 0;
    font-weight: 500;
}
</style>
"""

st.markdown(STRIPE_CSS, unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════
# Session state init
# ═══════════════════════════════════════════════════════════════════════════

def _init_state():
    defaults = {
        "raw_workbook": None,
        "standardized": None,
        "mapping_report": None,
        "exit_multiple_suggestion": None,
        "include_estimates": False,
        "confidence_threshold": 0.80,
        "assumptions": {},
        "results": {},
        "active_scenario": "Base",
        "magnitude": "thousands",
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

_init_state()

# ═══════════════════════════════════════════════════════════════════════════
# Sidebar navigation
# ═══════════════════════════════════════════════════════════════════════════

PAGES = ["Import", "Raw Data", "Mapping", "Standardized Financials", "DCF Valuation"]

with st.sidebar:
    st.markdown("### 📊 DCF Tutor")
    st.markdown("<p style='color: #475467; font-size: 13px;'>Capital IQ DCF Learning Tool</p>", unsafe_allow_html=True)
    st.divider()
    page = st.radio("Navigation", PAGES, label_visibility="collapsed")
    st.divider()

    if st.session_state.raw_workbook:
        wb: RawWorkbook = st.session_state.raw_workbook
        first_sheet = next(iter(wb.sheets.values()), None)
        if first_sheet:
            st.caption(f"**Company:** {first_sheet.company_name or 'N/A'}")
            st.caption(f"**Currency:** {first_sheet.currency}")
            st.caption(f"**Magnitude:** {first_sheet.magnitude.title()}")
            st.caption(f"**Sheets:** {len(wb.sheets)}")


# ═══════════════════════════════════════════════════════════════════════════
# Page: Import
# ═══════════════════════════════════════════════════════════════════════════

if page == "Import":
    st.markdown("# Import Data")
    st.markdown("Upload a Capital IQ Excel export (.xlsx) to begin.")

    uploaded = st.file_uploader("Upload .xlsx file", type=["xlsx"], key="file_uploader")

    if uploaded is not None:
        with st.spinner("Parsing workbook..."):
            wb = parse_workbook(uploaded)
            st.session_state.raw_workbook = wb

            # Detect magnitude from first sheet
            first_sheet = next(iter(wb.sheets.values()), None)
            if first_sheet:
                st.session_state.magnitude = first_sheet.magnitude

            # Build standardized
            std, report, exit_mult = build_standardized(
                wb,
                include_estimates=st.session_state.include_estimates,
                threshold=st.session_state.confidence_threshold,
            )
            st.session_state.standardized = std
            st.session_state.mapping_report = report
            st.session_state.exit_multiple_suggestion = exit_mult

        st.success(f"Imported **{wb.file_name}** — {len(wb.sheets)} sheets detected.")

        # Show detected sheets
        cols = st.columns(3)
        for i, (name, sheet) in enumerate(wb.sheets.items()):
            with cols[i % 3]:
                st.markdown(f"""
                <div class="metric-card">
                    <h3>{sheet.sheet_type.replace('_', ' ').title()}</h3>
                    <div class="value" style="font-size: 16px;">{name}</div>
                    <p style="color: var(--text-secondary); font-size: 12px; margin-top: 4px;">
                        {len(sheet.years)} years · {sheet.magnitude.title()}
                    </p>
                </div>
                """, unsafe_allow_html=True)

    elif st.session_state.raw_workbook:
        st.info("Workbook already loaded. Upload a new file to replace.")


# ═══════════════════════════════════════════════════════════════════════════
# Page: Raw Data
# ═══════════════════════════════════════════════════════════════════════════

elif page == "Raw Data":
    st.markdown("# Raw Data")
    st.markdown("Exact cell values from each sheet in the uploaded workbook.")

    wb = st.session_state.raw_workbook
    if wb is None:
        st.warning("Please upload a file on the Import page first.")
    else:
        tabs = st.tabs(list(wb.sheets.keys()))
        for tab, (name, sheet) in zip(tabs, wb.sheets.items()):
            with tab:
                st.caption(f"Type: {sheet.sheet_type} · Years: {sheet.years} · Magnitude: {sheet.magnitude}")
                st.dataframe(sheet.raw_table, use_container_width=True, height=500)


# ═══════════════════════════════════════════════════════════════════════════
# Page: Mapping
# ═══════════════════════════════════════════════════════════════════════════

elif page == "Mapping":
    st.markdown("# Mapping Review")
    st.markdown("Review how raw labels were matched to canonical fields. Override any incorrect matches.")

    wb = st.session_state.raw_workbook
    report: MappingReport | None = st.session_state.mapping_report

    if wb is None or report is None:
        st.warning("Please upload a file on the Import page first.")
    else:
        col1, col2 = st.columns([1, 3])
        with col1:
            new_threshold = st.slider(
                "Confidence Threshold",
                0.50, 1.0, st.session_state.confidence_threshold, 0.05,
            )
            include_est = st.checkbox("Include estimates as history", st.session_state.include_estimates)

            if st.button("Rebuild Mapping", type="primary"):
                st.session_state.confidence_threshold = new_threshold
                st.session_state.include_estimates = include_est
                std, report, exit_mult = build_standardized(
                    wb, include_estimates=include_est, threshold=new_threshold,
                )
                st.session_state.standardized = std
                st.session_state.mapping_report = report
                st.session_state.exit_multiple_suggestion = exit_mult
                st.rerun()

        with col2:
            sections = [
                ("Income Statement", report.income_statement),
                ("Balance Sheet", report.balance_sheet),
                ("Cash Flow", report.cash_flow),
                ("Multiples", report.multiples),
            ]
            for section_name, entries in sections:
                st.markdown(f'<div class="section-header">{section_name}</div>', unsafe_allow_html=True)
                if not entries:
                    st.caption("No sheet found for this section.")
                    continue

                for entry in entries:
                    c1, c2, c3 = st.columns([2, 3, 1])
                    with c1:
                        st.text(entry.canonical)
                    with c2:
                        st.text(entry.raw_match or "— not matched —")
                    with c3:
                        color = "green" if entry.confidence >= st.session_state.confidence_threshold else "orange" if entry.confidence >= 0.5 else "red"
                        st.markdown(f":{color}[{entry.confidence:.0%}]")


# ═══════════════════════════════════════════════════════════════════════════
# Page: Standardized Financials
# ═══════════════════════════════════════════════════════════════════════════

elif page == "Standardized Financials":
    st.markdown("# Standardized Financials")
    st.markdown("Canonical financial statements mapped from the raw data. Values in stated magnitude.")

    std: StandardizedFinancials | None = st.session_state.standardized
    if std is None:
        st.warning("Please upload a file on the Import page first.")
    else:
        tab_names = ["Income Statement", "Balance Sheet", "Cash Flow", "Multiples"]
        tabs = st.tabs(tab_names)
        dfs = [std.income_statement, std.balance_sheet, std.cash_flow, std.multiples]

        for tab, name, df in zip(tabs, tab_names, dfs):
            with tab:
                if df.empty:
                    st.caption(f"No data available for {name}.")
                else:
                    st.dataframe(
                        df.style.format("{:,.1f}", na_rep="—"),
                        use_container_width=True,
                        height=400,
                    )


# ═══════════════════════════════════════════════════════════════════════════
# Page: DCF Valuation
# ═══════════════════════════════════════════════════════════════════════════

elif page == "DCF Valuation":
    std: StandardizedFinancials | None = st.session_state.standardized
    if std is None:
        st.warning("Please upload a file on the Import page first.")
    else:
        st.markdown("# DCF Valuation")

        mag = st.session_state.magnitude
        mult = magnitude_multiplier(mag)

        # ─── Sidebar controls ──────────────────────────────────────────
        with st.sidebar:
            st.divider()
            scenario = st.selectbox("Scenario", ["Base", "Upside", "Downside"])
            st.session_state.active_scenario = scenario

            forecast_years = st.selectbox("Forecast Horizon", [5, 10], index=0)
            terminal_method = st.selectbox("Terminal Value Method", ["perpetuity", "exit_multiple"])

        # ─── Build / retrieve assumptions ──────────────────────────────
        if scenario not in st.session_state.assumptions:
            # Determine last actual year
            last_actual = None
            if not std.income_statement.empty:
                all_years = [int(c) for c in std.income_statement.columns]
                if all_years:
                    last_actual = max(all_years)

            a = build_default_assumptions(
                std,
                forecast_years=forecast_years,
                last_actual_year=last_actual,
                magnitude=mag,
                exit_multiple_suggestion=st.session_state.exit_multiple_suggestion,
            )
            a.scenario_name = scenario
            a.terminal_method = terminal_method
            st.session_state.assumptions[scenario] = a

        assumptions: DCFAssumptions = st.session_state.assumptions[scenario]
        assumptions.forecast_years = forecast_years
        assumptions.terminal_method = terminal_method

        # Ensure year dicts match forecast horizon
        if not std.income_statement.empty:
            all_years = [int(c) for c in std.income_statement.columns]
            base_year = max(all_years) if all_years else 2024
        else:
            base_year = 2024
        fyears = list(range(base_year + 1, base_year + 1 + forecast_years))

        for attr in ["revenue_growth", "ebitda_margin", "da_pct_revenue", "tax_rate", "capex_pct_revenue", "nwc_pct_revenue"]:
            d = getattr(assumptions, attr)
            for y in fyears:
                if y not in d:
                    # Use the first existing value or a default
                    existing = list(d.values())
                    d[y] = existing[0] if existing else 0.05

        # ─── Assumptions panel ─────────────────────────────────────────
        st.markdown('<div class="section-header">Assumptions</div>', unsafe_allow_html=True)

        # Copy buttons
        bcol1, bcol2 = st.columns(2)
        with bcol1:
            if st.button("Set all years to Year 1 value"):
                for attr in ["revenue_growth", "ebitda_margin", "da_pct_revenue", "tax_rate", "capex_pct_revenue", "nwc_pct_revenue"]:
                    d = getattr(assumptions, attr)
                    if fyears and fyears[0] in d:
                        first_val = d[fyears[0]]
                        for y in fyears:
                            d[y] = first_val
                st.rerun()
        with bcol2:
            if st.button("Copy Base → Upside & Downside"):
                if "Base" in st.session_state.assumptions:
                    for s in ["Upside", "Downside"]:
                        st.session_state.assumptions[s] = copy.deepcopy(st.session_state.assumptions["Base"])
                        st.session_state.assumptions[s].scenario_name = s
                st.rerun()

        # Basic assumptions — year-by-year editors
        with st.expander("Basic Assumptions", expanded=True):
            driver_labels = {
                "revenue_growth": ("Revenue Growth", True),
                "ebitda_margin": ("EBITDA Margin", True),
                "tax_rate": ("Tax Rate", True),
            }
            for attr, (label, is_pct) in driver_labels.items():
                st.markdown(f"**{label}**")
                cols = st.columns(len(fyears))
                d = getattr(assumptions, attr)
                for i, y in enumerate(fyears):
                    with cols[i]:
                        val = d.get(y, 0.0)
                        new_val = st.number_input(
                            f"{y}", value=val * 100 if is_pct else val,
                            step=0.5, format="%.1f",
                            key=f"{scenario}_{attr}_{y}",
                            label_visibility="visible",
                        )
                        d[y] = new_val / 100 if is_pct else new_val

        # Advanced assumptions
        with st.expander("Advanced Assumptions"):
            adv_labels = {
                "da_pct_revenue": ("D&A % of Revenue", True),
                "capex_pct_revenue": ("Capex % of Revenue", True),
                "nwc_pct_revenue": ("NWC % of Revenue", True),
            }
            for attr, (label, is_pct) in adv_labels.items():
                st.markdown(f"**{label}**")
                cols = st.columns(len(fyears))
                d = getattr(assumptions, attr)
                for i, y in enumerate(fyears):
                    with cols[i]:
                        val = d.get(y, 0.0)
                        new_val = st.number_input(
                            f"{y}", value=val * 100, step=0.5, format="%.2f",
                            key=f"{scenario}_{attr}_{y}_adv",
                        )
                        d[y] = new_val / 100

            st.markdown("**Equity Bridge**")
            c1, c2, c3, c4 = st.columns(4)
            with c1:
                assumptions.net_debt = st.number_input("Net Debt ($mm)", value=assumptions.net_debt, step=100.0, key=f"{scenario}_net_debt")
            with c2:
                assumptions.preferred_equity = st.number_input("Preferred Equity ($mm)", value=assumptions.preferred_equity, step=10.0, key=f"{scenario}_pref")
            with c3:
                assumptions.minority_interest = st.number_input("Minority Interest ($mm)", value=assumptions.minority_interest, step=10.0, key=f"{scenario}_minority")
            with c4:
                assumptions.other_adjustments = st.number_input("Other Adj. ($mm)", value=assumptions.other_adjustments, step=10.0, key=f"{scenario}_other")

            st.markdown("**Shares & Terminal**")
            c1, c2, c3 = st.columns(3)
            with c1:
                assumptions.diluted_shares = st.number_input("Diluted Shares (mm)", value=assumptions.diluted_shares, step=1.0, min_value=0.001, key=f"{scenario}_shares")
            with c2:
                assumptions.terminal_growth_rate = st.number_input("Terminal Growth (%)", value=assumptions.terminal_growth_rate * 100, step=0.25, key=f"{scenario}_tg") / 100
            with c3:
                assumptions.exit_multiple = st.number_input("Exit Multiple (EV/EBITDA)", value=assumptions.exit_multiple, step=0.5, key=f"{scenario}_exit_mult")
                if st.session_state.exit_multiple_suggestion:
                    st.caption(f"Suggested: {st.session_state.exit_multiple_suggestion:.1f}x from Multiples tab")

        # ─── WACC ──────────────────────────────────────────────────────
        with st.expander("WACC Configuration"):
            assumptions.use_computed_wacc = st.checkbox("Compute WACC from components", value=assumptions.use_computed_wacc, key=f"{scenario}_use_comp_wacc")

            if assumptions.use_computed_wacc:
                c1, c2, c3 = st.columns(3)
                with c1:
                    st.markdown("**Cost of Equity (CAPM)**")
                    assumptions.risk_free_rate = st.number_input("Risk-Free Rate (%)", value=assumptions.risk_free_rate * 100, step=0.25, key=f"{scenario}_rf") / 100
                    assumptions.beta = st.number_input("Beta", value=assumptions.beta, step=0.1, key=f"{scenario}_beta")
                    assumptions.equity_risk_premium = st.number_input("Equity Risk Premium (%)", value=assumptions.equity_risk_premium * 100, step=0.25, key=f"{scenario}_erp") / 100
                    assumptions.size_premium = st.number_input("Size Premium (%)", value=assumptions.size_premium * 100, step=0.25, key=f"{scenario}_sp") / 100
                    assumptions.country_risk_premium = st.number_input("Country Risk Premium (%)", value=assumptions.country_risk_premium * 100, step=0.25, key=f"{scenario}_crp") / 100
                with c2:
                    st.markdown("**Cost of Debt**")
                    assumptions.pre_tax_cost_of_debt = st.number_input("Pre-tax Cost of Debt (%)", value=assumptions.pre_tax_cost_of_debt * 100, step=0.25, key=f"{scenario}_rd") / 100
                    assumptions.wacc_tax_rate = st.number_input("Tax Rate for WACC (%)", value=assumptions.wacc_tax_rate * 100, step=1.0, key=f"{scenario}_wacc_tax") / 100
                with c3:
                    st.markdown("**Capital Structure**")
                    assumptions.target_debt_weight = st.number_input("Debt Weight (%)", value=assumptions.target_debt_weight * 100, step=1.0, key=f"{scenario}_wd") / 100

                # Show computed values
                st.divider()
                cc1, cc2, cc3 = st.columns(3)
                with cc1:
                    st.metric("Cost of Equity", fmt_pct(assumptions.cost_of_equity))
                with cc2:
                    st.metric("After-tax Cost of Debt", fmt_pct(assumptions.after_tax_cost_of_debt))
                with cc3:
                    st.metric("Computed WACC", fmt_pct(assumptions.computed_wacc))

                st.latex(r"R_e = R_f + \beta \cdot ERP + \text{Size Premium} + \text{CRP}")
                st.latex(r"WACC = w_e \cdot R_e + w_d \cdot R_d \cdot (1 - \tau)")
            else:
                assumptions.wacc = st.number_input("WACC (%)", value=assumptions.wacc * 100, step=0.25, key=f"{scenario}_wacc_direct") / 100

        # ─── Run DCF ───────────────────────────────────────────────────
        result = run_dcf(std, assumptions, mag)
        st.session_state.results[scenario] = result

        # ─── Summary cards ─────────────────────────────────────────────
        st.markdown('<div class="section-header">Valuation Summary</div>', unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.markdown(f"""
            <div class="metric-card">
                <h3>Enterprise Value</h3>
                <div class="value">{fmt_number(result.enterprise_value, 1, "$", "M")}</div>
            </div>
            """, unsafe_allow_html=True)
        with c2:
            st.markdown(f"""
            <div class="metric-card">
                <h3>Equity Value</h3>
                <div class="value">{fmt_number(result.equity_value, 1, "$", "M")}</div>
            </div>
            """, unsafe_allow_html=True)
        with c3:
            st.markdown(f"""
            <div class="metric-card">
                <h3>Price per Share</h3>
                <div class="value">{fmt_number(result.price_per_share, 2, "$")}</div>
            </div>
            """, unsafe_allow_html=True)
        with c4:
            ev_pct = (result.pv_terminal / result.enterprise_value * 100) if result.enterprise_value != 0 else 0
            st.markdown(f"""
            <div class="metric-card">
                <h3>Terminal % of EV</h3>
                <div class="value">{ev_pct:.1f}%</div>
            </div>
            """, unsafe_allow_html=True)

        # ─── DCF Forecast Table ────────────────────────────────────────
        st.markdown('<div class="section-header">Forecast Table</div>', unsafe_allow_html=True)
        ft = result.forecast_table
        if not ft.empty:
            # Format display
            pct_rows = {"Revenue Growth", "EBITDA Margin"}
            display_df = ft.copy()
            for row_name in display_df.index:
                for col in display_df.columns:
                    val = display_df.at[row_name, col]
                    if row_name in pct_rows:
                        display_df.at[row_name, col] = f"{val * 100:.1f}%" if pd.notna(val) else "—"
                    else:
                        display_df.at[row_name, col] = fmt_number(val, 1, "$", "M") if pd.notna(val) else "—"
            st.dataframe(display_df, use_container_width=True)

        # ─── PV Breakdown ─────────────────────────────────────────────
        st.markdown('<div class="section-header">Present Value Breakdown</div>', unsafe_allow_html=True)
        pv_data = {
            "Year": list(result.pv_fcff.keys()) + ["Terminal"],
            "PV ($mm)": [fmt_number(v, 1, "$", "M") for v in result.pv_fcff.values()] + [fmt_number(result.pv_terminal, 1, "$", "M")],
        }
        st.dataframe(pd.DataFrame(pv_data), use_container_width=True, hide_index=True)

        # ─── Charts ───────────────────────────────────────────────────
        st.markdown('<div class="section-header">Charts</div>', unsafe_allow_html=True)

        chart_col1, chart_col2 = st.columns(2)
        with chart_col1:
            st.plotly_chart(ev_to_equity_waterfall(result), use_container_width=True)
        with chart_col2:
            st.plotly_chart(explicit_vs_terminal_pie(result), use_container_width=True)

        chart_col3, chart_col4 = st.columns(2)
        with chart_col3:
            st.plotly_chart(revenue_ebitda_fcff_bars(std.income_statement, result, mag), use_container_width=True)
        with chart_col4:
            st.plotly_chart(margin_trend(std.income_statement, result, mag), use_container_width=True)

        chart_col5, chart_col6 = st.columns(2)
        with chart_col5:
            st.plotly_chart(pv_cash_flows_chart(result), use_container_width=True)
        with chart_col6:
            st.plotly_chart(reinvestment_vs_growth(result), use_container_width=True)

        # ─── Sensitivity Table ─────────────────────────────────────────
        st.markdown('<div class="section-header">Sensitivity Analysis</div>', unsafe_allow_html=True)
        st.caption("WACC vs Terminal Growth Rate — Implied Price per Share")

        sens_df = run_sensitivity(std, assumptions, magnitude=mag)
        st.plotly_chart(sensitivity_heatmap(sens_df, result.price_per_share), use_container_width=True)

        # Also show as table
        with st.expander("Sensitivity Table (raw)"):
            fmt_sens = sens_df.copy()
            fmt_sens.index = [f"{w:.2%}" for w in fmt_sens.index]
            fmt_sens.columns = [f"{g:.2%}" for g in fmt_sens.columns]
            st.dataframe(fmt_sens.style.format("${:,.2f}"), use_container_width=True)

        # ─── Tornado Chart ─────────────────────────────────────────────
        st.markdown('<div class="section-header">Tornado Analysis</div>', unsafe_allow_html=True)
        tornado_data = run_tornado(std, assumptions, magnitude=mag)
        st.plotly_chart(tornado_chart(tornado_data), use_container_width=True)

        # Tornado table
        with st.expander("Tornado Table (raw)"):
            t_rows = []
            for d in tornado_data:
                t_rows.append({
                    "Variable": d["label"],
                    "Low PPS": fmt_number(d["low"], 2, "$"),
                    "Base PPS": fmt_number(d["base"], 2, "$"),
                    "High PPS": fmt_number(d["high"], 2, "$"),
                    "Spread": fmt_number(d["high"] - d["low"], 2, "$"),
                })
            st.dataframe(pd.DataFrame(t_rows), use_container_width=True, hide_index=True)

        # ─── WACC Explanation ──────────────────────────────────────────
        st.markdown('<div class="section-header">WACC Methodology</div>', unsafe_allow_html=True)

        wacc_exp = get_explanation("wacc")
        coe_exp = get_explanation("cost_of_equity")
        if wacc_exp:
            st.markdown(f"**{wacc_exp.title}**")
            st.markdown(wacc_exp.definition)
            st.latex(wacc_exp.formula)

        if coe_exp:
            st.markdown(f"**{coe_exp.title}**")
            st.markdown(coe_exp.definition)
            st.latex(coe_exp.formula)

        st.markdown("**Current WACC Breakdown**")
        wacc_c1, wacc_c2, wacc_c3 = st.columns(3)
        with wacc_c1:
            st.metric("Effective WACC", fmt_pct(assumptions.effective_wacc))
        with wacc_c2:
            st.metric("Cost of Equity", fmt_pct(assumptions.cost_of_equity))
        with wacc_c3:
            st.metric("After-tax Cost of Debt", fmt_pct(assumptions.after_tax_cost_of_debt))

        # ─── Explain Panel ─────────────────────────────────────────────
        st.markdown('<div class="section-header">Explain This</div>', unsafe_allow_html=True)
        st.caption("Select a concept to learn about its definition, formula, and impact on valuation.")

        explain_key = st.selectbox(
            "Select concept",
            all_keys(),
            format_func=lambda k: EXPLANATIONS[k].title,
        )

        exp = get_explanation(explain_key)
        if exp:
            st.markdown(f"""
            <div class="explain-box">
                <h4>{exp.title}</h4>
                <p>{exp.definition}</p>
            </div>
            """, unsafe_allow_html=True)
            st.latex(exp.formula)
            st.markdown(f'<p class="explain-direction">{exp.directionality}</p>', unsafe_allow_html=True)
