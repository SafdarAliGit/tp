"""The account list now lives on the Chart of Accounts page (List view); old links redirect."""

from urllib.parse import urlencode

import frappe

no_cache = 1


def get_context(context):
	query = {"view": "list"}
	if frappe.form_dict.get("open"):
		query["open"] = frappe.form_dict.open
	frappe.local.flags.redirect_location = f"/chart-of-accounts?{urlencode(query)}"
	raise frappe.Redirect(302)
