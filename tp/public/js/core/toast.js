import { html, icon, el } from "@tp/core/dom.js";

const ICONS = { success: "check-circle", danger: "alert", info: "info" };

/** toast("Saved", { type: "success", text: "Contract WCT-0001" }) */
export function toast(title, { type = "info", text = "", timeout = 4000 } = {}) {
	const root = document.getElementById("toasts");
	if (!root) return;
	const node = el(html`
		<div class="toast toast--${type}" role="${type === "danger" ? "alert" : "status"}">
			<span class="toast__icon">${icon(ICONS[type] || "info")}</span>
			<div class="toast__body">
				<div class="toast__title">${title}</div>
				${text ? html`<div class="toast__text">${text}</div>` : ""}
			</div>
			<button class="icon-btn icon-btn--sm" type="button" aria-label="Dismiss">${icon("x", "i--sm")}</button>
		</div>
	`);
	const close = () => {
		node.classList.add("is-leaving");
		node.addEventListener("animationend", () => node.remove(), { once: true });
	};
	node.querySelector("button").addEventListener("click", close);
	root.append(node);
	if (timeout) setTimeout(close, type === "danger" ? timeout * 2 : timeout);
}

toast.success = (title, opts) => toast(title, { ...opts, type: "success" });
toast.error = (title, opts) => toast(title, { ...opts, type: "danger" });

/** Show an ApiError (or any error) as a toast. */
export function showError(err, title = "Something went wrong") {
	if (err?.name === "AbortError") return;
	toast.error(title, { text: err?.message || String(err) });
}
