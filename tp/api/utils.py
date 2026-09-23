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
	rows = frappe.get_list(
		doctype, filters=filters, or_filters=or_filters, fields=[{"COUNT": "*", "as": "total"}]
	)
	return frappe.utils.cint(rows[0].total) if rows else 0


def like(txt: str | None) -> str | None:
	txt = (txt or "").strip()
	return f"%{txt}%" if txt else None
