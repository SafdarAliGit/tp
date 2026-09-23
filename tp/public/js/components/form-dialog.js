/**
 * Small modal with a Form, for quick one-off inputs (rename, merge…).
 *
 *   const result = await formDialog({
 *     title: "Rename account", fields, values, confirmLabel: "Rename",
 *     submit: async (values) => api.post(...),   // throw to keep the dialog open
 *   });
 *   // → submit()'s return value, or null when cancelled
 */
import { html, icon, el } from "@tp/core/dom.js";
import { openOverlay } from "@tp/core/overlay.js";
import { showError } from "@tp/core/toast.js";
import { Form } from "@tp/components/form.js";

export function formDialog({ title, text = "", fields, values = {}, confirmLabel = "Save", danger = false, submit }) {
	return new Promise((resolve) => {
		const node = el(html`
			<div class="overlay">
				<form class="modal modal--form" role="dialog" aria-modal="true" aria-labelledby="dialog-title" novalidate>
					<header class="picker__header">
						<div>
							<h2 class="modal__title" id="dialog-title">${title}</h2>
							${text ? html`<p class="modal__text">${text}</p>` : ""}
						</div>
					</header>
					<div class="modal__form"></div>
					<div class="modal__footer">
						<button class="btn btn--secondary" type="button" data-cancel>Cancel</button>
						<button class="btn ${danger ? "btn--danger-solid" : "btn--primary"}" type="submit">${icon("check")} ${confirmLabel}</button>
					</div>
				</form>
			</div>
		`);
		const form = new Form(node.querySelector(".modal__form"), fields, { values, isNew: true });
		let result = null;
		const close = openOverlay(node, {
			initialFocus: ".modal__form input",
			onClose: () => {
				form.destroy();
				resolve(result);
			},
		});
		node.querySelector("[data-cancel]").addEventListener("click", () => close(false));
		node.querySelector("form").addEventListener("submit", async (e) => {
			e.preventDefault();
			if (!form.validate()) return;
			const button = node.querySelector("[type=submit]");
			button.classList.add("is-loading");
			button.disabled = true;
			try {
				result = await submit(form.values());
				close(true);
			} catch (err) {
				button.classList.remove("is-loading");
				button.disabled = false;
				showError(err, `Couldn't ${confirmLabel.toLowerCase()}`);
			}
		});
	});
}
