/**
 * Generic master-data page (Items, Customers, Colors…): searchable, tabbed list with a
 * drawer form for create/edit. Everything is driven by tp/config/resources.py via boot data.
 * "Form fields" lets each user add more of the DocType's fields to the form; the choice is
 * kept in the browser (localStorage) per resource. List / Report view options (filters, sort,
 * columns, export, bulk actions…) come from components/list-options.js.
 *
 *   mountResourcePage();                                   // a page of its own (tp/templates/tp/resource.html)
 *   const list = mountResourcePage({ root, handleOpen: false });  // hosted inside another page
 *   list.reload(); list.openForm(null);                   // e.g. the Chart of Accounts' List view
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, boot, debounce, storage } from "@tp/core/dom.js";
import { toast, showError } from "@tp/core/toast.js";
import { DataTable } from "@tp/components/data-table.js";
import { openResourceForm, deleteRecord } from "@tp/components/resource-form.js";
import { pickFields } from "@tp/components/field-picker.js";
import { ListOptions } from "@tp/components/list-options.js";

export function mountResourcePage({ root = null, handleOpen = true } = {}) {
	const { resource, permissions: perms, page: pageKey } = boot();
	const page = root || $("[data-resource]");
	const searchInput = $("[data-slot='search']", page);
	const tabsNode = $("[data-slot='tabs']", page);
	const tabKey = `tp-tab-${resource.key}`;
	const fieldsKey = `tp-fields-${resource.key}`;

	const state = {
		txt: "",
		tab: resource.tabs.find((t) => t.key === storage.get(tabKey))?.key || resource.tabs[0]?.key || null,
		start: 0,
	};

	const newButton = $("[data-action='new']", page);
	if (newButton) newButton.hidden = !perms.create;

	/* Tabs */
	tabsNode.innerHTML = resource.tabs
		.map((t) => html`<button class="tab" role="tab" type="button" data-tab="${t.key}" aria-selected="${t.key === state.tab}">${t.label}</button>`)
		.join("");
	tabsNode.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-tab]");
		if (!btn) return;
		state.tab = btn.dataset.tab;
		state.start = 0;
		storage.set(tabKey, state.tab);
		tabsNode.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
		load();
	});

	/* Table */
	const columns = resource.list_fields.map((f) => ({ key: f.fieldname, label: f.label, type: f.type, width: f.width, sub: f.sub, sortable: Boolean(f.label) }));
	const rowActions = (perms.write || perms.delete)
		? (row) => html`
			${perms.write ? html`<button class="icon-btn icon-btn--sm icon-btn--primary" type="button" data-edit="${row.name}" aria-label="Edit ${row.name}">${icon("pencil", "i--sm")}</button>` : ""}
			${perms.delete ? html`<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-delete="${row.name}" aria-label="Delete ${row.name}">${icon("trash", "i--sm")}</button>` : ""}`
		: null;

	const table = new DataTable($("[data-slot='table']", page), {
		columns,
		rowActions,
		onRowClick: (row) => openForm(row.name),
		onPage: (start) => {
			state.start = start;
			load();
		},
		empty: {
			icon: "inbox",
			title: `No ${resource.singular.toLowerCase()}s found`,
			text: "Try a different search, tab or filter.",
			action: perms.create ? raw(`<button class="btn btn--primary" type="button" data-action="new">${icon("plus")} New ${resource.singular}</button>`) : "",
		},
	});

	const [sortField, sortDir] = resource.order_by.split(" ");
	const options = new ListOptions({
		page: pageKey,
		table,
		sort: { field: sortField, dir: sortDir || "desc" },
		quickFilters: () => {
			const tab = resource.tabs.find((t) => t.key === state.tab);
			return Object.entries(tab?.filters || {}).map(([field, value]) => [options.meta.doctype, field, ...(Array.isArray(value) ? value : ["=", value])]);
		},
		search: () => state.txt,
		openRecord: (name) => openForm(name),
		onChange: () => {
			state.start = 0;
			load();
		},
		onCount: (total) => showCount(total),
	});
	const showCount = (total) => {
		const countNode = $("[data-slot='count']", page);
		if (countNode) countNode.textContent = `${total.toLocaleString()} ${total === 1 ? resource.singular.toLowerCase() : `${resource.singular.toLowerCase()}s`}`;
	};

	page.addEventListener("click", (e) => {
		const edit = e.target.closest("[data-edit]");
		const del = e.target.closest("[data-delete]");
		if (edit) openForm(edit.dataset.edit);
		else if (del) remove(del.dataset.delete);
		else if (e.target.closest("[data-action='new']")) openForm(null);
		else if (e.target.closest("[data-action='refresh']")) load();
		else if (e.target.closest("[data-action='fields']")) chooseFields();
	});

	searchInput.addEventListener(
		"input",
		debounce(() => {
			state.txt = searchInput.value.trim();
			state.start = 0;
			load();
		}, 250)
	);
	document.addEventListener("keydown", (e) => {
		// Hosted lists can be hidden (e.g. behind the Chart of Accounts' Tree view)
		if (e.key === "/" && !e.target.closest("input, textarea, select") && page.offsetParent !== null) {
			e.preventDefault();
			searchInput.focus();
		}
	});

	let controller;
	async function load() {
		await options.ready;
		if (options.isReport) return options.load();
		controller?.abort();
		controller = new AbortController();
		table.loading();
		try {
			const result = await api.get(
				"tp.api.resources.get_list",
				{ resource: resource.key, txt: state.txt, tab: state.tab, start: state.start, ...options.listArgs() },
				{ signal: controller.signal }
			);
			table.update(result);
			showCount(result.total);
		} catch (err) {
			showError(err, `Couldn't load ${resource.singular.toLowerCase()}s`);
		}
	}

	/* Form fields: configured ones by default, or the user's saved selection */
	let allFields = null;
	const savedSelection = () => {
		try {
			const names = JSON.parse(storage.get(fieldsKey));
			return Array.isArray(names) ? names : null;
		} catch {
			return null;
		}
	};

	async function loadAllFields() {
		allFields ??= (await api.get("tp.api.resources.get_fields", { resource: resource.key })).fields;
		return allFields;
	}

	async function formFields() {
		const selection = savedSelection();
		if (!selection) return resource.form_fields;
		const chosen = new Set(selection);
		return (await loadAllFields()).filter((f) => f.locked || chosen.has(f.fieldname));
	}

	async function chooseFields() {
		const button = $("[data-action='fields']", page);
		button.classList.add("is-loading");
		let fields;
		try {
			fields = await loadAllFields();
		} catch (err) {
			showError(err, "Couldn't load fields");
			return;
		} finally {
			button.classList.remove("is-loading");
		}
		const defaults = resource.form_fields.map((f) => f.fieldname);
		const picked = await pickFields({
			title: `${resource.singular} form fields`,
			fields,
			selected: savedSelection() || defaults,
			defaults,
		});
		if (!picked) return;
		const isDefault = picked.length === defaults.length && defaults.every((n) => picked.includes(n));
		storage.set(fieldsKey, isDefault ? null : JSON.stringify(picked));
		toast.success("Form fields updated", { text: `${picked.length} fields will show in the ${resource.singular.toLowerCase()} form.` });
	}

	async function openForm(name) {
		let fields;
		try {
			fields = await formFields();
		} catch (err) {
			showError(err, "Couldn't load form");
			return;
		}
		openResourceForm({ resource, name, fields, permissions: perms, onSaved: load, onDeleted: load });
	}

	async function remove(name) {
		if (await deleteRecord({ resource, name })) load();
	}

	load();

	// `?open=<name>` (e.g. from a Link field's arrow): open that record's form
	const openName = handleOpen && new URLSearchParams(location.search).get("open");
	if (openName) {
		history.replaceState(null, "", location.pathname);
		openForm(openName);
	}

	return { reload: load, openForm };
}
