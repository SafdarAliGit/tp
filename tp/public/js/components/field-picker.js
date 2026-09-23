/**
 * Popup for choosing which fields a form shows.
 *
 *   const picked = await pickFields({ title, fields, selected, defaults });
 *   // → array of fieldnames, or null when cancelled
 *
 * Fields flagged `locked` (required) are always ticked and can't be removed.
 */
import { html, icon, el, raw } from "@tp/core/dom.js";
import { openOverlay } from "@tp/core/overlay.js";

export function pickFields({ title = "Form fields", fields, selected, defaults }) {
	return new Promise((resolve) => {
		const chosen = new Set(selected);
		const groups = [];
		for (const f of fields) {
			const name = f.standard ? "Default fields" : f.section;
			let group = groups.find((g) => g.name === name);
			if (!group) groups.push((group = { name, fields: [] }));
			group.fields.push(f);
		}

		const node = el(html`
			<div class="overlay">
				<div class="modal modal--picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
					<header class="picker__header">
						<div>
							<h2 class="modal__title" id="picker-title">${title}</h2>
							<p class="modal__text">Choose the fields shown in the form. Required fields are always shown.</p>
						</div>
						<button class="icon-btn" type="button" data-result="cancel" aria-label="Close">${icon("x")}</button>
					</header>
					<div class="picker__search">
						<label class="search-field">
							${icon("search")}
							<input type="search" placeholder="Search fields…" aria-label="Search fields" data-slot="filter">
						</label>
					</div>
					<div class="picker__list" data-slot="list">
						${groups.map((g) => html`
							<section class="picker__group">
								<h3 class="picker__heading">${g.name}</h3>
								${g.fields.map((f) => html`
									<label class="check picker__item" data-name="${`${f.label} ${f.fieldname}`.toLowerCase()}">
										<input type="checkbox" value="${f.fieldname}" ${raw(f.locked || chosen.has(f.fieldname) ? "checked" : "")} ${raw(f.locked ? "disabled" : "")}>
										<span class="picker__label">${f.label}${f.reqd ? html`<span class="req">*</span>` : ""}</span>
										${f.locked ? html`<span class="badge badge--neutral">Required</span>` : ""}
										<span class="picker__type">${f.fieldtype}</span>
									</label>`)}
							</section>`)}
						<p class="picker__empty" data-slot="empty" hidden>No fields match your search.</p>
					</div>
					<footer class="modal__footer">
						<button class="btn btn--ghost" type="button" data-result="reset">Reset to default</button>
						<span class="spacer"></span>
						<button class="btn btn--secondary" type="button" data-result="cancel">Cancel</button>
						<button class="btn btn--primary" type="button" data-result="apply">${icon("check")} Apply</button>
					</footer>
				</div>
			</div>
		`);

		const list = node.querySelector("[data-slot='list']");
		const close = openOverlay(node, { onClose: (result) => resolve(result || null), initialFocus: "[data-slot='filter']" });

		node.querySelector("[data-slot='filter']").addEventListener("input", (e) => {
			const q = e.target.value.trim().toLowerCase();
			let any = false;
			list.querySelectorAll(".picker__group").forEach((group) => {
				let visible = 0;
				group.querySelectorAll(".picker__item").forEach((item) => {
					item.hidden = Boolean(q) && !item.dataset.name.includes(q);
					if (!item.hidden) visible++;
				});
				group.hidden = !visible;
				any ||= visible > 0;
			});
			node.querySelector("[data-slot='empty']").hidden = any;
		});

		node.querySelectorAll("[data-result]").forEach((btn) =>
			btn.addEventListener("click", () => {
				const action = btn.dataset.result;
				if (action === "reset") {
					const initial = new Set(defaults);
					list.querySelectorAll("input:not(:disabled)").forEach((input) => (input.checked = initial.has(input.value)));
				} else if (action === "apply") {
					close([...list.querySelectorAll("input:checked")].map((input) => input.value));
				} else {
					close(null);
				}
			})
		);
	});
}
