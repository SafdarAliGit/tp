import { api } from "@tp/core/api.js";
import { $, boot, icon } from "@tp/core/dom.js";
import { bindThemeToggles } from "@tp/core/theme.js";

function setLoading(button, loading) {
	button.disabled = loading;
	button.classList.toggle("is-loading", loading);
}

function showAlert(node, message, type = "danger") {
	node.className = `alert alert--${type}`;
	node.innerHTML = `${icon(type === "success" ? "check-circle" : "alert")}<span></span>`;
	node.querySelector("span").textContent = message;
	node.hidden = false;
}

export function mountLogin() {
	const { redirect_to: redirectTo = "/" } = boot();
	const loginForm = $("#login-form");
	const forgotForm = $("#forgot-form");
	const error = $("[data-slot='error']", loginForm);

	bindThemeToggles();

	const showView = (view) => {
		loginForm.hidden = view !== "login";
		forgotForm.hidden = view !== "forgot";
		$("input", view === "login" ? loginForm : forgotForm).focus();
	};
	document.addEventListener("click", (e) => {
		const action = e.target.closest("[data-action]")?.dataset.action;
		if (action === "show-forgot") {
			forgotForm.elements.user.value = loginForm.elements.usr.value.includes("@") ? loginForm.elements.usr.value : "";
			showView("forgot");
		} else if (action === "show-login") {
			showView("login");
		} else if (action === "toggle-password") {
			const input = loginForm.elements.pwd;
			const show = input.type === "password";
			input.type = show ? "text" : "password";
			const btn = e.target.closest("button");
			btn.innerHTML = String(icon(show ? "eye-off" : "eye"));
			btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
		}
	});

	loginForm.addEventListener("submit", async (e) => {
		e.preventDefault();
		const usr = loginForm.elements.usr.value.trim();
		const pwd = loginForm.elements.pwd.value;
		if (!usr || !pwd) {
			showAlert(error, "Enter your email and password.");
			(usr ? loginForm.elements.pwd : loginForm.elements.usr).focus();
			return;
		}

		const button = $("button[type=submit]", loginForm);
		setLoading(button, true);
		error.hidden = true;
		try {
			const response = await fetch("/api/method/login", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ usr, pwd }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message =
					response.status === 401
						? "Incorrect email or password."
						: response.status === 429
							? "Too many attempts. Please wait a minute and try again."
							: body.message || "Sign in failed. Please try again.";
				throw new Error(message);
			}
			if (body.verification) {
				throw new Error("Two-factor authentication is not supported by this portal yet. Please contact your administrator.");
			}
			button.querySelector(".btn__label").textContent = "Signing in…";
			window.location.href = redirectTo || "/";
		} catch (err) {
			setLoading(button, false);
			showAlert(error, err.message);
			loginForm.elements.pwd.select();
		}
	});

	forgotForm.addEventListener("submit", async (e) => {
		e.preventDefault();
		const message = $("[data-slot='message']", forgotForm);
		const user = forgotForm.elements.user.value.trim();
		if (!user) {
			showAlert(message, "Enter the email you sign in with.");
			return;
		}
		const button = $("button[type=submit]", forgotForm);
		setLoading(button, true);
		try {
			await api.post("frappe.core.doctype.user.user.reset_password", { user });
			showAlert(message, "If an account exists for that email, a reset link is on its way.", "success");
		} catch (err) {
			showAlert(message, err.message);
		} finally {
			setLoading(button, false);
		}
	});
}
