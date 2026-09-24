/**
 * Material Request form: details, transport, items grid, summary, and the document lifecycle
 * (save → submit → stop / re-open → cancel → amend → delete), all without leaving the portal.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, raw, boot, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { confirm } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { Form } from "@tp/components/form.js";
import { EditableGrid } from "@tp/components/grid.js";
import { collapsibleSections } from "@tp/components/sections.js";
import { statusTone } from "@tp/lib/status.js";

const BASE = "/stock/material-requests";
const DOCTYPE = "Material Request";
const HEADER_FIELDS = ["material_request_type", "transaction_date", "schedule_date", "company", "customer", "set_from_warehouse", "set_warehouse", "driver_name", "vehicle_no", "mobile_no"];
const ITEM_FIELDS = ["name", "item_code", "qty", "uom", "warehouse", "from_warehouse", "schedule_date", "type", "bags", "weaving_contract_terry"];
const warehouseFilters = { is_group: 0, company: { field: "company" } };
const contractsOf = (doc) => [...new Set(doc.items.map((r) => r.weaving_contract_terry).filter(Boolean))];

// What "done" means for each purpose, shown as a progress bar once submitted
const PROGRESS = {
	Purchase: [["per_ordered", "Ordered"], ["per_received", "Received"]],
	"Customer Provided": [["per_ordered", "Received"]],
	"Material Transfer": [["per_ordered", "Transferred"]],
	"Material Issue": [["per_ordered", "Issued"]],
};

// With a weaving contract on the rows, the customer is the contract's buyer
const detailFields = (meta, fromContract) => [
	{ fieldname: "material_request_type", label: "Purpose", fieldtype: "Select", options: meta.purposes.join("\n"), reqd: 1 },
	{ fieldname: "transaction_date", label: "Date", fieldtype: "Date", reqd: 1 },
	{ fieldname: "schedule_date", label: "Required By", fieldtype: "Date", reqd: 1 },
	{ fieldname: "customer", label: "Customer", fieldtype: "Link", options: "Customer", reqd: 1, placeholder: "Select customer", read_only: fromContract, depends_on: { material_request_type: "Customer Provided" } },
	{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company", reqd: 1 },
	{ fieldname: "set_from_warehouse", label: "Source Warehouse", fieldtype: "Link", options: "Warehouse", filters: warehouseFilters, depends_on: { material_request_type: "Material Transfer" } },
	{ fieldname: "set_warehouse", label: "Target Warehouse", fieldtype: "Link", options: "Warehouse", filters: warehouseFilters, description: "Applied to every item row" },
];

const transportFields = [
	{ fieldname: "driver_name", label: "Driver Name", fieldtype: "Data" },
	{ fieldname: "vehicle_no", label: "Vehicle No", fieldtype: "Data" },
	{ fieldname: "mobile_no", label: "Mobile No", fieldtype: "Data", placeholder: "03xx-xxxxxxx" },
];

const section = (id, iconName, title, sub) => html`
	<section class="card form-section" id="${id}">
		<header class="card__header">
			<div class="card__title"><span class="card__title-icon">${icon(iconName)}</span><div>${title}<div class="card__sub">${sub}</div></div></div>
		</header>
		<div data-body></div>
	</section>`;

export async function mountMaterialRequestForm() {
	const { request: name, contract, amend, duplicate: copyOf } = boot();
	const root = $("[data-slot='request']");
	const formNode = $("[data-slot='form']", root);
	const actionsNode = $("[data-slot='actions']", root);

	let meta;
	let loaded;
	try {
		[meta, loaded] = await Promise.all([
			api.get("tp.api.material_requests.get_meta"),
			name ? api.get("tp.api.material_requests.get", { name }) : api.get("tp.api.material_requests.new", { contract, amend, duplicate: copyOf }),
		]);
	} catch (err) {
		showError(err, "Couldn't open material request");
		setHTML(
			formNode,
			html`<div class="card state"><div class="state__icon state__icon--danger">${icon("alert")}</div><h3 class="state__title">Material request unavailable</h3><p class="state__text">${err.message}</p><a class="btn btn--secondary" href="${BASE}">${icon("arrow-left")} Back to material requests</a></div>`
		);
		return;
	}

	const state = { doc: loaded.doc, perms: loaded.permissions || meta.permissions, dirty: false, busy: false, source: contract || amend || copyOf || null };
	state.doc.items ||= [];
	const isNew = () => !state.doc.name;
	const readOnly = () => state.doc.docstatus !== 0 || (isNew() ? !state.perms.create : !state.perms.write);

	setHTML(
		formNode,
		html`
		<div data-slot="notice"></div>
		${section("details", "clipboard-list", "Request details", "Purpose, dates, customer and warehouses")}
		${section("transport", "truck", "Transport", "Driver and vehicle bringing or taking the material")}
		${section("items", "package", "Items", "What is requested, how much and where it goes")}`
	);
	const body = (id) => $(`#${id} [data-body]`, formNode);
	collapsibleSections(formNode, "material-request");

	let details, transport, items;

	function markDirty() {
		if (!state.dirty) {
			state.dirty = true;
			renderHeader();
		}
	}

	const totals = () => ({
		qty: state.doc.items.reduce((t, r) => t + (Number(r.qty) || 0), 0),
		bags: state.doc.items.reduce((t, r) => t + (Number(r.bags) || 0), 0),
	});

	function buildForms() {
		[details, transport, items].forEach((c) => c?.destroy?.());
		const d = state.doc;
		const ro = readOnly();

		details = new Form(body("details"), detailFields(meta, contractsOf(d).length > 0), {
			values: d,
			isNew: isNew(),
			disabled: ro,
			onChange: (field, value) => {
				d[field] = value;
				if (field === "customer") d.customer_title = details.links.customer?.label;
				// Header warehouse and date apply to every row, as in the desk
				if (field === "set_warehouse" && value) d.items.forEach((r) => (r.warehouse = value));
				if (field === "schedule_date" && value) d.items.forEach((r) => (r.schedule_date = value));
				if (field === "set_warehouse" || field === "schedule_date") items.setRows(d.items);
				markDirty();
				renderAside();
			},
		});
		if (d.customer_title) details.links.customer?.set(d.customer, d.customer_title);

		transport = new Form(body("transport"), transportFields, {
			values: d,
			isNew: isNew(),
			disabled: ro,
			onChange: (field, value) => {
				d[field] = value;
				markDirty();
			},
		});

		items = new EditableGrid(body("items"), {
			doctype: DOCTYPE,
			fieldname: "items",
			rows: d.items,
			readOnly: ro,
			addLabel: "Add item",
			emptyText: "Add the items to request.",
			newRow: () => {
				// A request made from one contract keeps adding that contract's yarn
				const linked = contractsOf(d);
				return { warehouse: d.set_warehouse || "", schedule_date: d.schedule_date || "", weaving_contract_terry: linked.length === 1 ? linked[0] : "" };
			},
			columns: [
				{
					fieldname: "item_code",
					label: "Item",
					type: "link",
					doctype: "Item",
					reqd: 1,
					width: "170px",
					// Contract rows only offer that contract's yarn articles
					filters: (row) => {
						const yarn = d.contract_items?.[row.weaving_contract_terry];
						return yarn ? { name: ["in", yarn.length ? yarn : [""]] } : undefined;
					},
					onSelect: (row, value, item) => {
						row.item_name = item?.label || "";
						if (value) fetchItem(row, value);
					},
				},
				{ fieldname: "item_name", label: "Item Name", type: "static", width: "160px" },
				{ fieldname: "type", label: "Type", type: "static", width: "110px" },
				{ fieldname: "qty", label: "Qty", type: "number", reqd: 1, width: "100px" },
				{ fieldname: "uom", label: "UOM", type: "static", width: "70px" },
				{ fieldname: "bags", label: "Bags", type: "computed", width: "90px" },
				{ fieldname: "warehouse", label: "Warehouse", type: "link", doctype: "Warehouse", reqd: 1, width: "170px", filters: () => ({ is_group: 0, company: d.company }) },
				{ fieldname: "schedule_date", label: "Required By", type: "date", width: "140px" },
				{ fieldname: "weaving_contract_terry", label: "Contract", type: "static", width: "160px" },
			],
			totals: { qty: () => totals().qty, bags: () => totals().bags },
			onChange: () => {
				markDirty();
				renderAside();
			},
			onRowsChange: () => {
				markDirty();
				renderAside();
			},
		});
	}

	// Item name and UOM; on a contract row also Type, Qty and Bags from the contract's Yarn Details
	// (clubbed per Article + Type), taking the first type of that article not already requested
	async function fetchItem(row, itemCode) {
		const contract = row.weaving_contract_terry || null;
		try {
			const item = await api.get("tp.api.material_requests.get_item_details", { item_code: itemCode, contract });
			if (row.item_code !== itemCode) return;
			Object.assign(row, { item_name: item.item_name, uom: item.uom });
			if (contract) {
				const used = new Set(state.doc.items.filter((r) => r !== row && r.weaving_contract_terry === contract && r.item_code === itemCode).map((r) => r.type || ""));
				const yarn = item.yarn.find((y) => !used.has(y.type || "")) || item.yarn[0];
				Object.assign(row, { type: yarn.type, qty: yarn.qty, bags: yarn.bags });
				items.setRows(state.doc.items); // Qty is an input, which refresh() doesn't repaint
			} else {
				items.refresh();
			}
			renderAside();
		} catch (err) {
			showError(err, "Couldn't load item");
		}
	}

	/* ---------- Header & actions ---------- */
	const button = (action, label, iconName, cls = "btn--secondary") =>
		html`<button class="btn ${cls}" type="button" data-action="${action}">${icon(iconName)}<span class="hide-sm">${label}</span></button>`;

	function renderHeader() {
		const d = state.doc;
		const title = d.name || (d.amended_from ? `Amend ${d.amended_from}` : "New Material Request");
		$("[data-slot='title']", root).textContent = title;
		document.title = `${title} · Towel Production`;
		const crumb = $(".topbar .crumb--current");
		if (crumb) crumb.textContent = title;

		const sub = [d.material_request_type, d.customer_title || d.customer, d.modified && `Updated ${fmt.relative(d.modified)}`].filter(Boolean).join(" · ");
		$("[data-slot='subtitle']", root).textContent = sub;

		const status = $("[data-slot='status']", root);
		status.hidden = false;
		if (isNew()) {
			status.className = "pill pill--info";
			status.textContent = "Not saved";
		} else if (state.dirty) {
			status.className = "pill pill--warning";
			status.textContent = "Unsaved changes";
		} else {
			status.className = `pill ${statusTone(d.status)}`;
			status.textContent = d.status;
		}
		renderActions();
	}

	function renderActions() {
		const d = state.doc;
		const p = state.perms;
		const printUrl = `/printview?doctype=${encodeURIComponent(DOCTYPE)}&name=${encodeURIComponent(d.name)}&trigger_print=1`;
		const print = !isNew() && p.print ? html`<a class="btn btn--secondary" href="${printUrl}" target="_blank" rel="noopener">${icon("printer")}<span class="hide-sm">Print</span></a>` : "";
		const del = !isNew() && d.docstatus !== 1 && p.delete ? button("delete", "Delete", "trash", "btn--ghost btn--danger") : "";
		const dup = !isNew() && p.create ? button("duplicate", "Duplicate", "copy") : "";
		let main = "";

		if (d.docstatus === 0) {
			const canEdit = !readOnly();
			if (isNew() || state.dirty) {
				main = canEdit
					? html`${p.submit ? button("save-submit", "Save & Submit", "send") : ""}<button class="btn btn--primary" type="button" data-action="save" ${raw(state.busy ? "disabled" : "")}>${icon("save")}<span>Save</span><kbd class="kbd kbd--on-primary hide-sm">Ctrl S</kbd></button>`
					: "";
			} else if (p.submit) {
				main = button("submit", "Submit", "send", "btn--primary");
			}
		} else if (d.docstatus === 1) {
			const canStop = p.write && d.status !== "Stopped" && (d.per_ordered || 0) < 100;
			const canReopen = p.write && d.status === "Stopped";
			main = html`${p.cancel ? button("cancel", "Cancel", "ban", "btn--ghost btn--danger") : ""}
				${canStop ? button("stop", "Stop", "pause") : ""}
				${canReopen ? button("reopen", "Re-open", "play", "btn--primary") : ""}`;
		} else if (p.amend && p.create) {
			main = button("amend", "Amend", "copy", "btn--primary");
		}

		setHTML(actionsNode, html`${del}${dup}${print}${main}`);
		actionsNode.classList.toggle("is-busy", state.busy);
		actionsNode.querySelectorAll("button").forEach((b) => (b.disabled = state.busy));
	}

	function renderNotice() {
		const d = state.doc;
		let notice = "";
		if (isNew() && copyOf) {
			notice = html`<div class="alert alert--info">${icon("copy")}<div><strong>Copy of <a class="link" href="${BASE}/${encodeURIComponent(copyOf)}">${copyOf}</a>.</strong> A new draft with the same details and items. Check the dates and quantities, then save.</div></div>`;
		} else if (isNew() && contract && !d.items.length) {
			notice = html`<div class="alert">${icon("alert")}<div><strong><a class="link" href="/contracts/${encodeURIComponent(contract)}">${contract}</a> has no yarn yet.</strong> Add items below, or fill the contract's Yarn Details (Article and quantities) and create the Yarn Request again.</div></div>`;
		} else if (isNew() && contract) {
			notice = html`<div class="alert alert--info">${icon("info")}<div><strong>Yarn Request from <a class="link" href="/contracts/${encodeURIComponent(contract)}">${contract}</a>.</strong> Yarn Qty (Lbs) and Bags are combined per article and type. Check the quantities, add transport details and save.</div></div>`;
		} else if (d.docstatus === 1) {
			notice = html`<div class="alert alert--info">${icon("lock")}<div>This request is submitted and can no longer be edited. Cancel and amend it to make changes.</div></div>`;
		} else if (d.docstatus === 2) {
			notice = html`<div class="alert alert--danger">${icon("ban")}<div>This request is cancelled.${state.perms.amend ? " Amend it to create a corrected copy." : ""}</div></div>`;
		}
		setHTML($("[data-slot='notice']", formNode), notice);
	}

	/* ---------- Summary ---------- */
	function renderAside() {
		const d = state.doc;
		const t = totals();
		const contracts = contractsOf(d);
		const uoms = [...new Set(d.items.map((r) => r.uom).filter(Boolean))];
		const progress = d.docstatus === 1 ? PROGRESS[d.material_request_type] || [["per_ordered", "Completed"]] : [];

		setHTML(
			$("[data-slot='summary']", root),
			html`<div class="card summary">
				<div class="summary__head">
					<div class="summary__label">Total quantity</div>
					<div class="summary__total">${fmt.fixed(t.qty)}${uoms.length === 1 ? html` <span class="summary__unit">${uoms[0]}</span>` : ""}</div>
				</div>
				<dl class="summary__list">
					<div class="summary__row"><dt>Items</dt><dd>${d.items.length}</dd></div>
					<div class="summary__row"><dt>Bags</dt><dd>${fmt.fixed(t.bags)}</dd></div>
					<div class="summary__row"><dt>Required by</dt><dd>${d.schedule_date ? fmt.date(d.schedule_date) : "—"}</dd></div>
					<div class="summary__row"><dt>Warehouse</dt><dd class="summary__text">${d.set_warehouse || "—"}</dd></div>
				</dl>
				${progress.map(
					([field, label]) => html`<div class="summary__progress">
						<div class="rank__row">
							<span class="rank__name">${label}</span>
							<span class="rank__value">${Math.round(d[field] || 0)}%</span>
							<span class="rank__track"><span class="rank__fill" style="width:${Math.min(d[field] || 0, 100)}%"></span></span>
						</div>
					</div>`
				)}
			</div>
			<nav class="card card--flush section-nav" aria-label="Form sections">
				<a href="#details">${icon("clipboard-list")} Details</a>
				<a href="#transport">${icon("truck")} Transport</a>
				<a href="#items">${icon("package")} Items <span class="count">${d.items.length}</span></a>
			</nav>
			${contracts.length
				? html`<div class="card linked-card">
					<div class="linked-card__title">${icon("link")} Weaving contracts</div>
					<div class="linked-card__list">${contracts.map((c) => html`<a class="linked-chip" href="/contracts/${encodeURIComponent(c)}">${icon("file-text")} ${c}</a>`)}</div>
				</div>`
				: ""}
			${d.name
				? html`<div class="card meta-list">
					<div>Created <strong>${fmt.date(d.creation, { dateStyle: "medium" })}</strong> by <strong>${d.owner}</strong></div>
					<div>Last modified <strong>${fmt.relative(d.modified)}</strong> by <strong>${d.modified_by}</strong></div>
					${d.amended_from ? html`<div>Amended from <a class="link" href="${BASE}/${encodeURIComponent(d.amended_from)}">${d.amended_from}</a></div>` : ""}
				</div>`
				: ""}`
		);
	}

	function renderAll() {
		renderHeader();
		renderNotice();
		renderAside();
	}

	/* ---------- Lifecycle ---------- */
	function validate() {
		let ok = details.validate();
		if (!state.doc.items.length) {
			toast.error("Add at least one item");
			ok = false;
		} else if (items.validate()) {
			ok = false;
		}
		return ok;
	}

	function serialize() {
		const d = state.doc;
		const doc = { name: d.name, modified: d.modified, amended_from: d.amended_from };
		HEADER_FIELDS.forEach((f) => (doc[f] = d[f] ?? null));
		doc.items = d.items.map((r) => Object.fromEntries(ITEM_FIELDS.map((f) => [f, r[f] ?? null])));
		return doc;
	}

	function apply(result, message) {
		const wasNew = isNew();
		state.doc = result.doc;
		state.doc.items ||= [];
		state.perms = result.permissions || state.perms;
		state.dirty = false;
		if (wasNew && state.doc.name) history.replaceState(null, "", `${BASE}/${encodeURIComponent(state.doc.name)}`);
		buildForms();
		renderAll();
		if (message) toast.success(message, { text: state.doc.name });
	}

	async function run(task, errorTitle) {
		if (state.busy) return;
		state.busy = true;
		renderActions();
		try {
			await task();
		} catch (err) {
			showError(err, errorTitle);
		} finally {
			state.busy = false;
			renderActions();
		}
	}

	const save = ({ submit = false } = {}) => {
		if (readOnly() || !validate()) return;
		if (!isNew() && !state.dirty && !submit) return;
		return run(async () => {
			if (submit && !(await confirmSubmit())) return;
			const wasNew = isNew();
			const result = await api.post("tp.api.material_requests.save", { doc: serialize(), submit: submit ? 1 : 0 });
			apply(result, submit ? "Request submitted" : wasNew ? "Request created" : "Request saved");
		}, submit ? "Couldn't submit request" : "Couldn't save request");
	};

	const confirmSubmit = () =>
		confirm({
			title: "Submit this request?",
			text: "A submitted request can't be edited. You can still stop or cancel it later.",
			confirmLabel: "Submit request",
		});

	const lifecycle = {
		save: () => save(),
		"save-submit": () => save({ submit: true }),
		submit: () =>
			run(async () => {
				if (!(await confirmSubmit())) return;
				apply(await api.post("tp.api.material_requests.submit", { name: state.doc.name }), "Request submitted");
			}, "Couldn't submit request"),
		cancel: () =>
			run(async () => {
				const ok = await confirm({ title: "Cancel this request?", text: `${state.doc.name} will be cancelled. You can amend it afterwards to create a corrected copy.`, confirmLabel: "Cancel request", danger: true });
				if (ok) apply(await api.post("tp.api.material_requests.cancel", { name: state.doc.name }), "Request cancelled");
			}, "Couldn't cancel request"),
		stop: () =>
			run(async () => {
				const ok = await confirm({ title: "Stop this request?", text: "No further receipts or transfers will be made against it until it is re-opened.", confirmLabel: "Stop request", danger: true });
				if (ok) apply(await api.post("tp.api.material_requests.set_status", { name: state.doc.name, status: "Stopped" }), "Request stopped");
			}, "Couldn't stop request"),
		reopen: () => run(async () => apply(await api.post("tp.api.material_requests.set_status", { name: state.doc.name, status: "Submitted" }), "Request re-opened"), "Couldn't re-open request"),
		amend: () => (window.location.href = `${BASE}/new?amend=${encodeURIComponent(state.doc.name)}`),
		duplicate: () => {
			if (state.dirty) return toast.error("Save the request first", { text: "Duplicate copies the saved request." });
			window.location.href = `${BASE}/new?duplicate=${encodeURIComponent(state.doc.name)}`;
		},
		delete: () =>
			run(async () => {
				const ok = await confirm({ title: "Delete this request?", text: `${state.doc.name} and all its items will be permanently deleted.`, confirmLabel: "Delete request", danger: true });
				if (!ok) return;
				await api.post("tp.api.material_requests.delete", { name: state.doc.name });
				state.dirty = false;
				window.location.href = BASE;
			}, "Couldn't delete request"),
	};

	actionsNode.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-action]");
		if (btn && !btn.disabled) lifecycle[btn.dataset.action]?.();
	});
	document.addEventListener("keydown", (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			save();
		}
	});
	window.addEventListener("beforeunload", (e) => {
		if (state.dirty || (isNew() && state.source)) {
			e.preventDefault();
			e.returnValue = "";
		}
	});

	buildForms();
	renderAll();
	if (isNew() && !contract) details.inputs.material_request_type?.focus();
}

