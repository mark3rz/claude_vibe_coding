"""Plotly charts with Stripe-inspired light theme."""

from __future__ import annotations

from typing import Any

import plotly.graph_objects as go
import pandas as pd

from .models import DCFResult
from .utils import fmt_number, fmt_pct

# ---------------------------------------------------------------------------
# Theme constants (Stripe-inspired)
# ---------------------------------------------------------------------------

BG_COLOR = "#F6F9FC"
CARD_BG = "#FFFFFF"
BORDER_COLOR = "#E6EBF1"
ACCENT = "#635BFF"
DARK_TEXT = "#0A2540"
LIGHT_TEXT = "#475467"
POSITIVE = "#16B364"
NEGATIVE = "#D92D20"
GRID_COLOR = "#E6EBF1"
HISTORICAL_COLOR = "#94A3B8"
FORECAST_COLOR = ACCENT
TERMINAL_COLOR = "#7C72FF"

_LAYOUT_DEFAULTS = dict(
    font=dict(family="Inter, system-ui, sans-serif", color=DARK_TEXT, size=13),
    paper_bgcolor=CARD_BG,
    plot_bgcolor=CARD_BG,
    margin=dict(l=60, r=30, t=50, b=50),
    xaxis=dict(
        gridcolor=GRID_COLOR, gridwidth=0.5,
        linecolor=BORDER_COLOR, linewidth=1,
        tickfont=dict(size=11, color=LIGHT_TEXT),
    ),
    yaxis=dict(
        gridcolor=GRID_COLOR, gridwidth=0.5,
        linecolor=BORDER_COLOR, linewidth=1,
        tickfont=dict(size=11, color=LIGHT_TEXT),
    ),
    legend=dict(
        bgcolor="rgba(0,0,0,0)", borderwidth=0,
        font=dict(size=11, color=LIGHT_TEXT),
    ),
)


def _apply_theme(fig: go.Figure) -> go.Figure:
    fig.update_layout(**_LAYOUT_DEFAULTS)
    return fig


# ---------------------------------------------------------------------------
# EV-to-Equity waterfall
# ---------------------------------------------------------------------------

def ev_to_equity_waterfall(result: DCFResult) -> go.Figure:
    """Waterfall chart showing EV → Equity bridge."""
    labels = [
        "PV Explicit",
        "PV Terminal",
        "Enterprise Value",
        "Net Debt",
        "Preferred Equity",
        "Minority Interest",
        "Other Adj.",
        "Equity Value",
    ]
    values = [
        result.pv_explicit,
        result.pv_terminal,
        0,  # total
        -result.net_debt,
        -result.preferred_equity,
        -result.minority_interest,
        result.other_adjustments,
        0,  # total
    ]
    measures = [
        "relative", "relative", "total",
        "relative", "relative", "relative", "relative",
        "total",
    ]

    fig = go.Figure(go.Waterfall(
        x=labels, y=values, measure=measures,
        connector=dict(line=dict(color=BORDER_COLOR, width=1)),
        increasing=dict(marker=dict(color=ACCENT)),
        decreasing=dict(marker=dict(color=NEGATIVE)),
        totals=dict(marker=dict(color=DARK_TEXT)),
        textposition="outside",
        text=[fmt_number(v, decimals=0, prefix="$", suffix="M") if v != 0 else "" for v in values],
    ))
    fig.update_layout(title="EV to Equity Bridge", showlegend=False)
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Revenue / EBITDA / FCFF bars (historical + forecast)
# ---------------------------------------------------------------------------

