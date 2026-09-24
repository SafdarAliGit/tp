/**
 * ERPNext-style List / Report view options for a portal list page.
 *
 * Adds to any list page whose Page Access has a Reference DocType:
 *   - List | Report view switch
 *   - Filter builder on any readable field (incl. child-table fields), shown as removable chips
 *   - Sort on any field, ascending / descending
 *   - Rows per page (20 / 100 / 500)
 *   - Row selection with bulk actions: Edit, Submit, Cancel, Delete, Export
 *   - Export to Excel / CSV
 *   - Report view: pick / reorder / remove columns, totals row, group by with counts
 * Settings are kept per page in the browser, like ERPNext's user settings.
 *
 *   const options = new ListOptions({
 *     page: "contracts",
 *     table,                              // the page's own List view DataTable
 *     sort: { field: "modified", dir: "desc" },
 *     quickFilters: () => [...],          // the page's own filter controls as Frappe filters
 *     search: () => state.txt,
 *     openRecord: (name) => ...,
 *     onChange: () => reload(),           // List view options changed: reload the list
 *     onCount: (total) => ...,            // Report view loaded: update the page count
 *   });
 *   // in the page's load(): if (options.isReport) return options.load();
 *   api.get(method, { ...ownArgs, ...options.listArgs() })
 *
 * The page markup needs `[data-slot='list-options']` (the options bar) and `[data-slot='table']`;
 * the Report view renders into a sibling node it creates next to the table.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, el, storage } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { openOverlay, confirm } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { DataTable, cell } from "@tp/components/data-table.js";
import { LinkField } from "@tp/components/link-field.js";
import { openMenu } from "@tp/components/popover-menu.js";
import { pickFields } from "@tp/components/field-picker.js";
import { statusTone } from "@tp/lib/status.js";

const PAGE_SIZES = [20, 100, 500];
const NUMBER_TYPES = new Set(["Currency", "Int", "Long Int", "Float", "Percent"]);
const DATE_TYPES = new Set(["Date", "Datetime"]);
const LONG_TEXT = new Set(["Small Text", "Text", "Long Text", "Text Editor"]);
const DOCSTATUS = { 0: "Draft", 1: "Submitted", 2: "Cancelled" };
const OP_LABELS = {
	"=": "equals",
	"!=": "not equals",
	like: "like",
	"not like": "not like",
	in: "in",
	"not in": "not in",
	">": ">",
	"<": "<",
	">=": ">=",
	"<=": "<=",
	between: "between",
	is: "is",
};

function operators(field) {
	if (field.fieldtype === "Check" || field.fieldtype === "DocStatus") return ["=", "!="];
	if (NUMBER_TYPES.has(field.fieldtype) || DATE_TYPES.has(field.fieldtype) || field.fieldtype === "Time") {
		return ["=", "!=", ">", "<", ">=", "<=", "between", "is"];
	}
	if (field.fieldtype === "Select") return ["=", "!=", "in", "not in", "is"];
	return ["=", "!=", "like", "not like", "in", "not in", "is"];
}

const defaultOperator = (field) => (["Data", "Small Text", "Text", "Long Text", "Text Editor", "Read Only"].includes(field.fieldtype) ? "like" : "=");

/** Human-readable filter value, as shown on chips. */
function describeValue(field, op, value) {
	if (op === "is") return value === "set" ? "set" : "not set";
	if (op === "between") return `${value?.[0] ?? ""} – ${value?.[1] ?? ""}`;
	if (Array.isArray(value)) return value.join(", ");
	if (field?.fieldtype === "Check") return Number(value) ? "Yes" : "No";
	if (field?.fieldtype === "DocStatus") return DOCSTATUS[value] ?? value;
	if (op === "like" || op === "not like") return String(value ?? "").replace(/^%|%$/g, "");
	return String(value ?? "");
}

/**
 * Input for a filter / bulk-edit value, typed by field and operator.
 * Returns { node, get(), destroy() }.
 */
