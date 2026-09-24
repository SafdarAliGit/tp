"""ERPNext-style List / Report view options shared by every portal list page.

Everything is keyed by a portal page (`tp/config/pages.py`): the page's Reference DocType is the
DocType being listed, so access needs the page *and* Frappe's own DocType permissions. Field
level permissions (permlevel) decide which fields can be shown, filtered, sorted or edited.

Filters use Frappe's list form: `[fieldname, operator, value]`, or
`[child_doctype, fieldname, operator, value]` for a field of one of the DocType's child tables.

List pages with their own endpoint validate the user's options with `list_filters` and
`sort_clause`; the Report view uses `get_data` / `get_group_by` directly.
"""

import frappe
from frappe import _
from frappe.model import data_fieldtypes, numeric_fieldtypes
from frappe.utils import cint, cstr

from tp.access import get_doctype_permissions, get_page, require_page_access
from tp.api.utils import count, like, paging, parse_json

MAX_PAGE_LENGTH = 500
MAX_BULK = 500
OPERATORS = ("=", "!=", "like", "not like", "in", "not in", ">", "<", ">=", "<=", "between", "is")
EXPORT_FORMATS = {"Excel": "xlsx", "CSV": "csv"}
# Value fields that can't be listed, filtered or bulk-edited meaningfully
SKIP_FIELDTYPES = {"Password", "Signature", "Geolocation", "JSON", "Code", "HTML Editor", "Markdown Editor"}
NOT_EDITABLE = {"Attach", "Attach Image", "Read Only", "Text Editor", "Rating", "Barcode", "Icon", "Duration"}
TOTAL_FIELDTYPES = set(numeric_fieldtypes) - {"Check"}
NO_GROUP_BY = {"Datetime", "Small Text", "Text", "Long Text", "Text Editor"}


def _doctype(page: str) -> str:
	require_page_access(page)
	doctype = (get_page(page) or {}).get("reference_doctype")
	if not doctype:
		frappe.throw(_("This page has no list."), frappe.ValidationError)
	frappe.has_permission(doctype, "read", throw=True)
	return doctype


def _standard_fields(meta) -> list[dict]:
	fields = [
		{"fieldname": "name", "label": _("ID"), "fieldtype": "Data"},
		{"fieldname": "owner", "label": _("Created By"), "fieldtype": "Link", "options": "User"},
		{"fieldname": "creation", "label": _("Created On"), "fieldtype": "Datetime"},
		{"fieldname": "modified", "label": _("Last Updated On"), "fieldtype": "Datetime"},
		{"fieldname": "modified_by", "label": _("Last Updated By"), "fieldtype": "Link", "options": "User"},
	]
	if meta.is_submittable:
		fields.append({"fieldname": "docstatus", "label": _("Document Status"), "fieldtype": "DocStatus"})
	return [{**f, "standard": 1} for f in fields]


def _fields(doctype: str, parenttype: str | None = None) -> dict[str, dict]:
	"""Fields of `doctype` the user may read, keyed by fieldname (a child DocType's when `parenttype`)."""
	cache_key = (doctype, parenttype)
	cache = getattr(frappe.local, "tp_listview_fields", None)
	if cache is None:
		cache = frappe.local.tp_listview_fields = {}
	if cache_key in cache:
		return cache[cache_key]

	meta = frappe.get_meta(doctype)
	permitted = set(meta.get_permitted_fieldnames(parenttype=parenttype, with_virtual_fields=False))
	writable = (
		set()
		if parenttype
		else set(meta.get_permitted_fieldnames(permission_type="write", with_virtual_fields=False))
	)
	fields = {} if parenttype else {f["fieldname"]: f for f in _standard_fields(meta)}
	for df in meta.fields:
		if (
			df.fieldname not in permitted
			or df.fieldtype not in data_fieldtypes
			or df.fieldtype in SKIP_FIELDTYPES
			or df.is_virtual
			or (df.hidden and not df.in_list_view)
		):
			continue
		field = {"fieldname": df.fieldname, "label": _(df.label or df.fieldname), "fieldtype": df.fieldtype}
		if df.fieldtype in ("Link", "Select", "Dynamic Link") and df.options:
			field["options"] = df.options
		if df.in_list_view or df.in_standard_filter:
			field["in_list_view"] = 1
		if (
			df.fieldname in writable
			and df.fieldtype not in NOT_EDITABLE
			and not df.read_only
			and not df.set_only_once
			and not df.fetch_from
		):
			field["editable"] = 1
			if df.allow_on_submit:
				field["allow_on_submit"] = 1
		fields[df.fieldname] = field
	cache[cache_key] = fields
	return fields


