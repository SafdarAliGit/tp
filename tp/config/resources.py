"""Master-data resources rendered by the generic list + drawer form UI.

To expose another DocType: add a Page to `tp/config/pages.py`, add a resource here and create
`tp/www/<route>.html/.py` (copy `items`). Only fields declared in `form_fields` can be written.
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
}
