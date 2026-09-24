/**
 * Collapsible form sections, like ERPNext's: click a section header (or its chevron) to fold it.
 * Which sections are folded is remembered per form in this browser. Links to a section
 * (the form's section nav, `#id`) unfold it first.
 *
 *   collapsibleSections(formNode, "contract");   // every `.form-section` inside formNode
 */
import { html, icon, el, storage } from "@tp/core/dom.js";

export function collapsibleSections(root, key) {
	const storeKey = `tp-sections-${key}`;
	let folded;
	try {
		folded = new Set(JSON.parse(storage.get(storeKey)) || []);
	} catch {
		folded = new Set();
	}
	const save = () => storage.set(storeKey, folded.size ? JSON.stringify([...folded]) : null);

	const apply = (section) => {
		const isFolded = folded.has(section.id);
		section.classList.toggle("is-collapsed", isFolded);
		section.querySelector(".section-toggle")?.setAttribute("aria-expanded", String(!isFolded));
	};
	const toggle = (section, open = folded.has(section.id)) => {
		if (open) folded.delete(section.id);
		else folded.add(section.id);
		save();
		apply(section);
	};

	for (const section of root.querySelectorAll(".form-section[id]")) {
		const header = section.querySelector(".card__header");
		if (!header || header.querySelector(".section-toggle")) continue;
		const title = header.querySelector(".card__title")?.textContent.trim().split("\n")[0] || "section";
		const button = el(html`<button class="icon-btn icon-btn--sm section-toggle" type="button" aria-label="Show or hide ${title}" title="Collapse / expand">${icon("chevron-down", "i--sm")}</button>`);
		header.append(button);
		header.classList.add("is-toggle");
		// The whole header toggles, except its own buttons and links (grid actions, "Add"…)
		header.addEventListener("click", (e) => {
			if (e.target.closest("button, a, input, select, label") && !e.target.closest(".section-toggle")) return;
			toggle(section);
		});
		apply(section);
	}

	const open = (id) => {
		const section = id && root.querySelector(`#${CSS.escape(id)}.form-section`);
		if (section && folded.has(id)) toggle(section, true);
	};
	// Jumping to a section opens it
	document.addEventListener("click", (e) => {
		const link = e.target.closest('a[href^="#"]');
		if (link) open(link.getAttribute("href").slice(1));
	});

	return { open };
}
