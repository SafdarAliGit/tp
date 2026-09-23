/**
 * Declarative form built from Frappe-like field definitions:
 *   { fieldname, label, fieldtype, options, reqd, default, set_only_once, read_only, full, filters, placeholder, depends_on }
 *
 * `depends_on: { is_group: 0 }` shows the field only while every listed value matches.
 * A Link filter value `{ field: "company" }` is read from another field when searching.
 *
 *   const form = new Form(node, fields, { values, isNew, disabled, onChange });
 *   if (form.validate()) save(form.values());
 */
import { html, el, raw } from "@tp/core/dom.js";
import { LinkField } from "@tp/components/link-field.js";

const NUMBER_TYPES = new Set(["Int", "Float", "Currency", "Percent"]);
let uid = 0;

export class Form {
	constructor(node, fields, { values = {}, isNew = true, disabled = false, onChange } = {}) {
		Object.assign(this, { node, fields, isNew, disabled, onChange });
		this.inputs = {};
		this.links = {};
		this.data = {};
		for (const f of fields) {
			this.data[f.fieldname] = values[f.fieldname] ?? (isNew ? f.default ?? (f.fieldtype === "Check" ? 0 : "") : "");
		}
		this.render();
	}

	isVisible(f) {
		if (!f.depends_on) return true;
		return Object.entries(f.depends_on).every(([key, expected]) => {
			const value = this.data[key];
			return typeof expected === "number" ? Number(value || 0) === expected : (value ?? "") === expected;
		});
	}

	refreshVisibility() {
		for (const f of this.fields) {
			if (!f.depends_on) continue;
			const wrap = this.node.querySelector(`[data-field="${f.fieldname}"]`);
			if (wrap) wrap.hidden = !this.isVisible(f);
		}
	}

	linkFilters(f) {
		if (!f.filters) return undefined;
		const refs = Object.values(f.filters).some((v) => v && typeof v === "object" && "field" in v);
		if (!refs) return f.filters;
		return () =>
			Object.fromEntries(
				Object.entries(f.filters)
					.map(([key, v]) => [key, v && typeof v === "object" && "field" in v ? this.data[v.field] : v])
					.filter(([, v]) => v !== "" && v !== null && v !== undefined)
			);
	}

	isReadOnly(f) {
		return this.disabled || f.read_only || (f.set_only_once && !this.isNew);
	}

	render() {
		const grid = el(`<div class="form-grid"></div>`);
		for (const f of this.fields) grid.append(this.renderField(f));
		this.node.replaceChildren(grid);
		this.refreshVisibility();
	}