function valueInput(field, op, value) {
	const inputType = DATE_TYPES.has(field.fieldtype) ? "date" : field.fieldtype === "Time" ? "time" : NUMBER_TYPES.has(field.fieldtype) ? "number" : "text";
	const plain = (v, attrs = "") => el(html`<input class="input" type="${inputType}" value="${v ?? ""}" ${raw(attrs)} ${raw(inputType === "number" ? 'step="any"' : "")}>`);
	const select = (options, v) => el(html`<select class="select">${options.map(([val, label]) => html`<option value="${val}" ${raw(String(val) === String(v ?? "") ? "selected" : "")}>${label}</option>`)}</select>`);

	if (op === "is") {
		const node = select([["set", "Set"], ["not set", "Not set"]], value || "set");
		return { node, get: () => node.value, destroy() {} };
	}
	if (op === "between") {
		const [a, b] = Array.isArray(value) ? value : [];
		const node = el(html`<div class="filter-between"></div>`);
		const from = plain(a, 'aria-label="From"');
		const to = plain(b, 'aria-label="To"');
		node.append(from, el(html`<span class="date-range__sep">–</span>`), to);
		return { node, get: () => (from.value && to.value ? [from.value, to.value] : null), destroy() {} };
	}
	if (op === "in" || op === "not in") {
		const node = plain(Array.isArray(value) ? value.join(", ") : value, 'placeholder="Comma-separated values"');
		node.type = "text";
		return { node, get: () => node.value.split(",").map((v) => v.trim()).filter(Boolean), destroy() {} };
	}
	if (field.fieldtype === "Check") {
		const node = select([[1, "Yes"], [0, "No"]], value ?? 1);
		return { node, get: () => Number(node.value), destroy() {} };
	}
	if (field.fieldtype === "DocStatus") {
		const node = select(Object.entries(DOCSTATUS), value ?? 0);
		return { node, get: () => Number(node.value), destroy() {} };
	}
	if (field.fieldtype === "Select" && field.options) {
		const node = select(field.options.split("\n").map((o) => [o, o || "(empty)"]), value);
		return { node, get: () => node.value, destroy() {} };
	}
	if (field.fieldtype === "Link" && field.options && (op === "=" || op === "!=")) {
		const link = new LinkField({ doctype: field.options, value: value || "", allowCreate: false });
		return { node: link.el, get: () => link.value, destroy: () => link.destroy() };
	}
	const text = op === "like" || op === "not like" ? String(value ?? "").replace(/^%|%$/g, "") : value;
	const node = plain(text);
	return {
		node,
		get: () => {
			const v = node.value.trim();
			if (!v) return null;
			if ((op === "like" || op === "not like") && !v.includes("%")) return `%${v}%`;
			return inputType === "number" ? Number(v) : v;
		},
		destroy() {},
	};
}

/** Report view cell renderer for a DocType field. */
function renderer(field, meta) {
	const type = field.fieldtype;
	if (field.fieldname === "name") return (v) => html`<span class="cell-title">${v}</span>`;
	if (field.fieldname === meta.title_field) return (v) => (v ? html`<span class="cell-title">${v}</span>` : cell.text(v));
	if (type === "DocStatus") return (v) => html`<span class="pill ${statusTone(DOCSTATUS[v])}">${DOCSTATUS[v] ?? v}</span>`;
	if (field.fieldname === "status" && type === "Select") return (v) => (v ? html`<span class="pill ${statusTone(v)}">${v}</span>` : cell.text(v));
	if (type === "Currency") return (v) => html`<span class="num">${fmt.fixed(v)}</span>`;
	if (type === "Int" || type === "Long Int") return (v) => html`<span class="num">${fmt.number(v, 0)}</span>`;
	if (type === "Float" || type === "Percent") return (v) => html`<span class="num">${fmt.number(v, 3)}</span>`;
	if (type === "Check") return (v) => (Number(v) ? html`<span class="check-mark" aria-label="Yes">${icon("check", "i--sm")}</span>` : html`<span class="muted">—</span>`);
	if (type === "Date") return cell.date;
	if (type === "Datetime") return cell.datetime;
	if (type === "Color") return (v) => (v ? html`<span class="cell-color">${cell.swatch(v)}<span class="cell-code">${v}</span></span>` : cell.text(v));
	if (LONG_TEXT.has(type)) {
		return (v) => {
			const text = String(v ?? "").replace(/<[^>]*>/g, " ").trim();
			return text ? html`<span class="cell-long" title="${text}">${text}</span>` : cell.text(v);
		};
	}
	return cell.text;
}