def revenue_ebitda_fcff_bars(
    historical_is: pd.DataFrame,
    result: DCFResult,
    magnitude: str = "thousands",
) -> go.Figure:
    """Grouped bars for Revenue, EBITDA, FCFF across historical + forecast."""
    from .utils import magnitude_multiplier
    mult = magnitude_multiplier(magnitude)

    fig = go.Figure()

    # Historical
    if not historical_is.empty and "Revenue" in historical_is.index:
        hist_years = [int(c) for c in historical_is.columns]
        rev_hist = [float(historical_is.at["Revenue", y]) * mult if pd.notna(historical_is.at["Revenue", y]) else 0 for y in hist_years]
        ebitda_hist = [float(historical_is.at["EBITDA", y]) * mult if "EBITDA" in historical_is.index and pd.notna(historical_is.at["EBITDA", y]) else 0 for y in hist_years]

        fig.add_trace(go.Bar(x=hist_years, y=rev_hist, name="Revenue (Hist)", marker_color=HISTORICAL_COLOR, opacity=0.7))
        fig.add_trace(go.Bar(x=hist_years, y=ebitda_hist, name="EBITDA (Hist)", marker_color="#B0BEC5", opacity=0.7))

    # Forecast
    ft = result.forecast_table
    if not ft.empty:
        fyears = [int(c) for c in ft.columns]
        fig.add_trace(go.Bar(x=fyears, y=[ft.at["Revenue", y] for y in fyears], name="Revenue (Fcst)", marker_color=ACCENT))
        fig.add_trace(go.Bar(x=fyears, y=[ft.at["EBITDA", y] for y in fyears], name="EBITDA (Fcst)", marker_color=TERMINAL_COLOR))
        fig.add_trace(go.Bar(x=fyears, y=[ft.at["FCFF", y] for y in fyears], name="FCFF (Fcst)", marker_color=POSITIVE))

    fig.update_layout(
        title="Revenue, EBITDA & FCFF",
        barmode="group",
        xaxis_title="Year",
        yaxis_title="USD (mm)",
    )
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Margin trend line
# ---------------------------------------------------------------------------

def margin_trend(
    historical_is: pd.DataFrame,
    result: DCFResult,
    magnitude: str = "thousands",
) -> go.Figure:
    """Line chart of EBITDA margin over time."""
    fig = go.Figure()

    # Historical margins
    if not historical_is.empty and "Revenue" in historical_is.index and "EBITDA" in historical_is.index:
        hist_years = [int(c) for c in historical_is.columns]
        margins = []
        for y in hist_years:
            r = historical_is.at["Revenue", y]
            e = historical_is.at["EBITDA", y]
            if pd.notna(r) and pd.notna(e) and r != 0:
                margins.append(float(e / r))
            else:
                margins.append(None)
        fig.add_trace(go.Scatter(
            x=hist_years, y=margins, name="Historical",
            mode="lines+markers",
            line=dict(color=HISTORICAL_COLOR, width=2),
            marker=dict(size=6),
        ))

    # Forecast margins
    ft = result.forecast_table
    if not ft.empty and "EBITDA Margin" in ft.index:
        fyears = [int(c) for c in ft.columns]
        fmargins = [ft.at["EBITDA Margin", y] for y in fyears]
        fig.add_trace(go.Scatter(
            x=fyears, y=fmargins, name="Forecast",
            mode="lines+markers",
            line=dict(color=ACCENT, width=2, dash="dash"),
            marker=dict(size=6),
        ))

    fig.update_layout(
        title="EBITDA Margin Trend",
        xaxis_title="Year",
        yaxis_title="Margin",
        yaxis_tickformat=".1%",
    )
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# PV of cash flows by year
# ---------------------------------------------------------------------------

def pv_cash_flows_chart(result: DCFResult) -> go.Figure:
    """Bar chart of PV of FCFF by forecast year + terminal."""
    years = sorted(result.pv_fcff.keys())
    pvs = [result.pv_fcff[y] for y in years]

    colors = [ACCENT] * len(years)

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=[str(y) for y in years], y=pvs,
        name="PV of FCFF", marker_color=colors,
    ))
    fig.add_trace(go.Bar(
        x=["Terminal"], y=[result.pv_terminal],
        name="PV of Terminal", marker_color=TERMINAL_COLOR,
    ))

    fig.update_layout(
        title="Present Value Breakdown",
        barmode="stack",
        xaxis_title="Year",
        yaxis_title="PV (USD mm)",
    )
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Explicit vs Terminal contribution
# ---------------------------------------------------------------------------

