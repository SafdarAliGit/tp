/**
 * Weaving Contract Terry form: details, product grid, yarn grid, construction and a live summary.
 */
import { api } from "@tp/core/api.js";
import { $, html, icon, boot, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { confirm } from "@tp/core/overlay.js";
import { toast, showError } from "@tp/core/toast.js";
import { Form } from "@tp/components/form.js";
import { EditableGrid } from "@tp/components/grid.js";
import { recalculate } from "@tp/lib/contract-calc.js";

const DOCTYPE = "Weaving Contract Terry";

const detailFields = (meta, isNew) => [
	...(isNew && meta.naming_series.length > 1
		? [{ fieldname: "naming_series", label: "Series", fieldtype: "Select", options: meta.naming_series.join("\n"), reqd: 1, default: meta.naming_series[0] }]
		: []),
	{ fieldname: "buyers_name", label: "Buyer", fieldtype: "Link", options: "Customer", reqd: 1, placeholder: "Select buyer" },
	{ fieldname: "po_no", label: "PO No", fieldtype: "Data" },
	{ fieldname: "ct_no", label: "CT No", fieldtype: "Data" },
	{ fieldname: "allowance_percent", label: "Allowance %", fieldtype: "Percent" },
	{ fieldname: "po_start_date", label: "PO Start Date", fieldtype: "Date" },
	{ fieldname: "po_end_date", label: "PO End Date", fieldtype: "Date" },
	{ fieldname: "remarks", label: "Remarks", fieldtype: "Small Text" },
];

const constructionFields = (meta) => [
	{ fieldname: "reed", label: "Reed", fieldtype: "Data" },
	{ fieldname: "pick_on_loom", label: "Pick on Loom", fieldtype: "Data" },
	{ fieldname: "end_pile", label: "End Pile", fieldtype: "Data" },
	{ fieldname: "end_ground", label: "End Ground", fieldtype: "Data" },
	{ fieldname: "stitch_type", label: "Stitch Type", fieldtype: "Select", options: ["", ...meta.stitch_type].join("\n") },
	{ fieldname: "cam_border", label: "Cam Border", fieldtype: "Data" },
	{ fieldname: "fancy_size", label: "Fancy Size", fieldtype: "Data" },
	{ fieldname: "cut_pana", label: "Cut Pana", fieldtype: "Data" },
	{ fieldname: "ribbon_type", label: "Ribbon Type", fieldtype: "Data" },
	{ fieldname: "pile_to_pile", label: "Pile To Pile", fieldtype: "Data" },
	{ fieldname: "no_of_loom", label: "No of Loom", fieldtype: "Int" },
	{ fieldname: "per_day_production", label: "Per Day Production", fieldtype: "Data" },
	{ fieldname: "in_date", label: "In Date", fieldtype: "Date" },
	{ fieldname: "out_date", label: "Out Date", fieldtype: "Date" },
];

const section = (id, iconName, title, sub) => html`
	<section class="card form-section" id="${id}">
		<header class="card__header">
			<div class="card__title"><span class="card__title-icon">${icon(iconName)}</span><div>${title}<div class="card__sub">${sub}</div></div></div>
		</header>
		<div data-body></div>
	</section>`;

export async function mountContractForm() {
	const { contract: name, permissions } = boot();
	const root = $("[data-slot='contract']");
	const formNode = $("[data-slot='form']", root);

	let meta;
	let doc;
	try {
		[meta, doc] = await Promise.all([
			api.get("tp.api.contracts.get_meta"),
			name ? api.get("tp.api.contracts.get", { name }).then((r) => r.doc) : Promise.resolve(null),
		]);
	} catch (err) {
		showError(err, "Couldn't open contract");
		setHTML(formNode, html`<div class="card state"><div class="state__icon state__icon--danger">${icon("alert")}</div><h3 class="state__title">Contract unavailable</h3><p class="state__text">${err.message}</p><a class="btn btn--secondary" href="/contracts">${icon("arrow-left")} Back to contracts</a></div>`);
		return;
	}

	const perms = meta.permissions || permissions;
	const state = { doc: doc || { product_detail: [], yarn_details: [] }, dirty: false, saving: false };
	const isNew = () => !state.doc.name;
	const readOnly = () => (isNew() ? !perms.create : !perms.write);

	setHTML(
		formNode,
		html`
		${section("details", "file-text", "Contract details", "Buyer, purchase order and dates")}
		${section("products", "package", "Products", "Articles, weights, quantities and rates")}
		${section("yarn", "spool", "Yarn details", "Yarn requirement per article and color")}
		${section("construction", "layers", "Construction", "Loom and weaving specification")}`
	);
	const body = (id) => $(`#${id} [data-body]`, formNode);

	let details, construction, products, yarn;

	function markDirty() {
		if (!state.dirty) {
			state.dirty = true;
			renderHeader();
		}
	}

	function onCalc() {
		recalculate(state.doc);
		products.refresh();
		yarn.refresh();
		renderSummary();
		markDirty();
	}

	function buildForms() {
		[details, construction, products, yarn].forEach((c) => c?.destroy?.());
		const d = state.doc;
		const ro = readOnly();

		details = new Form(body("details"), detailFields(meta, isNew()), {
			values: d,
			isNew: isNew(),
			disabled: ro,
			onChange: (field, value) => {
				d[field] = value;
				if (field === "buyers_name") d.buyer_title = details.links.buyers_name?.label;
				markDirty();
			},
		});
		if (d.buyer_title) details.links.buyers_name?.set(d.buyers_name, d.buyer_title);
		if (isNew()) Object.assign(d, { ...details.values(), ...d });

		construction = new Form(body("construction"), constructionFields(meta), {
			values: d,
			isNew: isNew(),
			disabled: ro,
			onChange: (field, value) => {
				d[field] = value;
				markDirty();
			},
		});

		products = new EditableGrid(body("products"), {
			rows: d.product_detail,
			readOnly: ro,
			addLabel: "Add product",
			emptyText: "Add the articles for this contract.",
			newRow: () => ({ greige_weight_percent: d.product_detail.at(-1)?.greige_weight_percent ?? "" }),
			columns: [
				{ fieldname: "article", label: "Article", type: "link", doctype: "Item", reqd: 1, width: "180px", filters: () => ({ item_group: "Products" }) },
				{ fieldname: "color", label: "Color", type: "link", doctype: "Color", reqd: 1, width: "140px" },
				{ fieldname: "finish_weight", label: "Finish Wt", type: "number", width: "100px" },
				{ fieldname: "greige_weight_percent", label: "Greige %", type: "number", width: "90px" },
				{ fieldname: "greige_quality_weight", label: "Greige Qlty Wt", type: "computed", width: "120px", precision: 3 },
				{ fieldname: "qty_pcs", label: "Qty (Pcs)", type: "number", width: "100px" },
				{ fieldname: "weight_kg", label: "Weight (Kg)", type: "computed", width: "110px" },
				{ fieldname: "lbs", label: "Lbs", type: "computed", width: "110px" },
				{ fieldname: "rate", label: "Rate", type: "number", width: "100px" },
				{ fieldname: "amount", label: "Amount", type: "computed", width: "120px" },
			],
			totals: {
				qty_pcs: () => d.total_item_qty,
				weight_kg: () => d.total_kg,
				lbs: () => d.total_lbs,
				amount: () => d.total_amount,
			},
			onChange: onCalc,
			onRowsChange: () => {
				onCalc();
				renderAside();
			},
		});

		yarn = new EditableGrid(body("yarn"), {
			rows: d.yarn_details,
			readOnly: ro,
			addLabel: "Add yarn",
			emptyText: "Add yarn for each article and color, or generate rows from products.",
			columns: [
				{
					fieldname: "article",
					label: "Article",
					type: "link",
					doctype: "Item",
					reqd: 1,
					width: "180px",
					filters: () => ({ name: ["in", [...new Set(d.product_detail.map((p) => p.article).filter(Boolean))].concat([""])] }),
				},
				{ fieldname: "color", label: "Color", type: "link", doctype: "Color", reqd: 1, width: "140px" },
				{ fieldname: "article_weight", label: "Article Wt", type: "computed", width: "110px" },
				{ fieldname: "yarn_count", label: "Yarn Count", type: "link", doctype: "Item", width: "160px", filters: () => ({ item_group: "Yarn" }) },
				{ fieldname: "type", label: "Type", type: "select", options: meta.yarn_type, width: "110px" },
				{ fieldname: "ratio_percent", label: "Ratio %", type: "number", width: "90px" },
				{ fieldname: "wastage_percent", label: "Wastage %", type: "number", width: "100px" },
				{ fieldname: "yarn_qty_lbs", label: "Yarn Qty (Lbs)", type: "computed", width: "120px" },
				{ fieldname: "bags", label: "Bags", type: "computed", width: "90px" },
			],
			totals: {
				yarn_qty_lbs: () => d.total_yarn_qty_lbs,
				bags: () => d.total_bags,
			},
			onChange: onCalc,
			onRowsChange: () => {
				onCalc();
				renderAside();
			},
		});

		if (!ro) {
			const extra = $("[data-grid-extra]", body("yarn"));
			extra.innerHTML = String(html`<button class="btn btn--ghost btn--sm" type="button">${icon("copy")} Generate from products</button>`);
			extra.querySelector("button").addEventListener("click", generateYarnRows);
		}

		recalculate(d);
		products.refresh();
		yarn.refresh();
	}

	function generateYarnRows() {
		const d = state.doc;
		const existing = new Set(d.yarn_details.map((y) => `${y.article}|${y.color}`));
		const missing = d.product_detail.filter((p) => p.article && p.color && !existing.has(`${p.article}|${p.color}`));
		const unique = [...new Map(missing.map((p) => [`${p.article}|${p.color}`, p])).values()];
		if (!unique.length) {
			toast("Nothing to add", { text: "Every product article and color already has a yarn row." });
			return;
		}
		unique.forEach((p) => d.yarn_details.push({ article: p.article, color: p.color }));
		yarn.setRows(d.yarn_details);
		onCalc();
		renderAside();
		toast.success(`${unique.length} yarn row${unique.length === 1 ? "" : "s"} added`);
	}

	/* ---------- Header, summary & actions ---------- */
	function renderHeader() {
		const d = state.doc;
		$("[data-slot='title']", root).textContent = d.name || "New Contract";
		document.title = `${d.name || "New Contract"} · Towel Production`;
		const crumb = $(".topbar .crumb--current");
		if (crumb) crumb.textContent = d.name || "New Contract";

		const sub = [d.buyer_title || d.buyers_name, d.modified && `Updated ${fmt.relative(d.modified)}`].filter(Boolean).join(" · ");
		$("[data-slot='subtitle']", root).textContent = sub || "Fill in the details and save to create the contract";

		const status = $("[data-slot='status']", root);
		status.hidden = false;
		if (isNew()) {
			status.className = "pill pill--info";
			status.textContent = "Not saved";
		} else if (state.dirty) {
			status.className = "pill pill--warning";
			status.textContent = "Unsaved changes";
		} else {
			status.className = "pill pill--success";
			status.textContent = "Saved";
		}

		const save = $("[data-action='save']", root);
		save.hidden = readOnly();
		save.disabled = state.saving || (!state.dirty && !isNew());
		$("[data-action='delete']", root).hidden = isNew() || !perms.delete;
		const print = $("[data-action='print']", root);
		print.hidden = isNew() || !perms.print;
		if (!isNew()) print.href = `/printview?doctype=${encodeURIComponent(DOCTYPE)}&name=${encodeURIComponent(d.name)}&trigger_print=1`;
	}

	function renderSummary() {
		const d = state.doc;
		const node = $("[data-summary]", root);
		if (!node) return;
		setHTML(
			node,
			html`<div class="summary__head">
				<div class="summary__label">Contract value</div>
				<div class="summary__total">${fmt.currency(d.total_amount)}</div>
			</div>
			<dl class="summary__list">
				<div class="summary__row"><dt>Pieces</dt><dd>${fmt.number(d.total_item_qty, 0)}</dd></div>
				<div class="summary__row"><dt>Weight</dt><dd>${fmt.fixed(d.total_kg)} kg</dd></div>
				<div class="summary__row"><dt>Greige lbs</dt><dd>${fmt.fixed(d.total_lbs)}</dd></div>
				<div class="summary__row"><dt>Yarn required</dt><dd>${fmt.fixed(d.total_yarn_qty_lbs)} lbs</dd></div>
				<div class="summary__row"><dt>Yarn bags</dt><dd>${fmt.fixed(d.total_bags)}</dd></div>
			</dl>`
		);
	}

	function renderAside() {
		const d = state.doc;
		setHTML(
			$("[data-slot='summary']", root),
			html`<div class="card summary" data-summary></div>
			<nav class="card card--flush section-nav" aria-label="Form sections">
				<a href="#details">${icon("file-text")} Details</a>
				<a href="#products">${icon("package")} Products <span class="count">${d.product_detail.length}</span></a>
				<a href="#yarn">${icon("spool")} Yarn details <span class="count">${d.yarn_details.length}</span></a>
				<a href="#construction">${icon("layers")} Construction</a>
			</nav>
			${d.name
				? html`<div class="card meta-list">
					<div>Created <strong>${fmt.date(d.creation, { dateStyle: "medium" })}</strong> by <strong>${d.owner}</strong></div>
					<div>Last modified <strong>${fmt.relative(d.modified)}</strong> by <strong>${d.modified_by}</strong></div>
				</div>`
				: ""}`
		);
		renderSummary();
	}

	function validate() {
		const d = state.doc;
		let ok = details.validate();
		if (!d.product_detail.length) {
			toast.error("Add at least one product");
			return false;
		}
		const productProblems = products.validate();
		const yarnProblems = yarn.validate();
		if (productProblems || yarnProblems) {
			toast.error("Some rows are incomplete", { text: "Article and Color are required in every row." });
			ok = false;
		}
		if (d.po_start_date && d.po_end_date && d.po_end_date < d.po_start_date) {
			details.setError("po_end_date", "PO end date can't be before the start date");
			ok = false;
		}
		return ok;
	}

	const serialize = () => {
		const clean = (rows) => rows.map(({ _key, ...row }) => row);
		const d = state.doc;
		return { ...d, product_detail: clean(d.product_detail), yarn_details: clean(d.yarn_details) };
	};

	async function save() {
		if (state.saving || readOnly() || !validate()) return;
		state.saving = true;
		const button = $("[data-action='save']", root);
		button.classList.add("is-loading");
		renderHeader();
		try {
			const wasNew = isNew();
			const result = await api.post("tp.api.contracts.save", { doc: serialize() });
			state.doc = result.doc;
			state.dirty = false;
			if (wasNew) history.replaceState(null, "", `/contracts/${encodeURIComponent(result.doc.name)}`);
			buildForms();
			renderAside();
			toast.success(wasNew ? "Contract created" : "Contract saved", { text: result.doc.name });
		} catch (err) {
			showError(err, "Couldn't save contract");
		} finally {
			state.saving = false;
			button.classList.remove("is-loading");
			renderHeader();
		}
	}

	async function remove() {
		const ok = await confirm({
			title: "Delete this contract?",
			text: `${state.doc.name} and all its product and yarn rows will be permanently deleted.`,
			confirmLabel: "Delete contract",
			danger: true,
		});
		if (!ok) return;
		try {
			await api.post("tp.api.contracts.delete", { name: state.doc.name });
			state.dirty = false;
			window.location.href = "/contracts";
		} catch (err) {
			showError(err, "Couldn't delete contract");
		}
	}

	$("[data-action='save']", root).addEventListener("click", save);
	$("[data-action='delete']", root).addEventListener("click", remove);
	document.addEventListener("keydown", (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			save();
		}
	});
	window.addEventListener("beforeunload", (e) => {
		if (state.dirty) {
			e.preventDefault();
			e.returnValue = "";
		}
	});

	buildForms();
	renderAside();
	renderHeader();
	if (isNew()) details.inputs.buyers_name?.focus();
}
