"""Generic CRUD for the master-data resources declared in `tp/config/resources.py`."""

import frappe
from frappe import _

from tp.access import get_doctype_permissions, has_page_access
from tp.api.listview import MAX_PAGE_LENGTH, list_filters, sort_clause
from tp.api.utils import count, duplicate_doc, like, paging, parse_json
from tp.config.resources import RESOURCES


def _resource(key: str) -> dict:
	resource = RESOURCES.get(key)
	if not resource:
		frappe.throw(_("Unknown resource {0}").format(key), frappe.DoesNotExistError)
	if not any(has_page_access(page) for page in (resource["page"], *resource.get("pages", ()))):
		frappe.throw(_("You do not have access to this page."), frappe.PermissionError)
	return resource


# DocType field types the portal form can render, mapped to the form's fieldtype
FORM_FIELDTYPES = {
	"Data": "Data",
	"Link": "Link",
	"Select": "Select",
	"Check": "Check",
	"Int": "Int",
	"Float": "Float",
	"Currency": "Currency",
	"Percent": "Percent",
	"Date": "Date",
	"Color": "Color",
	"Small Text": "Small Text",
	"Text": "Text",
	"Long Text": "Text",
	"Text Editor": "Text",
}


def _default(df):
	"""A DocField default as the form expects it (meta stores Check defaults as "0" / "1")."""
	return frappe.utils.cint(df.default) if df.fieldtype == "Check" else df.default


def form_fields(resource: dict) -> list[dict]:
	"""The configured form fields, completed from the DocType: Select options and defaults
	missing from the config, and the user's default for `user_default` Link fields."""
	meta = frappe.get_meta(resource["doctype"])
	fields = []
	for field in resource["form_fields"]:
		field = dict(field)
		df = meta.get_field(field["fieldname"])
		if df and field["fieldtype"] == "Select" and "options" not in field:
			field["options"] = df.options or ""
		if df and "default" not in field and df.default and not str(df.default).startswith(":"):
			field["default"] = _default(df)
		if field.pop("user_default", None) and field.get("options"):
			default = frappe.defaults.get_user_default(field["options"])
			if default:
				field["default"] = default
		fields.append(field)
	return fields


def extra_fields(resource: dict) -> list[dict]:
	"""Editable DocType fields beyond `form_fields` that users may add to the form (see get_fields)."""
	meta = frappe.get_meta(resource["doctype"])
	standard = {f["fieldname"] for f in resource["form_fields"]}
	fields, section = [], None
	for df in meta.fields:
		if df.fieldtype in ("Section Break", "Tab Break"):
			section = _(df.label) if df.label else section
			continue
		if (
			df.fieldname in standard
			or df.fieldtype not in FORM_FIELDTYPES
			or df.hidden
			or df.read_only
			or df.permlevel
			or df.is_virtual
		):
			continue
		field = {
			"fieldname": df.fieldname,
			"label": _(df.label or df.fieldname),
			"fieldtype": FORM_FIELDTYPES[df.fieldtype],
			"section": section or _("Details"),
		}
		if df.fieldtype in ("Link", "Select") and df.options:
			field["options"] = df.options
		if df.default and not str(df.default).startswith(":"):
			field["default"] = _default(df)
		for key in ("reqd", "set_only_once", "description"):
			if df.get(key):
				field[key] = _(df.description) if key == "description" else 1
		fields.append(field)
	return fields


def _writable_fields(resource: dict) -> dict[str, dict]:
	return {f["fieldname"]: f for f in (*form_fields(resource), *extra_fields(resource))}


def _list_fieldnames(resource: dict) -> list[str]:
	fields = {"name", "modified"} | {f["fieldname"] for f in resource["list_fields"]}
	fields |= {f["sub"] for f in resource["list_fields"] if f.get("sub")}
	return sorted(fields)


def _form_values(resource: dict, doc) -> dict:
	values = {"name": doc.name, "modified": str(doc.modified)}
	for field in _writable_fields(resource).values():
		fieldname = field["fieldname"]
		values[fieldname] = doc.name if fieldname == "__newname" else doc.get(fieldname)
	return values


