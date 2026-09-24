/**
 * Several values of a DocType as removable chips plus a Link search to add more
 * (like Frappe's MultiSelectList filter).
 *
 *   const accounts = new MultiLink({ doctype: "Account", values, filters: () => ({ company }), placeholder, onChange });
 *   node.append(accounts.el);  accounts.values → [...]
 *   accounts.setDoctype("Supplier")   // e.g. when the party type changes (clears the values)
 */
import { html, icon, el } from "@tp/core/dom.js";
import { LinkField } from "@tp/components/link-field.js";

export class MultiLink {
	constructor({ doctype, values = [], filters, placeholder = "", onChange, label = "", disabledText = "" }) {
		Object.assign(this, { doctype, filters, placeholder, onChange, label, disabledText });
		this.values = [...values];
		this.el = el(html`<div class="multi-link"><div class="multi-link__chips"></div></div>`);
		this.chips = this.el.firstElementChild;
		this.el.addEventListener("click", (e) => {
			const remove = e.target.closest("[data-remove]");
			if (remove) {
				this.values.splice(+remove.dataset.remove, 1);
				this.draw();
				this.onChange?.(this.values);
			} else if (!e.target.closest(".combo, .multi-link__chip")) {
				this.link?.input.focus();
			}
		});
		this.makeLink();
		this.draw();
	}

	makeLink() {
		this.link?.destroy();
		this.link?.el.remove();
		if (!this.doctype) {
			this.link = null;
			return;
		}
		this.link = new LinkField({
			doctype: this.doctype,
			bare: true,
			allowCreate: false,
			placeholder: this.placeholder || `Add ${this.doctype}…`,
			filters: this.filters,
			onChange: (value) => {
				if (value && !this.values.includes(value)) {
					this.values.push(value);
					this.draw();
					this.onChange?.(this.values);
				}
				this.link.set("", "");
				this.link.input.focus();
			},
		});
		if (this.label) this.link.input.setAttribute("aria-label", this.label);
		this.el.append(this.link.el);
	}

	draw() {
		this.chips.innerHTML = String(html`${!this.doctype && this.disabledText ? html`<span class="multi-link__hint">${this.disabledText}</span>` : ""}${this.values.map(
			(v, i) => html`<span class="multi-link__chip" title="${v}">
				<span class="multi-link__text">${v}</span>
				<button type="button" data-remove="${i}" aria-label="Remove ${v}">${icon("x", "i--sm")}</button>
			</span>`
		)}`);
		this.el.classList.toggle("has-values", this.values.length > 0);
		this.el.classList.toggle("is-disabled", !this.doctype);
	}

	set(values) {
		this.values = [...(values || [])];
		this.draw();
	}

	setDoctype(doctype) {
		if (doctype === this.doctype) return;
		this.doctype = doctype;
		this.values = [];
		this.makeLink();
		this.draw();
	}

	destroy() {
		this.link?.destroy();
	}
}
