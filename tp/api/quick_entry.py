"""Create a record from a Link field ("+ Create a new …"), like ERPNext's quick entry.

`get_info` tells the Link field how a new record of a DocType can be made:
  - "resource": the DocType has a master-data page (tp/config/resources.py) the user can open,
    so its own drawer form is used;
  - "fields": otherwise a quick-entry dialog with the DocType's mandatory fields (plus fields
    flagged "Allow in Quick Entry"), created by `create`;
  - "new_url": when a quick entry isn't possible (e.g. a mandatory table), the full form opens
    in a new tab: the portal's form page, else the desk.
Only DocTypes the portal's Link fields may search can be created, always with the user's own
`create` permission.
"""

import frappe
from frappe import _
from frappe.utils import cint

from tp.access import get_link_routes, has_page_access
from tp.api.resources import FORM_FIELDTYPES, form_fields
from tp.api.search import _searchable_doctypes
from tp.api.utils import parse_json
from tp.config.resources import RESOURCES


def _check(doctype: str):
	if doctype not in _searchable_doctypes():
		frappe.throw(_("{0} can't be created here.").format(doctype), frappe.PermissionError)
	frappe.has_permission(doctype, "create", throw=True)


def _resource_for(doctype: str) -> dict | None:
	for key, config in RESOURCES.items():
		if config["doctype"] == doctype and has_page_access(config["page"]):
			return {
				"key": key,
				"singular": config["singular"],
				"title_field": config["title_field"],
				"form_fields": form_fields(config),
			}
	return None


def _quick_fields(doctype: str) -> list[dict] | None:
	"""Quick-entry fields, or None when the DocType needs its full form."""
	meta = frappe.get_meta(doctype)
	autoname = (meta.autoname or "").lower()
	name_field = autoname[len("field:") :] if autoname.startswith("field:") else None
	title_field = meta.title_field if meta.title_field and meta.title_field != "name" else None
	# Tree DocTypes (Item Group, Territory…): also ask where the new node goes
	tree_fields = (
		(meta.nsm_parent_field or f"parent_{frappe.scrub(doctype)}", "is_group") if meta.is_tree else ()
	)

	fields = []
	if autoname == "prompt":
		fields.append(
			{
				"fieldname": "__newname",
				"label": _("{0} Name").format(_(doctype)),
				"fieldtype": "Data",
				"reqd": 1,
			}
		)
	for df in meta.fields:
		wanted = (
			df.reqd
			or df.allow_in_quick_entry
			or df.fieldname in (name_field, title_field)
			or df.fieldname in tree_fields
		)
		if not wanted or df.read_only or (df.hidden and not df.reqd):
			continue
		if df.fieldtype in ("Table", "Table MultiSelect"):
			if df.reqd:
				return None
			continue
		if df.fieldtype not in FORM_FIELDTYPES:
			if df.reqd and not df.default:
				return None
			continue
		if df.reqd and df.hidden and not df.default:
			return None
		field = {
			"fieldname": df.fieldname,
			"label": _(df.label or df.fieldname),
			"fieldtype": FORM_FIELDTYPES[df.fieldtype],
		}
		if df.fieldtype in ("Link", "Select") and df.options:
			field["options"] = df.options
		if df.default and not str(df.default).startswith(":"):
			field["default"] = cint(df.default) if df.fieldtype == "Check" else df.default
		if df.reqd or df.fieldname == name_field:
			field["reqd"] = 1
		if df.description:
			field["description"] = _(df.description)
		if tree_fields and df.fieldname == tree_fields[0]:
			field["filters"] = {"is_group": 1}
		fields.append(field)
	return fields or None


def _new_url(doctype: str) -> str | None:
	route = get_link_routes().get(doctype)
	if route and "?open=" not in route:
		return route.replace("{name}", "new")
	if frappe.get_cached_value("User", frappe.session.user, "user_type") == "System User":
		return f"/desk/{frappe.scrub(doctype).replace('_', '-')}/new"
	return None


@frappe.whitelist(methods=["GET"])
def get_info(doctype: str) -> dict:
	"""How a Link field can create a `doctype` record for the current user (see module docstring)."""
	if doctype not in _searchable_doctypes() or not frappe.has_permission(doctype, "create"):
		return {"can_create": False}
	# Documents with their own portal form (contracts, requests…) are created there
	route = get_link_routes().get(doctype)
	if route and "?open=" not in route:
		return {"can_create": True, "new_url": _new_url(doctype)}
	if resource := _resource_for(doctype):
		return {"can_create": True, "resource": resource}
	if fields := _quick_fields(doctype):
		title = frappe.get_meta(doctype).title_field
		return {"can_create": True, "fields": fields, "title_field": title if title != "name" else None}
	url = _new_url(doctype)
	return {"can_create": bool(url), "new_url": url}


@frappe.whitelist(methods=["POST"])
def create(doctype: str, data) -> dict:
	"""Insert a record from the quick-entry dialog; only the quick-entry fields are taken."""
	_check(doctype)
	fields = _quick_fields(doctype)
	if not fields:
		frappe.throw(_("{0} needs its full form.").format(doctype))
	data = parse_json(data, {}) or {}
	doc = frappe.new_doc(doctype)
	for field in fields:
		value = data.get(field["fieldname"])
		if value in (None, ""):
			continue
		doc.set(field["fieldname"], cint(value) if field["fieldtype"] == "Check" else value)
	doc.insert()
	title = frappe.get_meta(doctype).get_title_field()
	return {"value": doc.name, "label": doc.get(title) if title != "name" else doc.name}