export class ListOptions {
	constructor({ page, table, sort, quickFilters = () => [], search = () => "", openRecord, onChange, onCount }) {
		Object.assign(this, { page, table, quickFilters, search, openRecord, onChange, onCount });
		this.key = `tp-list-${page}`;
		this.bar = $("[data-slot='list-options']");
		this.selection = [];

		const saved = this.saved();
		this.defaultSort = sort || { field: "modified", dir: "desc" };
		this.settings = {
			view: saved.view === "report" ? "report" : "list",
			filters: Array.isArray(saved.filters) ? saved.filters : [],
			sort: saved.sort?.field ? saved.sort : this.defaultSort,
			pageLength: PAGE_SIZES.includes(saved.pageLength) ? saved.pageLength : 20,
			columns: Array.isArray(saved.columns) ? saved.columns : null,
			groupBy: saved.groupBy || "",
			totals: Boolean(saved.totals),
		};

		// Report view lives next to the List view table
		this.listNode = table.node;
		this.reportNode = el(html`<div data-slot="report" hidden></div>`);
		this.listNode.after(this.reportNode);

		Object.assign(table, {
			selectable: true,
			pageSizes: PAGE_SIZES,
			pageLength: this.settings.pageLength,
			sort: this.settings.sort,
			onSelect: (names) => this.select(names),
			onPageLength: (n) => this.setPageLength(n),
		});
		table.onSort = (s) => this.setSort(s);

		this.bar.addEventListener("click", (e) => this.onBarClick(e));
		this.bar.addEventListener("change", (e) => this.onBarChange(e));
		this.ready = this.init();
	}

	async init() {
		try {
			this.meta = await api.get("tp.api.listview.get_meta", { page: this.page });
		} catch (err) {
			showError(err, "Couldn't load list options");
			this.meta = { fields: [], child_tables: [], permissions: {}, default_columns: ["name"] };
		}
		this.fields = new Map(this.meta.fields.map((f) => [f.fieldname, f]));
		this.childFields = new Map(this.meta.child_tables.map((t) => [t.doctype, new Map(t.fields.map((f) => [f.fieldname, f]))]));
		// Drop saved settings that no longer apply (field removed or permission changed)
		this.settings.filters = this.settings.filters.filter((f) => this.fieldOf(f));
		if (this.settings.sort.field !== this.defaultSort.field && !this.fields.has(this.settings.sort.field)) this.settings.sort = this.defaultSort;
		if (this.settings.columns) this.settings.columns = this.settings.columns.filter((c) => this.fields.has(c));
		if (this.settings.groupBy && !this.fields.has(this.settings.groupBy)) this.settings.groupBy = "";
		this.table.sort = this.settings.sort;

		this.report = new DataTable(this.reportNode, {
			columns: [],
			selectable: true,
			pageSizes: PAGE_SIZES,
			pageLength: this.settings.pageLength,
			sort: this.settings.sort,
			onSelect: (names) => this.select(names),
			onPageLength: (n) => this.setPageLength(n),
			onSort: (s) => this.setSort(s),
			onPage: (start) => this.load(start),
			onRowClick: (row) => (this.settings.groupBy ? this.drillDown(row) : this.openRecord?.(row.name)),
			headerMenu: (col) => this.columnMenu(col),
			empty: { icon: "inbox", title: "No records found", text: "Adjust the filters or search." },
		});
		this.showView();
		this.drawBar();
	}

	/* ---------- State ---------- */

	saved() {
		try {
			return JSON.parse(storage.get(this.key)) || {};
		} catch {
			return {};
		}
	}

	persist() {
		storage.set(this.key, JSON.stringify(this.settings));
	}

	get isReport() {
		return this.settings.view === "report";
	}

	fieldOf([doctype, fieldname]) {
		return doctype === this.meta.doctype ? this.fields.get(fieldname) : this.childFields.get(doctype)?.get(fieldname);
	}

	/** Arguments the page's own list endpoint takes. */
	listArgs() {
		const { filters, sort, pageLength } = this.settings;
		return { filters: filters.length ? filters : undefined, order_by: `${sort.field} ${sort.dir}`, page_length: pageLength };
	}

	columns() {
		const chosen = this.settings.columns?.length ? this.settings.columns : this.meta.default_columns;
		return chosen.filter((c) => this.fields.has(c));
	}

	queryArgs() {
		return {
			page: this.page,
			columns: this.columns(),
			filters: [...this.quickFilters(), ...this.settings.filters],
			txt: this.search() || undefined,
			order_by: `${this.settings.sort.field} ${this.settings.sort.dir}`,
		};
	}

	changed() {
		this.persist();
		this.drawBar();
		if (this.isReport) this.load();
		else this.onChange?.();
	}

	setSort(sort) {
		this.settings.sort = this.table.sort = sort;
		if (this.report) this.report.sort = sort;
		this.changed();
	}

	setPageLength(n) {
		this.settings.pageLength = this.table.pageLength = n;
		if (this.report) this.report.pageLength = n;
		this.changed();
	}

	setView(view) {
		if (view === this.settings.view) return;
		this.settings.view = view;
		this.showView();
		this.changed();
	}

	showView() {
		this.listNode.hidden = this.isReport;
		this.reportNode.hidden = !this.isReport;
		this.select([]);
	}

	/* ---------- Report view ---------- */

