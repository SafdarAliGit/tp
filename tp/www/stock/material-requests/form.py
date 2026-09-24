import frappe

from tp.portal import build_context

no_cache = 1


def get_context(context):
	name = frappe.form_dict.get("name") or "new"
	is_new = name in ("new", "form")
	context.request_name = None if is_new else name
	build_context(
		context,
		"material-requests",
		request=context.request_name,
		contract=frappe.form_dict.get("contract") if is_new else None,
		amend=frappe.form_dict.get("amend") if is_new else None,
	)
	context.title = "New Material Request" if is_new else name
	return context
