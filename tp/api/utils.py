import functools
import json

import frappe

from tp.access import require_page_access


def page_api(page: str, methods=("GET", "POST")):
	"""Whitelist a method and require access to a portal page before running it.

	Usage:
	        @page_api("contracts")
	        def get_list(...): ...

	        @page_api("contracts", methods=["POST"])
	        def cancel(...): ...
	"""

	def decorator(fn):
		@functools.wraps(fn)
		def wrapper(*args, **kwargs):
			require_page_access(page)
			return fn(*args, **kwargs)

		return frappe.whitelist(methods=list(methods))(wrapper)

	return decorator


def parse_json(value, default=None):
	if value in (None, ""):
		return default
	if isinstance(value, str):
		return json.loads(value)
	return value


def paging(start, page_length, max_length: int = 100) -> tuple[int, int]:
	return max(frappe.utils.cint(start), 0), min(max(frappe.utils.cint(page_length) or 20, 1), max_length)


def count(doctype: str, filters=None, or_filters=None) -> int:
	if any(isinstance(f, list | tuple) and len(f) == 4 and f[0] != doctype for f in filters or ()):
		# A child-table filter joins the child rows: count each document once
		return len(
			frappe.get_list(
				doctype,
				filters=filters,
				or_filters=or_filters,
				pluck="name",
				distinct=True,
				limit_page_length=0,
			)
		)
	rows = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}]
	)
	return frappe.utils.cint(rows[0].total) if rows else 0


def like(txt: str | None) -> str | None:
	txt = (txt or "").strip()
	return f"%{txt}%" if txt else None


def duplicate_doc(doctype: str, name: str):
	"""An unsaved copy of `name`, like ERPNext's "Duplicate": no-copy fields start from the
	defaults of a new document (series, today's date, Draft status…) and it is always a draft."""
	source = frappe.get_doc(doctype, name)
	source.check_permission("read")
	frappe.has_permission(doctype, "create", throw=True)
	doc = frappe.copy_doc(source, ignore_no_copy=False)
	doc.docstatus = 0
	blank = frappe.new_doc(doctype)
	for df in frappe.get_meta(doctype).fields:
		if df.no_copy and blank.get(df.fieldname) not in (None, ""):
			doc.set(df.fieldname, blank.get(df.fieldname))
	if doc.meta.has_field("amended_from"):
		doc.amended_from = None
	return doc