	async load(start = 0) {
		await this.ready;
		const { groupBy, pageLength, totals } = this.settings;
		this.controller?.abort();
		this.controller = new AbortController();
		const signal = this.controller.signal;
		const report = this.report;

		if (groupBy) {
			const group = this.fields.get(groupBy);
			const numeric = this.columns().map((c) => this.fields.get(c)).filter((f) => NUMBER_TYPES.has(f.fieldtype));
			report.columns = [
				{ key: "value", label: group.label, render: (v) => (v === null || v === "" ? html`<span class="muted">Not set</span>` : renderer(group, this.meta)(v)) },
				{ key: "count", label: "Count", type: "number", render: (v) => html`<span class="num">${fmt.number(v, 0)}</span>` },
				...numeric.map((f) => ({ key: f.fieldname, label: f.label, type: "number", render: renderer(f, this.meta) })),
			];
			report.selectable = false;
			report.pageSizes = null;
			report.headerMenu = null;
			report.sort = null;
			report.loading();
			try {
				const { groups } = await api.post("tp.api.listview.get_group_by", { ...this.queryArgs(), group_by: groupBy }, { signal });
				const sums = { count: groups.reduce((s, g) => s + g.count, 0) };
				for (const f of numeric) sums[f.fieldname] = groups.reduce((s, g) => s + (g[f.fieldname] || 0), 0);
				report.pageLength = groups.length || 1;
				report.update({ rows: groups.map((g) => ({ ...g, name: g.value })), total: groups.length, totals: groups.length > 1 ? sums : null });
				this.onCount?.(sums.count);
			} catch (err) {
				showError(err, "Couldn't load report");
			}
			return;
		}

		report.columns = this.columns().map((c) => {
			const f = this.fields.get(c);
			return { key: c, label: f.label, type: NUMBER_TYPES.has(f.fieldtype) ? "number" : undefined, sortable: true, render: renderer(f, this.meta) };
		});
		Object.assign(report, { selectable: true, pageSizes: PAGE_SIZES, pageLength, sort: this.settings.sort, headerMenu: (col) => this.columnMenu(col) });
		report.loading();
		try {
			const result = await api.post(
				"tp.api.listview.get_data",
				{ ...this.queryArgs(), start, page_length: pageLength, with_totals: totals ? 1 : 0 },
				{ signal }
			);
			report.update(result);
			this.onCount?.(result.total);
		} catch (err) {
			showError(err, "Couldn't load report");
		}
	}

	columnMenu(col) {
		const columns = this.columns();
		const index = columns.indexOf(col.key);
		const move = (delta) => {
			const next = [...columns];
			next.splice(index, 1);
			next.splice(index + delta, 0, col.key);
			this.settings.columns = next;
			this.changed();
		};
		return [
			{ label: "Sort ascending", icon: "arrow-up-right", run: () => this.setSort({ field: col.key, dir: "asc" }) },
			{ label: "Sort descending", icon: "chevron-down", run: () => this.setSort({ field: col.key, dir: "desc" }) },
			{ sep: true },
			index > 0 && { label: "Move left", icon: "arrow-left", run: () => move(-1) },
			index < columns.length - 1 && { label: "Move right", icon: "arrow-right", run: () => move(1) },
			{ label: `Group by ${col.label}`, icon: "layers", run: () => this.setGroupBy(col.key) },
			{ label: "Filter on this column", icon: "filter", run: () => this.editFilters([this.meta.doctype, col.key]) },
			columns.length > 1 && { sep: true },
			columns.length > 1 && { label: "Remove column", icon: "trash", danger: true, run: () => this.setColumns(columns.filter((c) => c !== col.key)) },
		];
	}

	setColumns(columns) {
		this.settings.columns = columns;
		this.changed();
	}

	setGroupBy(fieldname) {
		this.settings.groupBy = fieldname;
		if (!this.isReport) this.settings.view = "report";
		this.showView();
		this.changed();
	}

	drillDown(group) {
		const value = group.value;
		const filter = value === null || value === "" ? [this.meta.doctype, this.settings.groupBy, "is", "not set"] : [this.meta.doctype, this.settings.groupBy, "=", value];
		this.settings.filters = [...this.settings.filters.filter((f) => !(f[0] === filter[0] && f[1] === filter[1])), filter];
		this.settings.groupBy = "";
		this.changed();
	}

