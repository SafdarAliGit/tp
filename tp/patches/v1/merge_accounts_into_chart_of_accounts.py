"""The Accounts list moved onto the Chart of Accounts page: drop its own Page Access record."""

import frappe

from tp.access import clear_access_cache


def execute():
	if frappe.db.exists("Page Access", "accounts"):
		frappe.delete_doc("Page Access", "accounts", ignore_permissions=True, force=True)
	clear_access_cache()
