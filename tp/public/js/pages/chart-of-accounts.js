/**
 * Chart of Accounts: the company's account tree with debit / credit / balance per account
 * (groups include their children), like ERPNext's tree view plus:
 *   - root-type cards that double as filters, instant search that keeps the matching branch,
 *     "as on" date, hide zero balances, show disabled, expand / collapse all, CSV export
 *   - a trial-balance check (total debit vs credit) under the tree
 *   - row actions: edit, add child, rename / renumber, group ↔ ledger, merge, enable / disable,
 *     delete, General Ledger, copy name; also on right-click and from the keyboard
 * Expanded branches, company and filters are remembered per browser.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, boot, debounce, storage, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { toast, showError } from "@tp/core/toast.js";
import { confirm } from "@tp/core/overlay.js";
import { openResourceForm, deleteRecord } from "@tp/components/resource-form.js";
import { openMenu, closeMenu } from "@tp/components/popover-menu.js";
import { formDialog } from "@tp/components/form-dialog.js";

const ROOT_TYPES = [
	{ key: "Asset", label: "Assets", icon: "landmark", credit: false },
	{ key: "Liability", label: "Liabilities", icon: "scale", credit: true },
	{ key: "Equity", label: "Equity", icon: "layers", credit: true },
	{ key: "Income", label: "Income", icon: "arrow-up-right", credit: true },
	{ key: "Expense", label: "Expenses", icon: "coins", credit: false },
];
const ROOT_ORDER = ROOT_TYPES.map((r) => r.key);
const EPSILON = 0.005;

const compareAccounts = (a, b) =>
	(a.account_number || "\uffff").localeCompare(b.account_number || "\uffff", undefined, { numeric: true }) ||
	a.account_name.localeCompare(b.account_name, undefined, { numeric: true });

export function mountChartOfAccounts() {
	const { companies = [], company: defaultCompany, resource } = boot();
	const page = $(".coa");
	const slot = (name) => $(`[data-slot='${name}']`, page);
	const treeNode = slot("tree");
	const searchInput = slot("search");
	const hasDesk = Boolean(document.querySelector('a[href="/desk"]'));

	const state = {
		company: companies.includes(storage.get("tp-coa-company")) ? storage.get("tp-coa-company") : defaultCompany,
		txt: "",
		root: null,
		toDate: "",
		hideZero: storage.get("tp-coa-hide-zero") === "1",
		showDisabled: storage.get("tp-coa-show-disabled") === "1",
		expanded: new Set(),
		focused: null,
	};
	let data = null; // { accounts, byName, children, roots, currency, show_balances, permissions }
	let visible = []; // rows currently rendered: [{ account, depth, expandable, expanded, context }]

	/* ---------- Header controls ---------- */
	const companySelect = slot("company");
	companySelect.innerHTML = String(html`${companies.map((c) => html`<option ${raw(c === state.company ? "selected" : "")}>${c}</option>`)}`);
	companySelect.closest(".coa-company").hidden = companies.length < 2;
	companySelect.addEventListener("change", () => {
		state.company = companySelect.value;
		storage.set("tp-coa-company", state.company);
		state.root = null;
		state.focused = null;
		load();
	});

	slot("hide-zero").checked = state.hideZero;
	slot("show-disabled").checked = state.showDisabled;
	slot("hide-zero").addEventListener("change", (e) => {
		state.hideZero = e.target.checked;
		storage.set("tp-coa-hide-zero", state.hideZero ? "1" : null);
		render();
	});
	slot("show-disabled").addEventListener("change", (e) => {
		state.showDisabled = e.target.checked;
		storage.set("tp-coa-show-disabled", state.showDisabled ? "1" : null);
		render();
	});
	slot("to-date").addEventListener("change", (e) => {
		state.toDate = e.target.value;
		load();
	});
	searchInput.addEventListener(
		"input",
		debounce(() => {
			state.txt = searchInput.value.trim().toLowerCase();
			render();
		}, 120)
	);
	searchInput.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			focusRow(visible[0]?.account.name);
		} else if (e.key === "Escape" && searchInput.value) {
			e.stopPropagation();
			searchInput.value = "";
			state.txt = "";
			render();
		}
	});

	page.addEventListener("click", (e) => {
		const action = e.target.closest("[data-action]")?.dataset.action;
		if (action === "refresh") load();
		else if (action === "new") newAccount(null);
		else if (action === "expand") setAllExpanded(true);
		else if (action === "collapse-all") setAllExpanded(false);
		else if (action === "export") exportCsv();
		const card = e.target.closest("[data-root]");
		if (card) {
			state.root = state.root === card.dataset.root ? null : card.dataset.root;
			render();
		}
	});

	document.addEventListener("keydown", (e) => {
		if (e.target.closest("input, textarea, select, .overlay") || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === "/") {
			e.preventDefault();
			searchInput.focus();
		} else if (e.key.toLowerCase() === "r" && !e.target.closest("tr[data-name]")) {
			load();
		}
	});

	/* ---------- Data ---------- */
	const openKey = () => `tp-coa-open-${state.company}`;
	const saveExpanded = () => storage.set(openKey(), JSON.stringify([...state.expanded]));
	function restoreExpanded() {
		try {
			const saved = JSON.parse(storage.get(openKey()));
			if (Array.isArray(saved)) return new Set(saved);
		} catch {
			/* first visit */
		}
		return null;
	}

	let controller;
	async function load() {
		if (!state.company) {
			setHTML(treeNode, emptyState("landmark", "No company available", "You don't have access to any company yet."));
			return;
		}
		controller?.abort();
		controller = new AbortController();
		if (!data) skeleton();
		page.classList.add("is-busy");
		try {
			const result = await api.get("tp.api.accounts.get_tree", { company: state.company, to_date: state.toDate }, { signal: controller.signal });
			buildTree(result);
			state.expanded = restoreExpanded() ?? new Set(data.roots.map((a) => a.name));
			$("[data-action='new']", page).hidden = !data.permissions.create;
			render();
		} catch (err) {
			if (err.name === "AbortError") return;
			showError(err, "Couldn't load the chart of accounts");
			if (!data) setHTML(treeNode, emptyState("alert", "Couldn't load accounts", err.message));
		} finally {
			page.classList.remove("is-busy");
		}
	}

	function buildTree(result) {
		const byName = new Map(result.accounts.map((a) => [a.name, a]));
		const children = new Map();
		const roots = [];
		for (const account of result.accounts) {
			if (account.parent_account && byName.has(account.parent_account)) {
				if (!children.has(account.parent_account)) children.set(account.parent_account, []);
				children.get(account.parent_account).push(account);
			} else {
				roots.push(account);
			}
		}
		children.forEach((list) => list.sort(compareAccounts));
		roots.sort((a, b) => ROOT_ORDER.indexOf(a.root_type) - ROOT_ORDER.indexOf(b.root_type) || compareAccounts(a, b));
		const multiCurrency = result.accounts.some((a) => a.account_currency && a.account_currency !== result.currency);
		data = { ...result, byName, children, roots, multiCurrency };
	}

	const kids = (account) => data.children.get(account.name) || [];
	const hasBalance = (a) => Math.abs(a.balance || 0) > EPSILON;
	const matches = (a) =>
		!state.txt ||
		[a.account_name, a.account_number, a.name, a.account_type].some((v) => v && String(v).toLowerCase().includes(state.txt));

	/** Accounts to show: filters applied, and every ancestor of a shown account kept for context. */
	function computeVisible() {
		const include = new Map(); // name → "match" | "context"
		const walk = (account) => {
			if (!state.showDisabled && account.disabled) return false;
			if (state.root && account.root_type !== state.root) return false;
			let childShown = false;
			for (const child of kids(account)) childShown = walk(child) || childShown;
			const self = matches(account) && (!state.hideZero || !data.show_balances || hasBalance(account));
			if (self) include.set(account.name, "match");
			else if (childShown) include.set(account.name, "context");
			return self || childShown;
		};
		data.roots.forEach(walk);

		const searching = Boolean(state.txt);
		const rows = [];
		const add = (account, depth) => {
			const status = include.get(account.name);
			if (!status) return;
			const shownKids = kids(account).filter((c) => include.has(c.name));
			const expandable = Boolean(account.is_group) && shownKids.length > 0;
			const expanded = expandable && (searching || state.expanded.has(account.name));
			rows.push({ account, depth, expandable, expanded, context: status === "context" });
			if (expanded) shownKids.forEach((c) => add(c, depth + 1));
		};
		data.roots.forEach((r) => add(r, 0));
		return { rows, total: include.size };
	}

	/* ---------- Rendering ---------- */
	function amount(value, { dash = true } = {}) {
		if (Math.abs(value || 0) <= EPSILON) return dash ? html`<span class="muted">—</span>` : fmt.fixed(0);
		return fmt.fixed(Math.abs(value));
	}

	function balanceCell(a) {
		const b = a.balance || 0;
		if (Math.abs(b) <= EPSILON) return html`<span class="muted">—</span>`;
		const side = b > 0 ? "Dr" : "Cr";
		const foreign = a.balance_in_account_currency !== undefined && a.balance_in_account_currency !== null
			? html`<span class="cell-sub">${a.account_currency} ${fmt.fixed(Math.abs(a.balance_in_account_currency))} ${a.balance_in_account_currency >= 0 ? "Dr" : "Cr"}</span>`
			: "";
		return html`<span class="coa-bal">${fmt.fixed(Math.abs(b))}<span class="coa-side coa-side--${side.toLowerCase()}">${side}</span></span>${foreign}`;
	}

	function highlight(text) {
		if (!state.txt || !text) return html`${text}`;
		const i = text.toLowerCase().indexOf(state.txt);
		if (i < 0) return html`${text}`;
		return html`${text.slice(0, i)}<mark>${text.slice(i, i + state.txt.length)}</mark>${text.slice(i + state.txt.length)}`;
	}

	function rowHTML({ account: a, depth, expandable, expanded, context }) {
		const perms = data.permissions;
		return html`<tr data-name="${a.name}" tabindex="-1" role="row" aria-level="${depth + 1}"
			${raw(expandable ? `aria-expanded="${expanded}"` : "")}
			class="coa-row ${a.is_group ? "is-group" : ""} ${depth === 0 ? "is-root" : ""} ${context ? "is-context" : ""} ${a.disabled ? "is-disabled" : ""} ${a.name === state.focused ? "is-focused" : ""}">
			<td role="gridcell">
				<div class="coa-name" style="--depth:${depth}">
					${expandable
						? html`<button class="coa-caret" type="button" data-toggle tabindex="-1" aria-label="${expanded ? "Collapse" : "Expand"} ${a.account_name}">${icon("chevron-right", "i--sm")}</button>`
						: html`<span class="coa-caret coa-caret--leaf"></span>`}
					<span class="coa-icon">${icon(a.is_group ? "folder" : "file", "i--sm")}</span>
					${a.account_number ? html`<span class="coa-num">${highlight(a.account_number)}</span>` : ""}
					<span class="coa-title" title="${a.name}">${highlight(a.account_name)}</span>
					${a.disabled ? html`<span class="pill pill--danger">Disabled</span>` : ""}
					${a.freeze_account === "Yes" ? html`<span class="pill pill--warning">Frozen</span>` : ""}
				</div>
			</td>
			<td role="gridcell" class="coa-col-type">${a.account_type ? html`<span class="badge badge--neutral">${highlight(a.account_type)}</span>` : ""}</td>
			${data.multiCurrency ? html`<td role="gridcell" class="coa-col-cur">${a.account_currency || data.currency}</td>` : ""}
			${data.show_balances
				? html`<td role="gridcell" class="is-num coa-col-dc">${amount(a.debit)}</td>
					<td role="gridcell" class="is-num coa-col-dc">${amount(a.credit)}</td>
					<td role="gridcell" class="is-num">${balanceCell(a)}</td>`
				: ""}
			<td role="gridcell" class="cell-actions"><div class="row-actions">
				${a.is_group && perms.create ? html`<button class="icon-btn icon-btn--sm icon-btn--primary" type="button" tabindex="-1" data-row-act="child" aria-label="Add account under ${a.account_name}" title="Add child account (N)">${icon("plus", "i--sm")}</button>` : ""}
				${perms.write ? html`<button class="icon-btn icon-btn--sm icon-btn--primary" type="button" tabindex="-1" data-row-act="edit" aria-label="Edit ${a.account_name}" title="Edit (Enter)">${icon("pencil", "i--sm")}</button>` : ""}
				<button class="icon-btn icon-btn--sm" type="button" tabindex="-1" data-row-act="menu" aria-label="More actions for ${a.account_name}" aria-haspopup="menu">${icon("more", "i--sm")}</button>
			</div></td>
		</tr>`;
	}

	function render() {
		if (!data) return;
		renderKpis();
		if (!data.accounts.length) {
			slot("count").textContent = state.company;
			slot("footer").hidden = true;
			setHTML(
				treeNode,
				emptyState(
					"list-tree",
					"No chart of accounts yet",
					`${state.company} has no accounts. Set up the chart from the company in the desk.`,
					hasDesk ? html`<a class="btn btn--secondary" href="/desk/company/${encodeURIComponent(state.company)}">${icon("external")} Open company</a>` : ""
				)
			);
			return;
		}

		const { rows, total } = computeVisible();
		visible = rows;
		const groups = data.accounts.filter((a) => a.is_group).length;
		slot("count").textContent = `${data.accounts.length.toLocaleString()} accounts · ${groups} groups · ${data.currency}${state.toDate ? ` · as on ${fmt.date(state.toDate)}` : ""}`;

		if (!rows.length) {
			setHTML(treeNode, emptyState("search", "No matching accounts", "Try a different search or clear the filters."));
		} else {
			const cols = 2 + (data.multiCurrency ? 1 : 0) + (data.show_balances ? 3 : 0);
			setHTML(
				treeNode,
				html`<div class="table-wrap"><table class="table coa-table" role="treegrid" aria-label="Chart of accounts" aria-colcount="${cols + 1}">
					<thead><tr>
						<th>Account</th>
						<th class="coa-col-type">Type</th>
						${data.multiCurrency ? html`<th class="coa-col-cur">Currency</th>` : ""}
						${data.show_balances ? html`<th class="is-num coa-col-dc">Debit</th><th class="is-num coa-col-dc">Credit</th><th class="is-num">Balance (${data.currency})</th>` : ""}
						<th class="cell-actions"><span class="sr-only">Actions</span></th>
					</tr></thead>
					<tbody>${rows.map(rowHTML)}</tbody>
				</table></div>
				${state.txt || state.root || state.hideZero ? html`<div class="coa-filtered">Showing ${total.toLocaleString()} of ${data.accounts.length.toLocaleString()} accounts
					<button class="btn btn--ghost btn--sm" type="button" data-clear>${icon("x")} Clear filters</button></div>` : ""}`
			);
			$("[data-clear]", treeNode)?.addEventListener("click", clearFilters);
			// Keep one row reachable with Tab (roving tabindex)
			const focusRowNode = $(`tr[data-name="${CSS.escape(state.focused || "")}"]`, treeNode) || $("tr[data-name]", treeNode);
			if (focusRowNode) focusRowNode.tabIndex = 0;
		}
		renderFooter();
	}

	function renderKpis() {
		const totals = ROOT_TYPES.map((rt) => {
			const roots = data.roots.filter((a) => a.root_type === rt.key);
			const balance = roots.reduce((sum, a) => sum + (a.balance || 0), 0);
			const count = data.accounts.filter((a) => a.root_type === rt.key && !a.is_group).length;
			return { ...rt, present: roots.length > 0, balance: rt.credit ? -balance : balance, count };
		}).filter((t) => t.present);

		setHTML(
			slot("kpis"),
			html`${totals.map(
				(t) => html`<button class="coa-kpi ${state.root === t.key ? "is-active" : ""}" type="button" data-root="${t.key}" aria-pressed="${state.root === t.key}">
					<span class="coa-kpi__head"><span class="coa-kpi__icon">${icon(t.icon, "i--sm")}</span>${t.label}</span>
					${data.show_balances ? html`<span class="coa-kpi__value num">${fmt.fixed(t.balance)}</span>` : ""}
					<span class="coa-kpi__foot">${t.count} ledger${t.count === 1 ? "" : "s"}${data.show_balances ? ` · ${t.credit ? "credit" : "debit"} balance` : ""}</span>
				</button>`
			)}`
		);
	}

	function renderFooter() {
		const footer = slot("footer");
		if (!data.show_balances || !data.accounts.length) {
			footer.hidden = true;
			return;
		}
		const debit = data.roots.reduce((s, a) => s + (a.debit || 0), 0);
		const credit = data.roots.reduce((s, a) => s + (a.credit || 0), 0);
		const diff = debit - credit;
		const balanced = Math.abs(diff) <= EPSILON;
		const income = data.roots.filter((a) => a.root_type === "Income").reduce((s, a) => s - (a.balance || 0), 0);
		const expense = data.roots.filter((a) => a.root_type === "Expense").reduce((s, a) => s + (a.balance || 0), 0);
		const profit = income - expense;
		footer.hidden = false;
		setHTML(
			footer,
			html`<span class="coa-footer__item"><span class="muted">Total debit</span> <strong class="num">${fmt.fixed(debit)}</strong></span>
			<span class="coa-footer__item"><span class="muted">Total credit</span> <strong class="num">${fmt.fixed(credit)}</strong></span>
			<span class="coa-footer__item">${balanced
				? html`<span class="pill pill--success">Trial balance matches</span>`
				: html`<span class="pill pill--warning">Out by ${fmt.fixed(Math.abs(diff))}</span>`}</span>
			<span class="coa-footer__item coa-footer__profit"><span class="muted">Net ${profit >= 0 ? "profit" : "loss"}</span> <strong class="num">${fmt.fixed(Math.abs(profit))}</strong></span>`
		);
	}

	function skeleton() {
		setHTML(
			treeNode,
			html`<div class="table-wrap"><table class="table coa-table"><tbody>
				${Array.from({ length: 8 }, (_, i) => html`<tr><td><span class="skeleton" style="height:14px;margin-left:${(i % 3) * 22}px;width:${40 + ((i * 17) % 35)}%"></span></td><td><span class="skeleton" style="height:14px;width:60%"></span></td></tr>`)}
			</tbody></table></div>`
		);
	}

	function emptyState(iconName, title, text, action = "") {
		return html`<div class="state">
			<div class="state__icon">${icon(iconName)}</div>
			<h3 class="state__title">${title}</h3>
			<p class="state__text">${text}</p>
			${action}
		</div>`;
	}

	function clearFilters() {
		searchInput.value = "";
		state.txt = "";
		state.root = null;
		state.hideZero = false;
		slot("hide-zero").checked = false;
		storage.set("tp-coa-hide-zero", null);
		render();
	}

	/* ---------- Expand / collapse & focus ---------- */
	function setExpanded(name, open) {
		if (open) state.expanded.add(name);
		else state.expanded.delete(name);
		saveExpanded();
		render();
		focusRow(name);
	}

	function setAllExpanded(open) {
		state.expanded = open ? new Set(data.accounts.filter((a) => a.is_group).map((a) => a.name)) : new Set();
		saveExpanded();
		render();
	}

	function expandTo(name) {
		let parent = data.byName.get(name)?.parent_account;
		while (parent && data.byName.has(parent)) {
			state.expanded.add(parent);
			parent = data.byName.get(parent).parent_account;
		}
		saveExpanded();
	}

	function focusRow(name) {
		if (!name) return;
		const row = $(`tr[data-name="${CSS.escape(name)}"]`, treeNode);
		if (!row) return;
		state.focused = name;
		treeNode.querySelectorAll("tr[data-name]").forEach((tr) => {
			tr.tabIndex = tr === row ? 0 : -1;
			tr.classList.toggle("is-focused", tr === row);
		});
		row.focus({ preventScroll: true });
		row.scrollIntoView({ block: "nearest" });
	}

	/* ---------- Tree interaction ---------- */
	const rowOf = (target) => {
		const tr = target.closest("tr[data-name]");
		return tr ? visible.find((r) => r.account.name === tr.dataset.name) : null;
	};

	treeNode.addEventListener("click", (e) => {
		const row = rowOf(e.target);
		if (!row) return;
		const { account } = row;
		const act = e.target.closest("[data-row-act]")?.dataset.rowAct;
		if (act === "menu") return openActions(account, e.target.closest("button"));
		if (act === "edit") return editAccount(account);
		if (act === "child") return newAccount(account);
		focusRow(account.name);
		if (e.target.closest("[data-toggle]") || (row.expandable && !e.target.closest("button"))) {
			setExpanded(account.name, !row.expanded);
		} else if (!account.is_group) {
			editAccount(account);
		}
	});

	treeNode.addEventListener("dblclick", (e) => {
		const row = rowOf(e.target);
		if (row?.account.is_group && !e.target.closest("button")) editAccount(row.account);
	});

	treeNode.addEventListener("contextmenu", (e) => {
		const row = rowOf(e.target);
		if (!row) return;
		e.preventDefault();
		focusRow(row.account.name);
		openActions(row.account, e);
	});

	treeNode.addEventListener("keydown", (e) => {
		if (!e.target.matches("tr[data-name]")) return;
		const index = visible.findIndex((r) => r.account.name === e.target.dataset.name);
		const row = visible[index];
		if (!row) return;
		const { account } = row;
		const move = (i) => {
			e.preventDefault();
			focusRow(visible[Math.max(0, Math.min(visible.length - 1, i))]?.account.name);
		};
		switch (e.key) {
			case "ArrowDown":
				return move(index + 1);
			case "ArrowUp":
				return index === 0 ? (e.preventDefault(), searchInput.focus()) : move(index - 1);
			case "Home":
				return move(0);
			case "End":
				return move(visible.length - 1);
			case "ArrowRight":
				e.preventDefault();
				if (row.expandable && !row.expanded) setExpanded(account.name, true);
				else if (row.expanded) move(index + 1);
				return;
			case "ArrowLeft": {
				e.preventDefault();
				if (row.expanded) return setExpanded(account.name, false);
				const parent = visible.findIndex((r) => r.account.name === account.parent_account);
				if (parent >= 0) move(parent);
				return;
			}
			case "Enter":
				e.preventDefault();
				return editAccount(account);
			case "ContextMenu":
				e.preventDefault();
				return openActions(account, e.target.querySelector("[data-row-act='menu']"));
			case "F10":
				if (e.shiftKey) {
					e.preventDefault();
					openActions(account, e.target.querySelector("[data-row-act='menu']"));
				}
				return;
			case "n":
			case "N":
				if (!e.ctrlKey && !e.metaKey && data.permissions.create) {
					e.preventDefault();
					newAccount(account.is_group ? account : data.byName.get(account.parent_account) || null);
				}
				return;
			case "Delete":
				if (data.permissions.delete) {
					e.preventDefault();
					removeAccount(account);
				}
				return;
		}
	});

	/* ---------- Actions ---------- */
	function openActions(account, anchor) {
		const perms = data.permissions;
		const ledgerUrl = `/desk/query-report/General Ledger?${new URLSearchParams({ company: state.company, account: account.name, group_by: "Group by Voucher (Consolidated)" })}`;
		openMenu(anchor, [
			{ label: perms.write ? "Edit account" : "View account", icon: perms.write ? "pencil" : "eye", run: () => editAccount(account) },
			account.is_group && perms.create && { label: "Add child account", icon: "plus", run: () => newAccount(account) },
			perms.create && { label: "Add sibling account", icon: "plus", run: () => newAccount(data.byName.get(account.parent_account) || null) },
			perms.write && { sep: true },
			perms.write && { label: "Rename / renumber", icon: "type", run: () => renameAccount(account) },
			perms.write && account.parent_account && {
				label: account.is_group ? "Convert to ledger" : "Convert to group",
				icon: "arrow-left-right",
				run: () => convertAccount(account),
			},
			perms.write && account.parent_account && { label: "Merge into…", icon: "git-merge", run: () => mergeAccount(account) },
			perms.write && account.parent_account && {
				label: account.disabled ? "Enable" : "Disable",
				icon: account.disabled ? "check-circle" : "ban",
				run: () => toggleDisabled(account),
			},
			{ sep: true },
			data.show_balances && hasDesk && { label: "General Ledger", icon: "book-open", href: ledgerUrl, newTab: true },
			hasDesk && { label: "Open in Desk", icon: "external", href: `/desk/account/${encodeURIComponent(account.name)}`, newTab: true },
			{ label: "Copy account name", icon: "copy", run: () => copyName(account) },
			perms.delete && account.parent_account && { sep: true },
			perms.delete && account.parent_account && { label: "Delete", icon: "trash", danger: true, run: () => removeAccount(account) },
		]);
	}

	/** Reload, then focus `name` (expanding its branch) — used after every change. */
	async function reloadAndFocus(name) {
		await load();
		if (name && data?.byName.has(name)) {
			expandTo(name);
			render();
			focusRow(name);
		}
	}

	function editAccount(account) {
		closeMenu();
		openResourceForm({
			resource,
			name: account.name,
			fields: resource.form_fields,
			permissions: data.permissions,
			onSaved: (doc) => reloadAndFocus(doc.name),
			onDeleted: () => reloadAndFocus(account.parent_account),
		});
	}

	function newAccount(parent) {
		closeMenu();
		const values = { company: state.company };
		if (parent) {
			values.parent_account = parent.name;
			// Suggest the next free number under the parent, e.g. 1110 → 1120
			const numbers = kids(parent)
				.map((c) => c.account_number)
				.filter((n) => /^\d+$/.test(n || ""))
				.map(Number)
				.sort((a, b) => a - b);
			if (numbers.length) {
				const step = numbers.length > 1 ? Math.max(1, numbers[1] - numbers[0]) : 1;
				let next = numbers[numbers.length - 1] + step;
				while (data.accounts.some((a) => a.account_number === String(next))) next += 1;
				values.account_number = String(next);
			}
		}
		openResourceForm({
			resource,
			name: null,
			fields: resource.form_fields,
			permissions: data.permissions,
			values,
			onSaved: (doc) => {
				if (parent) state.expanded.add(parent.name);
				reloadAndFocus(doc.name);
			},
		});
	}

	async function renameAccount(account) {
		const result = await formDialog({
			title: "Rename account",
			text: "ERPNext renames the account everywhere it is used.",
			fields: [
				{ fieldname: "account_name", label: "Account Name", fieldtype: "Data", reqd: 1, full: 1 },
				{ fieldname: "account_number", label: "Account Number", fieldtype: "Data", full: 1 },
			],
			values: { account_name: account.account_name, account_number: account.account_number || "" },
			confirmLabel: "Rename",
			submit: (v) => api.post("tp.api.accounts.rename", { name: account.name, ...v }),
		});
		if (!result) return;
		if (result.name !== account.name && state.expanded.delete(account.name)) {
			state.expanded.add(result.name);
			saveExpanded();
		}
		toast.success("Account renamed", { text: result.name });
		reloadAndFocus(result.name);
	}

	async function convertAccount(account) {
		const toGroup = !account.is_group;
		const ok = await confirm({
			title: toGroup ? "Convert to group?" : "Convert to ledger?",
			text: toGroup
				? `"${account.account_name}" will be able to hold other accounts but can no longer be used in transactions.`
				: `"${account.account_name}" will accept transactions. It must not have child accounts.`,
			confirmLabel: "Convert",
		});
		if (!ok) return;
		try {
			await api.post("tp.api.accounts.convert", { name: account.name, to_group: toGroup ? 1 : 0 });
			toast.success(toGroup ? "Converted to group" : "Converted to ledger", { text: account.name });
			reloadAndFocus(account.name);
		} catch (err) {
			showError(err, "Couldn't convert");
		}
	}

	async function mergeAccount(account) {
		const result = await formDialog({
			title: "Merge account",
			text: `All entries of "${account.name}" move to the chosen account and "${account.account_name}" is removed. Both must have the same root type, currency and group setting. This can't be undone.`,
			fields: [
				{
					fieldname: "into",
					label: "Merge into",
					fieldtype: "Link",
					options: "Account",
					reqd: 1,
					full: 1,
					filters: { company: state.company, is_group: account.is_group ? 1 : 0, root_type: account.root_type, name: ["!=", account.name] },
				},
			],
			confirmLabel: "Merge",
			danger: true,
			submit: (v) => api.post("tp.api.accounts.merge", { name: account.name, into: v.into }),
		});
		if (!result) return;
		toast.success("Accounts merged", { text: `${account.name} → ${result.name}` });
		reloadAndFocus(result.name);
	}

	async function toggleDisabled(account) {
		try {
			await api.post("tp.api.accounts.set_disabled", { name: account.name, disabled: account.disabled ? 0 : 1 });
			toast.success(account.disabled ? "Account enabled" : "Account disabled", { text: account.name });
			if (!account.disabled && !state.showDisabled) toast("Disabled accounts are hidden", { text: "Tick “Show disabled” to see them." });
			reloadAndFocus(account.name);
		} catch (err) {
			showError(err, "Couldn't update account");
		}
	}

	async function removeAccount(account) {
		if (await deleteRecord({ resource, name: account.name })) reloadAndFocus(account.parent_account);
	}

	async function copyName(account) {
		try {
			await navigator.clipboard.writeText(account.name);
			toast.success("Copied", { text: account.name });
		} catch {
			toast.error("Couldn't copy", { text: account.name });
		}
	}

	/* ---------- Export ---------- */
	function exportCsv() {
		if (!data?.accounts.length) return;
		const saved = state.expanded;
		state.expanded = new Set(data.accounts.map((a) => a.name)); // export every matching account, not just open branches
		const { rows } = computeVisible();
		state.expanded = saved;

		const header = ["Level", "Account", "Account Number", "Account Name", "Parent Account", "Group", "Root Type", "Account Type", "Currency", "Disabled"];
		if (data.show_balances) header.push("Debit", "Credit", "Balance", "Dr/Cr");
		const lines = rows.map(({ account: a, depth }) => {
			const cells = [depth + 1, `${"    ".repeat(depth)}${a.account_name}`, a.account_number || "", a.name, a.parent_account || "", a.is_group ? "Yes" : "No", a.root_type || "", a.account_type || "", a.account_currency || data.currency, a.disabled ? "Yes" : "No"];
			if (data.show_balances) {
				const b = a.balance || 0;
				cells.push((a.debit || 0).toFixed(2), (a.credit || 0).toFixed(2), Math.abs(b).toFixed(2), Math.abs(b) <= EPSILON ? "" : b > 0 ? "Dr" : "Cr");
			}
			return cells;
		});
		const csv = [header, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
		const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `Chart of Accounts - ${state.company}${state.toDate ? ` - ${state.toDate}` : ""}.csv`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		toast.success("Exported", { text: `${rows.length} accounts` });
	}

	load();
}
