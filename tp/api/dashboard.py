from collections import defaultdict

import frappe
from frappe.utils import add_months, flt, get_first_day, getdate, nowdate

from tp.access import has_page_access
from tp.api.utils import count, page_api

CONTRACT = "Weaving Contract Terry"


@page_api("home")
def get_summary() -> dict:
	"""Dashboard data. Each block is included only if the user can open the related page."""
	summary = {"counts": {}}

	for page, doctype in (("items", "Item"), ("customers", "Customer"), ("colors", "Color")):
		if has_page_access(page):
			summary["counts"][page] = count(doctype)

	if has_page_access("contracts"):
		summary["contracts"] = _contract_summary()

	if has_page_access("chart-of-accounts"):
		summary["accounts"] = _accounts_summary()

	return summary


def _accounts_summary() -> dict | None:
	"""Ledger count and balance per root type for the user's default company, plus the trial
	balance (total debit / credit). Balances need read access to GL Entry."""
	companies = frappe.get_list("Company", pluck="name", order_by="name asc")
	if not companies:
		return None
	default = frappe.defaults.get_user_default("Company")
	company = default if default in companies else companies[0]

	accounts = frappe.get_list(
		"Account",
		filters={"company": company},
		fields=["name", "root_type", "is_group"],
		limit_page_length=0,
	)
	roots = defaultdict(lambda: {"count": 0, "balance": 0.0})
	root_type = {}
	for account in accounts:
		if not account.root_type:
			continue
		root_type[account.name] = account.root_type
		entry = roots[account.root_type]  # every root type with accounts gets a card
		if not account.is_group:
			entry["count"] += 1

	show_balances = bool(frappe.has_permission("GL Entry", "read"))
	total_debit = total_credit = 0.0
	if show_balances:
		for row in frappe.get_list(
			"GL Entry",
			filters=[["company", "=", company], ["is_cancelled", "=", 0]],
			fields=["account", {"SUM": "debit", "as": "debit"}, {"SUM": "credit", "as": "credit"}],
			group_by="account",
			limit_page_length=0,
		):
			total_debit += flt(row.debit)
			total_credit += flt(row.credit)
			if row.account in root_type:
				roots[root_type[row.account]]["balance"] += flt(row.debit) - flt(row.credit)

	return {
		"company": company,
		"currency": frappe.get_cached_value("Company", company, "default_currency"),
		"show_balances": show_balances,
		"total_debit": total_debit,
		"total_credit": total_credit,
		"roots": [{"root_type": key, **value} for key, value in roots.items()],
	}


def _contract_summary() -> dict:
	today = getdate(nowdate())
	month_start = get_first_day(today)
	window_start = get_first_day(add_months(today, -11))

	totals = frappe.get_list(
		CONTRACT,
		fields=[
			{"COUNT": "*", "as": "contracts"},
			{"SUM": "total_item_qty", "as": "pcs"},
			{"SUM": "total_lbs", "as": "lbs"},
			{"SUM": "total_amount", "as": "amount"},
			{"SUM": "total_bags", "as": "bags"},
		],
	)[0]

	rows = frappe.get_list(
		CONTRACT,
		filters=[["po_start_date", ">=", window_start]],
		fields=["po_start_date", "total_amount", "total_item_qty"],
		limit_page_length=0,
	)
	months = defaultdict(lambda: {"amount": 0.0, "pcs": 0.0, "contracts": 0})
	for row in rows:
		bucket = months[getdate(row.po_start_date).strftime("%Y-%m")]
		bucket["amount"] += flt(row.total_amount)
		bucket["pcs"] += flt(row.total_item_qty)
		bucket["contracts"] += 1

	trend = []
	for i in range(12):
		key = add_months(window_start, i).strftime("%Y-%m")
		trend.append({"month": key, **months[key]})

	buyers = frappe.get_list(
		CONTRACT,
		fields=["buyers_name", {"SUM": "total_amount", "as": "amount"}, {"COUNT": "*", "as": "contracts"}],
		group_by="buyers_name",
		order_by="amount desc",
		limit_page_length=5,
	)
	titles = dict(
		frappe.get_all(
			"Customer",
			filters={"name": ["in", [b.buyers_name for b in buyers] or [""]]},
			fields=["name", "customer_name"],
			as_list=True,
		)
	)
	for buyer in buyers:
		buyer["buyer_title"] = titles.get(buyer.buyers_name, buyer.buyers_name)

	recent = frappe.get_list(
		CONTRACT,
		fields=[
			"name",
			"buyers_name",
			"po_no",
			"po_start_date",
			"po_end_date",
			"total_item_qty",
			"total_amount",
		],
		order_by="modified desc",
		limit_page_length=6,
	)
	for row in recent:
		row["buyer_title"] = titles.get(row.buyers_name) or frappe.db.get_value(
			"Customer", row.buyers_name, "customer_name"
		)

	active = count(CONTRACT, [["po_end_date", ">=", today]])
	this_month = count(CONTRACT, [["po_start_date", ">=", month_start]])

	return {
		"totals": {
			"contracts": frappe.utils.cint(totals.contracts),
			"pcs": flt(totals.pcs),
			"lbs": flt(totals.lbs),
			"amount": flt(totals.amount),
			"bags": flt(totals.bags),
			"active": active,
			"this_month": this_month,
		},
		"trend": trend,
		"top_buyers": buyers,
		"recent": recent,
		"currency": frappe.defaults.get_global_default("currency")
		or frappe.db.get_single_value("Global Defaults", "default_currency"),
	}
