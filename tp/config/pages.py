"""Portal page registry.

`form_route` marks pages that open single documents in the portal; links to those documents
(e.g. a contract's Connections) use it instead of the desk.

Every portal page is declared here once. `tp.setup.install.sync_pages` creates a matching
**Page Access** record on install/migrate (existing records are never overwritten), and
administrators then adjust roles, order and visibility from the desk.
"""

# Roles that get access when a page has no reference DocType to derive them from.
DEFAULT_ROLES = ("System Manager",)

PAGES = (
	{
		"page": "home",
		"title": "Dashboard",
		"route": "/",
		"icon": "home",
		"section": "Overview",
		"sequence": 10,
		"roles": ("All",),
		"description": "Production overview. Widgets respect the user's DocType permissions.",
	},
	{
		"page": "contracts",
		"title": "Weaving Contracts",
		"route": "/contracts",
		"form_route": "/contracts/{name}",
		"icon": "file-text",
		"section": "Production",
		"sequence": 20,
		"reference_doctype": "Weaving Contract Terry",
	},
	{
		"page": "material-requests",
		"title": "Material Requests",
		"route": "/stock/material-requests",
		"form_route": "/stock/material-requests/{name}",
		"icon": "clipboard-list",
		"section": "Stock",
		"sequence": 25,
		"reference_doctype": "Material Request",
	},
	{
		"page": "items",
		"title": "Items",
		"route": "/items",
		"icon": "package",
		"section": "Masters",
		"sequence": 30,
		"reference_doctype": "Item",
	},
	{
		"page": "customers",
		"title": "Customers",
		"route": "/customers",
		"icon": "users",
		"section": "Masters",
		"sequence": 40,
		"reference_doctype": "Customer",
	},
	{
		"page": "colors",
		"title": "Colors",
		"route": "/colors",
		"icon": "palette",
		"section": "Masters",
		"sequence": 50,
		"reference_doctype": "Color",
	},
	{
		"page": "chart-of-accounts",
		"title": "Chart of Accounts",
		"route": "/chart-of-accounts",
		"icon": "list-tree",
		"section": "Accounting",
		"sequence": 60,
		"reference_doctype": "Account",
		"description": "Account tree with balances, and the account list (Tree | List). Actions follow the user's Account permissions.",
	},
	{
		"page": "general-ledger",
		"title": "General Ledger",
		"route": "/general-ledger",
		"icon": "book-open",
		"section": "Accounting",
		"sequence": 65,
		"reference_doctype": "GL Entry",
		"description": "Ledger entries with opening, totals and closing balances (ERPNext's General Ledger report).",
	},
)

SECTION_ORDER = ("Overview", "Production", "Stock", "Accounting", "Masters")
