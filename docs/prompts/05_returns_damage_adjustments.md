# Phase 5 — Returns, damage/scrap, adjustments

- Customer returns: link to original challan (validate returned qty ≤ dispatched qty minus prior returns), condition GOOD / DAMAGED / NEEDS_INSPECTION. GOOD → USABLE; DAMAGED → DAMAGED bucket; NEEDS_INSPECTION → INSPECTION bucket. Damaged returns never enter usable stock automatically.
- Supplier returns: link to GRN, reduces stock (SUPPLIER_RETURN).
- Damage/Scrap: DAMAGE moves USABLE → DAMAGED; SCRAP removes from DAMAGED. Allow later actions on damaged stock: repair (→ USABLE), return to supplier, scrap, or permitted conversion — each audited, with reason.
- Stock adjustments: date, item, system qty (snapshot), physical qty, difference, reason, remarks, approval workflow (MANAGER approves). Creates ADJUSTMENT_IN/OUT only on approval + confirm.

Tests for each flow, including over-return rejection, damaged not counted as available, adjustment approval gating.
Stop and report.