def explicit_vs_terminal_pie(result: DCFResult) -> go.Figure:
    """Pie chart: explicit period vs terminal value contribution."""
    fig = go.Figure(go.Pie(
        labels=["Explicit Period", "Terminal Value"],
        values=[result.pv_explicit, result.pv_terminal],
        marker=dict(colors=[ACCENT, TERMINAL_COLOR]),
        hole=0.4,
        textinfo="label+percent",
        textfont=dict(size=13),
    ))
    fig.update_layout(title="Value Composition", showlegend=True)
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Tornado chart
# ---------------------------------------------------------------------------

def tornado_chart(tornado_data: list[dict[str, Any]]) -> go.Figure:
    """Horizontal bar chart for tornado sensitivity."""
    labels = [d["label"] for d in tornado_data]
    base_pps = tornado_data[0]["base"] if tornado_data else 0

    lows = [d["low"] - base_pps for d in tornado_data]
    highs = [d["high"] - base_pps for d in tornado_data]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=labels, x=lows, orientation="h",
        name="Downside", marker_color=NEGATIVE,
        text=[fmt_number(v, 2, "$") for v in [d["low"] for d in tornado_data]],
        textposition="outside",
    ))
    fig.add_trace(go.Bar(
        y=labels, x=highs, orientation="h",
        name="Upside", marker_color=POSITIVE,
        text=[fmt_number(v, 2, "$") for v in [d["high"] for d in tornado_data]],
        textposition="outside",
    ))

    fig.update_layout(
        title=f"Tornado Analysis (Base: {fmt_number(base_pps, 2, '$')}/share)",
        barmode="relative",
        xaxis_title="Impact on Price per Share (USD)",
        yaxis=dict(autorange="reversed"),
    )
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Sensitivity heatmap
# ---------------------------------------------------------------------------

def sensitivity_heatmap(sensitivity_df: pd.DataFrame, base_pps: float = 0) -> go.Figure:
    """Heatmap of WACC vs terminal growth rate."""
    z = sensitivity_df.values
    x_labels = [f"{g:.1%}" for g in sensitivity_df.columns]
    y_labels = [f"{w:.1%}" for w in sensitivity_df.index]

    # Custom text with $ formatting
    text = [[fmt_number(v, 2, "$") for v in row] for row in z]

    fig = go.Figure(go.Heatmap(
        z=z, x=x_labels, y=y_labels,
        text=text, texttemplate="%{text}",
        colorscale=[
            [0, NEGATIVE],
            [0.5, "#F6F9FC"],
            [1, POSITIVE],
        ],
        colorbar=dict(title="PPS"),
        hovertemplate="WACC: %{y}<br>Growth: %{x}<br>PPS: %{text}<extra></extra>",
    ))

    fig.update_layout(
        title="Sensitivity: WACC vs Terminal Growth",
        xaxis_title="Terminal Growth Rate",
        yaxis_title="WACC",
        yaxis=dict(autorange="reversed"),
    )
    return _apply_theme(fig)


# ---------------------------------------------------------------------------
# Reinvestment vs growth
# ---------------------------------------------------------------------------

def reinvestment_vs_growth(result: DCFResult) -> go.Figure:
    """Capex + NWC vs Revenue growth across forecast years."""
    ft = result.forecast_table
    if ft.empty:
        return go.Figure()

    years = [int(c) for c in ft.columns]
    capex = [ft.at["Capex", y] for y in years]
    nwc = [ft.at["Change in NWC", y] for y in years]
    rev_growth = [ft.at["Revenue Growth", y] for y in years]

    fig = go.Figure()
    fig.add_trace(go.Bar(x=years, y=capex, name="Capex", marker_color=ACCENT))
    fig.add_trace(go.Bar(x=years, y=nwc, name="Change in NWC", marker_color=TERMINAL_COLOR))
    fig.add_trace(go.Scatter(
        x=years, y=rev_growth, name="Revenue Growth",
        yaxis="y2", mode="lines+markers",
        line=dict(color=POSITIVE, width=2),
        marker=dict(size=6),
    ))

    fig.update_layout(
        title="Reinvestment vs Growth",
        barmode="stack",
        xaxis_title="Year",
        yaxis_title="USD (mm)",
        yaxis2=dict(
            title="Growth Rate", overlaying="y", side="right",
            tickformat=".1%", gridcolor="rgba(0,0,0,0)",
        ),
    )
    return _apply_theme(fig)
