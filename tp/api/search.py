import frappe
from frappe import _

from tp.api.resources import extra_fields
from tp.api.utils import like, parse_json
from tp.config.resources import RESOURCES

# DocTypes the portal link fields may search. Results are still filtered by Frappe permissions.
CONTRACT_LINKS = {"Customer", "Item", "Color"}


def _searchable_doctypes() -> set[str]:
	doctypes = set(CONTRACT_LINKS)
	for resource in RESOURCES.values():
		doctypes.add(resource["doctype"])
		fields = (*resource["form_fields"], *extra_fields(resource))
		doctypes.update(f["options"] for f in fields if f["fieldtype"] == "Link" and f.get("options"))
	return doctypes


@frappe.whitelist(methods=["GET", "POST"])
def link(doctype: str, txt: str | None = None, filters=None, page_length: int = 10) -> list[dict]:
	"""Autocomplete for link fields: [{value, label, description}]."""
	if doctype not in _searchable_doctypes():
		frappe.throw(_("Search is not available for {0}").format(doctype), frappe.PermissionError)

	meta = frappe.get_meta(doctype)
	title_field = meta.title_field if meta.title_field and meta.title_field != "name" else None
	description_field = next(
		(f for f in ("item_group", "customer_group", "color", "description") if meta.has_field(f)), None
	)
	fields = ["name", *(f for f in (title_field, description_field) if f)]

	or_filters = None
	if pattern := like(txt):
		or_filters = {"name": ["like", pattern]}
		if title_field:
			or_filters[title_field] = ["like", pattern]

	filters = parse_json(filters, {}) or {}
	if meta.has_field("disabled"):
		filters.setdefault("disabled", 0)

	rows = frappe.get_list(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="modified desc" if not txt else None,
		limit_page_length=min(frappe.utils.cint(page_length) or 10, 50),
	)
	return [
		{
			"value": row.name,
			"label": row.get(title_field) if title_field else row.name,
			"description": row.get(description_field) if description_field else None,
		}
		for row in rows
	]
