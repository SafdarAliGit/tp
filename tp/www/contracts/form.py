import frappe

from tp.portal import build_context

no_cache = 1


def get_context(context):
	name = frappe.form_dict.get("name") or "new"
	is_new = name in ("new", "form")
	context.contract_name = None if is_new else name
	build_context(context, "contracts", contract=context.contract_name)
	context.title = "New Contract" if is_new else name
	return context
