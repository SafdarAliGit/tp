/**
 * Read-only data table with loading, empty state, sorting and pagination.
 *
 *   const table = new DataTable(node, { columns, onRowClick, onPage, rowActions, empty });
 *   table.loading(); table.update({ rows, total, start, totals });
 *
 * Options for list views (see components/list-options.js):
 *   selectable        checkbox per row (keyed by `row.name`); `onSelect(names)` on every change
 *   pageSizes         e.g. [20, 100, 500]; `onPageLength(n)` when the user picks one
 *   headerMenu(col)   menu items (components/popover-menu.js) for a column header
 *   `totals` passed to update() renders a totals row for the columns it has values for
 */
import { html, icon, raw, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { openMenu } from "@tp/components/popover-menu.js";

export const cell = {
	title: (v, row, col) => html`<span class="cell-title">${v}</span>${col.sub ? html`<span class="cell-sub">${row[col.sub] ?? ""}</span>` : ""}`,
	code: (v) => html`<span class="cell-code">${v}</span>`,
	badge: (v) => (v ? html`<span class="badge">${v}</span>` : ""),
	group: (v) => (Number(v) ? html`<span class="badge">Group</span>` : html`<span class="badge badge--neutral">Ledger</span>`),
	status: (v) => (Number(v) ? html`<span class="pill pill--danger">Disabled</span>` : html`<span class="pill pill--success">Active</span>`),
	swatch: (v) => html`<span class="swatch" style="background:${/^#[0-9a-f]{3,8}$/i.test(v || "") ? v : "transparent"}"></span>`,
	date: (v) => (v ? fmt.date(v) : html`<span class="muted">—</span>`),
	datetime: (v) => html`<span title="${fmt.date(v, { dateStyle: "medium", timeStyle: "short" })}">${fmt.relative(v)}</span>`,
	number: (v) => html`<span class="num">${fmt.number(v)}</span>`,
	currency: (v) => html`<span class="num">${fmt.currency(v)}</span>`,
	text: (v) => (v === null || v === undefined || v === "" ? html`<span class="muted">—</span>` : html`${v}`),
};

const NUMERIC = new Set(["number", "currency"]);

export class DataTable {
	constructor(node, { columns, onRowClick, onPage, onSort, rowActions, empty = {}, pageLength = 20, sort = null, selectable = false, onSelect, pageSizes, onPageLength, headerMenu }) {
		Object.assign(this, { node, columns, onRowClick, onPage, onSort, rowActions, empty, pageLength, sort, selectable, onSelect, pageSizes, onPageLength, headerMenu });
		this.rows = [];
		this.selected = new Set();
		this.node.addEventListener("click", (e) => this.onClick(e));
		this.node.addEventListener("change", (e) => this.onCheck(e));
		this.node.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && e.target.matches("tr[data-index]")) this.onRowClick?.(this.rows[+e.target.dataset.index]);
		});
	}

	head() {
		const all = this.rows.length > 0 && this.rows.every((r) => this.selected.has(r.name));
		return html`<thead><tr>
			${this.selectable ? html`<th class="cell-check"><label class="check"><input type="checkbox" data-check="all" aria-label="Select all rows" ${raw(all ? "checked" : "")}></label></th>` : ""}
			${this.columns.map((col, i) => {
				const sortable = col.sortable && this.onSort;
				const active = this.sort?.field === col.key;
				return html`<th class="${NUMERIC.has(col.type) ? "is-num" : ""}" ${raw(col.width ? `style="width:${col.width}"` : "")}
					${raw(sortable ? `data-sort="${col.key}" aria-sort="${active ? (this.sort.dir === "asc" ? "ascending" : "descending") : "none"}"` : "")}>
					${col.label}${active ? html`<span class="sort-ind">${this.sort.dir === "asc" ? "↑" : "↓"}</span>` : ""}
					${this.headerMenu ? html`<button class="th-menu" type="button" data-col-menu="${i}" aria-label="${col.label} column options">${icon("chevron-down", "i--sm")}</button>` : ""}
				</th>`;
			})}
			${this.rowActions ? html`<th class="cell-actions"><span class="sr-only">Actions</span></th>` : ""}
		</tr></thead>`;
	}

	colspan() {
		return this.columns.length + (this.rowActions ? 1 : 0) + (this.selectable ? 1 : 0);
	}

	loading() {
		const cols = this.colspan();
		setHTML(
			this.node,
			html`<div class="table-wrap"><table class="table">${this.head()}<tbody>
				${Array.from({ length: 6 }, () => html`<tr>${Array.from({ length: cols }, () => html`<td><span class="skeleton" style="height:14px;width:${60 + Math.round(Math.random() * 30)}%"></span></td>`)}</tr>`)}
			</tbody></table></div>`
		);
	}

	update({ rows, total = rows.length, start = 0, totals = null }) {
		this.rows = rows;
		this.total = total;
		this.start = start;
		this.setSelection([]);

		if (!rows.length) {
			const e = this.empty;
			setHTML(
				this.node,
				html`<div class="state">
					<div class="state__icon">${icon(e.icon || "inbox")}</div>
					<h3 class="state__title">${e.title || "Nothing here yet"}</h3>
					${e.text ? html`<p class="state__text">${e.text}</p>` : ""}
					${e.action || ""}
				</div>`
			);
			return;
		}

		const clickable = Boolean(this.onRowClick);
		const body = rows.map(
			(row, i) => html`<tr data-index="${i}" ${raw(clickable ? 'class="is-clickable" tabindex="0"' : "")}>
				${this.selectable ? html`<td class="cell-check"><label class="check"><input type="checkbox" data-check="${i}" aria-label="Select ${row.name}"></label></td>` : ""}
				${this.columns.map((col) => {
					const render = col.render || cell[col.type] || cell.text;
					return html`<td class="${NUMERIC.has(col.type) ? "is-num" : ""}">${render(row[col.key], row, col)}</td>`;
				})}
				${this.rowActions ? html`<td class="cell-actions"><div class="row-actions">${this.rowActions(row)}</div></td>` : ""}
			</tr>`
		);

		const foot = totals && Object.keys(totals).length
			? html`<tfoot><tr>
				${this.selectable ? html`<td></td>` : ""}
				${this.columns.map((col, i) => {
					const has = col.key in totals;
					const render = col.totalRender || col.render || cell[col.type] || cell.text;
					return html`<td class="${NUMERIC.has(col.type) ? "is-num" : ""}">${has ? render(totals[col.key], totals, col) : i === 0 ? html`<strong>Total</strong>` : ""}</td>`;
				})}
				${this.rowActions ? html`<td></td>` : ""}
			</tr></tfoot>`
			: "";

		const end = start + rows.length;
		const hasPrev = start > 0;
		const hasNext = end < total;
		setHTML(
			this.node,
			html`<div class="table-wrap"><table class="table">${this.head()}<tbody>${body}</tbody>${foot}</table></div>
			<div class="table-footer">
				<span>Showing <strong class="num">${fmt.number(start + 1, 0)}–${fmt.number(end, 0)}</strong> of <strong class="num">${fmt.number(total, 0)}</strong></span>
				<div class="pager">
					${this.pageSizes ? html`<div class="page-sizes" role="group" aria-label="Rows per page">
						${this.pageSizes.map((n) => html`<button class="page-size" type="button" data-page-length="${n}" aria-pressed="${n === this.pageLength}">${n}</button>`)}
					</div>` : ""}
					<button class="btn btn--secondary btn--sm" type="button" data-page="prev" ${raw(hasPrev ? "" : "disabled")} aria-label="Previous page">${icon("chevron-left")}</button>
					<button class="btn btn--secondary btn--sm" type="button" data-page="next" ${raw(hasNext ? "" : "disabled")} aria-label="Next page">${icon("chevron-right")}</button>
				</div>
			</div>`
		);
	}

	/** Tick exactly `names` (rows not on this page are ignored). */
	setSelection(names) {
		this.selected = new Set(names.filter((n) => this.rows.some((r) => r.name === n)));
		this.node.querySelectorAll("input[data-check]").forEach((input) => {
			input.checked = input.dataset.check === "all" ? this.rows.length > 0 && this.selected.size === this.rows.length : this.selected.has(this.rows[+input.dataset.check]?.name);
		});
		this.node.querySelectorAll("tr[data-index]").forEach((tr) => tr.classList.toggle("is-selected", this.selected.has(this.rows[+tr.dataset.index]?.name)));
		this.onSelect?.([...this.selected]);
	}

	onCheck(e) {
		const input = e.target.closest("input[data-check]");
		if (!input) return;
		if (input.dataset.check === "all") {
			this.setSelection(input.checked ? this.rows.map((r) => r.name) : []);
		} else {
			const name = this.rows[+input.dataset.check].name;
			const names = new Set(this.selected);
			if (input.checked) names.add(name);
			else names.delete(name);
			this.setSelection([...names]);
		}
	}

	onClick(e) {
		const size = e.target.closest("[data-page-length]");
		if (size) {
			this.pageLength = +size.dataset.pageLength;
			this.onPageLength?.(this.pageLength);
			return;
		}
		const pager = e.target.closest("[data-page]");
		if (pager) {
			const delta = pager.dataset.page === "next" ? this.pageLength : -this.pageLength;
			this.onPage?.(Math.max(0, this.start + delta));
			return;
		}
		const colMenu = e.target.closest("[data-col-menu]");
		if (colMenu) {
			openMenu(colMenu, this.headerMenu(this.columns[+colMenu.dataset.colMenu]));
			return;
		}
		const th = e.target.closest("th[data-sort]");
		if (th) {
			const field = th.dataset.sort;
			const dir = this.sort?.field === field && this.sort.dir === "desc" ? "asc" : "desc";
			this.sort = { field, dir };
			this.onSort?.(this.sort);
			return;
		}
		if (e.target.closest(".row-actions, a, button, .cell-check")) return;
		const tr = e.target.closest("tr[data-index]");
		if (tr && this.onRowClick) this.onRowClick(this.rows[+tr.dataset.index]);
	}
}
