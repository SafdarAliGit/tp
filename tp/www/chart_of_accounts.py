import frappe

from tp.portal import build_context, resource_boot

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		return build_context(context, "chart-of-accounts")  # redirects to /login

	companies = frappe.get_list("Company", pluck="name", order_by="name asc")
	default = frappe.defaults.get_user_default("Company")
	return build_context(
		context,
		"chart-of-accounts",
		companies=companies,
		company=default if default in companies else (companies[0] if companies else None),
		resource=resource_boot("accounts"),
	)