	renderField(f) {
		const id = `f-${++uid}`;
		const value = this.data[f.fieldname];
		const ro = this.isReadOnly(f);
		const wrap = el(html`<div class="field ${f.full || f.fieldtype === "Small Text" || f.fieldtype === "Text" ? "field--full" : ""}" data-field="${f.fieldname}"></div>`);

		if (f.fieldtype === "Check") {
			wrap.append(
				el(html`<label class="check"><input type="checkbox" id="${id}" ${raw(value ? "checked" : "")} ${raw(ro ? "disabled" : "")}> ${f.label}</label>`)
			);
			const input = wrap.querySelector("input");
			input.addEventListener("change", () => this.set(f.fieldname, input.checked ? 1 : 0));
			this.inputs[f.fieldname] = input;
			return wrap;
		}

		wrap.append(el(html`<label class="field__label" for="${id}">${f.label}${f.reqd ? html`<span class="req">*</span>` : ""}</label>`));

		let control;
		if (f.fieldtype === "Link" && !ro) {
			const link = new LinkField({
				doctype: f.options,
				value,
				id,
				required: f.reqd,
				filters: this.linkFilters(f),
				placeholder: f.placeholder,
				onChange: (v) => this.set(f.fieldname, v),
			});
			this.links[f.fieldname] = link;
			control = link.el;
			this.inputs[f.fieldname] = link.input;
		} else if (f.fieldtype === "Select") {
			const options = (f.options || "").split("\n");
			control = el(html`<select class="select" id="${id}" ${raw(ro ? "disabled" : "")}>
				${f.reqd ? "" : html`<option value=""></option>`}
				${options.filter(Boolean).map((o) => html`<option ${raw(o === value ? "selected" : "")}>${o}</option>`)}
			</select>`);
			control.addEventListener("change", () => this.set(f.fieldname, control.value));
			this.inputs[f.fieldname] = control;
		} else if (f.fieldtype === "Small Text" || f.fieldtype === "Text") {
			control = el(html`<textarea class="textarea" id="${id}" rows="3" ${raw(ro ? "readonly" : "")}></textarea>`);
			control.value = value || "";
			control.addEventListener("input", () => this.set(f.fieldname, control.value));
			this.inputs[f.fieldname] = control;
		} else if (f.fieldtype === "Color") {
			control = el(html`<div class="color-input">
				<input type="color" aria-label="${f.label} picker" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : "#2d5591"}" ${raw(ro ? "disabled" : "")}>
				<input class="input mono" id="${id}" type="text" value="${value || ""}" placeholder="#RRGGBB" maxlength="7" ${raw(ro ? "readonly" : "")}>
			</div>`);
			const [picker, text] = control.querySelectorAll("input");
			picker.addEventListener("input", () => {
				text.value = picker.value.toUpperCase();
				this.set(f.fieldname, text.value);
			});
			text.addEventListener("input", () => {
				if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
				this.set(f.fieldname, text.value);
			});
			this.inputs[f.fieldname] = text;
		} else {
			const type = f.fieldtype === "Date" ? "date" : NUMBER_TYPES.has(f.fieldtype) ? "number" : "text";
			control = el(html`<input class="input ${type === "number" ? "input--num" : ""}" id="${id}" type="${type}"
				${raw(type === "number" ? 'step="any" inputmode="decimal"' : "")} placeholder="${f.placeholder || ""}" ${raw(ro ? "readonly" : "")}>`);
			control.value = value ?? "";
			control.addEventListener("input", () => this.set(f.fieldname, control.value));
			this.inputs[f.fieldname] = control;
		}

		wrap.append(control);
		if (f.description) wrap.append(el(html`<span class="field__hint">${f.description}</span>`));
		wrap.append(el(`<span class="field__error" hidden></span>`));
		return wrap;
	}

	set(fieldname, value) {
		this.data[fieldname] = value;
		this.clearError(fieldname);
		this.refreshVisibility();
		this.onChange?.(fieldname, value, this.data);
	}

	values() {
		return { ...this.data };
	}

	setError(fieldname, message) {
		const wrap = this.node.querySelector(`[data-field="${fieldname}"]`);
		if (!wrap) return;
		wrap.classList.add("is-invalid");
		this.inputs[fieldname]?.classList.add("is-invalid");
		const err = wrap.querySelector(".field__error");
		if (err) {
			err.textContent = message;
			err.hidden = false;
		}
	}

	clearError(fieldname) {
		const wrap = this.node.querySelector(`[data-field="${fieldname}"]`);
		wrap?.classList.remove("is-invalid");
		this.inputs[fieldname]?.classList.remove("is-invalid");
		const err = wrap?.querySelector(".field__error");
		if (err) err.hidden = true;
	}

	/** Checks required fields; focuses the first invalid one. */
	validate() {
		let first = null;
		for (const f of this.fields) {
			const v = this.data[f.fieldname];
			if (f.reqd && f.fieldtype !== "Check" && this.isVisible(f) && (v === "" || v === null || v === undefined)) {
				this.setError(f.fieldname, `${f.label} is required`);
				first ??= f.fieldname;
			}
		}
		if (first) this.inputs[first]?.focus();
		return !first;
	}

	destroy() {
		Object.values(this.links).forEach((l) => l.destroy());
	}
}