	async pickColumns() {
		const current = this.columns();
		const section = (f) => (f.standard ? "Standard fields" : "Fields");
		const picked = await pickFields({
			title: "Pick columns",
			text: "Choose the columns shown in the Report view. Use a column's menu to reorder it.",
			fields: this.meta.fields.map((f) => ({ ...f, section: section(f), locked: f.fieldname === "name" ? 1 : 0 })),
			selected: current,
			defaults: this.meta.default_columns,
		});
		if (!picked) return;
		// Keep the existing order; new columns go to the end
		this.setColumns([...current.filter((c) => picked.includes(c)), ...picked.filter((c) => !current.includes(c))]);
	}

	/* ---------- Options bar ---------- */

	drawBar() {
		if (!this.meta) return;
		const { settings, meta } = this;
		const perms = meta.permissions || {};
		const n = this.selection.length;

		if (n) {
			const editable = meta.fields.some((f) => f.editable);
			this.bar.innerHTML = String(html`
				<div class="list-options list-options--bulk">
					<span class="list-options__count"><strong class="num">${n}</strong> selected</span>
					<div class="list-options__group">
						${perms.write && editable ? html`<button class="btn btn--secondary btn--sm" type="button" data-bulk="edit">${icon("pencil")} Edit</button>` : ""}
						${meta.can_submit ? html`<button class="btn btn--secondary btn--sm" type="button" data-bulk="submit">${icon("send")} Submit</button>` : ""}
						${meta.can_cancel ? html`<button class="btn btn--secondary btn--sm" type="button" data-bulk="cancel">${icon("ban")} Cancel</button>` : ""}
						${perms.export ? html`<button class="btn btn--secondary btn--sm" type="button" data-bulk="export">${icon("download")} Export</button>` : ""}
						${perms.delete ? html`<button class="btn btn--danger btn--sm" type="button" data-bulk="delete">${icon("trash")} Delete</button>` : ""}
					</div>
					<span class="spacer"></span>
					<button class="btn btn--ghost btn--sm" type="button" data-opt="deselect">${icon("x")} Clear selection</button>
				</div>`);
			return;
		}

		const sortable = meta.fields.filter((f) => !LONG_TEXT.has(f.fieldtype));
		const groupable = meta.fields.filter((f) => !LONG_TEXT.has(f.fieldtype) && f.fieldtype !== "Datetime");
		const sortField = this.fields.get(settings.sort.field);
		this.bar.innerHTML = String(html`
			<div class="list-options">
				<div class="view-switch" role="group" aria-label="View">
					<button class="view-switch__btn" type="button" data-view="list" aria-pressed="${!this.isReport}">${icon("menu", "i--sm")} List</button>
					<button class="view-switch__btn" type="button" data-view="report" aria-pressed="${this.isReport}">${icon("layers", "i--sm")} Report</button>
				</div>
				<button class="btn btn--secondary btn--sm ${settings.filters.length ? "is-active" : ""}" type="button" data-opt="filter">
					${icon("filter")} Filter${settings.filters.length ? html`<span class="count-badge">${settings.filters.length}</span>` : ""}
				</button>
				<div class="filter-chips">
					${settings.filters.map((f, i) => {
						const field = this.fieldOf(f);
						const child = f[0] !== meta.doctype ? meta.child_tables.find((t) => t.doctype === f[0])?.label : "";
						return html`<span class="filter-chip">
							<button class="filter-chip__body" type="button" data-edit-filter="${i}" title="Edit filter">
								<span class="filter-chip__field">${child ? `${child}: ` : ""}${field?.label || f[1]}</span>
								<span class="filter-chip__op">${OP_LABELS[f[2]] || f[2]}</span>
								<span class="filter-chip__value">${describeValue(field, f[2], f[3])}</span>
							</button>
							<button class="filter-chip__remove" type="button" data-remove-filter="${i}" aria-label="Remove filter">${icon("x", "i--sm")}</button>
						</span>`;
					})}
					${settings.filters.length > 1 ? html`<button class="btn btn--ghost btn--sm" type="button" data-opt="clear-filters">Clear all</button>` : ""}
				</div>
				<span class="spacer"></span>
				${this.isReport
					? html`<label class="opt-select" title="Group by">
							${icon("layers", "i--sm")}
							<select class="select select--xs" data-opt="group-by" aria-label="Group by">
								<option value="">No grouping</option>
								${groupable.map((f) => html`<option value="${f.fieldname}" ${raw(f.fieldname === settings.groupBy ? "selected" : "")}>Group by ${f.label}</option>`)}
							</select>
						</label>
						<label class="check check--sm"><input type="checkbox" data-opt="totals" ${raw(settings.totals ? "checked" : "")}> Totals</label>
						<button class="btn btn--secondary btn--sm" type="button" data-opt="columns" ${raw(settings.groupBy ? "disabled" : "")}>${icon("settings")} Columns</button>`
					: ""}
				<div class="sort-control">
					<label class="opt-select" title="Sort by">
						<span class="sr-only">Sort by</span>
						<select class="select select--xs" data-opt="sort" aria-label="Sort by">
							${sortField ? "" : html`<option value="${settings.sort.field}" selected>Default order</option>`}
							${sortable.map((f) => html`<option value="${f.fieldname}" ${raw(f.fieldname === settings.sort.field ? "selected" : "")}>${f.label}</option>`)}
						</select>
					</label>
					<button class="icon-btn icon-btn--sm" type="button" data-opt="sort-dir" aria-label="${settings.sort.dir === "asc" ? "Ascending: switch to descending" : "Descending: switch to ascending"}" title="${settings.sort.dir === "asc" ? "Ascending" : "Descending"}">
						<span class="sort-dir">${settings.sort.dir === "asc" ? "↑" : "↓"}</span>
					</button>
				</div>
				<button class="icon-btn" type="button" data-opt="menu" aria-label="More list options">${icon("more")}</button>
			</div>`);
	}

