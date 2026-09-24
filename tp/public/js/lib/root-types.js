/**
 * Account root types in Chart of Accounts order, shared by the Chart of Accounts page and the
 * dashboard cards. `credit`: the type normally carries a credit balance (shown as positive).
 */
export const ROOT_TYPES = [
	{ key: "Asset", label: "Assets", icon: "landmark", credit: false },
	{ key: "Liability", label: "Liabilities", icon: "scale", credit: true },
	{ key: "Equity", label: "Equity", icon: "layers", credit: true },
	{ key: "Income", label: "Income", icon: "arrow-up-right", credit: true },
	{ key: "Expense", label: "Expenses", icon: "coins", credit: false },
];
