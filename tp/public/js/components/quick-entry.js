/**
 * "+ Create a new …" from a Link field, like ERPNext's quick entry.
 *
 *   const created = await quickCreate("UOM", { text: "Cone", values: { company } });
 *   // → { value, label } of the new record, or null (cancelled / opened elsewhere)
 *
 * What opens depends on tp.api.quick_entry.get_info: the DocType's own master-data drawer
 * (Items, Customers…), a quick-entry dialog with its mandatory fields, or its full form in a
 * new tab when a quick entry isn't enough.
 */
import { api } from "@tp/core/api.js";
import { toast, showError } from "@tp/core/toast.js";
import { formDialog } from "@tp/components/form-dialog.js";
import { openResourceForm } from "@tp/components/resource-form.js";

const infos = new Map();

/** Cached per DocType for the page's lifetime. */
export function createInfo(doctype) {
	if (!infos.has(doctype)) {
		infos.set(
			doctype,
			api.get("tp.api.quick_entry.get_info", { doctype }).catch(() => ({ can_create: false }))
		);
	}
	return infos.get(doctype);
}

/** Field the typed search text goes into. */
function textField(fields, titleField) {
	const names = fields.map((f) => f.fieldname);
	if (titleField && names.includes(titleField)) return titleField;
	return fields.find((f) => f.fieldtype === "Data" && f.reqd)?.fieldname || null;
}

export async function quickCreate(doctype, { text = "", values = {} } = {}) {
	const info = await createInfo(doctype);
	if (!info.can_create) return null;

	if (info.resource) {
		const { resource } = info;
		const fields = resource.form_fields;
		const target = textField(fields, resource.title_field === "name" ? null : resource.title_field);
		const initial = { ...values, ...(text && target ? { [target]: text } : {}) };
		return new Promise((resolve) =>
			openResourceForm({
				resource,
				fields,
				values: initial,
				permissions: { create: true, write: true },
				onSaved: (doc) => resolve({ value: doc.name, label: doc[resource.title_field] || doc.name }),
				onCancel: () => resolve(null),
			})
		);
	}

	if (info.fields) {
		const target = textField(info.fields, info.title_field);
		const initial = { ...values, ...(text && target ? { [target]: text } : {}) };
		return formDialog({
			title: `New ${doctype}`,
			fields: info.fields,
			values: initial,
			confirmLabel: "Create",
			submit: async (data) => {
				const created = await api.post("tp.api.quick_entry.create", { doctype, data });
				toast.success(`${doctype} created`, { text: created.value });
				return created;
			},
		});
	}

	if (info.new_url) {
		window.open(info.new_url, "_blank", "noopener");
		toast(`Create the ${doctype} in the new tab`, { text: "Then pick it here." });
		return null;
	}
	showError(new Error(`${doctype} can't be created here.`));
	return null;
}
