import { api } from "@tp/core/api.js";
import { $, html, icon, raw, setHTML } from "@tp/core/dom.js";
import * as fmt from "@tp/core/format.js";
import { showError } from "@tp/core/toast.js";
import { DataTable } from "@tp/components/data-table.js";

const QUICK_LINKS = {
	items: { label: "Items", href: "/items", icon: "package" },
	customers: { label: "Customers", href: "/customers", icon: "users" },
	colors: { label: "Colors", href: "/colors", icon: "palette" },
};

function greeting() {
	const h = new Date().getHours();
	return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const kpi = ({ label, value, unit = "", foot, iconName, hero = false }) => html`
	<div class="kpi ${hero ? "kpi--hero" : ""}">
		<div class="kpi__head"><span>${label}</span><span class="kpi__icon">${icon(iconName)}</span></div>
		<div class="kpi__value">${value}${unit ? html`<span class="kpi__unit">${unit}</span>` : ""}</div>
		<div class="kpi__foot">${foot}</div>
	</div>`;

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10^n. */
function niceMax(value) {
	if (value <= 0) return 1;
	const exp = 10 ** Math.floor(Math.log10(value));
	const f = value / exp;
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function renderTrendChart(node, trend) {
	const max = niceMax(Math.max(...trend.map((t) => t.amount)));
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
	setHTML(
		node,
		html`<div class="chart">
			<div class="chart__plot">
				<div class="chart__grid">
					${ticks.map((t) => html`<div class="chart__gridline ${t === 0 ? "chart__baseline" : ""}" style="bottom:${(t / max) * 100}%"><span>${fmt.currency(t, { compact: true })}</span></div>`)}
				</div>
				<div class="chart__bars">
					${trend.map(
						(t, i) => html`<div class="chart__col ${t.amount ? "" : "is-empty"}" tabindex="0" data-index="${i}"
							aria-label="${fmt.monthLabel(t.month, "long")}: ${fmt.currency(t.amount)}, ${t.contracts} contracts">
							<div class="chart__bar" style="height:${(t.amount / max) * 100}%"></div>
						</div>`
					)}
				</div>
			</div>
			<div class="chart__x" aria-hidden="true">${trend.map((t) => html`<span>${fmt.monthLabel(t.month)}</span>`)}</div>
		</div>`
	);

	const plot = $(".chart__plot", node);
	let tip;
	const show = (col) => {
		const t = trend[+col.dataset.index];
		tip?.remove();
		tip = document.createElement("div");
		tip.className = "chart__tip";
		tip.innerHTML = String(html`
			<div class="chart__tip-title">${fmt.monthLabel(t.month, "long")} ${t.month.slice(0, 4)}</div>
			<div class="chart__tip-row"><span>Value</span><strong>${fmt.currency(t.amount)}</strong></div>
			<div class="chart__tip-row"><span>Pieces</span><strong>${fmt.number(t.pcs, 0)}</strong></div>
			<div class="chart__tip-row"><span>Contracts</span><strong>${t.contracts}</strong></div>`);
		plot.append(tip);
		const colRect = col.getBoundingClientRect();
		const plotRect = plot.getBoundingClientRect();
		const bar = $(".chart__bar", col).getBoundingClientRect();
		const half = tip.offsetWidth / 2;
		const x = Math.min(Math.max(colRect.left - plotRect.left + colRect.width / 2, half - 56), plotRect.width - half);
		tip.style.left = `${x}px`;
		tip.style.top = `${Math.max(bar.top - plotRect.top, tip.offsetHeight + 10)}px`;
	};
	const hide = () => tip?.remove();
	plot.addEventListener("mouseover", (e) => e.target.closest(".chart__col") && show(e.target.closest(".chart__col")));
	plot.addEventListener("mouseleave", hide);
	plot.addEventListener("focusin", (e) => e.target.closest(".chart__col") && show(e.target.closest(".chart__col")));
	plot.addEventListener("focusout", hide);
}

function renderTopBuyers(buyers) {
	if (!buyers.length) return html`<p class="muted">No contracts yet.</p>`;
	const max = Math.max(...buyers.map((b) => b.amount)) || 1;
	return html`<ol class="rank">
		${buyers.map(
			(b) => html`<li class="rank__row">
				<span class="rank__name" title="${b.buyer_title}">${b.buyer_title || b.buyers_name}</span>
				<span class="rank__value">${fmt.currency(b.amount, { compact: true })}</span>
				<span class="rank__track"><span class="rank__fill" style="width:${Math.max((b.amount / max) * 100, 2)}%"></span></span>
				<span class="rank__meta">${b.contracts} contract${b.contracts === 1 ? "" : "s"}</span>
			</li>`
		)}
	</ol>`;
}

export async function mountDashboard() {
	$("[data-slot='today']").textContent = fmt.date(new Date().toISOString().slice(0, 10), {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	const nameNode = $("[data-slot='greeting']");
	nameNode.textContent = nameNode.textContent.replace("Welcome", greeting());

	const root = $("[data-slot='dashboard']");
	let data;
	try {
		data = await api.get("tp.api.dashboard.get_summary");
	} catch (err) {
		showError(err, "Couldn't load the dashboard");
		setHTML(root, html`<div class="card state"><div class="state__icon state__icon--danger">${icon("alert")}</div><h3 class="state__title">Dashboard unavailable</h3><p class="state__text">${err.message}</p></div>`);
		return;
	}

	const c = data.contracts;
	const links = Object.entries(data.counts).map(([key, value]) => ({ ...QUICK_LINKS[key], value }));
	const quickLinks = links.length
		? html`<div class="quick-links">
				${links.map(
					(l) => html`<a class="quick-link" href="${l.href}">
						<span class="quick-link__icon">${icon(l.icon, "i--lg")}</span>
						<span><span class="quick-link__label">${l.label}</span><br><span class="quick-link__value">${fmt.number(l.value, 0)}</span></span>
						${icon("arrow-up-right", "arrow")}
					</a>`
				)}
			</div>`
		: "";

	if (!c) {
		setHTML(
			root,
			links.length
				? quickLinks
				: html`<div class="card state"><div class="state__icon">${icon("layers")}</div><h3 class="state__title">Nothing to show yet</h3><p class="state__text">Pages shared with you will appear in the sidebar.</p></div>`
		);
		return;
	}

	fmt.configureFormat({ currency: c.currency });
	const t = c.totals;
	setHTML(
		root,
		html`
		<div class="kpis">
			${kpi({ label: "Contract value", value: fmt.currency(t.amount, { compact: true }), foot: `${fmt.number(t.contracts, 0)} contract${t.contracts === 1 ? "" : "s"} in total`, iconName: "coins", hero: true })}
			${kpi({ label: "Pieces ordered", value: fmt.compact(t.pcs), unit: "pcs", foot: `${t.this_month} new contract${t.this_month === 1 ? "" : "s"} this month`, iconName: "layers" })}
			${kpi({ label: "Greige weight", value: fmt.compact(t.lbs), unit: "lbs", foot: `≈ ${fmt.compact(t.lbs / 2.2046)} kg`, iconName: "scale" })}
			${kpi({ label: "Yarn required", value: fmt.number(t.bags, 1), unit: "bags", foot: `${t.active} active contract${t.active === 1 ? "" : "s"}`, iconName: "spool" })}
		</div>

		<div class="grid-2-1">
			<section class="card">
				<header class="card__header">
					<div class="card__title"><span class="card__title-icon">${icon("activity")}</span>
						<div>Contract value by month<div class="card__sub">By PO start date, last 12 months</div></div>
					</div>
				</header>
				<div data-slot="trend"></div>
			</section>
			<section class="card">
				<header class="card__header">
					<div class="card__title"><span class="card__title-icon">${icon("users")}</span>
						<div>Top buyers<div class="card__sub">By total contract value</div></div>
					</div>
				</header>
				${renderTopBuyers(c.top_buyers)}
			</section>
		</div>

		<section class="card card--flush">
			<header class="card__header" style="padding:var(--sp-5) var(--sp-6) 0">
				<div class="card__title"><span class="card__title-icon">${icon("file-text")}</span>Recent contracts</div>
				<a class="btn btn--ghost btn--sm" href="/contracts">View all ${icon("arrow-right")}</a>
			</header>
			<div data-slot="recent"></div>
		</section>

		${quickLinks}`
	);

	renderTrendChart($("[data-slot='trend']", root), c.trend);

	const table = new DataTable($("[data-slot='recent']", root), {
		columns: [
			{ key: "name", label: "Contract", type: "title", sub: "po_no" },
			{ key: "buyer_title", label: "Buyer" },
			{ key: "po_start_date", label: "PO Start", type: "date" },
			{ key: "po_end_date", label: "PO End", type: "date" },
			{ key: "total_item_qty", label: "Pieces", type: "number" },
			{ key: "total_amount", label: "Amount", type: "currency" },
		],
		onRowClick: (row) => (window.location.href = `/contracts/${encodeURIComponent(row.name)}`),
		empty: {
			icon: "file-text",
			title: "No contracts yet",
			text: "Create your first weaving contract to see it here.",
			action: raw(`<a class="btn btn--primary" href="/contracts/new">${icon("plus")} New Contract</a>`),
		},
	});
	table.update({ rows: c.recent, total: c.recent.length });
	$(".table-footer", root)?.remove();
}
