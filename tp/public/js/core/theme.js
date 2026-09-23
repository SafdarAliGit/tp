import { storage } from "@tp/core/dom.js";

const KEY = "tp-theme";

export function currentTheme() {
	const saved = document.documentElement.getAttribute("data-theme");
	if (saved) return saved;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme() {
	const next = currentTheme() === "dark" ? "light" : "dark";
	document.documentElement.setAttribute("data-theme", next);
	storage.set(KEY, next);
	return next;
}

export function bindThemeToggles(root = document) {
	root.querySelectorAll("[data-action='theme']").forEach((btn) => btn.addEventListener("click", toggleTheme));
}
