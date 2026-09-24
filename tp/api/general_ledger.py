"""General Ledger for the portal (tp/www/general-ledger).

Figures come from ERPNext's own General Ledger report (`erpnext.accounts.report.general_ledger`),
so every filter, accounting dimension, currency rule and permission works exactly as in the desk.
This module whitelists the filters, runs the report and reshapes its flat rows (with quoted
"'Opening'" / "'Total'" / "'Closing (Opening + Total)'" rows and blank separator rows) into
structured groups: {opening, entries, total, closing} per account / party / voucher.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from tp.access import require_page_access

PAGE = "general-ledger"
REPORT = "General Ledger"

CATEGORIES = {
	"": None,
	"Categorize by Voucher": "voucher_no",
	"Categorize by Voucher (Consolidated)": None,
	"Categorize by Account": "account",
	"Categorize by Party": "party",
}
TEXT_FILTERS = (
	"company",
	"finance_book",
	"from_date",
	"to_date",
	"voucher_no",
	"against_voucher_no",
	"party_type",
	"categorize_by",
	"presentation_currency",
)
LIST_FILTERS = ("account", "party", "cost_center", "project")
CHECK_FILTERS = (
	"include_dimensions",
	"disable_opening_balance_calculation",
	"show_opening_entries",
	"include_default_book_entries",
	"show_cancelled_entries",
	"show_net_values_in_party_account",
	"show_amount_in_company_currency",
	"add_values_in_transaction_currency",
	"show_remarks",
	"ignore_err",
	"ignore_cr_dr_notes",
)
PARTY_NAME_FIELDS = {
	"Customer": "customer_name",
	"Supplier": "supplier_name",
	"Employee": "employee_name",
	"Shareholder": "title",
	"Student": "student_name",
	"Member": "member_name",
}


def _check_access():
	require_page_access(PAGE)
	if not frappe.get_cached_doc("Report", REPORT).is_permitted():
		frappe.throw(_("You are not permitted to view the General Ledger."), frappe.PermissionError)


def _dimensions() -> list[dict]:
	from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
		get_accounting_dimensions,
	)

	return [
		{"fieldname": d.fieldname, "label": _(d.label), "doctype": d.document_type}
		for d in get_accounting_dimensions(as_list=False)
	]


def _clean_filters(filters) -> frappe._dict:
	raw = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	clean = frappe._dict()
	for key in TEXT_FILTERS:
		if raw.get(key):
			clean[key] = str(raw[key])
	for key in LIST_FILTERS:
		values = raw.get(key)
		if isinstance(values, str):
			values = [values]
		values = [str(v) for v in values or [] if v]
		if values:
			clean[key] = values
	for key in CHECK_FILTERS:
		if cint(raw.get(key)):
			clean[key] = 1
	for dim in _dimensions():
		values = raw.get(dim["fieldname"])
		if isinstance(values, str):
			values = [values]
		values = [str(v) for v in values or [] if v]
		if values:
			clean[dim["fieldname"]] = values
	if clean.get("categorize_by") not in CATEGORIES:
		clean.pop("categorize_by", None)
	if not clean.get("company"):
		frappe.throw(_("Select a company."))
	frappe.has_permission("Company", "read", doc=clean.company, throw=True)
	if not clean.get("from_date") or not clean.get("to_date"):
		frappe.throw(_("Select a period (From and To dates)."))
	if getdate(clean.from_date) > getdate(clean.to_date):
		frappe.throw(_("From Date must be before To Date."))
	if clean.get("party") and not clean.get("party_type"):
		frappe.throw(_("Select a Party Type for the chosen parties."))
	return clean


def _summary_kind(row: dict) -> str | None:
	"""'opening' / 'total' / 'closing' for ERPNext's quoted summary rows."""
	account = row.get("account")
	if not isinstance(account, str) or not account.startswith("'"):
		return None
	label = account.strip("'")
	if label == _("Opening"):
		return "opening"
	if label == _("Total"):
		return "total"
	if label.startswith(_("Closing")):
		return "closing"
	return "total"


def _is_entry(row: dict) -> bool:
	return bool(row.get("voucher_no") or row.get("gl_entry") or row.get("posting_date"))


def _is_separator(row: dict) -> bool:
	"""ERPNext's blank rows between groups (dicts whose values are all empty)."""
	return not _summary_kind(row) and not _is_entry(row)


def _amounts(row: dict | None) -> dict:
	row = row or {}
	return {
		"debit": flt(row.get("debit")),
		"credit": flt(row.get("credit")),
		"balance": flt(row.get("balance")),
	}


def _segments(rows: list[dict]) -> list[list[dict]]:
	segments, current = [], []
	for row in rows:
		if _is_separator(row):
			segments.append(current)
			current = []
		else:
			current.append(row)
	segments.append(current)
	return [s for s in segments if s]


def _block(rows: list[dict]) -> dict:
	block = {"opening": None, "total": None, "closing": None, "entries": []}
	for row in rows:
		kind = _summary_kind(row)
		if kind:
			block[kind] = _amounts(row)
		else:
			block["entries"].append(row)
	return block


