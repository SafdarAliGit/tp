/** Small DOM helpers. `html` escapes interpolations by default; wrap trusted markup in `raw()`. */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
	constructor(value) {
		this.value = value;
	}
	toString() {
		return this.value;
	}
}

export const raw = (value) => new Raw(value);

const render = (value) => {
	if (value instanceof Raw) return value.value;
	if (Array.isArray(value)) return value.map(render).join("");
	if (value === false || value === null || value === undefined) return "";
	return esc(value);
};

/** Tagged template: html`<p>${userText}</p>` → Raw (safe to nest). */
export function html(strings, ...values) {
	let out = strings[0];
	values.forEach((value, i) => {
		out += render(value) + strings[i + 1];
	});
	return raw(out);
}

export const icon = (name, cls = "") =>
	raw(`<svg class="i ${esc(cls)}" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Create an element from an html`` result (or string). */
export function el(markup) {
	const template = document.createElement("template");
	template.innerHTML = String(markup).trim();
	return template.content.firstElementChild;
}

export function setHTML(node, markup) {
	node.innerHTML = String(markup);
	return node;
}

export function debounce(fn, wait = 250) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), wait);
	};
}

export function boot() {
	try {
		return JSON.parse(document.getElementById("tp-boot")?.textContent || "{}");
	} catch {
		return {};
	}
}

export const storage = {
	get(key, fallback = null) {
		try {
			const value = localStorage.getItem(key);
			return value === null ? fallback : value;
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			if (value === null || value === undefined) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			/* storage unavailable */
		}
	},
};
