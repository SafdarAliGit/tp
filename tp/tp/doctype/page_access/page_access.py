# Copyright (c) 2026, Safdar Ali and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from tp.access import clear_access_cache


class PageAccess(Document):
	def validate(self):
		self.route = "/" + (self.route or "").strip().strip("/")
		roles = [row.role for row in self.roles]
		if len(roles) != len(set(roles)):
			frappe.throw(_("Each role can only be added once."))

	def on_update(self):
		clear_access_cache()

	def on_trash(self):
		clear_access_cache()
