/**
 * Editable child-table grid, working like ERPNext's:
 *   - a checkbox per row (and "select all"): Delete / Duplicate the selected rows
 *   - ⚙ Configure columns: show any field of the child table, set their order and widths;
 *     column edges can also be dragged. Saved per grid in this browser.
 *   - ✎ opens the row form with every field of the row, plus Insert above / below, Duplicate,
 *     Move up / down, Delete and Previous / Next row
 *   - drag a row by its handle to reorder; ↑ / ↓ / Enter move between rows while editing
 *   - Download the rows as CSV, or Upload a CSV to add rows
 *
 *   const grid = new EditableGrid(node, {
 *     doctype, fieldname,                  // parent DocType + table field → settings, all fields, row form
 *     columns: [{ fieldname, label, type: "link" | "number" | "select" | "date" | "check" | "computed" | "static" | "text",
 *                 doctype, filters, options, precision, reqd, width, onSelect }],
 *     rows,                                // array of plain objects (mutated in place)
 *     onChange: (row, fieldname) => {},    // after a cell edit
 *     onRowsChange: () => {},              // after add / remove / move
 *     totals: { fieldname: () => value },  // footer values
 *     readOnly, addLabel, emptyText, newRow: () => ({})
 *   });
 *   grid.refresh();                        // re-paint computed / static cells + totals without losing focus
 *
 * `columns` are the defaults and define special behaviour; other fields come from
 * tp.api.grid.get_fields. "computed" cells are read-only numbers, "static" read-only text.
 * A link column's `onSelect(row, value, item)` runs when a value is picked.
 */
import { api } from "@tp/core/api.js";
import { html, icon, raw, el, esc, storage } from "@tp/core/dom.js";
import { fixed } from "@tp/core/format.js";
import { drawer, openOverlay } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { LinkField } from "@tp/components/link-field.js";
import { Form } from "@tp/components/form.js";

let keySeq = 0;
export const rowKey = () => `new-${++keySeq}`;

const NUMERIC = new Set(["number", "computed"]);
const DEFAULT_WIDTH = { link: 170, number: 110, computed: 110, select: 130, date: 140, check: 80, text: 160, static: 150 };
const MIN_WIDTH = 60;
const metaCache = new Map();

/** Child-table fields from the server (cached per table for the page's lifetime). */
function loadMeta(doctype, fieldname) {
	const key = `${doctype}::${fieldname}`;
	if (!metaCache.has(key)) {
		metaCache.set(
			key,
			api.get("tp.api.grid.get_fields", { doctype, fieldname }).catch((err) => {
				showError(err, "Couldn't load table fields");
				return null;
			})
		);
	}
	return metaCache.get(key);
}

/** Grid column for a DocType field that has no column defined by the page. */
function columnFromField(f) {
	const base = { fieldname: f.fieldname, label: f.label, fromMeta: true };
	if (!f.editable) {
		if (f.fieldtype === "Check") return { ...base, type: "check", readOnly: true };
		return { ...base, type: f.numeric ? "computed" : "static" };
	}
	if (f.fieldtype === "Link") return { ...base, type: "link", doctype: f.options };
	if (f.fieldtype === "Select") return { ...base, type: "select", options: (f.options || "").split("\n").filter(Boolean) };
	if (f.fieldtype === "Date") return { ...base, type: "date" };
	if (f.fieldtype === "Check") return { ...base, type: "check" };
	if (f.numeric) return { ...base, type: "number" };
	return { ...base, type: "text" };
}

const isEmpty = (v) => v === undefined || v === null || v === "";
const copyRow = (row) => {
	const { name, _key, idx, ...rest } = row;
	return rest;
};

/* ---------- CSV ---------- */

