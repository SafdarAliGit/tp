/**
 * Floating action menu anchored to a button or a pointer position (context menu).
 *
 *   openMenu(buttonOrEvent, [
 *     { label: "Edit", icon: "pencil", run: () => {} },
 *     { sep: true },
 *     { label: "Delete", icon: "trash", danger: true, run },
 *     { label: "Open in Desk", icon: "external", href: "/desk/..." },
 *   ]);
 */
import { html, icon, el } from "@tp/core/dom.js";

let current = null;

export function closeMenu() {
	current?.();
	current = null;
}

export function openMenu(anchor, items) {
	closeMenu();
	const entries = items.filter(Boolean);
	const node = el(html`
		<div class="menu__panel popover-menu" role="menu">
			${entries.map((item, i) =>
				item.sep
					? html`<div class="menu__sep" role="separator"></div>`
					: item.href
						? html`<a class="menu__item" role="menuitem" href="${item.href}" ${item.newTab ? html`target="_blank" rel="noopener"` : ""} data-index="${i}">${icon(item.icon || "arrow-right")}${item.label}</a>`
						: html`<button class="menu__item ${item.danger ? "menu__item--danger" : ""}" role="menuitem" type="button" data-index="${i}">${icon(item.icon || "circle")}${item.label}</button>`
			)}
		</div>
	`);
	document.body.append(node);

	// Position: below the anchor button, or at the pointer for context menus
	const rect = anchor instanceof Event ? { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY } : anchor.getBoundingClientRect();
	const { offsetWidth: w, offsetHeight: h } = node;
	const left = anchor instanceof Event ? rect.left : rect.right - w;
	const top = rect.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 4) : rect.bottom + 4;
	node.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
	node.style.top = `${top}px`;

	const previous = document.activeElement;
	const menuItems = () => [...node.querySelectorAll(".menu__item")];
	const close = (restoreFocus = true) => {
		node.remove();
		document.removeEventListener("mousedown", onOutside, true);
		document.removeEventListener("keydown", onKey, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", onScroll);
		if (restoreFocus) previous?.focus?.({ preventScroll: true });
	};
	const onOutside = (e) => {
		if (!node.contains(e.target)) closeMenu();
	};
	const onScroll = (e) => {
		if (!node.contains(e.target)) closeMenu();
	};
	const onKey = (e) => {
		const list = menuItems();
		const index = list.indexOf(document.activeElement);
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			closeMenu();
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const step = e.key === "ArrowDown" ? 1 : -1;
			list[(index + step + list.length) % list.length]?.focus();
		} else if (e.key === "Tab") {
			closeMenu();
		}
	};

	node.addEventListener("click", (e) => {
		const target = e.target.closest("[data-index]");
		if (!target) return;
		const item = entries[+target.dataset.index];
		if (item.href) {
			close(false);
			current = null;
			return;
		}
		close();
		current = null;
		item.run?.();
	});
	document.addEventListener("mousedown", onOutside, true);
	document.addEventListener("keydown", onKey, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onScroll);
	current = close;
	menuItems()[0]?.focus({ preventScroll: true });
}
