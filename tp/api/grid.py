"""Child-table (grid) metadata for the portal's editable grids: every field of a child table the
user may read, and whether the portal form may write it. Used by "Configure columns" and the
row edit form (tp/public/js/components/grid.js)."""

import frappe
from frappe import _
from frappe.model import no_value_fields, table_fields

from tp.api.resources import FORM_FIELDTYPES

# Shown read-only: types the portal form has no editor for
DISPLAY_FIELDTYPES = {"Datetime", "Time", "Read Only", "Dynamic Link", "Duration", "Rating", "Attach"}


def editable_child_fields(doctype: str) -> set[str]:
	"""Fields of a child DocType a portal form may write (the parent's save filters rows by it)."""
	return {
		df.fieldname
		for df in frappe.get_meta(doctype).fields
		if df.fieldtype not in no_value_fields and not df.read_only and df.fieldtype in FORM_FIELDTYPES
	}


@frappe.whitelist(methods=["GET"])
def get_fields(doctype: str, fieldname: str) -> dict:
	"""Fields of the child table `fieldname` of `doctype`, in form order, grouped by section."""
	frappe.has_permission(doctype, "read", throw=True)
	table = frappe.get_meta(doctype).get_field(fieldname)
	if not table or table.fieldtype not in table_fields:
		frappe.throw(_("{0} is not a table of {1}.").format(fieldname, doctype))

	child = table.options
	meta = frappe.get_meta(child)
	permitted = set(meta.get_permitted_fieldnames(parenttype=doctype, with_virtual_fields=False))
	writable = (
		set(
			meta.get_permitted_fieldnames(
				parenttype=doctype, permission_type="write", with_virtual_fields=False
			)
		)
		or permitted
	)
	editable = editable_child_fields(child)

	fields, section = [], None
	for df in meta.fields:
		if df.fieldtype in ("Section Break", "Tab Break"):
			section = _(df.label) if df.label else section
			continue
		if df.hidden or df.fieldname not in permitted:
			continue
		if df.fieldtype not in FORM_FIELDTYPES and df.fieldtype not in DISPLAY_FIELDTYPES:
			continue
		field = {
			"fieldname": df.fieldname,
			"label": _(df.label or df.fieldname),
			"fieldtype": FORM_FIELDTYPES.get(df.fieldtype, "Data"),
			"section": section or _("Details"),
		}
		if df.fieldtype in ("Link", "Select") and df.options:
			field["options"] = df.options
		if df.fieldtype in ("Int", "Float", "Currency", "Percent"):
			field["numeric"] = 1
		if df.reqd:
			field["reqd"] = 1
		if df.in_list_view:
			field["in_list_view"] = 1
		if df.fieldname in editable and df.fieldname in writable:
			field["editable"] = 1
		if df.description:
			field["description"] = _(df.description)
		fields.append(field)
	return {"doctype": child, "label": _(table.label or child), "fields": fields}
