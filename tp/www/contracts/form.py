import frappe

from tp.access import get_form_route
from tp.portal import build_context

no_cache = 1


def get_context(context):
	name = frappe.form_dict.get("name") or "new"
	is_new = name in ("new", "form")
	context.contract_name = None if is_new else name
	build_context(
		context,
		"contracts",
		contract=context.contract_name,
		yarn_request=bool(
			get_form_route("Material Request") and frappe.has_permission("Material Request", "create")
		),
	)
	context.title = "New Contract" if is_new else name
	return context
