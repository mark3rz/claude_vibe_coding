"""Utility helpers for parsing, formatting, and fuzzy matching."""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------

def clean_number(value: Any) -> float | None:
    """Convert a cell value to float. Returns None for missing/non-meaningful."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if math.isnan(value) or math.isinf(value):
            return None
        return float(value)
    s = str(value).strip().strip("'\"")
    if s.upper() in ("NA", "N/A", "NM", "N.M.", "--", "-", ""):
        return None
    # Handle parentheses for negatives: (123) → -123
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1]
    # Strip currency symbols and commas
    s = re.sub(r"[$€£¥,]", "", s)
    # Strip trailing % but keep value
    pct = False
    if s.endswith("%"):
        pct = True
        s = s[:-1]
    s = s.strip()
    try:
        val = float(s)
    except (ValueError, TypeError):
        return None
    if neg:
        val = -val
    if pct:
        val = val  # keep as-is; caller handles % interpretation
    return val


# ---------------------------------------------------------------------------
# Label normalization
# ---------------------------------------------------------------------------

def normalize_label(label: str) -> str:
    """Lowercase, strip whitespace/punctuation for comparison."""
    s = str(label).strip()
    s = re.sub(r"[^\w\s]", "", s)  # remove punctuation
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


# ---------------------------------------------------------------------------
# Fuzzy matching
# ---------------------------------------------------------------------------

def fuzzy_match(query: str, candidates: list[str], threshold: float = 0.60) -> tuple[str, float]:
    """Return (best_match, score) using rapidfuzz with difflib fallback.

    Score is 0-1.  Returns ("", 0.0) if no candidate meets threshold.
    """
    nq = normalize_label(query)
    if not nq or not candidates:
        return ("", 0.0)

    try:
        from rapidfuzz import fuzz
        best, best_score = "", 0.0
        for c in candidates:
            nc = normalize_label(c)
            score = fuzz.token_sort_ratio(nq, nc) / 100.0
            if score > best_score:
                best, best_score = c, score
        if best_score >= threshold:
            return (best, best_score)
        return ("", 0.0)
    except ImportError:
        pass

    # difflib fallback
    from difflib import SequenceMatcher
    best, best_score = "", 0.0
    for c in candidates:
        nc = normalize_label(c)
        score = SequenceMatcher(None, nq, nc).ratio()
        if score > best_score:
            best, best_score = c, score
    if best_score >= threshold:
        return (best, best_score)
    return ("", 0.0)


# ---------------------------------------------------------------------------
# Year extraction & estimate detection
# ---------------------------------------------------------------------------

_YEAR_RE = re.compile(r"((?:19|20)\d{2})")

def extract_year(header: Any) -> int | None:
    """Pull the first 4-digit year from a header string like '2020 FY'."""
    m = _YEAR_RE.search(str(header))
    return int(m.group(1)) if m else None


_EST_RE = re.compile(r"(?:\d)(E)\b|(?:\b)(Est|Estimate|Proj|Projected|Forecast)\b", re.IGNORECASE)

def detect_estimate(header: Any) -> bool:
    """Return True if a column header looks like an estimate."""
    return bool(_EST_RE.search(str(header)))


# ---------------------------------------------------------------------------
# Magnitude detection
# ---------------------------------------------------------------------------

def detect_magnitude(text: str) -> str:
    """Detect magnitude from metadata row text. Returns 'thousands', 'millions', or 'billions'."""
    t = str(text).lower()
    if "billion" in t or "(b)" in t:
        return "billions"
    if "million" in t or "(m)" in t or "(mm)" in t:
        return "millions"
    if "thousand" in t or "(k)" in t:
        return "thousands"
    return "thousands"  # default for CIQ exports


def magnitude_multiplier(mag: str) -> float:
    """Multiplier to convert from stated magnitude to millions (internal standard)."""
    return {
        "thousands": 0.001,
        "millions": 1.0,
        "billions": 1000.0,
    }.get(mag, 0.001)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def fmt_number(value: float | None, decimals: int = 1, prefix: str = "$", suffix: str = "") -> str:
    """Format a number with thousands separators, parens for negatives."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    neg = value < 0
    av = abs(value)
    formatted = f"{av:,.{decimals}f}"
    if neg:
        return f"({prefix}{formatted}{suffix})"
    return f"{prefix}{formatted}{suffix}"


def fmt_pct(value: float | None, decimals: int = 1) -> str:
    """Format a percentage (0.10 → '10.0%')."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    return f"{value * 100:,.{decimals}f}%"


def fmt_multiple(value: float | None, decimals: int = 1) -> str:
    """Format a multiple like 12.5x."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    return f"{value:,.{decimals}f}x"
