# Phase 7 — Excel and PDF export

Excel (ExcelJS), triggered by an EXPORT EXCEL button on the daily report. Workbook sheets: DAILY INVENTORY SUMMARY, TRANSACTION LEDGER, DISPATCH DETAILS, PROCUREMENT DETAILS, CONVERSION DETAILS, STOCK ADJUSTMENTS. Each with company name, report date, styled headers, auto filters, freeze panes, column widths, number formats, totals row. Stream large files; server-side generation only.

Optional PDF for daily inventory and key reports: company name, period, opening, inward, outward, closing, detail tables.

Also: import templates download (items, opening stock, procurement, clients, suppliers) and validated import-preview flow for each, following the Phase 2 pattern.

Tests: generate workbook, re-read with ExcelJS, assert sheet names, headers, filters, freeze panes and that summary totals equal the report API. Stop and report.