	onBarClick(e) {
		const target = e.target.closest("button");
		if (!target) return;
		const { view, opt, bulk, editFilter, removeFilter } = target.dataset;
		if (view) this.setView(view);
		else if (bulk) this.bulk(bulk);
		else if (editFilter !== undefined) this.editFilters();
		else if (removeFilter !== undefined) {
			this.settings.filters = this.settings.filters.filter((_, i) => i !== +removeFilter);
			this.changed();
		} else if (opt === "filter") this.editFilters();
		else if (opt === "clear-filters") {
			this.settings.filters = [];
			this.changed();
		} else if (opt === "sort-dir") this.setSort({ ...this.settings.sort, dir: this.settings.sort.dir === "asc" ? "desc" : "asc" });
		else if (opt === "columns") this.pickColumns();
		else if (opt === "deselect") this.clearSelection();
		else if (opt === "menu") this.openOptionsMenu(target);
	}

	onBarChange(e) {
		const opt = e.target.dataset.opt;
		if (opt === "sort") this.setSort({ field: e.target.value, dir: this.settings.sort.dir });
		else if (opt === "group-by") this.setGroupBy(e.target.value);
		else if (opt === "totals") {
			this.settings.totals = e.target.checked;
			this.changed();
		}
	}

	openOptionsMenu(anchor) {
		const perms = this.meta.permissions || {};
		openMenu(anchor, [
			perms.export && { label: "Export to Excel", icon: "download", run: () => this.export("Excel") },
			perms.export && { label: "Export to CSV", icon: "file-text", run: () => this.export("CSV") },
			perms.export && { sep: true },
			this.isReport && !this.settings.groupBy && { label: "Pick columns", icon: "settings", run: () => this.pickColumns() },
			{ label: "Reset view settings", icon: "refresh", run: () => this.reset() },
			document.querySelector('a[href="/desk"]') && {
				label: `Open ${this.meta.doctype} in Desk`,
				icon: "external",
				href: `/desk/${this.meta.doctype.toLowerCase().replace(/ /g, "-")}${this.isReport ? "/view/report" : ""}`,
				newTab: true,
			},
		]);
	}

	reset() {
		const view = this.settings.view;
		this.settings = { view, filters: [], sort: this.defaultSort, pageLength: 20, columns: null, groupBy: "", totals: false };
		this.table.sort = this.report.sort = this.defaultSort;
		this.table.pageLength = this.report.pageLength = 20;
		this.showView();
		this.changed();
		toast.success("View settings reset");
	}

	/* ---------- Selection & bulk actions ---------- */

	select(names) {
		const had = this.selection.length;
		this.selection = names;
		if (had || names.length) this.drawBar();
	}

	clearSelection() {
		(this.isReport ? this.report : this.table).setSelection([]);
	}

