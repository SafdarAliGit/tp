import frappe

from tp.access import clear_access_cache
from tp.config.pages import DEFAULT_ROLES, PAGES


def after_install():
	after_migrate()


def after_migrate():
	sync_pages()
	ensure_item_groups()


def _doctype_roles(doctype: str) -> list[str]:
	"""Roles that already have read access to `doctype` (standard + custom permissions)."""
	roles = set()
	for perm_doctype in ("DocPerm", "Custom DocPerm"):
		roles.update(
			frappe.get_all(perm_doctype, filters={"parent": doctype, "permlevel": 0, "read": 1}, pluck="role")
		)
	roles.discard("Desk User")
	return sorted(roles | set(DEFAULT_ROLES))


def sync_pages():
	"""Create a Page Access record for each registered page. Existing records are left
	untouched so role changes made by administrators survive migrations."""
	for page in PAGES:
		if frappe.db.exists("Page Access", page["page"]):
			continue
		doctype = page.get("reference_doctype")
		if doctype and not frappe.db.exists("DocType", doctype):
			continue
		roles = page.get("roles") or (_doctype_roles(doctype) if doctype else DEFAULT_ROLES)
		doc = frappe.get_doc(
			{
				"doctype": "Page Access",
				**{k: v for k, v in page.items() if k not in ("roles", "form_route")},
				"enabled": 1,
				"show_in_sidebar": 1,
				"roles": [{"role": role} for role in roles if frappe.db.exists("Role", role)],
			}
		)
		doc.insert(ignore_permissions=True)
	clear_access_cache()


def ensure_item_groups():
	"""The contract form filters articles by "Products" and yarn counts by "Yarn"."""
	parent = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ["in", ["", None]]})
	if not parent:
		return
	for group in ("Products", "Yarn"):
		if not frappe.db.exists("Item Group", group):
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": group,
					"parent_item_group": parent,
					"is_group": 0,
				}
			).insert(ignore_permissions=True)
