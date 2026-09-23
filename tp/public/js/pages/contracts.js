import { api } from "@tp/core/api.js";
import { $, icon, raw, boot, debounce } from "@tp/core/dom.js";
import { showError } from "@tp/core/toast.js";
import { DataTable } from "@tp/components/data-table.js";
import { LinkField } from "@tp/components/link-field.js";

export function mountContractList() {
	const { permissions: perms } = boot();
	const params = new URLSearchParams(location.search);
	const state = {
		txt: params.get("q") || "",
		buyer: params.get("buyer") || "",
		from_date: params.get("from") || "",
		to_date: params.get("to") || "",
		start: 0,
		sort: { field: "modified", dir: "desc" },
	};

	$("[data-slot='new']").hidden = !perms.create;
	const search = $("[data-slot='search']");
	const from = $("[data-slot='from']");
	const to = $("[data-slot='to']");
	const clear = $("[data-action='clear-filters']");
	search.value = state.txt;
	from.value = state.from_date;
	to.value = state.to_date;

	const buyer = new LinkField({
		doctype: "Customer",
		value: state.buyer,
		placeholder: "All buyers",
		onChange: (value) => {
			state.buyer = value;
			reload();
		},
	});
	buyer.input.setAttribute("aria-label", "Filter by buyer");
	$("[data-slot='buyer']").replaceWith(buyer.el);

	const table = new DataTable($("[data-slot='table']"), {
		columns: [
			{ key: "name", label: "Contract", type: "title", sortable: true },
			{ key: "buyer_title", label: "Buyer" },
			{ key: "po_no", label: "PO No" },
			{ key: "po_start_date", label: "PO Start", type: "date", sortable: true },
			{ key: "po_end_date", label: "PO End", type: "date" },
			{ key: "total_item_qty", label: "Pieces", type: "number", sortable: true },
			{ key: "total_bags", label: "Yarn Bags", type: "number" },
			{ key: "total_amount", label: "Amount", type: "currency", sortable: true },
		],
		sort: state.sort,
		onSort: (sort) => {
			state.sort = sort;
			reload();
		},
		onRowClick: (row) => (window.location.href = `/contracts/${encodeURIComponent(row.name)}`),
		onPage: (start) => {
			state.start = start;
			load();
		},
		empty: {
			icon: "file-text",
			title: "No contracts found",
			text: "Adjust the filters, or create a new contract.",
			action: perms.create ? raw(`<a class="btn btn--primary" href="/contracts/new">${icon("plus")} New Contract</a>`) : "",
		},
	});

	const syncUrl = () => {
		const q = new URLSearchParams();
		if (state.txt) q.set("q", state.txt);
		if (state.buyer) q.set("buyer", state.buyer);
		if (state.from_date) q.set("from", state.from_date);
		if (state.to_date) q.set("to", state.to_date);
		history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
		clear.hidden = !(state.txt || state.buyer || state.from_date || state.to_date);
	};

	let controller;
	async function load() {
		controller?.abort();
		controller = new AbortController();
		syncUrl();
		table.loading();
		try {
			const result = await api.get(
				"tp.api.contracts.get_list",
				{
					txt: state.txt,
					buyer: state.buyer,
					from_date: state.from_date,
					to_date: state.to_date,
					start: state.start,
					page_length: 20,
					order_by: `${state.sort.field} ${state.sort.dir}`,
				},
				{ signal: controller.signal }
			);
			table.update(result);
			$("[data-slot='count']").textContent = `${result.total.toLocaleString()} contract${result.total === 1 ? "" : "s"}`;
		} catch (err) {
			showError(err, "Couldn't load contracts");
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
	from.addEventListener("change", () => {
		state.from_date = from.value;
		reload();
	});
	to.addEventListener("change", () => {
		state.to_date = to.value;
		reload();
	});
	clear.addEventListener("click", () => {
		Object.assign(state, { txt: "", buyer: "", from_date: "", to_date: "" });
		search.value = from.value = to.value = "";
		buyer.set("", "");
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
}
