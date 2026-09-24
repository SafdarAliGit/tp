/**
 * Material Request list: status tabs, search, purpose / customer / contract / date filters,
 * plus the shared List / Report view options (components/list-options.js).
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, boot, debounce } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { showError } from "@tp/core/toast.js";
import { DataTable } from "@tp/components/data-table.js";
import { LinkField } from "@tp/components/link-field.js";
import { statusTone } from "@tp/lib/status.js";
import { ListOptions } from "@tp/components/list-options.js";

const BASE = "/stock/material-requests";
const DOCTYPE = "Material Request";
// `status` filters mirror STATUS_TABS in tp/api/material_requests.py
const TABS = [
	{ key: "", label: "All" },
	{ key: "draft", label: "Draft", status: ["=", "Draft"] },
	{ key: "pending", label: "Pending", status: ["in", ["Pending", "Partially Ordered", "Partially Received"]] },
	{ key: "completed", label: "Completed", status: ["in", ["Ordered", "Received", "Transferred", "Issued"]] },
	{ key: "stopped", label: "Stopped", status: ["=", "Stopped"] },
	{ key: "cancelled", label: "Cancelled", status: ["=", "Cancelled"] },
];

export async function mountMaterialRequestList() {
	const { permissions: perms } = boot();
	const params = new URLSearchParams(location.search);
	const state = {
		tab: TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "",
		txt: params.get("q") || "",
		purpose: params.get("purpose") || "",
		customer: params.get("customer") || "",
		contract: params.get("contract") || "",
		from_date: params.get("from") || "",
		to_date: params.get("to") || "",
		start: 0,
	};

	$("[data-slot='new']").hidden = !perms.create;
	const search = $("[data-slot='search']");
	const purpose = $("[data-slot='purpose']");
	const from = $("[data-slot='from']");
	const to = $("[data-slot='to']");
	const clear = $("[data-action='clear-filters']");
	const tabs = $("[data-slot='tabs']");
	search.value = state.txt;
	from.value = state.from_date;
	to.value = state.to_date;

	tabs.innerHTML = String(
		html`${TABS.map((t) => html`<button class="tab" role="tab" type="button" data-tab="${t.key}" aria-selected="${t.key === state.tab}">${t.label}</button>`)}`
	);
	tabs.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-tab]");
		if (!btn) return;
		state.tab = btn.dataset.tab;
		tabs.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
		reload();
	});

	const linkFilter = (slot, doctype, key, placeholder) => {
		const field = new LinkField({
			doctype,
			value: state[key],
			placeholder,
			allowCreate: false,
			onChange: (value) => {
				state[key] = value;
				reload();
			},
		});
		field.input.setAttribute("aria-label", placeholder);
		$(`[data-slot='${slot}']`).replaceWith(field.el);
		return field;
	};
	const customer = linkFilter("customer", "Customer", "customer", "All customers");
	const contract = linkFilter("contract", "Weaving Contract Terry", "contract", "All contracts");

	const tableNode = $("[data-slot='table']");
	tableNode.classList.add("mr-table");
	const table = new DataTable(tableNode, {
		columns: [
			{ key: "name", label: "Request", type: "title", sub: "title", sortable: true },
			{ key: "material_request_type", label: "Purpose", type: "badge" },
			{ key: "customer_title", label: "Customer" },
			{
				key: "contracts",
				label: "Contract",
				render: (v) => (v?.length ? html`<span class="cell-code">${v[0]}</span>${v.length > 1 ? html` <span class="muted">+${v.length - 1}</span>` : ""}` : html`<span class="muted">—</span>`),
			},
			{
				key: "transaction_date",
				label: "Date",
				sortable: true,
				render: (v, row) => html`${fmt.date(v)}<span class="cell-sub">Due ${fmt.date(row.schedule_date)}</span>`,
			},
			{ key: "qty", label: "Qty", type: "number" },
			{ key: "bags", label: "Bags", type: "number" },
			{ key: "status", label: "Status", render: (v) => html`<span class="pill ${statusTone(v)}">${v}</span>` },
		],
		onRowClick: (row) => (window.location.href = `${BASE}/${encodeURIComponent(row.name)}`),
		onPage: (start) => {
			state.start = start;
			load();
		},
		empty: {
			icon: "clipboard-list",
			title: "No material requests found",
			text: "Adjust the filters, or create a new request.",
			action: perms.create ? raw(`<a class="btn btn--primary" href="${BASE}/new">${icon("plus")} New Request</a>`) : "",
		},
	});

	const options = new ListOptions({
		page: "material-requests",
		table,
		sort: { field: "modified", dir: "desc" },
		quickFilters: () => {
			const status = TABS.find((t) => t.key === state.tab)?.status;
			return [
				status && [DOCTYPE, "status", ...status],
				state.purpose && [DOCTYPE, "material_request_type", "=", state.purpose],
				state.customer && [DOCTYPE, "customer", "=", state.customer],
				state.contract && ["Material Request Item", "weaving_contract_terry", "=", state.contract],
				state.from_date && [DOCTYPE, "transaction_date", ">=", state.from_date],
				state.to_date && [DOCTYPE, "transaction_date", "<=", state.to_date],
			].filter(Boolean);
		},
		search: () => state.txt,
		openRecord: (name) => (window.location.href = `${BASE}/${encodeURIComponent(name)}`),
		onChange: () => reload(),
		onCount: (total) => showCount(total),
	});
	const showCount = (total) => {
		$("[data-slot='count']").textContent = `${fmt.number(total, 0)} request${total === 1 ? "" : "s"}`;
	};

	const filtered = () => Boolean(state.txt || state.purpose || state.customer || state.contract || state.from_date || state.to_date);
	const syncUrl = () => {
		const q = new URLSearchParams();
		const keys = { tab: "tab", txt: "q", purpose: "purpose", customer: "customer", contract: "contract", from_date: "from", to_date: "to" };
		for (const [key, param] of Object.entries(keys)) if (state[key]) q.set(param, state[key]);
		history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
		clear.hidden = !filtered();
	};

	let controller;
	async function load() {
		syncUrl();
		await options.ready;
		if (options.isReport) return options.load();
		controller?.abort();
		controller = new AbortController();
		table.loading();
		try {
			const result = await api.get(
				"tp.api.material_requests.get_list",
				{
					tab: state.tab,
					txt: state.txt,
					purpose: state.purpose,
					customer: state.customer,
					contract: state.contract,
					from_date: state.from_date,
					to_date: state.to_date,
					start: state.start,
					...options.listArgs(),
				},
				{ signal: controller.signal }
			);
			table.update(result);
			showCount(result.total);
		} catch (err) {
			if (err.name !== "AbortError") showError(err, "Couldn't load material requests");
		}
	}
	const reload = () => {
		state.start = 0;
		load();
	};

	search.addEventListener(
		"input",
		debounce(() => {
			state.txt = search.value.trim();
			reload();
		}, 250)
	);
	purpose.addEventListener("change", () => {
		state.purpose = purpose.value;
		reload();
	});
	from.addEventListener("change", () => {
		state.from_date = from.value;
		reload();
	});
	to.addEventListener("change", () => {
		state.to_date = to.value;
		reload();
	});
	clear.addEventListener("click", () => {
		Object.assign(state, { txt: "", purpose: "", customer: "", contract: "", from_date: "", to_date: "" });
		search.value = purpose.value = from.value = to.value = "";
		customer.set("", "");
		contract.set("", "");
		reload();
	});
	$("[data-action='refresh']").addEventListener("click", load);
	document.addEventListener("keydown", (e) => {
		if (e.key === "/" && !e.target.closest("input, textarea, select")) {
			e.preventDefault();
			search.focus();
		}
	});

	load();

	try {
		const meta = await api.get("tp.api.material_requests.get_meta");
		purpose.insertAdjacentHTML("beforeend", String(html`${meta.purposes.map((p) => html`<option ${raw(p === state.purpose ? "selected" : "")}>${p}</option>`)}`));
	} catch (err) {
		showError(err, "Couldn't load purposes");
	}
}
