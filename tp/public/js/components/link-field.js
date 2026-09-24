/**
 * Link field: an accessible combobox that searches a DocType via tp.api.search.link.
 *
 *   const buyer = new LinkField({ doctype: "Customer", value, onChange: (value, item) => {} });
 *   // allowCreate: false for filters, where "Create a new …" makes no sense
 *   container.append(buyer.el);
 *
 * Only values picked from the list are accepted (like Frappe's Link field).
 * Like ERPNext, a filled field shows an arrow (on hover / focus) that opens the linked record in
 * a new tab: its portal page when the user has one (boot `link_routes`), else the desk.
 * The list ends with "+ Create a new …" when the user may create that DocType
 * (components/quick-entry.js); the new record is filled in straight away.
 * The option list is rendered in <body> with fixed positioning so it is never clipped
 * by scrolling containers such as editable grids.
 */
import { api } from "@tp/core/api.js";
import { html, icon, el, debounce, boot } from "@tp/core/dom.js";

let uid = 0;
let routes;

/** URL of a linked record, or null when the user has nowhere to open it. */
export function linkUrl(doctype, name) {
	if (!doctype || !name) return null;
	routes ??= boot();
	const template = routes.link_routes?.[doctype];
	if (template) return template.replace("{name}", encodeURIComponent(name));
	return routes.desk ? `/desk/${doctype.toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(name)}` : null;
}

export class LinkField {
	constructor({ doctype, value = "", label = "", placeholder = "", filters, onChange, required = false, id, bare = false, allowCreate = true }) {
		this.doctype = doctype;
		this.allowCreate = allowCreate;
		this.value = value || "";
		this.label = label || "";
		this.filters = filters;
		this.onChange = onChange;
		this.results = [];
		this.active = -1;
		this.listId = `combo-${++uid}`;

		this.el = el(html`
			<div class="combo">
				<input class="input" type="text" role="combobox" autocomplete="off" spellcheck="false"
					aria-autocomplete="list" aria-expanded="false" aria-controls="${this.listId}"
					${raw_attr("id", id)} placeholder="${placeholder || `Select ${doctype}`}" ${required ? "aria-required=true" : ""}>
				<span class="combo__value-label" hidden></span>
				<a class="combo__open" target="_blank" rel="noopener" tabindex="-1" hidden>${icon("arrow-right", "i--sm")}</a>
				${icon("chevrons-up-down", "i--sm combo__chevron")}
			</div>
		`);
		if (bare) {
			this.el.querySelector(".combo__chevron").remove();
			this.el.classList.add("combo--bare");
		}
		this.openLink = this.el.querySelector(".combo__open");
		this.input = this.el.querySelector("input");
		this.hint = this.el.querySelector(".combo__value-label");
		this.list = el(html`<ul class="combo__list" id="${this.listId}" role="listbox" hidden></ul>`);

		this.search = debounce(() => this.fetch(), 180);
		this.reposition = () => this.position();
		this.bind();
		this.render();
	}

	bind() {
		const { input } = this;
		input.addEventListener("focus", () => {
			this.hint.hidden = true;
			input.select();
			this.fetch();
		});
		input.addEventListener("input", () => this.search());
		input.addEventListener("keydown", (e) => this.onKey(e));
		input.addEventListener("blur", () => setTimeout(() => this.commitText(), 120));
		this.list.addEventListener("mousedown", (e) => {
			e.preventDefault();
			if (e.target.closest("[data-create]")) return this.create();
			const option = e.target.closest("[data-index]");
			if (option) this.select(this.results[+option.dataset.index]);
		});
	}

	render() {
		this.input.value = this.value;
		const showLabel = this.label && this.label !== this.value && document.activeElement !== this.input;
		this.hint.hidden = !showLabel;
		this.hint.textContent = showLabel ? this.label : "";
		const url = linkUrl(this.doctype, this.value);
		this.openLink.hidden = !url;
		this.el.classList.toggle("has-open", Boolean(url));
		if (url) {
			this.openLink.href = url;
			this.openLink.title = `Open ${this.doctype} ${this.value}`;
			this.openLink.setAttribute("aria-label", `Open ${this.doctype} ${this.value} in a new tab`);
		}
	}

	async fetch() {
		const filters = typeof this.filters === "function" ? this.filters() : this.filters;
		const txt = this.input.value === this.value ? "" : this.input.value;
		this.controller?.abort();
		this.controller = new AbortController();
		const createInfo = this.allowCreate
			? import("@tp/components/quick-entry.js").then((m) => m.createInfo(this.doctype))
			: { can_create: false };
		try {
			this.results = await api.get(
				"tp.api.search.link",
				{ doctype: this.doctype, txt, filters: filters || {}, page_length: 12 },
				{ signal: this.controller.signal }
			);
		} catch (err) {
			if (err.name === "AbortError") return;
			this.results = [];
		}
		this.canCreate = Boolean((await createInfo).can_create);
		this.active = this.results.findIndex((r) => r.value === this.value);
		if (document.activeElement === this.input) this.open();
	}

