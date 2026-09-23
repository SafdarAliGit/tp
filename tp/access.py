"""Role-based access for portal pages.

A user can open a page when:
  1. the page's **Page Access** record is enabled,
  2. the user has at least one of its roles (standard Frappe/ERPNext roles), and
  3. if a Reference DocType is set, Frappe grants the user `read` on it.

Create / write / delete inside a page always follow Frappe's own DocType permissions,
so ERPNext role profiles, User Permissions and permission levels keep working.
"""

import frappe
from frappe import _

from tp.config.pages import SECTION_ORDER

CACHE_KEY = "tp:page_access"
PTYPES = ("read", "create", "write", "delete", "print", "export")


def clear_access_cache(*args, **kwargs):
	frappe.cache.delete_value(CACHE_KEY)


def _load_pages() -> list[dict]:
	pages = frappe.get_all(
		"Page Access",
		fields=[
			"name",
			"page",
			"title",
			"route",
			"icon",
			"section",
			"sequence",
			"enabled",
			"show_in_sidebar",
			"reference_doctype",
		],
		order_by="sequence asc, title asc",
	)
	roles = frappe.get_all(
		"Page Access Role",
		filters={"parenttype": "Page Access"},
		fields=["parent", "role"],
	)
	by_parent: dict[str, list[str]] = {}
	for row in roles:
		by_parent.setdefault(row.parent, []).append(row.role)

	for page in pages:
		page["roles"] = by_parent.get(page.name, [])
	return pages


def get_all_pages() -> list[dict]:
	return frappe.cache.get_value(CACHE_KEY, _load_pages)


def _can_access(page: dict, user: str, user_roles: set[str]) -> bool:
	if user == "Guest" or not page.get("enabled"):
		return False
	if user != "Administrator" and not user_roles.intersection(page["roles"]):
		return False
	doctype = page.get("reference_doctype")
	if doctype and not frappe.has_permission(doctype, "read", user=user):
		return False
	return True


def get_allowed_pages(user: str | None = None) -> list[dict]:
	user = user or frappe.session.user
	user_roles = set(frappe.get_roles(user))
	return [frappe._dict(p) for p in get_all_pages() if _can_access(p, user, user_roles)]


def get_page(page: str) -> dict | None:
	return next((frappe._dict(p) for p in get_all_pages() if p["page"] == page), None)


def has_page_access(page: str, user: str | None = None) -> bool:
	user = user or frappe.session.user
	definition = get_page(page)
	return bool(definition) and _can_access(definition, user, set(frappe.get_roles(user)))


def require_page_access(page: str):
	"""Raise PermissionError unless the current user can open `page`."""
	if not has_page_access(page):
		frappe.throw(_("You do not have access to this page."), frappe.PermissionError)


def get_doctype_permissions(doctype: str | None) -> dict[str, bool]:
	if not doctype:
		return {ptype: False for ptype in PTYPES}
	return {ptype: bool(frappe.has_permission(doctype, ptype)) for ptype in PTYPES}


def get_navigation(user: str | None = None) -> list[dict]:
	"""Sidebar groups: [{"label": section, "items": [page, ...]}, ...]."""
	groups: dict[str, list] = {}
	for page in get_allowed_pages(user):
		if page.show_in_sidebar:
			groups.setdefault(page.section or _("Other"), []).append(
				{
					"page": page.page,
					"title": _(page.title),
					"route": page.route,
					"icon": page.icon or "circle",
				}
			)

	def order(section):
		return SECTION_ORDER.index(section) if section in SECTION_ORDER else len(SECTION_ORDER)

	return [{"label": _(s), "items": groups[s]} for s in sorted(groups, key=order)]
