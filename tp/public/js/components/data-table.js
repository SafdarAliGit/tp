/**
 * Read-only data table with loading, empty state, sorting and pagination.
 *
 *   const table = new DataTable(node, { columns, onRowClick, onPage, rowActions, empty });
 *   table.loading(); table.update({ rows, total, start });
 */
import { html, icon, raw, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";

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
	constructor(node, { columns, onRowClick, onPage, onSort, rowActions, empty = {}, pageLength = 20, sort = null }) {
		Object.assign(this, { node, columns, onRowClick, onPage, onSort, rowActions, empty, pageLength, sort });
		this.rows = [];
		this.node.addEventListener("click", (e) => this.onClick(e));
		this.node.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && e.target.matches("tr[data-index]")) this.onRowClick?.(this.rows[+e.target.dataset.index]);
		});
	}

	head() {
		return html`<thead><tr>
			${this.columns.map((col) => {
				const sortable = col.sortable && this.onSort;
				const active = this.sort?.field === col.key;
				return html`<th class="${NUMERIC.has(col.type) ? "is-num" : ""}" ${raw(col.width ? `style="width:${col.width}"` : "")}
					${raw(sortable ? `data-sort="${col.key}" aria-sort="${active ? (this.sort.dir === "asc" ? "ascending" : "descending") : "none"}"` : "")}>
					${col.label}${active ? html`<span class="sort-ind">${this.sort.dir === "asc" ? "↑" : "↓"}</span>` : ""}
				</th>`;
			})}
			${this.rowActions ? html`<th class="cell-actions"><span class="sr-only">Actions</span></th>` : ""}
		</tr></thead>`;
	}

	loading() {
		const cols = this.columns.length + (this.rowActions ? 1 : 0);
		setHTML(
			this.node,
			html`<div class="table-wrap"><table class="table">${this.head()}<tbody>
				${Array.from({ length: 6 }, () => html`<tr>${Array.from({ length: cols }, () => html`<td><span class="skeleton" style="height:14px;width:${60 + Math.round(Math.random() * 30)}%"></span></td>`)}</tr>`)}
			</tbody></table></div>`
		);
	}

	update({ rows, total = rows.length, start = 0 }) {
		this.rows = rows;
		this.total = total;
		this.start = start;

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
				${this.columns.map((col) => {
					const render = col.render || cell[col.type] || cell.text;
					return html`<td class="${NUMERIC.has(col.type) ? "is-num" : ""}">${render(row[col.key], row, col)}</td>`;
				})}
				${this.rowActions ? html`<td class="cell-actions"><div class="row-actions">${this.rowActions(row)}</div></td>` : ""}
			</tr>`
		);

		const end = start + rows.length;
		const hasPrev = start > 0;
		const hasNext = end < total;
		setHTML(
			this.node,
			html`<div class="table-wrap"><table class="table">${this.head()}<tbody>${body}</tbody></table></div>
			<div class="table-footer">
				<span>Showing <strong class="num">${fmt.number(start + 1, 0)}–${fmt.number(end, 0)}</strong> of <strong class="num">${fmt.number(total, 0)}</strong></span>
				<div class="pager">
					<button class="btn btn--secondary btn--sm" type="button" data-page="prev" ${raw(hasPrev ? "" : "disabled")} aria-label="Previous page">${icon("chevron-left")}</button>
					<button class="btn btn--secondary btn--sm" type="button" data-page="next" ${raw(hasNext ? "" : "disabled")} aria-label="Next page">${icon("chevron-right")}</button>
				</div>
			</div>`
		);
	}

	onClick(e) {
		const pager = e.target.closest("[data-page]");
		if (pager) {
			const delta = pager.dataset.page === "next" ? this.pageLength : -this.pageLength;
			this.onPage?.(Math.max(0, this.start + delta));
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
		if (e.target.closest(".row-actions, a, button")) return;
		const tr = e.target.closest("tr[data-index]");
		if (tr && this.onRowClick) this.onRowClick(this.rows[+tr.dataset.index]);
	}
}
