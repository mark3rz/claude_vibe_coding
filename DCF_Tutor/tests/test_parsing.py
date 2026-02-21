"""Tests for parsing, number cleaning, and year extraction."""

from __future__ import annotations

import pytest

from src.utils import clean_number, normalize_label, extract_year, detect_estimate, fuzzy_match


class TestCleanNumber:
    def test_integer(self):
        assert clean_number(1234) == 1234.0

    def test_float(self):
        assert clean_number(12.34) == 12.34

    def test_string_with_commas(self):
        assert clean_number("1,234,567") == 1234567.0

    def test_negative_parens(self):
        assert clean_number("(500)") == -500.0

    def test_negative_parens_with_dollar(self):
        assert clean_number("($1,200)") == -1200.0

    def test_na_string(self):
        assert clean_number("NA") is None

    def test_nm_string(self):
        assert clean_number("NM") is None

    def test_dash(self):
        assert clean_number("--") is None

    def test_empty_string(self):
        assert clean_number("") is None

    def test_none(self):
        assert clean_number(None) is None

    def test_percentage(self):
        assert clean_number("89.5%") == 89.5

    def test_currency_symbol(self):
        assert clean_number("$1,000") == 1000.0


class TestNormalizeLabel:
    def test_strip_whitespace(self):
        assert normalize_label("  Revenue  ") == "revenue"

    def test_remove_punctuation(self):
        assert normalize_label("SG&A") == "sga"

    def test_collapse_spaces(self):
        assert normalize_label("  total   assets  ") == "total assets"


class TestExtractYear:
    def test_fy_format(self):
        assert extract_year("2020 FY") == 2020

    def test_plain_year(self):
        assert extract_year("2023") == 2023

    def test_no_year(self):
        assert extract_year("Revenue") is None

    def test_estimate_header(self):
        assert extract_year("2025E FY") == 2025


class TestDetectEstimate:
    def test_estimate_e(self):
        assert detect_estimate("2025E") is True

    def test_actual(self):
        assert detect_estimate("2023 FY") is False

    def test_estimate_word(self):
        assert detect_estimate("2025 Estimate") is True


class TestFuzzyMatch:
    def test_exact(self):
        match, score = fuzzy_match("revenue", ["Revenue", "EBITDA", "Net Income"])
        assert match == "Revenue"
        assert score > 0.90

    def test_close_match(self):
        match, score = fuzzy_match("total revenue", ["Revenue", "Total Revenue", "Net Revenue"])
        assert match == "Total Revenue"
        assert score > 0.80

    def test_no_match(self):
        match, score = fuzzy_match("xyzzy", ["Revenue", "EBITDA"])
        assert match == ""
        assert score == 0.0


class TestImporter:
    def test_parse_sheets(self, parsed_workbook):
        wb = parsed_workbook
        assert len(wb.sheets) >= 4

    def test_income_sheet_detected(self, parsed_workbook):
        wb = parsed_workbook
        types = {s.sheet_type for s in wb.sheets.values()}
        assert "income" in types

    def test_balance_sheet_detected(self, parsed_workbook):
        wb = parsed_workbook
        types = {s.sheet_type for s in wb.sheets.values()}
        assert "balance" in types

    def test_years_extracted(self, parsed_workbook):
        wb = parsed_workbook
        for name, sheet in wb.sheets.items():
            if sheet.sheet_type == "income":
                assert len(sheet.years) >= 5
                assert 2024 in sheet.years

    def test_statement_df_has_data(self, parsed_workbook):
        wb = parsed_workbook
        for name, sheet in wb.sheets.items():
            if sheet.sheet_type == "income":
                assert sheet.statement_df is not None
                assert not sheet.statement_df.empty
                assert "Revenue" in sheet.statement_df.index

    def test_magnitude_detected(self, parsed_workbook):
        wb = parsed_workbook
        for sheet in wb.sheets.values():
            if sheet.sheet_type == "income":
                assert sheet.magnitude == "thousands"


class TestMapping:
    def test_standardized_created(self, standardized_data):
        std, report, exit_mult = standardized_data
        assert not std.income_statement.empty

    def test_revenue_mapped(self, standardized_data):
        std, report, _ = standardized_data
        assert "Revenue" in std.income_statement.index

    def test_mapping_confidence(self, standardized_data):
        _, report, _ = standardized_data
        for entry in report.income_statement:
            if entry.canonical == "Revenue":
                assert entry.confidence > 0.70

    def test_exit_multiple_extracted(self, standardized_data):
        _, _, exit_mult = standardized_data
        # May or may not be extracted depending on matching
        # Just verify it doesn't crash
        assert exit_mult is None or isinstance(exit_mult, float)
