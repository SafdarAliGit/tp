/**
 * Drawer form for one record of a resource from tp/config/resources.py (create / edit / delete).
 * Shared by the master-data list pages and other views of the same resource (e.g. the account tree).
 *
 *   openResourceForm({ resource, name, fields, permissions, values, onSaved, onDeleted, onCancel });
 *   // name = null → create; `values` prefills a new record (e.g. { parent_account })
 *   // onCancel: the drawer closed without saving
 *   // Saved records offer "Duplicate": a new drawer pre-filled from a copy (tp.api.resources.get_copy)
 */
import { api } from "@tp/core/api.js";
import { $, html, icon } from "@tp/core/dom.js";
import { confirm, drawer } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { Form } from "@tp/components/form.js";

export async function openResourceForm(options) {
	const { resource, name = null, fields, permissions, values: initial = {}, copyOf = null, onSaved, onDeleted, onCancel } = options;
	let values = { ...initial };
	let docPerms = permissions;
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
		subtitle: copyOf ? `Copy of ${copyOf}` : name && values[resource.title_field] !== name ? name : "",
		onClose: (saved) => saved || onCancel?.(),
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
		${name && docPerms.create ? html`<button class="btn btn--ghost" type="button" data-act="duplicate" title="Create a copy of this ${resource.singular.toLowerCase()}">${icon("copy")} Duplicate</button>` : ""}
		<span class="spacer"></span>
		<span class="drawer__main-actions">
			<button class="btn btn--secondary" type="button" data-act="cancel">${readOnly ? "Close" : "Cancel"}</button>
			${readOnly ? "" : html`<button class="btn btn--primary" type="button" data-act="save">${icon("check")} ${name ? "Save" : `Create ${resource.singular}`}</button>`}
		</span>
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
			form.destroy();
			panel.close(true);
			onSaved?.(result.doc);
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
		} else if (act === "duplicate") {
			if (dirty && !(await confirm({ title: "Duplicate without your changes?", text: "The copy is made from the saved record; your unsaved changes here will be lost.", confirmLabel: "Duplicate" }))) return;
			let copy;
			try {
				copy = await api.get("tp.api.resources.get_copy", { resource: resource.key, name });
			} catch (err) {
				showError(err, "Couldn't duplicate");
				return;
			}
			form.destroy();
			panel.close(false);
			openResourceForm({ ...options, name: null, values: copy.values, copyOf: name });
		} else if (act === "delete") {
			if (await deleteRecord({ resource, name })) {
				form.destroy();
				panel.close(true);
				onDeleted?.(name);
			}
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

/** Confirm, then delete. Resolves true when the record was deleted. */
export async function deleteRecord({ resource, name }) {
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
		return true;
	} catch (err) {
		showError(err, "Couldn't delete");
		return false;
	}
}
