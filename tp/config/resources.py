"""Master-data resources rendered by the generic list + drawer form UI.

To expose another DocType: add a Page to `tp/config/pages.py`, add a resource here and create
`tp/www/<route>.html/.py` (copy `items`). Only fields declared in `form_fields` can be written.

Form field extras (besides Frappe-like keys):
  - "depends_on": {"fieldname": value, ...}  show the field only while every value matches
  - "filters": {"company": {"field": "company"}}  a Link filter taken from another field's value
  - "user_default": 1  default to the user's default for the Link DocType (e.g. Company)
  - Select fields without "options" take them from the DocType
  - "pages": (...)  extra pages whose users may also use this resource (e.g. a tree view)
"""

RESOURCES = {
	"items": {
		"page": "items",
		"doctype": "Item",
		"singular": "Item",
		"title_field": "item_name",
		"search_fields": ("name", "item_name", "description"),
		"order_by": "modified desc",
		"tabs": (
			{"key": "all", "label": "All Items", "filters": {}},
			{"key": "articles", "label": "Articles", "filters": {"item_group": "Products"}},
			{"key": "yarn", "label": "Yarn", "filters": {"item_group": "Yarn"}},
		),
		"list_fields": (
			{"fieldname": "name", "label": "Item Code", "type": "code"},
			{"fieldname": "item_name", "label": "Item Name", "type": "title"},
			{"fieldname": "item_group", "label": "Group", "type": "badge"},
			{"fieldname": "stock_uom", "label": "Unit"},
			{"fieldname": "disabled", "label": "Status", "type": "status"},
		),
		"form_fields": (
			{
				"fieldname": "item_code",
				"label": "Item Code",
				"fieldtype": "Data",
				"reqd": 1,
				"set_only_once": 1,
			},
			{"fieldname": "item_name", "label": "Item Name", "fieldtype": "Data", "reqd": 1},
			{
				"fieldname": "item_group",
				"label": "Item Group",
				"fieldtype": "Link",
				"options": "Item Group",
				"reqd": 1,
				"default": "Products",
				"filters": {"is_group": 0},
			},
			{
				"fieldname": "stock_uom",
				"label": "Unit of Measure",
				"fieldtype": "Link",
				"options": "UOM",
				"reqd": 1,
				"default": "Nos",
			},
			{"fieldname": "description", "label": "Description", "fieldtype": "Small Text", "full": 1},
			{"fieldname": "disabled", "label": "Disabled", "fieldtype": "Check"},
		),
	},
	"customers": {
		"page": "customers",
		"doctype": "Customer",
		"singular": "Customer",
		"title_field": "customer_name",
		"search_fields": ("name", "customer_name"),
		"order_by": "modified desc",
		"tabs": (
			{"key": "all", "label": "All Customers", "filters": {}},
			{"key": "active", "label": "Active", "filters": {"disabled": 0}},
			{"key": "disabled", "label": "Disabled", "filters": {"disabled": 1}},
		),
		"list_fields": (
			{"fieldname": "customer_name", "label": "Customer", "type": "title"},
			{"fieldname": "name", "label": "ID", "type": "code"},
			{"fieldname": "customer_type", "label": "Type", "type": "badge"},
			{"fieldname": "customer_group", "label": "Group"},
			{"fieldname": "territory", "label": "Territory"},
			{"fieldname": "disabled", "label": "Status", "type": "status"},
		),
		"form_fields": (
			{"fieldname": "customer_name", "label": "Customer Name", "fieldtype": "Data", "reqd": 1},
			{
				"fieldname": "customer_type",
				"label": "Customer Type",
				"fieldtype": "Select",
				"options": "Company\nIndividual\nPartnership",
				"reqd": 1,
				"default": "Company",
			},
			{
				"fieldname": "customer_group",
				"label": "Customer Group",
				"fieldtype": "Link",
				"options": "Customer Group",
				"filters": {"is_group": 0},
			},
			{
				"fieldname": "territory",
				"label": "Territory",
				"fieldtype": "Link",
				"options": "Territory",
				"filters": {"is_group": 0},
			},
			{"fieldname": "disabled", "label": "Disabled", "fieldtype": "Check"},
		),
	},
	"colors": {
		"page": "colors",
		"doctype": "Color",
		"singular": "Color",
		"title_field": "name",
		"search_fields": ("name",),
		"order_by": "name asc",
		"list_fields": (
			{"fieldname": "color", "label": "", "type": "swatch", "width": "56px"},
			{"fieldname": "name", "label": "Color Name", "type": "title"},
			{"fieldname": "color", "label": "Hex", "type": "code"},
			{"fieldname": "modified", "label": "Last Updated", "type": "datetime"},
		),
		"form_fields": (
			# `__newname` sets the document name for prompt-named DocTypes such as Color
			{
				"fieldname": "__newname",
				"label": "Color Name",
				"fieldtype": "Data",
				"reqd": 1,
				"set_only_once": 1,
			},
			{"fieldname": "color", "label": "Color", "fieldtype": "Color", "reqd": 1, "default": "#5C2D91"},
		),
	},
	# Listed on the Chart of Accounts page (Tree | List); tp/www/accounts redirects there
	"accounts": {
		"page": "chart-of-accounts",
		"doctype": "Account",
		"singular": "Account",
		"title_field": "account_name",
		"search_fields": ("name", "account_name", "account_number", "parent_account"),
		"order_by": "lft asc",
		"tabs": (
			{"key": "all", "label": "All Accounts", "filters": {}},
			{"key": "ledgers", "label": "Ledgers", "filters": {"is_group": 0}},
			{"key": "groups", "label": "Groups", "filters": {"is_group": 1}},
			{"key": "bank", "label": "Bank & Cash", "filters": {"account_type": ["in", ["Bank", "Cash"]]}},
			{
				"key": "parties",
				"label": "Receivable / Payable",
				"filters": {"account_type": ["in", ["Receivable", "Payable"]]},
			},
			{"key": "disabled", "label": "Disabled", "filters": {"disabled": 1}},
		),
		"list_fields": (
			{"fieldname": "account_name", "label": "Account", "type": "title", "sub": "parent_account"},
			{"fieldname": "account_number", "label": "Number", "type": "code"},
			{"fieldname": "is_group", "label": "Kind", "type": "group"},
			{"fieldname": "root_type", "label": "Root Type", "type": "badge"},
			{"fieldname": "account_type", "label": "Account Type"},
			{"fieldname": "company", "label": "Company"},
			{"fieldname": "disabled", "label": "Status", "type": "status"},
		),
		"form_fields": (
			{"fieldname": "account_name", "label": "Account Name", "fieldtype": "Data", "reqd": 1},
			{
				"fieldname": "account_number",
				"label": "Account Number",
				"fieldtype": "Data",
				"description": "Optional. Becomes part of the account name, e.g. 1110 - Cash - TP.",
			},
			{
				"fieldname": "company",
				"label": "Company",
				"fieldtype": "Link",
				"options": "Company",
				"reqd": 1,
				"set_only_once": 1,
				"user_default": 1,
			},
			{
				"fieldname": "parent_account",
				"label": "Parent Account",
				"fieldtype": "Link",
				"options": "Account",
				"reqd": 1,
				"filters": {"is_group": 1, "company": {"field": "company"}},
			},
			{
				"fieldname": "is_group",
				"label": "Is Group (can hold other accounts)",
				"fieldtype": "Check",
				"set_only_once": 1,
				"full": 1,
			},
			{
				"fieldname": "account_type",
				"label": "Account Type",
				"fieldtype": "Select",
				"description": "Drives defaults in ERPNext, e.g. Bank, Receivable, Tax.",
			},
			{
				"fieldname": "account_currency",
				"label": "Currency",
				"fieldtype": "Link",
				"options": "Currency",
				"depends_on": {"is_group": 0},
				"description": "Leave empty to use the company currency.",
			},
			{
				"fieldname": "tax_rate",
				"label": "Tax Rate (%)",
				"fieldtype": "Float",
				"depends_on": {"account_type": "Tax"},
			},
			{"fieldname": "balance_must_be", "label": "Balance Must Be", "fieldtype": "Select"},
			{"fieldname": "freeze_account", "label": "Frozen", "fieldtype": "Select", "default": "No"},
			{"fieldname": "disabled", "label": "Disabled", "fieldtype": "Check"},
		),
	},
}
