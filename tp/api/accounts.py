"""Chart of Accounts: the account tree with balances, and the tree-only actions
(rename / renumber, merge, group ↔ ledger, enable / disable).

Creating, editing and deleting single accounts go through `tp.api.resources` ("accounts").
Every action runs ERPNext's own Account logic and permission checks.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from tp.access import get_doctype_permissions
from tp.api.utils import page_api

PAGE = "chart-of-accounts"

ACCOUNT_FIELDS = (
	"name",
	"account_name",
	"account_number",
	"parent_account",
	"is_group",
	"root_type",
	"report_type",
	"account_type",
	"account_currency",
	"disabled",
	"freeze_account",
)


def _account(name: str, ptype: str = "write"):
	doc = frappe.get_doc("Account", name)
	doc.check_permission(ptype)
	return doc


def _balances(company: str, to_date: str | None) -> dict[str, dict]:
	"""{account: {debit, credit, debit_ac, credit_ac}} from submitted GL entries."""
	filters = [["company", "=", company], ["is_cancelled", "=", 0]]
	if to_date:
		filters.append(["posting_date", "<=", getdate(to_date)])
	rows = frappe.get_list(
		"GL Entry",
		filters=filters,
		fields=[
			"account",
			{"SUM": "debit", "as": "debit"},
			{"SUM": "credit", "as": "credit"},
			{"SUM": "debit_in_account_currency", "as": "debit_ac"},
			{"SUM": "credit_in_account_currency", "as": "credit_ac"},
		],
		group_by="account",
		limit_page_length=0,
	)
	return {row.account: row for row in rows}


@page_api(PAGE, methods=["GET"])
def get_tree(company: str, to_date: str | None = None) -> dict:
	"""Every account of `company` (disabled ones included, the page filters them) with
	debit, credit and balance in company currency; group balances include their children."""
	frappe.has_permission("Company", "read", doc=company, throw=True)
	currency = frappe.get_cached_value("Company", company, "default_currency")

	accounts = frappe.get_list(
		"Account",
		filters={"company": company},
		fields=list(ACCOUNT_FIELDS),
		order_by="lft asc",
		limit_page_length=0,
	)

	show_balances = bool(frappe.has_permission("GL Entry", "read"))
	if show_balances:
		ledger = _balances(company, to_date)
		by_name = {}
		for account in accounts:
			row = ledger.get(account.name) or {}
			account.debit = flt(row.get("debit"))
			account.credit = flt(row.get("credit"))
			if account.account_currency and account.account_currency != currency:
				account.balance_in_account_currency = flt(row.get("debit_ac")) - flt(row.get("credit_ac"))
			by_name[account.name] = account
		# lft order lists parents before children, so walking it backwards rolls totals up
		for account in reversed(accounts):
			parent = by_name.get(account.parent_account)
			if parent:
				parent.debit += account.debit
				parent.credit += account.credit
		for account in accounts:
			account.balance = account.debit - account.credit

	return {
		"company": company,
		"currency": currency,
		"to_date": to_date,
		"show_balances": show_balances,
		"accounts": accounts,
		"permissions": get_doctype_permissions("Account"),
	}


@page_api(PAGE, methods=["POST"])
def rename(name: str, account_name: str, account_number: str | None = None) -> dict:
	"""Change an account's name and/or number (ERPNext renames the document to match)."""
	from erpnext.accounts.doctype.account.account import update_account_number

	if not (account_name or "").strip():
		frappe.throw(_("Account Name is required"))
	_account(name)
	new_name = update_account_number(name, account_name, (account_number or "").strip() or None)
	return {"name": new_name or name}


@page_api(PAGE, methods=["POST"])
def merge(name: str, into: str) -> dict:
	"""Merge account `name` into `into`: its GL entries move and `name` is removed."""
	from erpnext.accounts.doctype.account.account import merge_account

	if name == into:
		frappe.throw(_("Choose a different account to merge into"))
	return {"name": merge_account(name, into)}


@page_api(PAGE, methods=["POST"])
def convert(name: str, to_group) -> dict:
	"""Group ↔ ledger. ERPNext refuses when the account has transactions or children."""
	doc = _account(name)
	if cint(to_group):
		doc.convert_ledger_to_group()
	else:
		doc.convert_group_to_ledger()
	return {"name": doc.name, "is_group": doc.is_group}


@page_api(PAGE, methods=["POST"])
def set_disabled(name: str, disabled) -> dict:
	doc = _account(name)
	doc.disabled = cint(disabled)
	doc.save()
	return {"name": doc.name, "disabled": doc.disabled}