def _child_tables(doctype: str) -> dict[str, str]:
	"""Child DocTypes of `doctype` → table label."""
	return {df.options: _(df.label or df.options) for df in frappe.get_meta(doctype).get_table_fields()}


def list_filters(doctype: str, filters) -> list[list]:
	"""Validate user filters for `doctype` (see module docstring); unknown fields or operators raise."""
	result = []
	for row in parse_json(filters, []) or []:
		if not isinstance(row, list | tuple) or len(row) not in (3, 4):
			frappe.throw(_("Invalid filter."))
		child = None
		if len(row) == 4:
			child, fieldname, operator, value = row
			if child == doctype:
				child = None
			elif child not in _child_tables(doctype):
				frappe.throw(_("Invalid filter table {0}.").format(child))
		else:
			fieldname, operator, value = row
		fields = _fields(child, doctype) if child else _fields(doctype)
		operator = cstr(operator).lower()
		if fieldname not in fields:
			frappe.throw(_("You can't filter on {0}.").format(fieldname))
		if operator not in OPERATORS:
			frappe.throw(_("Invalid filter operator {0}.").format(operator))
		if operator == "is" and value not in ("set", "not set"):
			frappe.throw(_("Invalid filter value."))
		if operator in ("in", "not in") and isinstance(value, str):
			value = [v.strip() for v in value.split(",") if v.strip()]
		if operator == "between" and (not isinstance(value, list | tuple) or len(value) != 2):
			frappe.throw(_("A 'between' filter needs two values."))
		result.append([child or doctype, fieldname, operator, value])
	return result


def sort_clause(doctype: str, order_by: str | None, default: str | None = None) -> str:
	"""`field asc|desc` for any readable field, else `default` (or the DocType's default sort)."""
	field, _sep, direction = cstr(order_by).strip().partition(" ")
	if field in _fields(doctype) and direction.lower() in ("asc", "desc"):
		return f"{field} {direction.lower()}"
	return default or default_sort(doctype)


def default_sort(doctype: str) -> str:
	meta = frappe.get_meta(doctype)
	field = meta.sort_field if meta.sort_field in _fields(doctype) else "modified"
	return f"{field} {(meta.sort_order or 'desc').lower()}"


def _search(doctype: str, txt: str | None) -> list | None:
	pattern = like(txt)
	if not pattern:
		return None
	meta = frappe.get_meta(doctype)
	fields = _fields(doctype)
	names = ["name", meta.get_title_field(), *meta.get_search_fields()]
	names = [
		n for n in dict.fromkeys(names) if n in fields and fields[n]["fieldtype"] not in numeric_fieldtypes
	]
	return [[doctype, n, "like", pattern] for n in names]


def _query(doctype: str, filters, txt: str | None) -> tuple[list, list | None, bool]:
	"""Filters for a query; child-table filters are resolved to parent names so rows, counts
	and totals are never multiplied by the join."""
	filters = list_filters(doctype, filters)
	or_filters = _search(doctype, txt)
	if not any(f[0] != doctype for f in filters):
		return filters, or_filters, True
	names = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, pluck="name", distinct=True, limit_page_length=0
	)
	return [[doctype, "name", "in", names]], None, bool(names)


def _columns(doctype: str, columns) -> list[str]:
	fields = _fields(doctype)
	columns = [c for c in dict.fromkeys(parse_json(columns, []) or []) if c in fields]
	extra = ["name"] + (["docstatus"] if "docstatus" in fields else [])
	return list(dict.fromkeys([*extra, *columns]))