@frappe.whitelist(methods=["GET", "POST"])
def get_list(
	resource: str,
	txt: str | None = None,
	tab: str | None = None,
	start: int = 0,
	page_length: int = 20,
	filters=None,
	order_by: str | None = None,
) -> dict:
	config = _resource(resource)
	doctype = config["doctype"]
	start, page_length = paging(start, page_length, MAX_PAGE_LENGTH)

	tab_def = next((t for t in config.get("tabs", ()) if t["key"] == tab), None)
	tab_filters = tab_def["filters"] if tab_def else {}
	filters = [
		[doctype, field, *(value if isinstance(value, list) else ["=", value])]
		for field, value in tab_filters.items()
	] + list_filters(doctype, filters)
	or_filters = None
	if pattern := like(txt):
		or_filters = {field: ["like", pattern] for field in config["search_fields"]}

	rows = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=_list_fieldnames(config),
		order_by=sort_clause(doctype, order_by, config.get("order_by", "modified desc")),
		limit_start=start,
		limit_page_length=page_length,
		distinct=True,
	)
	return {"rows": rows, "total": count(doctype, filters, or_filters), "start": start}


@frappe.whitelist(methods=["GET"])
def get_fields(resource: str) -> dict:
	"""Fields a user can choose to show in the form: the configured ones plus the DocType's
	other editable fields. Required fields are locked: they must always stay in the form."""
	config = _resource(resource)
	frappe.has_permission(config["doctype"], "read", throw=True)
	standard = [{**f, "standard": 1} for f in form_fields(config)]
	fields = [*standard, *extra_fields(config)]
	for field in fields:
		if field.get("reqd") and field["fieldtype"] != "Check":
			field["locked"] = 1
	return {"fields": fields}


@frappe.whitelist(methods=["GET"])
def get(resource: str, name: str) -> dict:
	config = _resource(resource)
	doc = frappe.get_doc(config["doctype"], name)
	doc.check_permission("read")
	return {"doc": _form_values(config, doc), "permissions": get_doctype_permissions(config["doctype"])}


@frappe.whitelist(methods=["GET"])
def get_copy(resource: str, name: str) -> dict:
	"""Form values for a new record copied from `name` (Duplicate). Fields that identify a record
	(its name, the naming field, unique fields) are left empty to be filled in."""
	config = _resource(resource)
	doctype = config["doctype"]
	doc = duplicate_doc(doctype, name)
	meta = frappe.get_meta(doctype)
	autoname = (meta.autoname or "").lower()
	identity = {"__newname", "name"}
	if autoname.startswith("field:"):
		identity.add(autoname[len("field:") :])
	identity |= {df.fieldname for df in meta.fields if df.unique}

	values = {}
	for field in _writable_fields(config).values():
		fieldname = field["fieldname"]
		values[fieldname] = None if fieldname in identity else doc.get(fieldname)
	return {"values": values, "source": name}


@frappe.whitelist(methods=["POST"])
def save(resource: str, data, name: str | None = None) -> dict:
	config = _resource(resource)
	data = parse_json(data, {})
	fields = _writable_fields(config)

	if name:
		doc = frappe.get_doc(config["doctype"], name)
		doc.check_permission("write")
		if data.get("modified") and str(doc.modified) != data["modified"]:
			frappe.throw(_("This record was changed by someone else. Reload and try again."))
	else:
		doc = frappe.new_doc(config["doctype"])

	for fieldname, field in fields.items():
		if fieldname not in data or (name and field.get("set_only_once")):
			continue
		value = data[fieldname]
		if field["fieldtype"] == "Check":
			value = 1 if value else 0
		doc.set(fieldname, value)

	if name:
		doc.save()
	else:
		doc.insert()
	return {"doc": _form_values(config, doc)}


@frappe.whitelist(methods=["POST"])
def delete(resource: str, name: str):
	config = _resource(resource)
	frappe.delete_doc(config["doctype"], name)
	return {"deleted": name}
