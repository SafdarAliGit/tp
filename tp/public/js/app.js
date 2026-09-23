/**
 * Application shell behaviour, loaded on every portal page:
 * sidebar (collapse on desktop, drawer on mobile), user menu, theme, sign-out,
 * Ctrl/Cmd+K command palette and tooltips for the collapsed sidebar.
 */
import { api } from "@tp/core/api.js";
import { $, $$, html, icon, el, boot, storage } from "@tp/core/dom.js";
import { configureFormat } from "@tp/core/format.js";
import { openOverlay } from "@tp/core/overlay.js";
import { bindThemeToggles } from "@tp/core/theme.js";
import { showError } from "@tp/core/toast.js";

const root = document.documentElement;
const data = boot();
configureFormat({ currency: data.currency });

/* ---------- Sidebar ---------- */
const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

function setSidebarOpen(open) {
	root.classList.toggle("sidebar-open", open);
	$("[data-action='open-sidebar']")?.setAttribute("aria-expanded", String(open));
	document.body.style.overflow = open ? "hidden" : "";
}

document.addEventListener("click", (e) => {
	const action = e.target.closest("[data-action]")?.dataset.action;
	if (action === "collapse") {
		const collapsed = root.classList.toggle("sidebar-collapsed");
		storage.set("tp-sidebar", collapsed ? "collapsed" : null);
	} else if (action === "open-sidebar") {
		setSidebarOpen(true);
	} else if (action === "close-sidebar") {
		setSidebarOpen(false);
	} else if (action === "logout") {
		logout();
	} else if (action === "palette") {
		openPalette();
	}
});

window.addEventListener("resize", () => {
	if (isDesktop() && root.classList.contains("sidebar-open")) setSidebarOpen(false);
});

/* ---------- Dropdown menus ---------- */
$$("[data-menu]").forEach((menu) => {
	const trigger = $("[data-menu-trigger]", menu);
	const setOpen = (open) => {
		menu.classList.toggle("is-open", open);
		trigger.setAttribute("aria-expanded", String(open));
		if (open) $(".menu__item", menu)?.focus();
	};
	trigger.addEventListener("click", (e) => {
		e.stopPropagation();
		setOpen(!menu.classList.contains("is-open"));
	});
	document.addEventListener("click", (e) => {
		if (!menu.contains(e.target)) setOpen(false);
	});
	menu.addEventListener("keydown", (e) => {
		const items = $$(".menu__item", menu);
		const index = items.indexOf(document.activeElement);
		if (e.key === "Escape") {
			setOpen(false);
			trigger.focus();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			items[(index + 1) % items.length]?.focus();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			items[(index - 1 + items.length) % items.length]?.focus();
		}
	});
});

bindThemeToggles();

async function logout() {
	try {
		await api.post("logout");
	} catch (err) {
		showError(err, "Couldn't sign out");
		return;
	}
	window.location.href = "/login";
}

/* ---------- Tooltips (collapsed sidebar) ---------- */
let tip;
document.addEventListener("mouseover", (e) => {
	const target = e.target.closest(".sidebar [data-tooltip]");
	if (!target || !root.classList.contains("sidebar-collapsed") || !isDesktop()) return;
	const rect = target.getBoundingClientRect();
	tip?.remove();
	tip = el(html`<div class="tooltip" role="tooltip">${target.dataset.tooltip}</div>`);
	document.body.append(tip);
	tip.style.left = `${rect.right + 10}px`;
	tip.style.top = `${rect.top + rect.height / 2 - tip.offsetHeight / 2}px`;
	target.addEventListener("mouseleave", () => tip?.remove(), { once: true });
});

/* ---------- Command palette ---------- */
function paletteItems() {
	const items = $$("#nav .nav__item[href]").map((a) => ({
		group: "Go to",
		label: a.querySelector(".sidebar__label")?.textContent.trim() || a.dataset.tooltip,
		href: a.getAttribute("href"),
		icon: a.querySelector("use")?.getAttribute("href")?.replace("#i-", "") || "arrow-right",
	}));
	const actions = [];
	if ($("#nav [data-page='contracts']")) actions.push({ group: "Create", label: "New Weaving Contract", href: "/contracts/new", icon: "plus" });
	actions.push({ group: "Account", label: "Toggle theme", run: () => $("[data-action='theme']")?.click(), icon: "moon" });
	actions.push({ group: "Account", label: "Sign out", run: logout, icon: "log-out" });
	return [...items, ...actions];
}

function openPalette() {
	if ($(".palette")) return;
	const all = paletteItems();
	const node = el(html`
		<div class="overlay">
			<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
				<div class="palette__input">
					${icon("search")}
					<input type="text" placeholder="Search pages and actions…" aria-label="Search" role="combobox"
						aria-expanded="true" aria-controls="palette-list" autocomplete="off">
					<kbd class="kbd">Esc</kbd>
				</div>
				<ul class="palette__list" id="palette-list" role="listbox"></ul>
			</div>
		</div>
	`);
	const input = $("input", node);
	const list = $("ul", node);
	let results = all;
	let active = 0;

	const draw = () => {
		let lastGroup = null;
		list.innerHTML = results.length
			? results
					.map((item, i) => {
						const header = item.group !== lastGroup ? html`<li class="palette__group" role="presentation">${item.group}</li>` : "";
						lastGroup = item.group;
						return html`${header}<li class="palette__item" role="option" data-index="${i}" aria-selected="${i === active}">
							${icon(item.icon)}<span>${item.label}</span>${i === active ? html`<span class="hint">↵</span>` : ""}
						</li>`;
					})
					.join("")
			: `<li class="combo__empty">No results</li>`;
		$("[aria-selected='true']", list)?.scrollIntoView({ block: "nearest" });
	};

	const run = (item) => {
		if (!item) return;
		close(true);
		if (item.href) window.location.href = item.href;
		else item.run?.();
	};

	input.addEventListener("input", () => {
		const q = input.value.trim().toLowerCase();
		results = all.filter((item) => item.label.toLowerCase().includes(q));
		active = 0;
		draw();
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(results.length, 1);
			draw();
		} else if (e.key === "Enter") {
			e.preventDefault();
			run(results[active]);
		}
	});
	list.addEventListener("click", (e) => run(results[+e.target.closest("[data-index]")?.dataset.index]));

	draw();
	const close = openOverlay(node, { initialFocus: "input" });
}

document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
		e.preventDefault();
		openPalette();
	}
});
