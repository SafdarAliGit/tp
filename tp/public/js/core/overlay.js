import { html, icon, el } from "@tp/core/dom.js";

/** Focus trap + Escape handling shared by modal, drawer and palette. */
export function openOverlay(node, { onClose, initialFocus } = {}) {
	const previous = document.activeElement;
	document.body.append(node);
	document.body.style.overflow = "hidden";

	const focusables = () =>
		[...node.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
			(n) => n.offsetParent !== null
		);

	let closed = false;
	const close = (result) => {
		if (closed) return;
		closed = true;
		node.classList.add("is-closing");
		document.removeEventListener("keydown", onKey, true);
		setTimeout(() => {
			node.remove();
			if (!document.querySelector(".overlay")) document.body.style.overflow = "";
			previous?.focus?.();
		}, 180);
		onClose?.(result);
	};

	const onKey = (e) => {
		// Stacked overlays (e.g. a quick entry opened from a drawer): only the top one reacts
		if ([...document.querySelectorAll(".overlay:not(.is-closing)")].pop() !== node) return;
		if (e.key === "Escape") {
			e.stopPropagation();
			close(false);
		} else if (e.key === "Tab") {
			const items = focusables();
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	};
	document.addEventListener("keydown", onKey, true);
	node.addEventListener("mousedown", (e) => {
		if (e.target === node) close(false);
	});

	requestAnimationFrame(() => (initialFocus ? node.querySelector(initialFocus) : focusables()[0])?.focus());
	return close;
}

/** await confirm({ title, text, confirmLabel, danger }) → boolean */
export function confirm({ title, text = "", confirmLabel = "Confirm", danger = false } = {}) {
	return new Promise((resolve) => {
		const node = el(html`
			<div class="overlay">
				<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
					<div class="modal__body">
						<div class="modal__icon ${danger ? "modal__icon--danger" : ""}">${icon(danger ? "trash" : "info")}</div>
						<div>
							<h2 class="modal__title" id="modal-title">${title}</h2>
							<p class="modal__text">${text}</p>
						</div>
					</div>
					<div class="modal__footer">
						<button class="btn btn--secondary" type="button" data-result="0">Cancel</button>
						<button class="btn ${danger ? "btn--danger-solid" : "btn--primary"}" type="button" data-result="1">${confirmLabel}</button>
					</div>
				</div>
			</div>
		`);
		const close = openOverlay(node, { onClose: resolve, initialFocus: "[data-result='0']" });
		node.querySelectorAll("[data-result]").forEach((btn) =>
			btn.addEventListener("click", () => close(btn.dataset.result === "1"))
		);
	});
}

/**
 * Side drawer. Returns { node, body, footer, close }.
 * `onBeforeClose` may return false to keep it open (e.g. unsaved changes).
 */
export function drawer({ title, subtitle = "", onClose }) {
	const node = el(html`
		<div class="overlay overlay--drawer">
			<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
				<header class="drawer__header">
					<div>
						<h2 class="drawer__title" id="drawer-title">${title}</h2>
						${subtitle ? html`<p class="page-sub">${subtitle}</p>` : ""}
					</div>
					<button class="icon-btn" type="button" data-close aria-label="Close">${icon("x")}</button>
				</header>
				<div class="drawer__body"></div>
				<footer class="drawer__footer"></footer>
			</section>
		</div>
	`);
	const close = openOverlay(node, { initialFocus: ".drawer__body input:not([readonly]), .drawer__body select", onClose });
	node.querySelector("[data-close]").addEventListener("click", () => close(false));
	return {
		node,
		body: node.querySelector(".drawer__body"),
		footer: node.querySelector(".drawer__footer"),
		close,
	};
}
