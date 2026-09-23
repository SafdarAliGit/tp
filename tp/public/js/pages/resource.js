/**
 * Generic master-data page (Items, Customers, Colors…): searchable, tabbed list with a
 * drawer form for create/edit. Everything is driven by tp/config/resources.py via boot data.
 * "Form fields" lets each user add more of the DocType's fields to the form; the choice is
 * kept in the browser (localStorage) per resource.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, boot, debounce, storage } from "@tp/core/dom.js";
import { confirm, drawer } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { DataTable } from "@tp/components/data-table.js";
import { Form } from "@tp/components/form.js";
import { pickFields } from "@tp/components/field-picker.js";

export function mountResourcePage() {
	const { resource, permissions: perms } = boot();
	const page = $("[data-resource]");
	const searchInput = $("[data-slot='search']", page);
	const tabsNode = $("[data-slot='tabs']", page);
	const tabKey = `tp-tab-${resource.key}`;
	const fieldsKey = `tp-fields-${resource.key}`;

	const state = {
		txt: "",
		tab: resource.tabs.find((t) => t.key === storage.get(tabKey))?.key || resource.tabs[0]?.key || null,
		start: 0,
	};

	$("[data-action='new']", page).hidden = !perms.create;

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
	const columns = resource.list_fields.map((f) => ({ key: f.fieldname, label: f.label, type: f.type, width: f.width }));
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
			text: "Try a different search or tab.",
			action: perms.create ? raw(`<button class="btn btn--primary" type="button" data-action="new">${icon("plus")} New ${resource.singular}</button>`) : "",
		},
	});

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
		if (e.key === "/" && !e.target.closest("input, textarea, select")) {
			e.preventDefault();
			searchInput.focus();
		}
	});

	let controller;
	async function load() {
		controller?.abort();
		controller = new AbortController();
		table.loading();
		try {
			const result = await api.get(
				"tp.api.resources.get_list",
				{ resource: resource.key, txt: state.txt, tab: state.tab, start: state.start, page_length: 20 },
				{ signal: controller.signal }
			);
			table.update(result);
			$("[data-slot='count']", page).textContent = `${result.total.toLocaleString()} ${result.total === 1 ? resource.singular.toLowerCase() : `${resource.singular.toLowerCase()}s`}`;
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
		let values = {};
		let docPerms = perms;
		if (name) {
			try {
				const result = await api.get("tp.api.resources.get", { resource: resource.key, name });
				values = result.doc;
				docPerms = result.permissions;
			} catch (err) {
				showError(err, "Couldn't open record");
				return;
			}
		}

		const readOnly = name ? !docPerms.write : !docPerms.create;
		const panel = drawer({
			title: name ? values[resource.title_field] || name : `New ${resource.singular}`,
			subtitle: name && values[resource.title_field] !== name ? name : "",
		});
		let dirty = false;
		const form = new Form(panel.body, fields, {
			values,
			isNew: !name,
			disabled: readOnly,
			onChange: () => (dirty = true),
		});

		panel.footer.innerHTML = String(html`
			${name && docPerms.delete ? html`<button class="btn btn--ghost btn--danger" type="button" data-act="delete">${icon("trash")} Delete</button>` : ""}
			<span class="spacer"></span>
			<button class="btn btn--secondary" type="button" data-act="cancel">${readOnly ? "Close" : "Cancel"}</button>
			${readOnly ? "" : html`<button class="btn btn--primary" type="button" data-act="save">${icon("check")} ${name ? "Save changes" : `Create ${resource.singular}`}</button>`}
		`);

		const save = async () => {
			if (!form.validate()) return;
			const button = $("[data-act='save']", panel.footer);
			button.classList.add("is-loading");
			button.disabled = true;
			try {
				const payload = { ...form.values(), modified: values.modified };
				const result = await api.post("tp.api.resources.save", { resource: resource.key, name, data: payload });
				toast.success(name ? "Changes saved" : `${resource.singular} created`, { text: result.doc.name });
				dirty = false;
				panel.close(true);
				load();
			} catch (err) {
				button.classList.remove("is-loading");
				button.disabled = false;
				showError(err, "Couldn't save");
			}
		};

		panel.footer.addEventListener("click", async (e) => {
			const act = e.target.closest("[data-act]")?.dataset.act;
			if (act === "save") save();
			else if (act === "cancel") {
				if (!dirty || (await confirm({ title: "Discard changes?", text: "Your unsaved changes will be lost.", confirmLabel: "Discard", danger: true }))) {
					form.destroy();
					panel.close(false);
				}
			} else if (act === "delete") {
				if (await remove(name)) panel.close(true);
			}
		});
		panel.body.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && e.target.matches("input:not([role=combobox])")) {
				e.preventDefault();
				save();
			}
		});
		panel.node.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				if (!readOnly) save();
			}
		});
	}

	async function remove(name) {
		const ok = await confirm({
			title: `Delete ${resource.singular.toLowerCase()}?`,
			text: `"${name}" will be permanently deleted. This can't be undone.`,
			confirmLabel: "Delete",
			danger: true,
		});
		if (!ok) return false;
		try {
			await api.post("tp.api.resources.delete", { resource: resource.key, name });
			toast.success(`${resource.singular} deleted`, { text: name });
			load();
			return true;
		} catch (err) {
			showError(err, "Couldn't delete");
			return false;
		}
	}

	load();
}