def _default_columns(doctype: str) -> list[str]:
	meta = frappe.get_meta(doctype)
	fields = _fields(doctype)
	title = meta.get_title_field()
	columns = ["name"]
	if title in fields:
		columns.append(title)
	if "status" in fields:
		columns.append("status")
	columns += [n for n, f in fields.items() if f.get("in_list_view") and not f.get("standard")]
	# DocTypes with few list-view fields: fill up with the first fields of the form
	long_text = ("Small Text", "Text", "Long Text", "Text Editor")
	columns += [
		n
		for n, f in fields.items()
		if not f.get("standard")
		and f["fieldtype"] not in long_text
		and n not in ("naming_series", "amended_from")
	]
	columns = list(dict.fromkeys(columns))[:6]
	return [*columns, "modified"]


@frappe.whitelist(methods=["GET"])
def get_meta(page: str) -> dict:
	"""Fields and defaults for the List / Report view options of `page`."""
	doctype = _doctype(page)
	meta = frappe.get_meta(doctype)
	fields = list(_fields(doctype).values())
	children = []
	for child, label in _child_tables(doctype).items():
		child_fields = [f for f in _fields(child, doctype).values() if f["fieldtype"] != "Table"]
		if child_fields:
			children.append({"doctype": child, "label": label, "fields": child_fields})
	return {
		"doctype": doctype,
		"title_field": meta.get_title_field(),
		"is_submittable": meta.is_submittable,
		"fields": fields,
		"child_tables": children,
		"default_columns": _default_columns(doctype),
		"default_sort": default_sort(doctype),
		"permissions": get_doctype_permissions(doctype),
		"can_submit": bool(meta.is_submittable and frappe.has_permission(doctype, "submit")),
		"can_cancel": bool(meta.is_submittable and frappe.has_permission(doctype, "cancel")),
	}


@frappe.whitelist(methods=["GET", "POST"])
def get_data(
	page: str,
	columns=None,
	filters=None,
	txt: str | None = None,
	order_by: str | None = None,
	start: int = 0,
	page_length: int = 20,
	with_totals: int = 0,
) -> dict:
	"""Report view rows: the chosen columns for one page, the total count and (optionally) the
	sum of every numeric column over all matching records."""
	doctype = _doctype(page)
	start, page_length = paging(start, page_length, MAX_PAGE_LENGTH)
	columns = _columns(doctype, columns)
	filters, or_filters, any_rows = _query(doctype, filters, txt)
	if not any_rows:
		return {"rows": [], "total": 0, "start": start, "totals": {}}

	rows = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=columns,
		order_by=sort_clause(doctype, order_by),
		limit_start=start,
		limit_page_length=page_length,
	)
	totals = {}
	numeric = [c for c in columns if _fields(doctype)[c]["fieldtype"] in TOTAL_FIELDTYPES]
	if cint(with_totals) and numeric:
		result = frappe.get_list(
			doctype,
			filters=filters,
			or_filters=or_filters,
			fields=[{"SUM": c, "as": c} for c in numeric],
		)
		totals = {c: (result[0].get(c) or 0) if result else 0 for c in numeric}
	return {"rows": rows, "total": count(doctype, filters, or_filters), "start": start, "totals": totals}


@frappe.whitelist(methods=["GET", "POST"])
def get_group_by(page: str, group_by: str, columns=None, filters=None, txt: str | None = None) -> dict:
	"""Report view "Group By": record count and numeric column sums per value of `group_by`."""
	doctype = _doctype(page)
	fields = _fields(doctype)
	if group_by not in fields or fields[group_by]["fieldtype"] in NO_GROUP_BY:
		frappe.throw(_("You can't group by {0}.").format(group_by))
	numeric = [c for c in _columns(doctype, columns) if fields[c]["fieldtype"] in TOTAL_FIELDTYPES]
	filters, or_filters, any_rows = _query(doctype, filters, txt)
	if not any_rows:
		return {"groups": []}
	groups = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=[
			f"{group_by} as value",
			{"COUNT": "*", "as": "count"},
			*({"SUM": c, "as": c} for c in numeric),
		],
		group_by=group_by,
		order_by="count desc",
		limit_page_length=1000,
	)
	return {"groups": groups}