	async bulk(action) {
		const names = [...this.selection];
		const count = `${names.length} record${names.length === 1 ? "" : "s"}`;
		if (action === "export") return this.export("Excel", names);

		let args = {};
		if (action === "edit") {
			args = await this.bulkEditDialog(names.length);
			if (!args) return;
		} else {
			const verbs = { submit: "Submit", cancel: "Cancel", delete: "Delete" };
			const texts = {
				submit: "Submitted documents can no longer be edited.",
				cancel: "Cancelled documents can't be changed again, only amended.",
				delete: "This permanently deletes the selected records. This can't be undone.",
			};
			const ok = await confirm({
				title: `${verbs[action]} ${count}?`,
				text: texts[action],
				confirmLabel: `${verbs[action]} ${count}`,
				danger: action !== "submit",
			});
			if (!ok) return;
		}

		try {
			const result = await api.post("tp.api.listview.bulk_action", { page: this.page, action, names, ...args });
			const past = { edit: "Updated", submit: "Submitted", cancel: "Cancelled", delete: "Deleted" }[action];
			if (result.done.length) toast.success(`${past} ${result.done.length} record${result.done.length === 1 ? "" : "s"}`);
			if (result.failed.length) {
				const detail = result.failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join("\n");
				toast.error(`${result.failed.length} record${result.failed.length === 1 ? "" : "s"} failed`, { text: detail + (result.failed.length > 3 ? "\n…" : "") });
			}
		} catch (err) {
			showError(err, "Bulk action failed");
		}
		if (this.isReport) this.load();
		else this.onChange?.();
	}

	bulkEditDialog(n) {
		const fields = this.meta.fields.filter((f) => f.editable);
		return new Promise((resolve) => {
			const node = el(html`
				<div class="overlay">
					<form class="modal modal--form" role="dialog" aria-modal="true" aria-labelledby="bulk-title" novalidate>
						<header class="picker__header">
							<div>
								<h2 class="modal__title" id="bulk-title">Edit ${n} record${n === 1 ? "" : "s"}</h2>
								<p class="modal__text">Set one field to the same value on every selected record.</p>
							</div>
						</header>
						<div class="modal__form">
							<div class="form-grid">
								<label class="field"><span class="field__label">Field</span>
									<select class="select" data-slot="field">${fields.map((f) => html`<option value="${f.fieldname}">${f.label}</option>`)}</select>
								</label>
								<div class="field"><span class="field__label">Value</span><div data-slot="value"></div></div>
							</div>
						</div>
						<div class="modal__footer">
							<button class="btn btn--secondary" type="button" data-cancel>Cancel</button>
							<button class="btn btn--primary" type="submit">${icon("check")} Update</button>
						</div>
					</form>
				</div>`);
			const fieldSelect = $("[data-slot='field']", node);
			const slot = $("[data-slot='value']", node);
			let input;
			const draw = () => {
				input?.destroy();
				input = valueInput(fields.find((f) => f.fieldname === fieldSelect.value), "=", "");
				slot.replaceChildren(input.node);
			};
			let result = null;
			const close = openOverlay(node, { initialFocus: "[data-slot='field']", onClose: () => (input?.destroy(), resolve(result)) });
			fieldSelect.addEventListener("change", draw);
			$("[data-cancel]", node).addEventListener("click", () => close());
			node.querySelector("form").addEventListener("submit", (e) => {
				e.preventDefault();
				const value = input.get();
				result = { fieldname: fieldSelect.value, value: value ?? "" };
				close(true);
			});
			draw();
		});
	}

