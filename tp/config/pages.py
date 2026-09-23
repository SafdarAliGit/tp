"""Portal page registry.

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
		"icon": "file-text",
		"section": "Production",
		"sequence": 20,
		"reference_doctype": "Weaving Contract Terry",
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
		"description": "Account tree with balances. Actions follow the user's Account permissions.",
	},
	{
		"page": "accounts",
		"title": "Accounts",
		"route": "/accounts",
		"icon": "landmark",
		"section": "Accounting",
		"sequence": 70,
		"reference_doctype": "Account",
	},
)

SECTION_ORDER = ("Overview", "Production", "Accounting", "Masters")
