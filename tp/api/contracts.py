"""Weaving Contract Terry API. Calculations live in the DocType controller (`validate`);
`tp/public/js/lib/contract-calc.js` mirrors them for instant feedback in the browser."""

import frappe
from frappe import _
from frappe.utils import flt, getdate

from tp.access import get_doctype_permissions, get_form_route
from tp.api.utils import count, like, page_api, paging, parse_json

DOCTYPE = "Weaving Contract Terry"
CHILD_TABLES = ("product_detail", "yarn_details")
LIST_FIELDS = (
	"name",
	"buyers_name",
	"po_no",
	"ct_no",
	"po_start_date",
	"po_end_date",
	"total_item_qty",
	"total_lbs",
	"total_amount",
	"total_bags",
	"modified",
)


def _editable_fields(doctype: str) -> set[str]:
	return {
		df.fieldname
		for df in frappe.get_meta(doctype).fields
		if df.fieldtype not in frappe.model.no_value_fields and not df.read_only
	}


def _serialize(doc) -> dict:
	data = doc.as_dict(no_default_fields=False, convert_dates_to_str=True)
	data["modified"] = str(doc.modified)
	data["buyer_title"] = frappe.db.get_value("Customer", doc.buyers_name, "customer_name")
	return data


@page_api("contracts")
def get_list(
	txt: str | None = None,
	buyer: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	start: int = 0,
	page_length: int = 20,
	order_by: str | None = None,
) -> dict:
	start, page_length = paging(start, page_length)
	filters = []
	if buyer:
		filters.append(["buyers_name", "=", buyer])
	if from_date:
		filters.append(["po_start_date", ">=", getdate(from_date)])
	if to_date:
		filters.append(["po_start_date", "<=", getdate(to_date)])

	or_filters = None
	if pattern := like(txt):
		or_filters = [["name", "like", pattern], ["po_no", "like", pattern], ["ct_no", "like", pattern]]
		or_filters.append(["buyers_name", "like", pattern])

	sortable = {"modified", "po_start_date", "total_amount", "total_item_qty", "name"}
	field, _sep, direction = (order_by or "modified desc").partition(" ")
	if field not in sortable or direction not in ("asc", "desc"):
		field, direction = "modified", "desc"

	rows = frappe.get_list(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=list(LIST_FIELDS),
		order_by=f"{field} {direction}",
		limit_start=start,
		limit_page_length=page_length,
	)
	buyers = {row.buyers_name for row in rows if row.buyers_name}
	titles = (
		dict(
			frappe.get_all(
				"Customer",
				filters={"name": ["in", list(buyers)]},
				fields=["name", "customer_name"],
				as_list=True,
			)
		)
		if buyers
		else {}
	)
	for row in rows:
		row["buyer_title"] = titles.get(row.buyers_name, row.buyers_name)

	return {"rows": rows, "total": count(DOCTYPE, filters, or_filters), "start": start}


@page_api("contracts")
def get(name: str) -> dict:
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission("read")
	return {"doc": _serialize(doc), "permissions": get_doctype_permissions(DOCTYPE)}


@page_api("contracts")
def get_meta() -> dict:
	"""Select options used by the contract form, read from the DocType so they never drift."""

	def options(doctype, fieldname):
		df = frappe.get_meta(doctype).get_field(fieldname)
		return [o for o in (df.options or "").split("\n") if o]

	return {
		"naming_series": options(DOCTYPE, "naming_series"),
		"stitch_type": options(DOCTYPE, "stitch_type"),
		"yarn_type": options("Yarn Details", "type"),
		"permissions": get_doctype_permissions(DOCTYPE),
	}