	async export(fileFormat, names = null) {
		const args = this.queryArgs();
		const params = new URLSearchParams({ page: this.page, file_format: fileFormat, columns: JSON.stringify(args.columns), order_by: args.order_by });
		if (names) params.set("names", JSON.stringify(names));
		else {
			params.set("filters", JSON.stringify(args.filters));
			if (args.txt) params.set("txt", args.txt);
		}
		toast("Preparing export…", { text: `${fileFormat} file with ${names ? `${names.length} selected` : "all matching"} records.`, timeout: 2500 });
		try {
			const response = await fetch(`/api/method/tp.api.listview.export?${params}`, { credentials: "same-origin" });
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				const messages = body._server_messages ? JSON.parse(body._server_messages).map((m) => JSON.parse(m).message) : [];
				const exception = String(body.exception || "").split(": ").slice(1).join(": ");
				throw new Error((messages.join("\n") || exception).replace(/<[^>]*>/g, "") || "The export failed.");
			}
			const filename = /filename="?([^";]+)"?/.exec(response.headers.get("Content-Disposition") || "")?.[1] || `export.${fileFormat === "CSV" ? "csv" : "xlsx"}`;
			const url = URL.createObjectURL(await response.blob());
			const link = Object.assign(document.createElement("a"), { href: url, download: filename });
			document.body.append(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (err) {
			showError(err, "Couldn't export");
		}
	}

	/* ---------- Filter builder ---------- */

	fieldOptions() {
		const main = html`<optgroup label="${this.meta.doctype}">${this.meta.fields.map((f) => html`<option value="${this.meta.doctype}::${f.fieldname}">${f.label}</option>`)}</optgroup>`;
		const children = this.meta.child_tables.map(
			(t) => html`<optgroup label="${t.label} (${t.doctype})">${t.fields.map((f) => html`<option value="${t.doctype}::${f.fieldname}">${t.label}: ${f.label}</option>`)}</optgroup>`
		);
		return html`${main}${children}`;
	}

	/** Filter dialog; `add` = [doctype, fieldname] opens it with a new filter on that field. */
	editFilters(add = null) {
		const rows = this.settings.filters.map((f) => [...f]);
		if (add || !rows.length) {
			const [doctype, fieldname] = add || [this.meta.doctype, this.meta.title_field && this.fields.has(this.meta.title_field) ? this.meta.title_field : "name"];
			const field = this.fieldOf([doctype, fieldname]);
			if (field) rows.push([doctype, fieldname, defaultOperator(field), ""]);
		}

		const node = el(html`
			<div class="overlay">
				<form class="modal modal--filters" role="dialog" aria-modal="true" aria-labelledby="filters-title" novalidate>
					<header class="picker__header">
						<div>
							<h2 class="modal__title" id="filters-title">Filters</h2>
							<p class="modal__text">Show only the ${this.meta.doctype} records matching every condition.</p>
						</div>
						<button class="icon-btn" type="button" data-cancel aria-label="Close">${icon("x")}</button>
					</header>
					<div class="filter-rows" data-slot="rows"></div>
					<div class="filter-add"><button class="btn btn--ghost btn--sm" type="button" data-add>${icon("plus")} Add a filter</button></div>
					<div class="modal__footer">
						<button class="btn btn--ghost" type="button" data-clear>Clear filters</button>
						<span class="spacer"></span>
						<button class="btn btn--secondary" type="button" data-cancel>Cancel</button>
						<button class="btn btn--primary" type="submit">${icon("check")} Apply</button>
					</div>
				</form>
			</div>`);
		const list = $("[data-slot='rows']", node);
		const editors = [];

		const addRow = ([doctype, fieldname, op, value]) => {
			const row = el(html`
				<div class="filter-row">
					<select class="select" data-part="field" aria-label="Field">${this.fieldOptions()}</select>
					<select class="select" data-part="op" aria-label="Condition"></select>
					<div class="filter-row__value" data-part="value"></div>
					<button class="icon-btn icon-btn--sm icon-btn--danger" type="button" data-remove aria-label="Remove filter">${icon("x", "i--sm")}</button>
				</div>`);
			const editor = { row, input: null };
			const fieldSelect = $("[data-part='field']", row);
			const opSelect = $("[data-part='op']", row);
			const valueSlot = $("[data-part='value']", row);
			const current = () => {
				const [dt, fn] = fieldSelect.value.split("::");
				return { doctype: dt, field: this.fieldOf([dt, fn]) };
			};
			const drawValue = (v) => {
				editor.input?.destroy();
				editor.input = valueInput(current().field, opSelect.value, v);
				valueSlot.replaceChildren(editor.input.node);
			};
			const drawOps = (selected) => {
				const ops = operators(current().field);
				opSelect.innerHTML = String(html`${ops.map((o) => html`<option value="${o}" ${raw(o === selected ? "selected" : "")}>${OP_LABELS[o]}</option>`)}`);
			};
			fieldSelect.value = `${doctype}::${fieldname}`;
			drawOps(op);
			drawValue(value);
			fieldSelect.addEventListener("change", () => {
				drawOps(defaultOperator(current().field));
				drawValue("");
			});
			opSelect.addEventListener("change", () => drawValue(""));
			$("[data-remove]", row).addEventListener("click", () => {
				editor.input?.destroy();
				row.remove();
				editors.splice(editors.indexOf(editor), 1);
			});
			editor.value = () => {
				const { doctype: dt, field } = current();
				const v = editor.input.get();
				return v === null || v === "" || (Array.isArray(v) && !v.length) ? null : [dt, field.fieldname, opSelect.value, v];
			};
			editors.push(editor);
			list.append(row);
			return editor;
		};

		rows.forEach(addRow);
		const close = openOverlay(node, { initialFocus: ".filter-row:last-child [data-part='value'] input, .filter-row:last-child select", onClose: () => editors.forEach((e) => e.input?.destroy()) });
		node.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => close()));
		$("[data-add]", node).addEventListener("click", () => {
			const editor = addRow([this.meta.doctype, "name", "=", ""]);
			$("select", editor.row).focus();
		});
		$("[data-clear]", node).addEventListener("click", () => {
			this.settings.filters = [];
			close();
			this.changed();
		});
		node.querySelector("form").addEventListener("submit", (e) => {
			e.preventDefault();
			this.settings.filters = editors.map((ed) => ed.value()).filter(Boolean);
			close();
			this.changed();
		});
	}
}
