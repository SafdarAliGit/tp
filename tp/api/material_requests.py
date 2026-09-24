"""Material Request API for the portal: list, form, and the full document lifecycle
(save → submit → stop / re-open → cancel → amend). ERPNext's controller does the validation,
item defaults (name, UOM, conversion) and status updates, exactly as it does in the desk."""

import frappe
from erpnext.stock.doctype.material_request.material_request import update_status
from erpnext.stock.get_item_details import get_conversion_factor
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from tp.api.utils import count, like, page_api, paging, parse_json

DOCTYPE = "Material Request"
PAGE = "material-requests"

# Only these fields can be written from the portal
HEADER_FIELDS = (
	"material_request_type",
	"transaction_date",
	"schedule_date",
	"company",
	"customer",
	"set_from_warehouse",
	"set_warehouse",
	"driver_name",
	"vehicle_no",
	"mobile_no",
)
ITEM_FIELDS = (
	"item_code",
	"qty",
	"uom",
	"warehouse",
	"from_warehouse",
	"schedule_date",
	"type",
	"bags",
	"weaving_contract_terry",
)
LIST_FIELDS = (
	"name",
	"title",
	"material_request_type",
	"customer",
	"transaction_date",
	"schedule_date",
	"status",
	"docstatus",
	"per_ordered",
	"per_received",
	"modified",
)
SORTABLE = {"modified", "transaction_date", "schedule_date", "name"}

# List tabs → status filters
STATUS_TABS = {
	"draft": ["=", "Draft"],
	"pending": ["in", ["Pending", "Partially Ordered", "Partially Received"]],
	"completed": ["in", ["Ordered", "Received", "Transferred", "Issued"]],
	"stopped": ["=", "Stopped"],
	"cancelled": ["=", "Cancelled"],
}
DOC_PTYPES = ("read", "write", "create", "delete", "submit", "cancel", "amend", "print")


def _permissions(doc=None) -> dict[str, bool]:
	return {p: bool(frappe.has_permission(DOCTYPE, p, doc=doc)) for p in DOC_PTYPES}


def _titles(doctype: str, field: str, names) -> dict:
	names = [n for n in set(names) if n]
	if not names:
		return {}
	return dict(frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True))


def _serialize(doc) -> dict:
	data = doc.as_dict(no_default_fields=False, convert_dates_to_str=True)
	data["modified"] = str(doc.modified) if doc.modified else None
	data["customer_title"] = _titles("Customer", "customer_name", [doc.customer]).get(doc.customer)
	data["contracts"] = sorted({row.get("weaving_contract_terry") for row in doc.items} - {None, ""})
	# Yarn items per linked contract, to limit the item picker on contract rows
	data["contract_items"] = {
		c: list(dict.fromkeys(y["item_code"] for y in _contract_yarn(c, check=False)["yarn"]))
		for c in data["contracts"]
	}
	return data


def _contract_yarn(name: str, check: bool = True) -> dict:
	"""A Weaving Contract Terry's buyer and its yarn clubbed per Article and Type."""
	from towel_production.towel_production.doctype.weaving_contract_terry.weaving_contract_terry import (
		get_yarn_by_article_type,
	)

	contract = frappe.get_doc("Weaving Contract Terry", name)
	if check:
		contract.check_permission("read")
	return {"customer": contract.buyers_name, "yarn": get_yarn_by_article_type(contract)}


def _set_from_contracts(request) -> None:
	"""Rows linked to a Weaving Contract Terry must match an Article + Type of that contract's
	Yarn Details and take their Bags from it; the request's customer is the contract's buyer."""
	contracts = {}
	for item in request.items:
		if not item.weaving_contract_terry:
			item.type = item.bags = None
			continue
		name = item.weaving_contract_terry
		if name not in contracts:
			contracts[name] = _contract_yarn(name)
		yarn = next(
			(
				y
				for y in contracts[name]["yarn"]
				if y["item_code"] == item.item_code and (y["type"] or "") == (item.type or "")
			),
			None,
		)
		if not yarn:
			frappe.throw(
				_("Row {0}: {1} ({2}) is not in the Yarn Details of Weaving Contract {3}.").format(
					item.idx, frappe.bold(item.item_code), item.type or _("no type"), frappe.bold(name)
				)
			)
		item.bags = yarn["bags"]

	buyers = {c["customer"] for c in contracts.values()}
	if len(buyers) > 1:
		frappe.throw(_("All weaving contracts on one request must belong to the same buyer."))
	if buyers:
		request.material_request_type = "Customer Provided"
		request.customer = buyers.pop()