def _shape(rows: list[dict], categorize_by: str | None) -> dict:
	"""Structured result: overall opening / total / closing, plus entries or groups."""
	group_field = CATEGORIES.get(categorize_by or "")
	segments = _segments(rows)
	if not group_field:
		block = _block([r for s in segments for r in s])
		return {"grouped": False, **block}

	# Grouped: [overall opening] {} [group] {} [group] … {} [overall total, closing]
	head = _block(segments[0]) if segments and not any(not _summary_kind(r) for r in segments[0]) else None
	tail = (
		_block(segments[-1])
		if len(segments) > 1 and not any(not _summary_kind(r) for r in segments[-1])
		else None
	)
	middle = segments[(1 if head else 0) : (-1 if tail else None)]
	groups = []
	for segment in middle:
		block = _block(segment)
		first = block["entries"][0] if block["entries"] else {}
		key = first.get(group_field) or ""
		label = key
		if group_field == "voucher_no" and first.get("voucher_type"):
			label = f"{first['voucher_type']}: {key}"
		groups.append({"key": key, "label": label or _("(Not set)"), "field": group_field, **block})
	return {
		"grouped": True,
		"group_field": group_field,
		"opening": head["opening"] if head else None,
		"total": tail["total"] if tail else None,
		"closing": tail["closing"] if tail else None,
		"groups": groups,
		"entries": [],
	}


def _party_names(rows: list[dict]) -> dict[str, str]:
	"""{"Customer::CUST-0001": "Acme Mills", …} for parties shown in the rows."""
	wanted: dict[str, set] = {}
	for row in rows:
		if row.get("party_type") and row.get("party"):
			wanted.setdefault(row["party_type"], set()).add(row["party"])
	names = {}
	for party_type, parties in wanted.items():
		field = PARTY_NAME_FIELDS.get(party_type)
		if not field or not frappe.get_meta(party_type).has_field(field):
			continue
		for name, title in frappe.get_all(
			party_type, filters={"name": ["in", list(parties)]}, fields=["name", field], as_list=True
		):
			if title and title != name:
				names[f"{party_type}::{name}"] = title
	return names


def _run(filters: frappe._dict):
	from erpnext.accounts.report.general_ledger.general_ledger import execute

	columns, rows = execute(frappe._dict(filters))
	rows = [dict(r) for r in rows]
	for row in rows:
		for key, value in row.items():
			if hasattr(value, "isoformat"):
				row[key] = value.isoformat()
	return columns, rows


@frappe.whitelist(methods=["GET"])
def get_meta() -> dict:
	"""Companies, periods, party types, dimensions and currencies for the filter bar."""
	_check_access()
	from erpnext.accounts.utils import get_fiscal_year

	companies = frappe.get_list("Company", fields=["name", "default_currency"], order_by="name asc")
	default = frappe.defaults.get_user_default("Company")
	if default not in [c.name for c in companies]:
		default = companies[0].name if companies else None
	fiscal_years = {}
	for company in companies:
		try:
			fy = get_fiscal_year(frappe.utils.nowdate(), company=company.name, as_dict=True)
			fiscal_years[company.name] = {
				"name": fy.name,
				"from": str(fy.year_start_date),
				"to": str(fy.year_end_date),
			}
		except Exception:
			frappe.clear_last_message()
	return {
		"companies": companies,
		"default_company": default,
		"fiscal_years": fiscal_years,
		"party_types": frappe.get_all("Party Type", pluck="name", order_by="name asc"),
		"dimensions": _dimensions(),
		"currencies": sorted({c.default_currency for c in companies if c.default_currency}),
		"finance_books": bool(frappe.db.count("Finance Book")),
	}


@frappe.whitelist(methods=["GET", "POST"])
def run(filters) -> dict:
	"""Run ERPNext's General Ledger and return it structured for the portal page."""
	_check_access()
	clean = _clean_filters(filters)
	columns, rows = _run(clean)
	shaped = _shape(rows, clean.get("categorize_by"))
	entries = [r for r in rows if _is_entry(r)]
	currency = clean.get("presentation_currency") or frappe.get_cached_value(
		"Company", clean.company, "default_currency"
	)
	return {
		"columns": [
			{k: c.get(k) for k in ("fieldname", "label", "fieldtype", "options", "width")}
			for c in columns
			if not c.get("hidden")
		],
		"currency": currency,
		"party_names": _party_names(entries),
		"count": len(entries),
		**shaped,
	}


@frappe.whitelist(methods=["GET", "POST"])
def export(filters, columns=None, file_format: str = "Excel"):
	"""Download the ledger as Excel or CSV, with the columns shown on the page."""
	_check_access()
	clean = _clean_filters(filters)
	report_columns, rows = _run(clean)
	wanted = frappe.parse_json(columns) if columns else None
	cols = [c for c in report_columns if not c.get("hidden") and (not wanted or c["fieldname"] in wanted)]
	if wanted:
		cols.sort(key=lambda c: wanted.index(c["fieldname"]))

	labels = {"opening": _("Opening"), "total": _("Total"), "closing": _("Closing (Opening + Total)")}
	data = [[c["label"] for c in cols]]
	for row in rows:
		kind = _summary_kind(row)
		line = []
		for c in cols:
			value = row.get(c["fieldname"])
			if kind and c["fieldname"] == "account":
				value = labels[kind]
			line.append("" if value is None else value)
		data.append(line)

	title = f"General Ledger {clean.company} {clean.from_date} to {clean.to_date}"
	if file_format == "CSV":
		from frappe.utils.csvutils import to_csv

		frappe.response["type"] = "download"
		frappe.response["filename"] = f"{title}.csv"
		frappe.response["filecontent"] = to_csv(data)
		frappe.response["content_type"] = "text/csv"
	else:
		from frappe.utils.xlsxutils import build_xlsx_response

		build_xlsx_response(data, title)
