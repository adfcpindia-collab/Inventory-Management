Inventory Management System
Comprehensive Claude Code Prompt — VS Code Repository
Purpose: Build a reliable, auditable inventory system where daily procurement, dispatch, conversions and other stock
movements are recorded as transactions and daily inventory reports can be exported to Excel.
1. Core Objective
Build a production-ready inventory management web application in a new VS Code repository. The system must manage
opening stock, procurement/inward, dispatch/outward, conversions, adjustments, returns, damaged/scrap stock, reports,
and Excel exports. Use a transaction/ledger-based architecture rather than directly overwriting stock quantities.
2. Item Master
Create a configurable Item Master with Item ID, SKU/code, name, category, subcategory, description, unit, product type,
active/inactive status, minimum/reorder/maximum levels, HSN/SAC, GST rate, purchase price, selling price, and
timestamps. Historical items must not be physically deleted.
3. Units & Categories
Support configurable units such as NOS, KG, LTR, MTR, SET, BOX and PCS. Prevent incompatible unit usage. Support
categories such as Finished Goods, Empty Body, Raw Material, Component, Packaging, Spare and Other.
4. Opening Inventory
Provide manual entry and Excel import for opening stock. Import flow: upload → parse → validate → preview → show
errors → confirm → create opening-stock transactions. Never silently overwrite existing stock.
5. Procurement / Inward
Create procurement/GRN entry with date, supplier, purchase/GRN number, item, quantity, unit, rate, GST, amount, batch
and remarks. Confirmed procurement increases stock and creates an auditable PROCUREMENT transaction.
6. Dispatch / Challan
Create dispatches with date, challan number, client, address, item lines, quantity, optional rate, vehicle, driver, sales
order and remarks. A single challan must support multiple items. Confirmed dispatch reduces stock. Negative inventory is
prohibited by default.
7. Client & Supplier Masters
Create searchable Client and Supplier masters with company/contact/address/GSTIN/phone/email/active status and
remarks. Transactions should select existing masters rather than repeatedly typing details.
8. Item Conversion Engine
Support conversion such as ABC 9 KG Empty Body → DCP 9 KG or Water 9 KG. A conversion must record inputs and
outputs and create inventory movements. Support simple 1→1 conversions and multi-input/multi-output conversions such
as Empty Body + Valve + Hose → Finished Extinguisher. Support conversion templates/recipes plus custom conversions.
9. Returns
Support customer returns and supplier returns. Customer returns must record original challan, condition and whether
returned stock is good, damaged or needs inspection. Damaged returns must not automatically enter usable stock.
10. Damage / Scrap


Create DAMAGE/SCRAP transactions and separate damaged stock. Support later repair, return, scrap or permitted
conversion back to usable stock, with full auditability.
11. Stock Adjustments
Provide stock-count adjustments with date, item, system quantity, physical quantity, difference, reason, remarks and
approval. Adjustments must create transactions; never silently overwrite stock.
12. Inventory Ledger
For every item show Date, Transaction Type, Reference, Opening, In, Out, Balance, User and Remarks. Filter by date
range, item, transaction type, client, supplier, challan and user.
13. Dashboard
Show total inventory items, total stock, low-stock items, out-of-stock items, today's procurement, dispatch, conversions,
returns and adjustments. Show item, category, available stock, unit, minimum level and status.
14. Daily Inventory Report
For a selected date calculate Opening Stock, Procurement, Customer Returns, Conversion In, Adjustment In, Total In,
Dispatch, Supplier Returns, Conversion Out, Damage/Scrap, Adjustment Out, Total Out and Closing Stock. Formula:
Closing = Opening + Total In − Total Out. The report must reconcile exactly with the transaction ledger.
15. Excel Export
Provide an EXPORT EXCEL button for the daily report. Create professionally formatted XLSX sheets: DAILY
INVENTORY SUMMARY, TRANSACTION LEDGER, DISPATCH DETAILS, PROCUREMENT DETAILS, CONVERSION
DETAILS and STOCK ADJUSTMENTS. Include filters, freeze panes, formatting, report date and company name.
16. PDF Export
Provide optional PDF export for daily inventory and other key reports with company name, report period, opening, inward,
outward, closing and detailed tables.
17. Reports
Provide challan-wise, client-wise, item-wise and date-range reports. Search by challan, client, supplier, item, transaction
ID, conversion ID, GRN and remarks. Support Today, Yesterday, This Week, This Month and Custom Date Range.
18. Audit & Corrections
Every important action must be logged with user, action, record, old value, new value and timestamp. Use DRAFT,
CONFIRMED and CANCELLED statuses. Confirmed transactions must never be deleted. Corrections/cancellations
create reversal transactions.
19. Users & Roles
Implement ADMIN, MANAGER, STORE/INVENTORY USER and VIEWER roles. Optionally require approval for stock
adjustments, large conversions and cancellations. Only confirmed transactions affect inventory.
20. Warehouses & Transfers
Design for multiple warehouses/locations even if initially one exists. Support warehouse-specific balances and transfers
using TRANSFER_OUT and TRANSFER_IN so total company inventory remains unchanged.
21. Batch / Serial Support
Design for optional batch and serial tracking, including batch number, serial number, manufacturing date and expiry date
where applicable. Do not force serial numbers on every item.