def _defaults() -> dict:
	company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	return {
		"company": company,
		"transaction_date": nowdate(),
		"schedule_date": nowdate(),
		"set_warehouse": frappe.db.get_single_value("Stock Settings", "default_warehouse"),
	}


@page_api(PAGE)
def get_list(
	txt: str | None = None,
	tab: str | None = None,
	purpose: str | None = None,
	customer: str | None = None,
	contract: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	start: int = 0,
	page_length: int = 20,
	order_by: str | None = None,
) -> dict:
	start, page_length = paging(start, page_length)
	filters = []
	if tab in STATUS_TABS:
		filters.append(["status", *STATUS_TABS[tab]])
	if purpose:
		filters.append(["material_request_type", "=", purpose])
	if customer:
		filters.append(["customer", "=", customer])
	if contract:
		filters.append(["Material Request Item", "weaving_contract_terry", "=", contract])
	if from_date:
		filters.append(["transaction_date", ">=", getdate(from_date)])
	if to_date:
		filters.append(["transaction_date", "<=", getdate(to_date)])

	or_filters = None
	if pattern := like(txt):
		or_filters = [["name", "like", pattern], ["title", "like", pattern], ["customer", "like", pattern]]

	field, _sep, direction = (order_by or "modified desc").partition(" ")
	if field not in SORTABLE or direction not in ("asc", "desc"):
		field, direction = "modified", "desc"

	rows = frappe.get_list(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=list(LIST_FIELDS),
		order_by=f"{field} {direction}",
		limit_start=start,
		limit_page_length=page_length,
		distinct=True,
	)

	# Item totals and linked contracts for the rows on this page
	totals = {}
	if rows:
		for item in frappe.get_all(
			"Material Request Item",
			filters={"parenttype": DOCTYPE, "parent": ["in", [r.name for r in rows]]},
			fields=["parent", "qty", "bags", "weaving_contract_terry"],
		):
			entry = totals.setdefault(item.parent, {"items": 0, "qty": 0, "bags": 0, "contracts": set()})
			entry["items"] += 1
			entry["qty"] += flt(item.qty)
			entry["bags"] += flt(item.bags)
			if item.weaving_contract_terry:
				entry["contracts"].add(item.weaving_contract_terry)

	customers = _titles("Customer", "customer_name", [r.customer for r in rows])
	for row in rows:
		entry = totals.get(row.name, {"items": 0, "qty": 0, "bags": 0, "contracts": set()})
		row.update({**entry, "contracts": sorted(entry["contracts"])})
		row["customer_title"] = customers.get(row.customer, row.customer)

	return {"rows": rows, "total": count(DOCTYPE, filters, or_filters), "start": start}


@page_api(PAGE)
def get_meta() -> dict:
	meta = frappe.get_meta(DOCTYPE)
	return {
		"purposes": [o for o in (meta.get_field("material_request_type").options or "").split("\n") if o],
		"yarn_types": [
			o for o in (frappe.get_meta("Yarn Details").get_field("type").options or "").split("\n") if o
		],
		"defaults": _defaults(),
		"permissions": _permissions(),
	}


@page_api(PAGE)
def get(name: str) -> dict:
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission("read")
	return {"doc": _serialize(doc), "permissions": _permissions(doc)}


@page_api(PAGE)
def new(contract: str | None = None, amend: str | None = None) -> dict:
	"""An unsaved document: blank, a Yarn Request built from a contract, or an amendment."""
	if contract:
		from towel_production.towel_production.doctype.weaving_contract_terry.weaving_contract_terry import (
			make_yarn_request,
		)

		doc = make_yarn_request(contract)
		doc.company = doc.company or _defaults()["company"]
		doc.transaction_date = nowdate()
	elif amend:
		source = frappe.get_doc(DOCTYPE, amend)
		source.check_permission("amend")
		if source.docstatus != 2:
			frappe.throw(_("Only cancelled requests can be amended."))
		doc = frappe.copy_doc(source)
		doc.amended_from = source.name
	else:
		doc = frappe.new_doc(DOCTYPE)
		doc.update(_defaults())
		doc.material_request_type = "Customer Provided"

	if not frappe.has_permission(DOCTYPE, "create"):
		frappe.throw(_("You are not allowed to create a Material Request."), frappe.PermissionError)
	data = _serialize(doc)
	data["name"] = None
	return {"doc": data}


