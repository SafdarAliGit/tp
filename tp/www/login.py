import frappe
from frappe.www.login import sanitize_redirect

from tp.portal import base_context

no_cache = 1


def get_context(context):
	redirect_to = sanitize_redirect(frappe.local.request.args.get("redirect-to")) or "/"
	if frappe.session.user != "Guest":
		frappe.local.flags.redirect_location = redirect_to
		raise frappe.Redirect(302)

	base_context(context)
	context.title = "Sign in"
	context.no_header = 1
	context.redirect_to = redirect_to
	context.disable_user_pass_login = frappe.utils.cint(frappe.get_system_settings("disable_user_pass_login"))
	return context