22. Excel Import
Support Excel imports for items, opening stock, procurement, clients and suppliers. Always validate and preview before
committing. Provide downloadable import templates.
23. Backup
Provide database backup functionality and documented restore procedures. Keep backup/restore safe and preferably
administrator-only.
24. Notifications & Dashboard Warnings
Show warnings for low stock, out of stock, pending approvals and inventory mismatches. Keep email/SMS out of the
initial scope but make the architecture extensible.
25. UI / UX
Build a clean, professional, minimal, responsive interface for desktop, laptop, tablet and mobile. Suggested sidebar:
Dashboard, Inventory, Items, Procurement, Dispatch, Conversions, Returns, Adjustments, Warehouses, Clients,
Suppliers, Reports, Excel Exports, Audit Logs, Users and Settings.
26. Daily Workflow
Typical workflow: morning dashboard → record procurement → create multi-item dispatch challan → record conversions
→ record returns/adjustments → generate daily inventory report → export Excel.
27. Inventory Architecture Rule
The source of truth must be CONFIRMED INVENTORY TRANSACTIONS. Current stock may be cached for performance
but must always reconcile to the ledger. Implement an inventory reconciliation function and flag any mismatch.
28. Idempotency & Validation
Prevent duplicate submissions, duplicate challans/GRNs/conversion IDs, zero/negative quantities, use of inactive items,
unavailable-stock conversions and invalid units. Validate in both frontend and backend and enforce database constraints.
29. Suggested Technology
Preferred stack: React + TypeScript + Vite + Tailwind CSS; Node.js + TypeScript + Express or NestJS; PostgreSQL;
Prisma or equivalent ORM; ExcelJS; Recharts; Zod; Vitest/Jest and Playwright; Docker Compose for local development.
Use equivalent technologies only when there is a clear benefit.
30. Database Design
Suggested tables: users, roles, items, categories, units, clients, suppliers, warehouses, inventory_transactions,
inventory_transaction_items, dispatches, dispatch_items, procurements, procurement_items, conversions,
conversion_inputs, conversion_outputs, returns, return_items, stock_adjustments, damage_records, audit_logs,
conversion_templates and conversion_template_inputs/outputs. Use proper foreign keys and indexes.
31. Security
Implement password hashing, authentication, authorization, role-based access, secure API endpoints, validation,
ORM-based SQL injection protection, rate limiting where appropriate, secure token/session handling, audit logging and
proper .gitignore. Never hardcode secrets.
32. Testing
Create automated tests for opening stock, procurement, dispatch, multiple-item challans, conversions, multi-input/output
conversions, returns, damage, adjustments, warehouse transfers, cancellation/reversal, negative-stock prevention,
duplicate challans, daily closing calculation, Excel export and reconciliation.


33. Seed Data
Provide 5–10 demo products, 3 clients, 3 suppliers, opening stock, procurement, dispatch and conversion examples.
Clearly mark demo/seed data.
34. Documentation
Create README.md, ARCHITECTURE.md, DATABASE.md, INVENTORY_LOGIC.md, DEPLOYMENT.md and
USER_GUIDE.md covering setup, migrations, environment variables, seed data, inventory calculations, backup/restore,
exports, roles and deployment.
35. Development Phases
Phase 1: authentication, database, Item/Client/Supplier masters. Phase 2: opening stock and ledger. Phase 3:
procurement and dispatch. Phase 4: conversion engine. Phase 5: returns, damage and adjustments. Phase 6: dashboard
and reports. Phase 7: Excel/PDF exports. Phase 8: audit, approvals and warehouses. Phase 9: testing, documentation
and production build.
36. Acceptance Criteria
The application is complete only when local setup works, migrations work, authentication works, all inventory modules
work, conversions reconcile, negative stock is prevented, cancellation/reversal works, audit logs work, daily reports
reconcile, Excel/PDF exports work, tests pass, lint/type checks pass, production build succeeds and documentation is
complete.
37. Example Daily Report
Example: ABC 9 KG Opening 50, Procurement 20, Conversion In 0, Returns 0, Dispatch 10, Conversion Out 0, Damage
0 → Closing 60. DCP 9 KG Opening 30, Conversion In 10, Dispatch 5 → Closing 35. ABC Empty Body Opening 20,
Conversion Out 10 → Closing 10. The system must calculate this dynamically from confirmed transactions.
38. Critical Instructions to Claude Code
Before coding, inspect the repository, define architecture, database schema, transaction model, APIs, routes and
validation. Then implement incrementally. After every major module run tests, fix errors and verify inventory integrity. At
the end run the complete test suite, linting, type checking, production build, migrations and export verification. Do not
build everything in one giant file.
39. Future Extensibility
Keep architecture ready for GST invoicing, purchase/sales orders, quotations, barcode/QR scanning, serial tracking,
production/BOM, accounting/Tally integration, notifications, cloud deployment and multi-company support without
implementing all of these in the first release.


Suggested Daily Data Flow
 Opening stock is established through an opening-stock transaction.
 Procurement creates confirmed inward transactions.
 Dispatch creates confirmed outward transactions against a challan and client.
 Conversions consume input inventory and create output inventory.
 Returns, damage and adjustments create their own auditable transaction types.
 The daily report is calculated from confirmed transactions.
 Closing stock must always reconcile to Opening + Total In − Total Out.
 The daily report can then be exported to Excel and optionally PDF.
