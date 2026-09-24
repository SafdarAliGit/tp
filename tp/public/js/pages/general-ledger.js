/**
 * General Ledger: ERPNext's General Ledger report (tp.api.general_ledger) with a portal UI:
 *   - every ERPNext filter, plus quick periods (this month, last month, fiscal year…)
 *   - multi-select chips for accounts, parties, cost centers, projects and dimensions
 *   - opening / total / closing rows with Dr / Cr balances
 *   - grouping by voucher, account or party with collapsible groups
 *   - click an account or party to filter by it; vouchers open in the portal or the desk
 *   - search in the results, choose columns, Excel / CSV export and print
 * Filters are kept in the URL (shareable, e.g. from the Chart of Accounts) and remembered
 * per browser.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, debounce, storage, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { toast, showError } from "@tp/core/toast.js";
import { openMenu } from "@tp/components/popover-menu.js";
import { pickFields } from "@tp/components/field-picker.js";
import { LinkField, linkUrl } from "@tp/components/link-field.js";
import { MultiLink } from "@tp/components/multi-link.js";

const STORE = "tp-gl-filters";
const COLUMNS_STORE = "tp-gl-columns";
const CONSOLIDATED = "Categorize by Voucher (Consolidated)";
const CATEGORIES = [
	["", "No grouping"],
	[CONSOLIDATED, "Voucher (consolidated)"],
	["Categorize by Voucher", "Voucher"],
	["Categorize by Account", "Account"],
	["Categorize by Party", "Party"],
];
const PERIODS = [
	["today", "Today"],
	["this-week", "This week"],
	["this-month", "This month"],
	["last-month", "Last month"],
	["last-30", "Last 30 days"],
	["this-quarter", "This quarter"],
	["last-quarter", "Last quarter"],
	["last-90", "Last 90 days"],
	["this-fy", "This fiscal year"],
	["last-fy", "Last fiscal year"],
	["custom", "Custom range"],
];
const CHECKS = [
	["include_dimensions", "Consider accounting dimensions"],
	["include_default_book_entries", "Include default finance book entries"],
	["show_opening_entries", "Show opening entries"],
	["disable_opening_balance_calculation", "Disable opening balance calculation"],
	["show_cancelled_entries", "Show cancelled entries"],
	["show_net_values_in_party_account", "Show net values in party account"],
	["show_amount_in_company_currency", "Show debit / credit in company currency"],
	["add_values_in_transaction_currency", "Add columns in transaction currency"],
	["show_remarks", "Show remarks"],
	["ignore_err", "Ignore exchange rate revaluation and gain / loss journals"],
	["ignore_cr_dr_notes", "Ignore system generated credit / debit notes"],
];
const LIST_KEYS = ["account", "party", "cost_center", "project"];
const DEFAULT_COLUMNS = ["posting_date", "account", "debit", "credit", "balance", "voucher_type", "voucher_no", "against", "party"];
const TOGGLE_COLUMNS = {
	show_remarks: ["remarks"],
	add_values_in_transaction_currency: ["debit_in_transaction_currency", "credit_in_transaction_currency", "transaction_currency"],
};
const AMOUNT_FIELDS = new Set(["debit", "credit", "balance", "debit_in_transaction_currency", "credit_in_transaction_currency"]);

/* ---------- Dates ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addYears = (s, n) => {
	const d = new Date(`${s}T00:00:00`);
	d.setFullYear(d.getFullYear() + n);
	return iso(d);
};

function periodRange(period, fy) {
	const t = new Date();
	const y = t.getFullYear();
	const m = t.getMonth();
	const q = Math.floor(m / 3) * 3;
	const days = (n) => [iso(new Date(y, m, t.getDate() - n + 1)), iso(t)];
	switch (period) {
		case "today":
			return [iso(t), iso(t)];
		case "this-week": {
			const start = new Date(y, m, t.getDate() - ((t.getDay() + 6) % 7));
			return [iso(start), iso(t)];
		}
		case "this-month":
			return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
		case "last-month":
			return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
		case "last-30":
			return days(30);
		case "last-90":
			return days(90);
		case "this-quarter":
			return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))];
		case "last-quarter":
			return [iso(new Date(y, q - 3, 1)), iso(new Date(y, q, 0))];
		case "this-fy":
			return fy ? [fy.from, fy.to] : [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))];
		case "last-fy":
			return fy ? [addYears(fy.from, -1), addYears(fy.to, -1)] : [iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))];
		default:
			return null;
	}
}

/* ---------- Formatting ---------- */
const amount = (v, { blankZero = true } = {}) => (blankZero && !Number(v) ? "" : fmt.fixed(v));
const drcr = (v) => {
	const n = Number(v) || 0;
	if (Math.abs(n) < 0.005) return html`<span class="num">${fmt.fixed(0)}</span>`;
	return html`<span class="num">${fmt.fixed(Math.abs(n))}</span> <span class="gl-side gl-side--${n > 0 ? "dr" : "cr"}">${n > 0 ? "Dr" : "Cr"}</span>`;
};
export async function mountGeneralLedger() {
	const root = $("[data-slot='gl']");
	const slot = (name) => $(`[data-slot='${name}']`, root);

	let meta;
	try {
		meta = await api.get("tp.api.general_ledger.get_meta");
	} catch (err) {
		showError(err, "Couldn't open the General Ledger");
		setHTML(slot("filters"), html`<div class="state"><div class="state__icon state__icon--danger">${icon("alert")}</div><h3 class="state__title">General Ledger unavailable</h3><p class="state__text">${err.message}</p></div>`);
		return;
	}
	if (!meta.companies.length) {
		setHTML(slot("filters"), html`<div class="state"><div class="state__icon">${icon("landmark")}</div><h3 class="state__title">No company</h3><p class="state__text">Create a company in ERPNext first.</p></div>`);
		return;
	}
	const companyNames = meta.companies.map((c) => c.name);
	const dimKeys = meta.dimensions.map((d) => d.fieldname);

	/* ---------- State: defaults ← saved ← URL ---------- */
	const defaults = (company) => {
		const [from, to] = periodRange("this-month");
		return {
			company,
			period: "this-month",
			from_date: from,
			to_date: to,
			party_type: "",
			voucher_no: "",
			against_voucher_no: "",
			categorize_by: CONSOLIDATED,
			finance_book: "",
			presentation_currency: "",
			include_dimensions: 1,
			include_default_book_entries: 1,
			...Object.fromEntries([...LIST_KEYS, ...dimKeys].map((k) => [k, []])),
		};
	};
	const read = () => {
		try {
			return JSON.parse(storage.get(STORE)) || {};
		} catch {
			return {};
		}
	};
	const params = new URLSearchParams(location.search);
	let f;
	if ([...params.keys()].length) {
		// A shared / linked URL describes the whole ledger view
		f = defaults(companyNames.includes(params.get("company")) ? params.get("company") : meta.default_company);
		for (const key of ["party_type", "voucher_no", "against_voucher_no", "finance_book", "presentation_currency"]) if (params.get(key)) f[key] = params.get(key);
		if (params.has("categorize_by")) f.categorize_by = params.get("categorize_by");
		for (const key of [...LIST_KEYS, ...dimKeys]) if (params.getAll(key).length) f[key] = params.getAll(key);
		for (const [key] of CHECKS) if (params.has(key)) f[key] = Number(params.get(key)) ? 1 : 0;
		if (params.get("from") && params.get("to")) Object.assign(f, { period: "custom", from_date: params.get("from"), to_date: params.get("to") });
		else if (params.get("period")) f.period = params.get("period");
	} else {
		const saved = read();
		f = { ...defaults(companyNames.includes(saved.company) ? saved.company : meta.default_company), ...saved };
		if (!companyNames.includes(f.company)) f.company = meta.default_company;
	}
	const applyPeriod = () => {
		const range = periodRange(f.period, meta.fiscal_years[f.company]);
		if (range) [f.from_date, f.to_date] = range;
	};
	applyPeriod();

	const ui = { result: null, search: "", collapsed: new Set(), moreOpen: storage.get("tp-gl-more") === "1" };

	/* ---------- Filters ---------- */
	const option = (value, label, selected) => html`<option value="${value}" ${raw(String(value) === String(selected) ? "selected" : "")}>${label}</option>`;
	setHTML(
		slot("filters"),
		html`
		<div class="gl-filter-grid">
			<label class="field"><span class="field__label">Company</span>
				<select class="select" data-f="company">${meta.companies.map((c) => option(c.name, c.name, f.company))}</select>
			</label>
			<label class="field"><span class="field__label">Period</span>
				<select class="select" data-f="period">${PERIODS.map(([v, l]) => option(v, l, f.period))}</select>
			</label>
			<div class="field field--wide"><span class="field__label">From – To</span>
				<div class="date-range gl-dates">
					${icon("calendar")}
					<input type="date" class="input input--bare" data-f="from_date" aria-label="From date" value="${f.from_date}">
					<span class="date-range__sep">–</span>
					<input type="date" class="input input--bare" data-f="to_date" aria-label="To date" value="${f.to_date}">
				</div>
			</div>
			<label class="field"><span class="field__label">Group by</span>
				<select class="select" data-f="categorize_by">${CATEGORIES.map(([v, l]) => option(v, l, f.categorize_by))}</select>
			</label>
			<div class="field field--wide"><span class="field__label">Accounts <span class="muted">(groups include their sub-accounts)</span></span><div data-multi="account"></div></div>
			<label class="field"><span class="field__label">Party Type</span>
				<select class="select" data-f="party_type">${option("", "Any", f.party_type)}${meta.party_types.map((p) => option(p, p, f.party_type))}</select>
			</label>
			<div class="field field--wide"><span class="field__label">Parties</span><div data-multi="party"></div></div>
			<label class="field"><span class="field__label">Voucher No</span>
				<input class="input" type="search" data-f="voucher_no" value="${f.voucher_no}" placeholder="e.g. ACC-JV-2026-00001">
			</label>
		</div>
		<div class="gl-more" ${raw(ui.moreOpen ? "" : "hidden")} data-slot="more">
			<div class="gl-filter-grid">
				<label class="field"><span class="field__label">Against Voucher No</span>
					<input class="input" type="search" data-f="against_voucher_no" value="${f.against_voucher_no}">
				</label>
				${meta.finance_books ? html`<div class="field"><span class="field__label">Finance Book</span><div data-link="finance_book"></div></div>` : ""}
				<label class="field"><span class="field__label">Currency</span>
					<select class="select" data-f="presentation_currency">${option("", "Company currency", f.presentation_currency)}${meta.currencies.map((c) => option(c, c, f.presentation_currency))}</select>
				</label>
				<div class="field field--wide"><span class="field__label">Cost Centers</span><div data-multi="cost_center"></div></div>
				<div class="field field--wide"><span class="field__label">Projects</span><div data-multi="project"></div></div>
				${meta.dimensions.map((d) => html`<div class="field field--wide"><span class="field__label">${d.label}</span><div data-multi="${d.fieldname}"></div></div>`)}
			</div>
			<div class="gl-checks">
				${CHECKS.map(([key, label]) => html`<label class="check"><input type="checkbox" data-check="${key}" ${raw(f[key] ? "checked" : "")}> ${label}</label>`)}
			</div>
		</div>
		<div class="gl-filter-actions">
			<button class="btn btn--ghost btn--sm" type="button" data-action="more" aria-expanded="${ui.moreOpen}">${icon("filter")} <span data-slot="more-label">${ui.moreOpen ? "Fewer options" : "More options"}</span></button>
			<span class="gl-active" data-slot="active"></span>
			<span class="spacer"></span>
			<button class="btn btn--ghost btn--sm" type="button" data-action="reset">${icon("x")} Reset filters</button>
		</div>`
	);
	const filtersNode = slot("filters");

	const multis = {};
	const companyFilter = () => ({ company: f.company });
	const multiDefs = {
		account: { doctype: "Account", filters: companyFilter, placeholder: "Add account…" },
		party: { doctype: f.party_type || null, placeholder: "Add party…", disabledText: "Choose a party type first" },
		cost_center: { doctype: "Cost Center", filters: companyFilter, placeholder: "Add cost center…" },
		project: { doctype: "Project", placeholder: "Add project…" },
		...Object.fromEntries(meta.dimensions.map((d) => [d.fieldname, { doctype: d.doctype, placeholder: `Add ${d.label.toLowerCase()}…` }])),
	};
	for (const [key, def] of Object.entries(multiDefs)) {
		const host = $(`[data-multi="${key}"]`, filtersNode);
		if (!host) continue;
		multis[key] = new MultiLink({ ...def, values: f[key], label: key, onChange: (values) => changed(key, [...values]) });
		host.replaceWith(multis[key].el);
	}
	let financeBook;
	const fbHost = $("[data-link='finance_book']", filtersNode);
	if (fbHost) {
		financeBook = new LinkField({ doctype: "Finance Book", value: f.finance_book, placeholder: "Any", allowCreate: false, onChange: (v) => changed("finance_book", v) });
		fbHost.replaceWith(financeBook.el);
	}

	function changed(key, value) {
		f[key] = value;
		if (key === "company") {
			for (const k of ["account", "cost_center", "project"]) {
				f[k] = [];
				multis[k]?.set([]);
			}
			if (f.period === "this-fy" || f.period === "last-fy") applyPeriod();
		}
		if (key === "period") applyPeriod();
		if (key === "from_date" || key === "to_date") f.period = "custom";
		if (key === "party_type") {
			f.party = [];
			multis.party.setDoctype(value || null);
		}
		// ERPNext shows a single voucher consolidated
		if (key === "voucher_no" && value && f.categorize_by === "Categorize by Voucher") f.categorize_by = CONSOLIDATED;
		syncControls();
		scheduleRun();
	}

	function syncControls() {
		$("[data-f='period']", filtersNode).value = f.period;
		$("[data-f='from_date']", filtersNode).value = f.from_date;
		$("[data-f='to_date']", filtersNode).value = f.to_date;
		$("[data-f='categorize_by']", filtersNode).value = f.categorize_by;
		const open = f.disable_opening_balance_calculation;
		const openingEntries = $("[data-check='show_opening_entries']", filtersNode);
		openingEntries.disabled = Boolean(open);
		openingEntries.closest(".check").classList.toggle("is-disabled", Boolean(open));
		// Count of active advanced filters on the "More options" button
		const advanced = ["against_voucher_no", "finance_book", "presentation_currency"].filter((k) => f[k]).length
			+ ["cost_center", "project", ...dimKeys].filter((k) => f[k]?.length).length;
		$("[data-slot='more-label']", filtersNode).textContent = `${ui.moreOpen ? "Fewer options" : "More options"}${advanced ? ` (${advanced})` : ""}`;
	}

	filtersNode.addEventListener("change", (e) => {
		const key = e.target.dataset.f;
		const check = e.target.dataset.check;
		if (key && e.target.type !== "search") changed(key, e.target.value);
		else if (check) changed(check, e.target.checked ? 1 : 0);
	});
	filtersNode.addEventListener(
		"input",
		debounce((e) => {
			if (e.target.type === "search" && e.target.dataset.f) changed(e.target.dataset.f, e.target.value.trim());
		}, 400)
	);
	filtersNode.addEventListener("click", (e) => {
		const action = e.target.closest("[data-action]")?.dataset.action;
		if (action === "more") {
			ui.moreOpen = !ui.moreOpen;
			slot("more").hidden = !ui.moreOpen;
			e.target.closest("[data-action]").setAttribute("aria-expanded", String(ui.moreOpen));
			storage.set("tp-gl-more", ui.moreOpen ? "1" : null);
			syncControls();
		} else if (action === "reset") {
			storage.set(STORE, null);
			window.location.href = `${location.pathname}?company=${encodeURIComponent(f.company)}`;
		}
	});

	/* ---------- URL + storage ---------- */
	function persist() {
		storage.set(STORE, JSON.stringify(f));
		const q = new URLSearchParams();
		q.set("company", f.company);
		if (f.period === "custom") {
			q.set("from", f.from_date);
			q.set("to", f.to_date);
		} else q.set("period", f.period);
		if (f.categorize_by !== CONSOLIDATED) q.set("categorize_by", f.categorize_by);
		for (const key of ["party_type", "voucher_no", "against_voucher_no", "finance_book", "presentation_currency"]) if (f[key]) q.set(key, f[key]);
		for (const key of [...LIST_KEYS, ...dimKeys]) for (const v of f[key] || []) q.append(key, v);
		const base = defaults(f.company);
		for (const [key] of CHECKS) if ((f[key] ? 1 : 0) !== (base[key] ? 1 : 0)) q.set(key, f[key] ? 1 : 0);
		history.replaceState(null, "", `${location.pathname}?${q}`);
	}

	function payload() {
		const out = {};
		for (const [key, value] of Object.entries(f)) {
			if (key === "period") continue;
			if (Array.isArray(value)) {
				if (value.length) out[key] = value;
			} else if (value !== "" && value !== null && value !== undefined && value !== 0) out[key] = value;
		}
		return out;
	}

	/* ---------- Run ---------- */
	let controller;
	const scheduleRun = debounce(() => run(), 250);
	async function run() {
		persist();
		renderSubtitle();
		controller?.abort();
		controller = new AbortController();
		root.classList.add("is-busy");
		if (!ui.result) renderSkeleton();
		try {
			ui.result = await api.post("tp.api.general_ledger.run", { filters: payload() }, { signal: controller.signal });
			ui.collapsed.clear();
			render();
		} catch (err) {
			if (err.name === "AbortError") return;
			ui.result = null;
			setHTML(slot("table"), html`<div class="state"><div class="state__icon state__icon--danger">${icon("alert")}</div><h3 class="state__title">Couldn't run the ledger</h3><p class="state__text">${err.message}</p></div>`);
			slot("count").textContent = "";
		} finally {
			root.classList.remove("is-busy");
		}
	}

	function renderSkeleton() {
		setHTML(slot("table"), html`<div class="table-wrap"><table class="table"><tbody>${Array.from({ length: 8 }, () => html`<tr>${Array.from({ length: 6 }, () => html`<td><span class="skeleton" style="height:14px;width:70%"></span></td>`)}</tr>`)}</tbody></table></div>`);
	}

	function renderSubtitle() {
		const bits = [f.company, `${fmt.date(f.from_date)} – ${fmt.date(f.to_date)}`];
		if (f.account.length) bits.push(f.account.length === 1 ? f.account[0] : `${f.account.length} accounts`);
		if (f.party.length) bits.push(f.party.length === 1 ? `${f.party_type} ${f.party[0]}` : `${f.party.length} parties`);
		if (f.voucher_no) bits.push(f.voucher_no);
		slot("subtitle").textContent = bits.join(" · ");
		document.title = `General Ledger · ${f.company} · Towel Production`;
		// Active filter summary next to "More options"
		const active = [];
		if (f.account.length) active.push(`${f.account.length} account${f.account.length === 1 ? "" : "s"}`);
		if (f.party.length) active.push(`${f.party.length} part${f.party.length === 1 ? "y" : "ies"}`);
		if (f.voucher_no) active.push("voucher");
		$("[data-slot='active']", filtersNode).textContent = active.length ? `Filtered by ${active.join(", ")}` : "";
	}

	/* ---------- Columns ---------- */
	const savedColumns = () => {
		try {
			const v = JSON.parse(storage.get(COLUMNS_STORE));
			return Array.isArray(v) ? v : null;
		} catch {
			return null;
		}
	};
	function visibleColumns() {
		const available = ui.result.columns;
		const names = new Set(available.map((c) => c.fieldname));
		const chosen = new Set((savedColumns() || DEFAULT_COLUMNS).filter((n) => names.has(n)));
		for (const [check, cols] of Object.entries(TOGGLE_COLUMNS)) if (f[check]) cols.forEach((c) => names.has(c) && chosen.add(c));
		chosen.add("account");
		return available.filter((c) => chosen.has(c.fieldname));
	}

	async function chooseColumns() {
		if (!ui.result) return;
		const picked = await pickFields({
			title: "Ledger columns",
			text: "Choose the columns shown in the ledger. Remembered in this browser.",
			fields: ui.result.columns.map((c) => ({ fieldname: c.fieldname, label: c.label, fieldtype: c.fieldtype || "Data", section: "Columns", locked: c.fieldname === "account" ? 1 : 0 })),
			selected: visibleColumns().map((c) => c.fieldname),
			defaults: DEFAULT_COLUMNS,
		});
		if (!picked) return;
		storage.set(COLUMNS_STORE, JSON.stringify(picked));
		render();
	}

	/* ---------- Render ---------- */
	const partyName = (r) => ui.result.party_names[`${r.party_type}::${r.party}`];

	function cellHTML(col, r) {
		const v = r[col.fieldname];
		switch (col.fieldname) {
			case "posting_date":
				return v ? html`<span class="gl-date">${fmt.date(v)}</span>` : "";
			case "account":
				return v ? html`<button class="gl-link" type="button" data-filter="account" data-value="${v}" title="Show only ${v}">${v}</button>` : "";
			case "balance":
				return drcr(v);
			case "voucher_no": {
				const url = linkUrl(r.voucher_type, v);
				const sub = r.voucher_subtype && r.voucher_subtype !== r.voucher_type ? html`<span class="cell-sub">${r.voucher_subtype}</span>` : "";
				return v ? html`${url ? html`<a class="gl-voucher" href="${url}" target="_blank" rel="noopener" title="Open ${r.voucher_type} ${v}">${v} ${icon("arrow-up-right", "i--sm")}</a>` : html`<span class="gl-voucher">${v}</span>`}${sub}` : "";
			}
			case "against_voucher": {
				const url = linkUrl(r.against_voucher_type, v);
				return v ? (url ? html`<a class="gl-voucher" href="${url}" target="_blank" rel="noopener">${v}</a>` : html`${v}`) : "";
			}
			case "party": {
				if (!v) return "";
				const name = partyName(r);
				return html`<button class="gl-link" type="button" data-filter="party" data-party-type="${r.party_type}" data-value="${v}" title="Show only ${r.party_type} ${v}">${name || v}</button>${name ? html`<span class="cell-sub">${v}</span>` : ""}`;
			}
			case "against":
			case "remarks":
				return v ? html`<span class="gl-long" title="${v}">${v}</span>` : "";
			default:
				if (AMOUNT_FIELDS.has(col.fieldname)) return html`<span class="num">${amount(v)}</span>`;
				return v ?? "";
		}
	}

	function summaryRow(kind, amounts, cols, label = null) {
		if (!amounts) return "";
		const labels = { opening: "Opening", total: "Total", closing: "Closing (Opening + Total)" };
		return html`<tr class="gl-summary gl-summary--${kind}">
			${cols.map((c) => {
				if (c.fieldname === "account") return html`<td class="gl-summary__label">${label || labels[kind]}</td>`;
				if (c.fieldname === "debit" || c.fieldname === "credit") return html`<td class="is-num"><span class="num">${amount(amounts[c.fieldname], { blankZero: kind !== "total" })}</span></td>`;
				if (c.fieldname === "balance") return html`<td class="is-num">${drcr(amounts.balance)}</td>`;
				return html`<td></td>`;
			})}
		</tr>`;
	}

	const matches = (r) => {
		if (!ui.search) return true;
		const text = [r.account, r.voucher_type, r.voucher_no, r.against, r.party, partyName(r), r.remarks, r.against_voucher, r.bill_no, r.posting_date, r.cost_center, r.project].join(" ").toLowerCase();
		return ui.search.split(/\s+/).every((word) => text.includes(word));
	};

	function render() {
		const res = ui.result;
		if (!res) return;
		const cols = visibleColumns();
		const numeric = (c) => AMOUNT_FIELDS.has(c.fieldname);
		const entryRow = (r) => html`<tr class="gl-entry ${r.is_cancelled ? "is-cancelled" : ""}">${cols.map((c) => html`<td class="${numeric(c) ? "is-num" : ""} gl-col-${c.fieldname}">${cellHTML(c, r)}</td>`)}</tr>`;

		const grouped = res.grouped;
		$("[data-action='expand']", root).hidden = !grouped || !res.groups.length;
		$("[data-action='collapse']", root).hidden = !grouped || !res.groups.length;

		if (!res.count && !(res.opening?.balance || res.closing?.balance)) {
			slot("count").textContent = "";
			setHTML(slot("table"), html`<div class="state"><div class="state__icon">${icon("book-open")}</div><h3 class="state__title">No ledger entries</h3><p class="state__text">Nothing was posted for these filters in ${fmt.date(f.from_date)} – ${fmt.date(f.to_date)}. Try a longer period or fewer filters.</p></div>`);
			return;
		}

		let shown = 0;
		let body = "";
		if (grouped) {
			body = res.groups
				.map((g, i) => {
					const entries = g.entries.filter(matches);
					if (ui.search && !entries.length) return "";
					shown += entries.length;
					const collapsed = ui.collapsed.has(i);
					const label =
						g.field === "voucher_no"
							? (() => {
									const first = g.entries[0] || {};
									const url = linkUrl(first.voucher_type, g.key);
									return url ? html`<a class="gl-voucher" href="${url}" target="_blank" rel="noopener">${g.label} ${icon("arrow-up-right", "i--sm")}</a>` : g.label;
								})()
							: g.field === "party"
								? html`<button class="gl-link" type="button" data-filter="party" data-party-type="${g.entries[0]?.party_type || f.party_type}" data-value="${g.key}">${partyName(g.entries[0] || {}) || g.label}</button>`
								: html`<button class="gl-link" type="button" data-filter="account" data-value="${g.key}">${g.label}</button>`;
					return html`<tr class="gl-group ${collapsed ? "is-collapsed" : ""}" data-group="${i}">
						<td colspan="${cols.length}">
							<div class="gl-group__row">
								<button class="gl-group__toggle" type="button" data-toggle-group="${i}" aria-expanded="${!collapsed}" aria-label="Show or hide ${g.label}">${icon("chevron-down", "i--sm")}</button>
								<span class="gl-group__label">${label}</span>
								<span class="gl-group__meta">${g.entries.length} entr${g.entries.length === 1 ? "y" : "ies"}</span>
								<span class="gl-group__balance">Closing ${drcr(g.closing?.balance ?? 0)}</span>
							</div>
						</td>
					</tr>
					${collapsed ? "" : html`${summaryRow("opening", g.opening, cols)}${entries.map(entryRow)}${summaryRow("total", g.total, cols)}${summaryRow("closing", g.closing, cols)}`}`;
				})
				.join("");
		} else {
			const entries = res.entries.filter(matches);
			shown = entries.length;
			body = String(html`${entries.map(entryRow)}`);
		}

		slot("count").textContent = ui.search ? `${shown} of ${res.count} entries` : `${res.count} entr${res.count === 1 ? "y" : "ies"}${grouped ? ` in ${res.groups.length} group${res.groups.length === 1 ? "" : "s"}` : ""}`;
		setHTML(
			slot("table"),
			html`<div class="table-wrap gl-wrap"><table class="table gl-table">
				<thead><tr>${cols.map((c) => html`<th class="${numeric(c) ? "is-num" : ""} gl-col-${c.fieldname}">${c.label}</th>`)}</tr></thead>
				<tbody>
					${summaryRow("opening", res.opening, cols, grouped ? "Opening (all)" : null)}
					${raw(body)}
					${ui.search && !shown ? html`<tr><td colspan="${cols.length}" class="gl-nomatch">No entries match “${ui.search}”.</td></tr>` : ""}
				</tbody>
				<tfoot>
					${summaryRow("total", res.total, cols, grouped ? "Total (all)" : null)}
					${summaryRow("closing", res.closing, cols, grouped ? "Closing (all)" : null)}
				</tfoot>
			</table></div>`
		);
	}

	/* ---------- Result interactions ---------- */
	slot("table").addEventListener("click", (e) => {
		const toggle = e.target.closest("[data-toggle-group]");
		if (toggle) {
			const i = +toggle.dataset.toggleGroup;
			if (ui.collapsed.has(i)) ui.collapsed.delete(i);
			else ui.collapsed.add(i);
			render();
			return;
		}
		const filter = e.target.closest("[data-filter]");
		if (filter) {
			if (filter.dataset.filter === "account") {
				f.account = [filter.dataset.value];
				multis.account.set(f.account);
				toast(`Showing ${filter.dataset.value}`, { text: "Remove the account chip to see all accounts again.", timeout: 2500 });
			} else {
				const type = filter.dataset.partyType;
				if (type && type !== f.party_type) {
					f.party_type = type;
					$("[data-f='party_type']", filtersNode).value = type;
					multis.party.setDoctype(type);
				}
				f.party = [filter.dataset.value];
				multis.party.set(f.party);
				toast(`Showing ${type} ${filter.dataset.value}`, { timeout: 2500 });
			}
			syncControls();
			run();
		}
	});

	slot("search").addEventListener(
		"input",
		debounce((e) => {
			ui.search = e.target.value.trim().toLowerCase();
			render();
		}, 150)
	);

	root.addEventListener("click", (e) => {
		const action = e.target.closest(".page-actions [data-action], .gl-results .toolbar [data-action]")?.dataset.action;
		if (!action) return;
		if (action === "refresh") run();
		else if (action === "print") window.print();
		else if (action === "columns") chooseColumns();
		else if (action === "expand" || action === "collapse") {
			ui.collapsed = action === "collapse" ? new Set(ui.result.groups.map((_, i) => i)) : new Set();
			render();
		} else if (action === "export") {
			openMenu(e.target.closest("[data-action]"), [
				{ label: "Excel (.xlsx)", icon: "download", run: () => exportAs("Excel") },
				{ label: "CSV", icon: "file-text", run: () => exportAs("CSV") },
			]);
		}
	});

	async function exportAs(fileFormat) {
		if (!ui.result) return;
		const q = new URLSearchParams({ filters: JSON.stringify(payload()), columns: JSON.stringify(visibleColumns().map((c) => c.fieldname)), file_format: fileFormat });
		toast("Preparing export…", { timeout: 2000 });
		try {
			const response = await fetch(`/api/method/tp.api.general_ledger.export?${q}`, { credentials: "same-origin" });
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(String(body.exception || "").split(": ").slice(1).join(": ") || "The export failed.");
			}
			const filename = /filename="?([^";]+)"?/.exec(response.headers.get("Content-Disposition") || "")?.[1] || `general_ledger.${fileFormat === "CSV" ? "csv" : "xlsx"}`;
			const url = URL.createObjectURL(await response.blob());
			const link = Object.assign(document.createElement("a"), { href: url, download: decodeURIComponent(filename) });
			document.body.append(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (err) {
			showError(err, "Couldn't export");
		}
	}

	document.addEventListener("keydown", (e) => {
		if (e.target.closest("input, textarea, select, .overlay") || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === "/") {
			e.preventDefault();
			slot("search").focus();
		} else if (e.key.toLowerCase() === "r") run();
	});

	syncControls();
	run();
}