@page_api("contracts")
def save(doc) -> dict:
	data = parse_json(doc, {})
	name = data.get("name")

	if name:
		contract = frappe.get_doc(DOCTYPE, name)
		contract.check_permission("write")
		if data.get("modified") and str(contract.modified) != data["modified"]:
			frappe.throw(_("This contract was changed by someone else. Reload and try again."))
	else:
		contract = frappe.new_doc(DOCTYPE)

	for fieldname in _editable_fields(DOCTYPE) - set(CHILD_TABLES):
		if fieldname in data:
			contract.set(fieldname, data[fieldname])

	for table in CHILD_TABLES:
		if table not in data:
			continue
		child_doctype = contract.meta.get_field(table).options
		allowed = _editable_fields(child_doctype)
		rows = []
		for row in data[table] or []:
			clean = {k: v for k, v in row.items() if k in allowed}
			if row.get("name") and not str(row["name"]).startswith("new-"):
				clean["name"] = row["name"]
			rows.append(clean)
		contract.set(table, rows)

	if name:
		contract.save()
	else:
		contract.insert()
	return {"doc": _serialize(contract)}


def _linking_doctypes() -> dict[str, list[tuple[str | None, str]]]:
	"""Doctypes that link to a contract, as {parent doctype: [(child doctype or None, link field)]}."""
	link_filters = {"fieldtype": "Link", "options": DOCTYPE}
	links = frappe.get_all("DocField", filters=link_filters, fields=["parent as dt", "fieldname"])
	links += frappe.get_all("Custom Field", filters=link_filters, fields=["dt", "fieldname"])

	result = {}
	for link in links:
		if not frappe.get_meta(link.dt).istable:
			result.setdefault(link.dt, []).append((None, link.fieldname))
			continue
		table_filters = {"fieldtype": ["in", ["Table", "Table MultiSelect"]], "options": link.dt}
		parents = set(frappe.get_all("DocField", filters=table_filters, pluck="parent"))
		parents |= set(frappe.get_all("Custom Field", filters=table_filters, pluck="dt"))
		for parent in parents:
			result.setdefault(parent, []).append((link.dt, link.fieldname))
	return result


@page_api("contracts")
def get_connections(name: str, limit: int = 50) -> dict:
	"""Documents linked to a contract, grouped by doctype, with qty and bags from linked rows."""
	frappe.get_doc(DOCTYPE, name).check_permission("read")

	groups = []
	for doctype, links in sorted(_linking_doctypes().items()):
		if not frappe.has_permission(doctype, "read"):
			continue

		# qty / bags come from the linked child rows, so a document only counts what belongs to this contract
		totals = {}
		for child, fieldname in links:
			if child is None:
				for parent in frappe.get_all(doctype, filters={fieldname: name}, pluck="name"):
					totals.setdefault(parent, {})
				continue
			child_meta = frappe.get_meta(child)
			sums = [f for f in ("qty", "bags") if child_meta.has_field(f)]
			rows = frappe.get_all(
				child,
				filters={fieldname: name, "parenttype": doctype},
				fields=["parent", *({"SUM": f, "as": f} for f in sums)],
				group_by="parent",
			)
			for row in rows:
				entry = totals.setdefault(row.parent, {})
				for f in sums:
					entry[f] = entry.get(f, 0) + flt(row.get(f))
		if not totals:
			continue

		meta = frappe.get_meta(doctype)
		date_field = next(
			(f for f in ("transaction_date", "posting_date", "schedule_date") if meta.has_field(f)), "creation"
		)
		fields = ["name", "docstatus", "modified", f"{date_field} as date"]
		fields += [f for f in ("status", "title") if meta.has_field(f)]
		docs = frappe.get_list(
			doctype,
			filters={"name": ["in", list(totals)]},
			fields=fields,
			order_by="creation desc",
			limit_page_length=min(max(int(limit), 1), 200),
		)
		for doc in docs:
			doc.update(totals[doc.name])
			doc.status = doc.get("status") or ("Draft", "Submitted", "Cancelled")[doc.docstatus]
			doc.date = str(doc.date) if doc.date else None
			doc.modified = str(doc.modified)
		if docs:
			groups.append(
				{
					"doctype": doctype,
					"label": _(doctype),
					"route": get_form_route(doctype),
					"total": count(doctype, {"name": ["in", list(totals)]}),
					"rows": docs,
				}
			)
	return {"groups": groups}


@page_api("contracts")
def delete(name: str) -> dict:
	frappe.delete_doc(DOCTYPE, name)
	return {"deleted": name}