	/** Options the keyboard moves through: the results, then "Create a new …". */
	optionCount() {
		return this.results.length + (this.canCreate ? 1 : 0);
	}

	open() {
		const typed = this.input.value !== this.value ? this.input.value.trim() : "";
		const create = this.canCreate
			? html`<li class="combo__option combo__create" role="option" id="${this.listId}-${this.results.length}" data-create
					aria-selected="${this.active === this.results.length}">
					<span class="combo__label">${icon("plus", "i--sm")} Create a new ${this.doctype}${typed ? html` <span class="combo__typed">“${typed}”</span>` : ""}</span>
				</li>`
			: "";
		this.list.innerHTML = (this.results.length
			? this.results
					.map(
						(r, i) => html`<li class="combo__option" role="option" id="${this.listId}-${i}" data-index="${i}"
							aria-selected="${i === this.active}">
							<span class="combo__label">${r.label || r.value}</span>
							${r.label && r.label !== r.value ? html`<span class="combo__desc">${r.value}${r.description ? ` · ${r.description}` : ""}</span>`
								: r.description ? html`<span class="combo__desc">${r.description}</span>` : ""}
						</li>`
					)
					.join("")
			: String(html`<li class="combo__empty">No matching ${this.doctype.toLowerCase()} found</li>`)) + create;
		if (!this.list.isConnected) document.body.append(this.list);
		this.list.hidden = false;
		this.input.setAttribute("aria-expanded", "true");
		this.position();
		window.addEventListener("scroll", this.reposition, true);
		window.addEventListener("resize", this.reposition);
	}

	close() {
		this.list.hidden = true;
		this.list.remove();
		this.input.setAttribute("aria-expanded", "false");
		this.input.removeAttribute("aria-activedescendant");
		window.removeEventListener("scroll", this.reposition, true);
		window.removeEventListener("resize", this.reposition);
	}

	position() {
		const rect = this.input.getBoundingClientRect();
		const list = this.list;
		list.style.minWidth = `${Math.max(rect.width, 220)}px`;
		const spaceBelow = window.innerHeight - rect.bottom;
		const height = Math.min(list.scrollHeight, 280);
		const top = spaceBelow < height + 12 && rect.top > spaceBelow ? rect.top - height - 4 : rect.bottom + 4;
		const left = Math.min(rect.left, window.innerWidth - list.offsetWidth - 8);
		list.style.top = `${top}px`;
		list.style.left = `${Math.max(8, left)}px`;
	}

	highlight(index) {
		const count = this.optionCount();
		if (!count) return;
		this.active = (index + count) % count;
		this.list.querySelectorAll("[role=option]").forEach((node, i) => {
			node.setAttribute("aria-selected", String(i === this.active));
			if (i === this.active) node.scrollIntoView({ block: "nearest" });
		});
		this.input.setAttribute("aria-activedescendant", `${this.listId}-${this.active}`);
	}

	onKey(e) {
		const isOpen = !this.list.hidden && this.list.isConnected;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			isOpen ? this.highlight(this.active + 1) : this.fetch();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (isOpen) this.highlight(this.active - 1);
		} else if (e.key === "Enter" && isOpen) {
			e.preventDefault();
			if (this.canCreate && this.active === this.results.length) this.create();
			else if (this.results[this.active]) this.select(this.results[this.active]);
		} else if (e.key === "Escape" && isOpen) {
			e.stopPropagation();
			this.input.value = this.value;
			this.close();
		} else if (e.key === "Tab" && isOpen && this.input.value !== this.value && this.results[this.active]) {
			this.select(this.results[this.active], { keepFocus: false });
		}
	}

	commitText() {
		if (document.activeElement === this.input) return;
		this.close();
		const text = this.input.value.trim();
		if (!text) {
			if (this.value) this.set("", "", true);
		} else if (text !== this.value) {
			const match = this.results.find((r) => r.value.toLowerCase() === text.toLowerCase());
			if (match) this.set(match.value, match.label, true, match);
		}
		this.render();
	}

	select(item, { keepFocus = true } = {}) {
		this.set(item.value, item.label, true, item);
		this.close();
		if (keepFocus) this.input.focus();
		this.input.select();
	}

	set(value, label = "", notify = false, item = null) {
		const changed = value !== this.value;
		this.value = value || "";
		this.label = label || "";
		this.render();
		if (notify && changed) this.onChange?.(this.value, item);
	}

	/** Quick-create a record (the typed text pre-fills its name) and select it. */
	async create() {
		const text = this.input.value !== this.value ? this.input.value.trim() : "";
		this.close();
		const filters = (typeof this.filters === "function" ? this.filters() : this.filters) || {};
		// Plain filter values (e.g. the form's company) become defaults of the new record
		const values = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== null && v !== "" && typeof v !== "object"));
		const { quickCreate } = await import("@tp/components/quick-entry.js");
		const created = await quickCreate(this.doctype, { text, values });
		if (created) {
			this.set(created.value, created.label, true, created);
			this.input.focus();
		} else {
			this.render();
		}
	}

	destroy() {
		this.close();
	}
}

function raw_attr(name, value) {
	return value ? html`${name}="${value}"` : "";
}