@page_api(PAGE, methods=["POST"])
def save(doc, submit: int = 0) -> dict:
	data = parse_json(doc, {})
	name = data.get("name")

	if name:
		request = frappe.get_doc(DOCTYPE, name)
		request.check_permission("write")
		if request.docstatus != 0:
			frappe.throw(_("Submitted or cancelled requests can't be edited."))
		if data.get("modified") and str(request.modified) != data["modified"]:
			frappe.throw(_("This request was changed by someone else. Reload and try again."))
	else:
		request = frappe.new_doc(DOCTYPE)
		if data.get("amended_from"):
			frappe.get_doc(DOCTYPE, data["amended_from"]).check_permission("amend")
			request.amended_from = data["amended_from"]

	for fieldname in HEADER_FIELDS:
		if fieldname in data:
			request.set(fieldname, data[fieldname] or None)
	if request.material_request_type != "Customer Provided":
		request.customer = None

	rows = []
	for row in data.get("items") or []:
		clean = {k: row.get(k) or None for k in ITEM_FIELDS if k in row}
		clean["schedule_date"] = clean.get("schedule_date") or request.schedule_date
		clean["warehouse"] = clean.get("warehouse") or request.set_warehouse
		if row.get("name") and not str(row["name"]).startswith("new-"):
			clean["name"] = row["name"]
		rows.append(clean)
	request.set("items", rows)
	_set_from_contracts(request)
	# ERPNext fills a missing UOM with the stock UOM; a chosen UOM needs its conversion factor
	for item in request.items:
		if item.uom and item.item_code:
			stock_uom = frappe.get_cached_value("Item", item.item_code, "stock_uom")
			if item.uom == stock_uom:
				item.conversion_factor = 1
			else:
				item.conversion_factor = flt(get_conversion_factor(item.item_code, item.uom).get("conversion_factor")) or 1

	if request.is_new():
		request.insert()
	else:
		request.save()
	if cint(submit):
		request.submit()
	return {"doc": _serialize(request), "permissions": _permissions(request)}


def _load(name: str, ptype: str):
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission(ptype)
	return doc


@page_api(PAGE, methods=["POST"])
def submit(name: str) -> dict:
	doc = _load(name, "submit")
	doc.submit()
	return {"doc": _serialize(doc), "permissions": _permissions(doc)}


@page_api(PAGE, methods=["POST"])
def cancel(name: str) -> dict:
	doc = _load(name, "cancel")
	doc.cancel()
	return {"doc": _serialize(doc), "permissions": _permissions(doc)}


@page_api(PAGE, methods=["POST"])
def set_status(name: str, status: str) -> dict:
	"""Stop a submitted request, or re-open a stopped one."""
	if status not in ("Stopped", "Submitted"):
		frappe.throw(_("Invalid status"))
	doc = _load(name, "write")
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted requests can be stopped or re-opened."))
	update_status(name, status)
	doc.reload()
	return {"doc": _serialize(doc), "permissions": _permissions(doc)}


@page_api(PAGE, methods=["POST"])
def delete(name: str) -> dict:
	frappe.delete_doc(DOCTYPE, name)
	return {"deleted": name}


@page_api(PAGE)
def get_item_details(item_code: str, contract: str | None = None) -> dict:
	"""Item name and UOM; with a contract, also that article's yarn clubbed per Type from the
	contract's Yarn Details, as `yarn: [{type, qty, bags}]`."""
	item = frappe.get_cached_value("Item", item_code, ["item_name", "stock_uom"], as_dict=True)
	if not item or not frappe.has_permission("Item", "read"):
		frappe.throw(_("Item {0} not found").format(item_code))
	details = {"item_name": item.item_name, "uom": item.stock_uom, "stock_uom": item.stock_uom}
	if contract:
		yarn = [y for y in _contract_yarn(contract)["yarn"] if y["item_code"] == item_code]
		if not yarn:
			frappe.throw(_("{0} is not an article in the Yarn Details of Weaving Contract {1}.").format(item_code, contract))
		details["yarn"] = yarn
	return details
