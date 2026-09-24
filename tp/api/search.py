import frappe
from frappe import _
from frappe.utils.caching import site_cache

from tp.api.resources import extra_fields
from tp.api.utils import like, parse_json
from tp.config.resources import RESOURCES

# DocTypes the portal link fields may search. Results are still filtered by Frappe permissions.
CONTRACT_LINKS = {"Customer", "Item", "Color"}
MATERIAL_REQUEST_LINKS = {"Company", "Warehouse", "UOM", "Weaving Contract Terry"}


def _searchable_doctypes() -> set[str]:
	doctypes = _form_links() | _grid_links() | _report_links()
	return doctypes | _quick_entry_links(frozenset(doctypes))


@site_cache(ttl=600)
def _report_links() -> frozenset[str]:
	"""Filters of the portal's reports (General Ledger): accounts, parties, cost centers,
	projects, finance books and accounting dimensions."""
	links = {"Account", "Company", "Cost Center", "Project", "Finance Book"}
	links.update(frappe.get_all("Party Type", pluck="name"))
	links.update(frappe.get_all("Accounting Dimension", pluck="document_type"))
	return frozenset(d for d in links if frappe.db.exists("DocType", d))


@site_cache(ttl=600)
def _grid_links() -> frozenset[str]:
	"""Link targets of the child tables of the portal's document forms (contracts, requests…),
	which users can show and edit through the grid's "Configure columns"."""
	from tp.config.pages import PAGES

	links = set()
	for page in PAGES:
		if not page.get("form_route") or not page.get("reference_doctype"):
			continue
		for table in frappe.get_meta(page["reference_doctype"]).get_table_fields():
			for df in frappe.get_meta(table.options).fields:
				if df.fieldtype == "Link" and df.options:
					links.add(df.options)
	return frozenset(links)


def _form_links() -> set[str]:
	doctypes = CONTRACT_LINKS | MATERIAL_REQUEST_LINKS
	for resource in RESOURCES.values():
		doctypes.add(resource["doctype"])
		fields = (*resource["form_fields"], *extra_fields(resource))
		doctypes.update(f["options"] for f in fields if f["fieldtype"] == "Link" and f.get("options"))
	return doctypes


@site_cache(ttl=600)
def _quick_entry_links(doctypes: frozenset[str]) -> frozenset[str]:
	"""Link targets of the quick-entry dialogs (tp.api.quick_entry), e.g. UOM → UOM Category,
	so those fields can be searched (and created) too."""
	from tp.api.quick_entry import _quick_fields

	links = set()
	for doctype in doctypes:
		for field in _quick_fields(doctype) or ():
			if field["fieldtype"] == "Link" and field.get("options"):
				links.add(field["options"])
	return frozenset(links)


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