function toCsv(rows) {
	const cell = (v) => {
		const s = String(v ?? "");
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function parseCsv(text) {
	const rows = [];
	let row = [];
	let value = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				value += '"';
				i++;
			} else if (c === '"') quoted = false;
			else value += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(value);
			value = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(value);
			rows.push(row);
			row = [];
			value = "";
		} else value += c;
	}
	if (value || row.length) {
		row.push(value);
		rows.push(row);
	}
	return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export class EditableGrid {
	constructor(node, opts) {
		Object.assign(this, { readOnly: false, totals: {}, addLabel: "Add row", emptyText: "No rows yet", newRow: () => ({}) }, opts);
		this.node = node;
		this.baseColumns = opts.columns;
		this.links = [];
		this.selected = new Set();
		this.meta = null;
		this.settingsKey = this.doctype && this.fieldname ? `tp-grid-${this.doctype}-${this.fieldname}` : null;
		this.settings = this.loadSettings();
		this.rows.forEach((r) => (r._key ??= r.name || rowKey()));
		this.columns = this.computeColumns();
		this.bind();
		this.render();

		if (this.settingsKey) {
			this.metaReady = loadMeta(this.doctype, this.fieldname).then((meta) => {
				this.meta = meta;
				// Saved columns that aren't page defaults can only be shown once the fields are known
				if (meta && this.settings.columns?.some((c) => !this.baseColumns.some((b) => b.fieldname === c))) {
					this.columns = this.computeColumns();
					this.render();
				}
				return meta;
			});
		}
	}

	/* ---------- Settings (columns, widths) ---------- */

	loadSettings() {
		if (!this.settingsKey) return {};
		try {
			return JSON.parse(storage.get(this.settingsKey)) || {};
		} catch {
			return {};
		}
	}

	saveSettings() {
		if (!this.settingsKey) return;
		const empty = !this.settings.columns && !Object.keys(this.settings.widths || {}).length;
		storage.set(this.settingsKey, empty ? null : JSON.stringify(this.settings));
	}

	computeColumns() {
		const base = new Map(this.baseColumns.map((c) => [c.fieldname, c]));
		const fields = new Map((this.meta?.fields || []).map((f) => [f.fieldname, f]));
		let names = this.settings.columns?.length ? this.settings.columns : this.baseColumns.map((c) => c.fieldname);
		names = names.filter((n) => base.has(n) || fields.has(n));
		// Required page columns can't be hidden: missing values must stay visible
		for (const c of this.baseColumns) if (c.reqd && !names.includes(c.fieldname)) names.push(c.fieldname);
		return names.map((n) => {
			const col = base.get(n) || columnFromField(fields.get(n));
			const width = this.settings.widths?.[n];
			return width ? { ...col, width: `${width}px` } : col;
		});
	}

	/* ---------- Rendering ---------- */

	setRows(rows) {
		this.rows = rows;
		this.rows.forEach((r) => (r._key ??= r.name || rowKey()));
		this.selected.clear();
		this.render();
	}

	colWidth(col) {
		return col.width || `${DEFAULT_WIDTH[col.type] || 140}px`;
	}

	render() {
		this.links.forEach((l) => l.destroy());
		this.links = [];
		this.selected = new Set([...this.selected].filter((k) => this.rows.some((r) => r._key === k)));
		const cols = this.columns;
		const editable = !this.readOnly;
		const allSelected = this.rows.length > 0 && this.selected.size === this.rows.length;
		const totalsRow = Object.keys(this.totals).length
			? html`<tfoot><tr><td colspan="2">Total</td>${cols.slice(1).map((c) => html`<td data-total="${c.fieldname}"></td>`)}<td></td></tr></tfoot>`
			: "";

		// Page-provided buttons (e.g. "Generate from products") survive re-renders
		const extra = this.node.querySelector("[data-grid-extra]");
		const extraChildren = extra ? [...extra.childNodes] : [];

		this.node.replaceChildren(
			el(html`<div class="grid">
				<div class="grid-table">
					<table>
						<thead><tr>
							<th class="col-idx">
								${editable
									? html`<label class="check grid-check"><input type="checkbox" data-select-all aria-label="Select all rows" ${raw(allSelected ? "checked" : "")}></label>`
									: "#"}
							</th>
							${cols.map(
								(c) => html`<th class="${NUMERIC.has(c.type) ? "is-num" : ""}" style="width:${this.colWidth(c)};min-width:${this.colWidth(c)}" data-col="${c.fieldname}">
									<span class="grid-th">${c.label}${c.reqd ? html`<span class="req"> *</span>` : ""}</span>
									<span class="col-resize" data-resize="${c.fieldname}" aria-hidden="true"></span>
								</th>`
							)}
							<th class="col-act">
								${this.settingsKey ? html`<button class="icon-btn icon-btn--sm" type="button" data-grid-config aria-label="Configure columns" title="Configure columns">${icon("settings", "i--sm")}</button>` : ""}
							</th>
						</tr></thead>
						<tbody></tbody>
						${totalsRow}
					</table>
				</div>
				<div class="grid-actions">
					${editable ? html`<button class="btn btn--primary btn--sm" type="button" data-grid-add>${icon("plus")} ${this.addLabel}</button>` : ""}
					<span data-grid-extra></span>
					${editable && this.selected.size
						? html`<span class="grid-selection">
								<span class="grid-selection__count">${this.selected.size} selected</span>
								<button class="btn btn--secondary btn--sm" type="button" data-grid-duplicate>${icon("copy")} Duplicate</button>
								<button class="btn btn--danger btn--sm" type="button" data-grid-delete>${icon("trash")} Delete</button>
							</span>`
						: ""}
					<span class="spacer"></span>
					<span class="grid-count">${this.rows.length} row${this.rows.length === 1 ? "" : "s"}</span>
					<button class="btn btn--ghost btn--sm" type="button" data-grid-download title="Download rows as CSV">${icon("download")} Download</button>
					${editable ? html`<button class="btn btn--ghost btn--sm" type="button" data-grid-upload title="Add rows from a CSV file">${icon("file-text")} Upload</button>` : ""}
				</div>
			</div>`)
		);
		if (extraChildren.length) this.node.querySelector("[data-grid-extra]").append(...extraChildren);

		const tbody = this.node.querySelector("tbody");
		if (!this.rows.length) {
			tbody.append(el(html`<tr><td colspan="${cols.length + 2}" class="grid-empty">${this.emptyText}</td></tr>`));
		}
		this.rows.forEach((row, i) => tbody.append(this.renderRow(row, i)));
		this.refresh();
	}

	renderRow(row, index) {
		const editable = !this.readOnly;
		const selected = this.selected.has(row._key);
		const tr = el(html`<tr data-key="${row._key}" class="${selected ? "is-selected" : ""}">
			<td class="col-idx">
				<div class="grid-idx">
					${editable ? html`<span class="row-grip" title="Drag to move" aria-hidden="true">${icon("grip", "i--sm")}</span>` : ""}
					${editable ? html`<label class="check grid-check"><input type="checkbox" data-select aria-label="Select row ${index + 1}" ${raw(selected ? "checked" : "")}></label>` : ""}
					<span class="row-num">${index + 1}</span>
				</div>
			</td>
		</tr>`);

		for (const col of this.columns) {
			const td = document.createElement("td");
			td.dataset.field = col.fieldname;
			const value = row[col.fieldname];
			const label = `${col.label}, row ${index + 1}`;
			const readOnly = this.readOnly || col.readOnly;

			if (col.type === "check") {
				td.classList.add("is-check");
				const input = el(html`<input type="checkbox" aria-label="${label}" ${raw(Number(value) ? "checked" : "")} ${raw(readOnly ? "disabled" : "")}>`);
				input.addEventListener("change", () => this.update(row, col.fieldname, input.checked ? 1 : 0, td));
				td.append(el(`<label class="check"></label>`));
				td.firstChild.append(input);
			} else if (col.type === "computed" || col.type === "static" || readOnly) {
				const display = NUMERIC.has(col.type) ? fixed(value, col.precision ?? 2) : value ?? "";
				td.append(el(html`<input class="input ${NUMERIC.has(col.type) ? "input--num" : ""}" readonly tabindex="-1" value="${display}" aria-label="${label}">`));
			} else if (col.type === "link") {
				const link = new LinkField({
					doctype: col.doctype,
					value,
					bare: true,
					placeholder: col.placeholder || "Select",
					filters: col.filters ? () => col.filters(row) : undefined,
					onChange: (v, item) => {
						col.onSelect?.(row, v, item);
						this.update(row, col.fieldname, v, td);
					},
				});
				link.input.setAttribute("aria-label", label);
				this.links.push(link);
				td.append(link.el);
			} else if (col.type === "select") {
				const select = el(html`<select class="select" aria-label="${label}">
					<option value=""></option>
					${col.options.map((o) => html`<option ${raw(o === value ? "selected" : "")}>${o}</option>`)}
				</select>`);
				select.addEventListener("change", () => this.update(row, col.fieldname, select.value, td));
				td.append(select);
			} else if (col.type === "date") {
				const input = el(html`<input class="input" type="date" aria-label="${label}">`);
				input.value = value ?? "";
				input.addEventListener("change", () => this.update(row, col.fieldname, input.value, td));
				td.append(input);
			} else {
				const isNum = col.type === "number";
				const input = el(html`<input class="input ${isNum ? "input--num" : ""}" type="${isNum ? "number" : "text"}"
					${raw(isNum ? 'step="any" inputmode="decimal"' : "")} aria-label="${label}" data-nav>`);
				input.value = value ?? "";
				input.addEventListener("input", () => this.update(row, col.fieldname, input.value, td));
				td.append(input);
			}
			tr.append(td);
		}
		tr.append(
			el(html`<td class="col-act"><button class="icon-btn icon-btn--sm" type="button" data-row-edit aria-label="Open row ${index + 1}" title="${editable ? "Edit" : "View"} row (all fields)">${icon(editable ? "pencil" : "eye", "i--sm")}</button></td>`)
		);
		return tr;
	}

	/* ---------- Events ---------- */

	bind() {
		const rowOf = (target) => this.rows.find((r) => r._key === target.closest("tr[data-key]")?.dataset.key);

		this.node.addEventListener("click", (e) => {
			const t = e.target;
			if (t.closest("[data-grid-add]")) this.addRow();
			else if (t.closest("[data-grid-config]")) this.configure();
			else if (t.closest("[data-row-edit]")) this.openRow(rowOf(t));
			else if (t.closest("[data-grid-delete]")) this.removeRows([...this.selected]);
			else if (t.closest("[data-grid-duplicate]")) this.duplicateRows([...this.selected]);
			else if (t.closest("[data-grid-download]")) this.download();
			else if (t.closest("[data-grid-upload]")) this.upload();
		});

		this.node.addEventListener("change", (e) => {
			if (e.target.matches("[data-select-all]")) {
				this.selected = e.target.checked ? new Set(this.rows.map((r) => r._key)) : new Set();
				this.render();
			} else if (e.target.matches("[data-select]")) {
				const row = rowOf(e.target);
				if (e.target.checked) this.selected.add(row._key);
				else this.selected.delete(row._key);
				this.render();
				this.node.querySelector(`tr[data-key="${CSS.escape(row._key)}"] [data-select]`)?.focus();
			}
		});

		// ↑ / ↓ / Enter: same column, previous / next row (text and number cells)
		this.node.addEventListener("keydown", (e) => {
			if (!e.target.matches("input[data-nav]") || !["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) return;
			if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
			const td = e.target.closest("td[data-field]");
			const tr = td.closest("tr");
			const target = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
			const next = target?.querySelector(`td[data-field="${CSS.escape(td.dataset.field)}"] input:not([readonly])`);
			e.preventDefault();
			next?.focus();
			next?.select?.();
		});

		this.bindResize();
		this.bindDrag();
	}

	bindResize() {
		this.node.addEventListener("pointerdown", (e) => {
			const handle = e.target.closest("[data-resize]");
			if (!handle) return;
			e.preventDefault();
			const th = handle.closest("th");
			const fieldname = handle.dataset.resize;
			const startX = e.clientX;
			const startWidth = th.getBoundingClientRect().width;
			handle.setPointerCapture(e.pointerId);
			document.body.classList.add("is-resizing");
			const move = (ev) => {
				const width = Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX));
				th.style.width = th.style.minWidth = `${width}px`;
			};
			const up = () => {
				handle.removeEventListener("pointermove", move);
				document.body.classList.remove("is-resizing");
				this.settings.widths = { ...this.settings.widths, [fieldname]: parseInt(th.style.width, 10) };
				this.saveSettings();
				this.columns = this.computeColumns();
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up, { once: true });
		});
	}

	bindDrag() {
		let dragKey = null;
		this.node.addEventListener("pointerdown", (e) => {
			const grip = e.target.closest(".row-grip");
			if (grip) grip.closest("tr").draggable = true;
		});
		this.node.addEventListener("dragstart", (e) => {
			const tr = e.target.closest?.("tr[data-key]");
			if (!tr?.draggable) return;
			dragKey = tr.dataset.key;
			tr.classList.add("is-dragging");
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", dragKey);
		});
		const clear = () => this.node.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
		this.node.addEventListener("dragover", (e) => {
			if (!dragKey) return;
			const tr = e.target.closest("tbody tr[data-key]");
			if (!tr) return;
			e.preventDefault();
			clear();
			const { top, height } = tr.getBoundingClientRect();
			tr.classList.add(e.clientY < top + height / 2 ? "drop-before" : "drop-after");
		});
		this.node.addEventListener("drop", (e) => {
			if (!dragKey) return;
			const tr = e.target.closest("tbody tr[data-key]");
			e.preventDefault();
			if (tr && tr.dataset.key !== dragKey) {
				const after = tr.classList.contains("drop-after");
				const row = this.rows.find((r) => r._key === dragKey);
				this.rows.splice(this.rows.indexOf(row), 1);
				const target = this.rows.findIndex((r) => r._key === tr.dataset.key);
				this.rows.splice(target + (after ? 1 : 0), 0, row);
				this.render();
				this.onRowsChange?.();
			}
		});
		this.node.addEventListener("dragend", (e) => {
			const tr = e.target.closest?.("tr[data-key]");
			if (tr) {
				tr.draggable = false;
				tr.classList.remove("is-dragging");
			}
			dragKey = null;
			clear();
		});
	}

	/* ---------- Row operations ---------- */

	update(row, fieldname, value, td) {
		row[fieldname] = value;
		td?.querySelector(".input, .select")?.classList.remove("is-invalid");
		this.onChange?.(row, fieldname);
		this.refresh();
	}

	/** Add a row at `index` (default: the end). */
	addRow(values = {}, index = this.rows.length, { focus = true } = {}) {
		const row = { ...this.newRow(), ...values, _key: rowKey() };
		this.rows.splice(index, 0, row);
		this.render();
		this.onRowsChange?.();
		if (focus) this.node.querySelector(`tr[data-key="${row._key}"] input:not([readonly]):not([type=checkbox]), tr[data-key="${row._key}"] select`)?.focus();
		return row;
	}

	removeRow(row) {
		this.removeRows([row._key]);
	}

	removeRows(keys) {
		const drop = new Set(keys);
		const count = this.rows.filter((r) => drop.has(r._key)).length;
		if (!count) return;
		for (let i = this.rows.length - 1; i >= 0; i--) if (drop.has(this.rows[i]._key)) this.rows.splice(i, 1);
		keys.forEach((k) => this.selected.delete(k));
		this.render();
		this.onRowsChange?.();
		if (count > 1) toast.success(`${count} rows deleted`);
	}

	duplicateRows(keys) {
		const pick = new Set(keys);
		const copies = [];
		for (let i = this.rows.length - 1; i >= 0; i--) {
			if (!pick.has(this.rows[i]._key)) continue;
			const copy = { ...copyRow(this.rows[i]), _key: rowKey() };
			this.rows.splice(i + 1, 0, copy);
			copies.push(copy);
		}
		this.selected = new Set(copies.map((c) => c._key));
		this.render();
		this.onRowsChange?.();
		toast.success(`${copies.length} row${copies.length === 1 ? "" : "s"} duplicated`);
	}

	moveRow(row, delta) {
		const from = this.rows.indexOf(row);
		const to = from + delta;
		if (from === -1 || to < 0 || to >= this.rows.length) return;
		this.rows.splice(from, 1);
		this.rows.splice(to, 0, row);
		this.render();
		this.onRowsChange?.();
	}

	/** Update computed cells and totals in place (keeps focus while typing). */
	refresh() {
		for (const row of this.rows) {
			const tr = this.node.querySelector(`tr[data-key="${CSS.escape(row._key)}"]`);
			if (!tr) continue;
			for (const col of this.columns) {
				if (col.type !== "computed" && col.type !== "static") continue;
				const input = tr.querySelector(`td[data-field="${col.fieldname}"] input`);
				if (input) input.value = col.type === "computed" ? fixed(row[col.fieldname], col.precision ?? 2) : row[col.fieldname] ?? "";
			}
		}
		for (const [fieldname, getter] of Object.entries(this.totals)) {
			const td = this.node.querySelector(`[data-total="${fieldname}"]`);
			if (td) td.textContent = fixed(getter(), fieldname === "qty_pcs" ? 0 : 2);
		}
		this.rowForm?.sync();
	}

	/** Mark missing required cells; returns the number of problems. */
	validate() {
		let problems = 0;
		let first = null;
		for (const row of this.rows) {
			const tr = this.node.querySelector(`tr[data-key="${CSS.escape(row._key)}"]`);
			for (const col of this.columns.filter((c) => c.reqd)) {
				if (isEmpty(row[col.fieldname])) {
					problems++;
					const input = tr?.querySelector(`td[data-field="${col.fieldname}"] .input, td[data-field="${col.fieldname}"] .select`);
					input?.classList.add("is-invalid");
					first ??= input;
				}
			}
		}
		first?.focus();
		return problems;
	}

	destroy() {
		this.links.forEach((l) => l.destroy());
	}

	/* ---------- Row form ---------- */

	/** Every field of the row (page columns keep their behaviour), for the row form. */
	async rowFields() {
		const meta = this.settingsKey ? await this.metaReady : null;
		const base = new Map(this.baseColumns.map((c) => [c.fieldname, c]));
		const toField = (f, col) => {
			const readOnly = this.readOnly || (col ? col.type === "computed" || col.type === "static" || col.readOnly : !f.editable);
			const field = { ...f, label: col?.label || f.label, read_only: readOnly ? 1 : 0, reqd: col?.reqd || (f.reqd && !readOnly) ? 1 : 0 };
			delete field.filters;
			return field;
		};
		if (meta) return meta.fields.map((f) => toField(f, base.get(f.fieldname)));
		const TYPES = { link: "Link", number: "Float", computed: "Float", select: "Select", date: "Date", check: "Check" };
		return this.baseColumns.map((c) =>
			toField({ fieldname: c.fieldname, label: c.label, fieldtype: TYPES[c.type] || "Data", options: c.type === "link" ? c.doctype : c.options?.join("\n") }, c)
		);
	}

	async openRow(row) {
		if (!row) return;
		const fields = await this.rowFields();
		const base = new Map(this.baseColumns.map((c) => [c.fieldname, c]));
		const panel = drawer({
			title: "Row",
			onClose: () => {
				forms.forEach((f) => f.destroy());
				this.rowForm = null;
				this.render();
			},
		});
		panel.node.querySelector(".drawer").classList.add("drawer--row");
		let current = row;
		let forms = [];
		const formOf = (fieldname) => forms.find((f) => f.inputs[fieldname]);

		// One form per section of the child table, under its heading (like ERPNext's row form)
		const sections = [];
		for (const f of fields) {
			const name = f.section || "Details";
			let s = sections.find((x) => x.name === name);
			if (!s) sections.push((s = { name, fields: [] }));
			s.fields.push(f);
		}

		const show = (target) => {
			current = target;
			forms.forEach((f) => f.destroy());
			forms = [];
			const index = this.rows.indexOf(current);
			panel.node.querySelector(".drawer__title").textContent = `${this.meta?.label || "Row"} · Row #${index + 1}`;
			panel.body.replaceChildren();
			for (const section of sections) {
				const wrap = el(html`<section class="row-form__section">
					${sections.length > 1 ? html`<h3 class="row-form__heading">${section.name}</h3>` : ""}
					<div></div>
				</section>`);
				panel.body.append(wrap);
				const sectionFields = section.fields.map((f) => {
					const col = base.get(f.fieldname);
					return col?.filters && f.fieldtype === "Link" ? { ...f, filters: () => col.filters(current) } : f;
				});
				forms.push(
					new Form(wrap.lastElementChild, sectionFields, {
						values: current,
						isNew: false,
						disabled: this.readOnly,
						onChange: (fieldname, value) => {
							current[fieldname] = value;
							const col = base.get(fieldname);
							const link = formOf(fieldname)?.links[fieldname];
							if (col?.onSelect) col.onSelect(current, value, link ? { value, label: link.label } : null);
							this.onChange?.(current, fieldname);
							sync();
						},
					})
				);
			}
			panel.body.scrollTop = 0;
			panel.footer.querySelector("[data-row-prev]").disabled = index <= 0;
			panel.footer.querySelector("[data-row-next]").disabled = index >= this.rows.length - 1;
		};
		// Read-only fields follow values the page recalculates (amounts, fetched item details…)
		const sync = () => {
			for (const f of fields) {
				const input = formOf(f.fieldname)?.inputs[f.fieldname];
				if (!f.read_only || !input) continue;
				const value = current[f.fieldname];
				if (input.type === "checkbox") input.checked = Boolean(Number(value));
				else input.value = f.numeric ? fixed(value, 3) : value ?? "";
			}
		};
		this.rowForm = { sync };

		const editable = !this.readOnly;
		panel.footer.innerHTML = String(html`
			${editable
				? html`<div class="row-tools">
						<button class="icon-btn" type="button" data-row-act="above" title="Insert a row above" aria-label="Insert a row above">${icon("plus", "i--sm")}<span class="row-tools__hint">↑</span></button>
						<button class="icon-btn" type="button" data-row-act="below" title="Insert a row below" aria-label="Insert a row below">${icon("plus", "i--sm")}<span class="row-tools__hint">↓</span></button>
						<button class="icon-btn" type="button" data-row-act="duplicate" title="Duplicate row" aria-label="Duplicate row">${icon("copy", "i--sm")}</button>
						<button class="icon-btn" type="button" data-row-act="up" title="Move up" aria-label="Move row up">${icon("arrow-left", "i--sm row-tools__rot")}</button>
						<button class="icon-btn" type="button" data-row-act="down" title="Move down" aria-label="Move row down">${icon("arrow-right", "i--sm row-tools__rot")}</button>
						<button class="icon-btn icon-btn--danger" type="button" data-row-act="delete" title="Delete row" aria-label="Delete row">${icon("trash", "i--sm")}</button>
					</div>`
				: ""}
			<span class="spacer"></span>
			<button class="icon-btn" type="button" data-row-prev title="Previous row" aria-label="Previous row">${icon("chevron-left")}</button>
			<button class="icon-btn" type="button" data-row-next title="Next row" aria-label="Next row">${icon("chevron-right")}</button>
			<button class="btn btn--primary btn--sm" type="button" data-row-done>${icon("check")} Done</button>`);

		panel.footer.addEventListener("click", (e) => {
			const button = e.target.closest("button");
			if (!button) return;
			const index = this.rows.indexOf(current);
			const act = button.dataset.rowAct;
			if (button.matches("[data-row-done]")) return panel.close(true);
			if (button.matches("[data-row-prev]")) return show(this.rows[index - 1]);
			if (button.matches("[data-row-next]")) return show(this.rows[index + 1]);
			if (act === "above" || act === "below") show(this.addRow({}, index + (act === "below" ? 1 : 0), { focus: false }));
			else if (act === "duplicate") show(this.addRow(copyRow(current), index + 1, { focus: false }));
			else if (act === "up" || act === "down") {
				this.moveRow(current, act === "up" ? -1 : 1);
				show(current);
			} else if (act === "delete") {
				const next = this.rows[index + 1] || this.rows[index - 1];
				this.removeRow(current);
				if (next) show(next);
				else panel.close(true);
			}
		});
		show(row);
	}

	/* ---------- Configure columns ---------- */

	async configure() {
		const meta = await this.metaReady;
		const base = new Map(this.baseColumns.map((c) => [c.fieldname, c]));
		const metaField = new Map((meta?.fields || []).map((f) => [f.fieldname, f]));
		const TYPE_LABEL = { link: "Link", number: "Number", computed: "Number", select: "Select", date: "Date", check: "Check", static: "Data", text: "Data" };
		// Page columns first, then every other field of the child table by section
		const available = [
			...this.baseColumns.map((c) => ({
				fieldname: c.fieldname,
				label: c.label,
				fieldtype: metaField.get(c.fieldname)?.fieldtype || TYPE_LABEL[c.type] || "Data",
				section: "Default columns",
				reqd: c.reqd ? 1 : 0,
				locked: c.reqd ? 1 : 0,
			})),
			...(meta?.fields || []).filter((f) => !base.has(f.fieldname)).map((f) => ({ ...f, reqd: 0, locked: 0 })),
		];
		const labelOf = (name) => base.get(name)?.label || available.find((f) => f.fieldname === name)?.label || name;
		const widthOf = (name) => parseInt(this.colWidth(base.get(name) || columnFromField(metaField.get(name))), 10);
		let chosen = this.columns.map((c) => ({ fieldname: c.fieldname, width: parseInt(this.colWidth(c), 10) }));

		const node = el(html`
			<div class="overlay">
				<form class="modal modal--columns" role="dialog" aria-modal="true" aria-labelledby="cols-title" novalidate>
					<header class="picker__header">
						<div>
							<h2 class="modal__title" id="cols-title">Configure columns</h2>
							<p class="modal__text">${meta?.label || "Table"}: drag to reorder, set widths, add or remove columns. Remembered in this browser.</p>
						</div>
						<button class="icon-btn" type="button" data-cancel aria-label="Close">${icon("x")}</button>
					</header>
					<div class="cols-list" data-slot="list" role="list"></div>
					<div class="cols-add">
						<button class="btn btn--secondary" type="button" data-pick ${raw(meta ? "" : "disabled")}>${icon("plus")} Add / remove columns</button>
						<span class="muted" data-slot="count"></span>
					</div>
					<div class="modal__footer">
						<button class="btn btn--ghost" type="button" data-reset>Reset to default</button>
						<span class="spacer"></span>
						<button class="btn btn--secondary" type="button" data-cancel>Cancel</button>
						<button class="btn btn--primary" type="submit">${icon("check")} Apply</button>
					</div>
				</form>
			</div>`);
		const list = node.querySelector("[data-slot='list']");

		const draw = (focusIndex = null) => {
			list.innerHTML = String(html`${chosen.map(
				(c, i) => html`<div class="cols-row" data-index="${i}" role="listitem">
					<button class="cols-row__grip" type="button" draggable="true" aria-label="Move ${labelOf(c.fieldname)} (drag, or Alt + arrow keys)" title="Drag to reorder">${icon("grip", "i--sm")}</button>
					<span class="cols-row__num">${i + 1}</span>
					<span class="cols-row__label">${labelOf(c.fieldname)}${base.get(c.fieldname)?.reqd ? html`<span class="req"> *</span>` : ""}</span>
					<label class="cols-row__width" title="Column width in pixels">
						<input class="input input--num" type="number" min="${MIN_WIDTH}" step="10" value="${c.width}" data-width aria-label="${labelOf(c.fieldname)} width">
						<span class="muted">px</span>
					</label>
					<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-remove aria-label="Remove ${labelOf(c.fieldname)}" ${raw(base.get(c.fieldname)?.reqd || chosen.length === 1 ? "disabled" : "")}>${icon("x", "i--sm")}</button>
				</div>`
			)}`);
			node.querySelector("[data-slot='count']").textContent = `${chosen.length} of ${available.length} fields shown`;
			if (focusIndex !== null) list.querySelector(`[data-index="${focusIndex}"] .cols-row__grip`)?.focus();
		};
		const move = (from, to) => {
			if (to < 0 || to >= chosen.length || from === to) return;
			const [item] = chosen.splice(from, 1);
			chosen.splice(to, 0, item);
			draw(to);
		};

		list.addEventListener("input", (e) => {
			if (!e.target.matches("[data-width]")) return;
			chosen[+e.target.closest("[data-index]").dataset.index].width = Math.max(MIN_WIDTH, parseInt(e.target.value, 10) || MIN_WIDTH);
		});
		list.addEventListener("click", (e) => {
			const button = e.target.closest("[data-remove]");
			if (!button) return;
			chosen.splice(+button.closest("[data-index]").dataset.index, 1);
			draw();
		});
		// Keyboard reordering on the handle
		list.addEventListener("keydown", (e) => {
			if (!e.target.matches(".cols-row__grip") || !e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
			e.preventDefault();
			const i = +e.target.closest("[data-index]").dataset.index;
			move(i, i + (e.key === "ArrowUp" ? -1 : 1));
		});

		// Drag and drop
		let dragIndex = null;
		const clearMarks = () => list.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
		list.addEventListener("dragstart", (e) => {
			const row = e.target.closest?.(".cols-row");
			if (!row) return;
			dragIndex = +row.dataset.index;
			row.classList.add("is-dragging");
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", String(dragIndex));
			e.dataTransfer.setDragImage(row, 20, 20);
		});
		list.addEventListener("dragover", (e) => {
			const row = e.target.closest(".cols-row");
			if (dragIndex === null || !row) return;
			e.preventDefault();
			clearMarks();
			const { top, height } = row.getBoundingClientRect();
			row.classList.add(e.clientY < top + height / 2 ? "drop-before" : "drop-after");
		});
		list.addEventListener("drop", (e) => {
			const row = e.target.closest(".cols-row");
			if (dragIndex === null || !row) return;
			e.preventDefault();
			let to = +row.dataset.index + (row.classList.contains("drop-after") ? 1 : 0);
			if (to > dragIndex) to--;
			const from = dragIndex;
			dragIndex = null;
			move(from, to);
		});
		list.addEventListener("dragend", () => {
			dragIndex = null;
			clearMarks();
			list.querySelectorAll(".is-dragging").forEach((n) => n.classList.remove("is-dragging"));
		});

		// Add / remove: searchable checkbox popup; ticked fields keep their place, new ones go last
		node.querySelector("[data-pick]").addEventListener("click", async () => {
			const { pickFields } = await import("@tp/components/field-picker.js");
			const picked = await pickFields({
				title: `${meta?.label || "Table"} columns`,
				text: "Tick the fields to show as columns. Required columns always stay.",
				fields: available,
				selected: chosen.map((c) => c.fieldname),
				defaults: this.baseColumns.map((c) => c.fieldname),
			});
			if (!picked) return;
			const keep = chosen.filter((c) => picked.includes(c.fieldname));
			const added = picked.filter((name) => !chosen.some((c) => c.fieldname === name)).map((name) => ({ fieldname: name, width: widthOf(name) }));
			chosen = [...keep, ...added];
			draw();
			if (added.length) list.lastElementChild?.scrollIntoView({ block: "nearest" });
		});

		const close = openOverlay(node, { initialFocus: "[data-pick]" });
		node.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => close(false)));
		node.querySelector("[data-reset]").addEventListener("click", () => {
			this.settings = {};
			this.saveSettings();
			this.columns = this.computeColumns();
			this.render();
			close(true);
			toast.success("Columns reset");
		});
		node.querySelector("form").addEventListener("submit", (e) => {
			e.preventDefault();
			this.settings.columns = chosen.map((c) => c.fieldname);
			this.settings.widths = Object.fromEntries(chosen.filter((c) => c.width !== widthOf(c.fieldname)).map((c) => [c.fieldname, c.width]));
			if (this.settings.columns.join() === this.baseColumns.map((c) => c.fieldname).join()) delete this.settings.columns;
			this.saveSettings();
			this.columns = this.computeColumns();
			this.render();
			close(true);
			toast.success("Columns saved", { text: "Remembered in this browser." });
		});
		draw();
	}

	/* ---------- CSV ---------- */

	download() {
		const cols = this.columns;
		const data = [cols.map((c) => c.label), ...this.rows.map((r) => cols.map((c) => r[c.fieldname] ?? ""))];
		const blob = new Blob(["﻿" + toCsv(data)], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = Object.assign(document.createElement("a"), { href: url, download: `${(this.meta?.label || this.fieldname || "rows").replace(/\s+/g, "_")}.csv` });
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	upload() {
		const input = Object.assign(document.createElement("input"), { type: "file", accept: ".csv,text/csv" });
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) return;
			const [header, ...lines] = parseCsv(await file.text());
			if (!header || !lines.length) {
				toast.error("Nothing to add", { text: "The file needs a header row and at least one data row." });
				return;
			}
			// Columns match by label or fieldname; only editable fields are taken
			const meta = this.settingsKey ? await this.metaReady : null;
			const writable = [
				...this.baseColumns.filter((c) => !["computed", "static"].includes(c.type)),
				...(meta?.fields || []).filter((f) => f.editable && !this.baseColumns.some((c) => c.fieldname === f.fieldname)),
			];
			const norm = (s) => String(s).replace(/\*/g, "").trim().toLowerCase();
			const mapping = header.map((h) => writable.find((c) => norm(c.label) === norm(h) || c.fieldname === norm(h).replace(/\s+/g, "_")));
			if (!mapping.some(Boolean)) {
				toast.error("No matching columns", { text: `Use the column names as in Download, e.g. ${this.columns.slice(0, 3).map((c) => c.label).join(", ")}.` });
				return;
			}
			const added = [];
			for (const line of lines) {
				const values = {};
				mapping.forEach((col, i) => {
					if (col && line[i] !== undefined && line[i] !== "") values[col.fieldname] = line[i].trim();
				});
				if (!Object.keys(values).length) continue;
				const row = { ...this.newRow(), ...values, _key: rowKey() };
				this.rows.push(row);
				added.push(row);
			}
			for (const row of added) {
				for (const col of this.baseColumns) if (col.onSelect && row[col.fieldname]) col.onSelect(row, row[col.fieldname], null);
			}
			this.render();
			this.onRowsChange?.();
			added.forEach((row) => this.onChange?.(row, null));
			toast.success(`${added.length} row${added.length === 1 ? "" : "s"} added`, { text: `Columns used: ${mapping.filter(Boolean).map((c) => c.label).join(", ")}` });
		});
		input.click();
	}
}
