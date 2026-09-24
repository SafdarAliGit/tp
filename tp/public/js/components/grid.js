/**
 * Editable child-table grid.
 *
 *   const grid = new EditableGrid(node, {
 *     columns: [{ fieldname, label, type: "link" | "number" | "select" | "date" | "computed" | "static" | "text",
 *                 doctype, filters, options, precision, reqd, width, onSelect }],
 *     rows,                                // array of plain objects (mutated in place)
 *     onChange: (row, fieldname) => {},    // after a cell edit
 *     onRowsChange: () => {},              // after add / remove
 *     totals: { fieldname: () => value },  // footer values
 *     readOnly, addLabel, emptyText, newRow: () => ({})
 *   });
 *   grid.refresh();                        // re-paint computed / static cells + totals without losing focus
 *
 * "computed" cells are read-only numbers, "static" cells read-only text. A link column's
 * `onSelect(row, value, item)` runs when a value is picked (e.g. to fetch item details).
 */
import { html, icon, raw, el, esc } from "@tp/core/dom.js";
import { fixed } from "@tp/core/format.js";
import { LinkField } from "@tp/components/link-field.js";

let keySeq = 0;
export const rowKey = () => `new-${++keySeq}`;

export class EditableGrid {
	constructor(node, opts) {
		Object.assign(this, { readOnly: false, totals: {}, addLabel: "Add row", emptyText: "No rows yet", newRow: () => ({}) }, opts);
		this.node = node;
		this.links = [];
		this.rows.forEach((r) => (r._key ??= r.name || rowKey()));
		this.render();
	}

	setRows(rows) {
		this.rows = rows;
		this.rows.forEach((r) => (r._key ??= r.name || rowKey()));
		this.render();
	}

	render() {
		this.links.forEach((l) => l.destroy());
		this.links = [];
		const cols = this.columns;
		const totalsRow = Object.keys(this.totals).length
			? html`<tfoot><tr><td colspan="2">Total</td>${cols.slice(1).map((c) => html`<td data-total="${c.fieldname}"></td>`)}${this.readOnly ? "" : html`<td></td>`}</tr></tfoot>`
			: "";

		this.node.replaceChildren(
			el(html`<div>
				<div class="grid-table">
					<table>
						<thead><tr>
							<th class="col-idx">#</th>
							${cols.map((c) => html`<th class="${c.type === "number" || c.type === "computed" ? "is-num" : ""}" ${raw(c.width ? `style="min-width:${esc(c.width)}"` : "")}>${c.label}${c.reqd ? html`<span class="req" style="color:var(--danger)"> *</span>` : ""}</th>`)}
							${this.readOnly ? "" : html`<th class="col-act"><span class="sr-only">Remove</span></th>`}
						</tr></thead>
						<tbody></tbody>
						${totalsRow}
					</table>
				</div>
				${this.readOnly ? "" : html`<div class="grid-actions"><button class="btn btn--primary btn--sm" type="button" data-grid-add>${icon("plus")} ${this.addLabel}</button><span data-grid-extra></span></div>`}
			</div>`)
		);

		const tbody = this.node.querySelector("tbody");
		if (!this.rows.length) {
			tbody.append(el(html`<tr><td colspan="${cols.length + 2}" class="grid-empty">${this.emptyText}</td></tr>`));
		}
		this.rows.forEach((row, i) => tbody.append(this.renderRow(row, i)));

		this.node.querySelector("[data-grid-add]")?.addEventListener("click", () => this.addRow());
		this.refresh();
	}

	renderRow(row, index) {
		const tr = el(html`<tr data-key="${row._key}"><td class="col-idx">${index + 1}</td></tr>`);
		for (const col of this.columns) {
			const td = document.createElement("td");
			td.dataset.field = col.fieldname;
			const value = row[col.fieldname];
			const label = `${col.label}, row ${index + 1}`;

			if (col.type === "computed" || col.type === "static" || this.readOnly) {
				const display = col.type === "number" || col.type === "computed" ? fixed(value, col.precision ?? 2) : value ?? "";
				td.append(el(html`<input class="input ${col.type === "number" || col.type === "computed" ? "input--num" : ""}" readonly tabindex="-1" value="${display}" aria-label="${label}">`));
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
					${raw(isNum ? 'step="any" inputmode="decimal"' : "")} aria-label="${label}">`);
				input.value = value ?? "";
				input.addEventListener("input", () => this.update(row, col.fieldname, isNum ? input.value : input.value, td));
				td.append(input);
			}
			tr.append(td);
		}
		if (!this.readOnly) {
			const td = el(html`<td class="col-act"><button class="icon-btn icon-btn--sm icon-btn--danger" type="button" aria-label="Remove row ${index + 1}">${icon("trash", "i--sm")}</button></td>`);
			td.querySelector("button").addEventListener("click", () => this.removeRow(row));
			tr.append(td);
		}
		return tr;
	}

	update(row, fieldname, value, td) {
		row[fieldname] = value;
		td?.querySelector(".input, .select")?.classList.remove("is-invalid");
		this.onChange?.(row, fieldname);
		this.refresh();
	}

	addRow(values = {}) {
		const row = { ...this.newRow(), ...values, _key: rowKey() };
		this.rows.push(row);
		this.render();
		this.onRowsChange?.();
		this.node.querySelector(`tr[data-key="${row._key}"] input:not([readonly]), tr[data-key="${row._key}"] select`)?.focus();
		return row;
	}

	removeRow(row) {
		const index = this.rows.indexOf(row);
		if (index === -1) return;
		this.rows.splice(index, 1);
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
	}

	/** Mark missing required cells; returns the number of problems. */
	validate() {
		let problems = 0;
		let first = null;
		for (const row of this.rows) {
			const tr = this.node.querySelector(`tr[data-key="${CSS.escape(row._key)}"]`);
			for (const col of this.columns.filter((c) => c.reqd)) {
				if (row[col.fieldname] === undefined || row[col.fieldname] === null || row[col.fieldname] === "") {
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
}