def _cell(value, field: dict):
	if field["fieldtype"] == "DocStatus":
		return {0: _("Draft"), 1: _("Submitted"), 2: _("Cancelled")}.get(cint(value), value)
	if value is None:
		return ""
	if field["fieldtype"] == "Datetime":
		return cstr(value)[:19]
	if field["fieldtype"] in ("Date", "Time"):
		return cstr(value)
	return value


@frappe.whitelist(methods=["GET", "POST"])
def export(
	page: str,
	columns=None,
	filters=None,
	txt: str | None = None,
	order_by: str | None = None,
	names=None,
	file_format: str = "Excel",
):
	"""Download the matching records (or only `names`) with the chosen columns as Excel or CSV."""
	doctype = _doctype(page)
	frappe.has_permission(doctype, "export", throw=True)
	if file_format not in EXPORT_FORMATS:
		frappe.throw(_("Unknown export format {0}.").format(file_format))

	fields = _fields(doctype)
	columns = _columns(doctype, columns or _default_columns(doctype))
	names = parse_json(names, None)
	if names:
		query_filters, or_filters, any_rows = [[doctype, "name", "in", list(names)]], None, True
	else:
		query_filters, or_filters, any_rows = _query(doctype, filters, txt)
	rows = (
		frappe.get_list(
			doctype,
			filters=query_filters,
			or_filters=or_filters,
			fields=columns,
			order_by=sort_clause(doctype, order_by),
			limit_page_length=0,
			as_list=True,
		)
		if any_rows
		else []
	)
	data = [[fields[c]["label"] for c in columns]]
	data += [[_cell(v, fields[c]) for v, c in zip(row, columns, strict=True)] for row in rows]

	filename = frappe.scrub(doctype)
	if file_format == "CSV":
		from frappe.utils.csvutils import to_csv

		frappe.response["type"] = "download"
		frappe.response["filename"] = f"{filename}.csv"
		frappe.response["filecontent"] = to_csv(data)
		frappe.response["content_type"] = "text/csv"
	else:
		from frappe.utils.xlsxutils import build_xlsx_response

		build_xlsx_response(data, filename)


@frappe.whitelist(methods=["POST"])
def bulk_action(page: str, action: str, names, fieldname: str | None = None, value=None) -> dict:
	"""Apply `action` (delete / submit / cancel / edit) to each selected record with the user's own
	permissions. Records that fail are reported back and don't stop the rest."""
	doctype = _doctype(page)
	names = [n for n in dict.fromkeys(parse_json(names, []) or []) if isinstance(n, str)]
	if not names:
		frappe.throw(_("Select at least one record."))
	if len(names) > MAX_BULK:
		frappe.throw(_("You can update at most {0} records at a time.").format(MAX_BULK))
	if action not in ("delete", "submit", "cancel", "edit"):
		frappe.throw(_("Unknown action {0}.").format(action))
	if action == "edit":
		field = _fields(doctype).get(fieldname)
		if not field or not field.get("editable"):
			frappe.throw(_("{0} can't be edited in bulk.").format(fieldname))
		if field["fieldtype"] == "Check":
			value = cint(value)

	done, failed = [], []
	for name in names:
		frappe.db.savepoint("tp_bulk")
		try:
			if action == "delete":
				frappe.delete_doc(doctype, name)
			else:
				doc = frappe.get_doc(doctype, name)
				if action == "submit":
					doc.check_permission("submit")
					if doc.docstatus != 0:
						frappe.throw(_("Only draft documents can be submitted."))
					doc.submit()
				elif action == "cancel":
					doc.check_permission("cancel")
					if doc.docstatus != 1:
						frappe.throw(_("Only submitted documents can be cancelled."))
					doc.cancel()
				else:
					doc.check_permission("write")
					if doc.docstatus == 1 and not field.get("allow_on_submit"):
						frappe.throw(_("{0} can't be changed after submission.").format(field["label"]))
					if doc.docstatus == 2:
						frappe.throw(_("Cancelled documents can't be changed."))
					doc.set(fieldname, value)
					doc.save()
			done.append(name)
		except Exception as e:
			frappe.db.rollback(save_point="tp_bulk")
			message = frappe.utils.strip_html(cstr(e)) or _("Not allowed")
			failed.append({"name": name, "error": message})
	frappe.local.message_log = []
	return {"done": done, "failed": failed}
