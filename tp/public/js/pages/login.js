import { api } from "@tp/core/api.js";
import { $, boot, debounce, icon } from "@tp/core/dom.js";
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

/* Weave the loom: the shuttle carries each pick across the warp, alternating direction,
   then the cloth holds for a moment and unravels before the next run. */
function animateLoom() {
	const loom = $(".loom");
	if (!loom || !loom.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const picks = [...loom.querySelectorAll(".loom__pick")];
	const shuttle = $(".loom__shuttle", loom);
	const pickMs = 700;
	const holdMs = 2200;
	const fadeMs = 600;
	const cycle = picks.length * pickMs + holdMs + fadeMs;
	const at = (ms) => ms / cycle;

	picks.forEach((pick, i) => {
		const start = at(i * pickMs);
		const end = at((i + 1) * pickMs);
		const fade = at(cycle - fadeMs);
		pick.animate(
			[
				{ offset: 0, transform: "scaleX(0)", opacity: 1 },
				...(start > 0 ? [{ offset: start, transform: "scaleX(0)", opacity: 1 }] : []),
				{ offset: end, transform: "scaleX(1)", opacity: 1 },
				{ offset: fade, transform: "scaleX(1)", opacity: 1 },
				{ offset: 1, transform: "scaleX(1)", opacity: 0 },
			],
			{ duration: cycle, iterations: Infinity, delay: 900 },
		);
	});

	const cloth = $(".loom__cloth", loom);
	let shuttleAnim;
	const runShuttle = () => {
		const travel = cloth.clientWidth - shuttle.offsetWidth;
		if (travel <= 0) return;
		const x0 = cloth.offsetLeft;
		const frames = [];
		picks.forEach((pick, i) => {
			const y = cloth.offsetTop + pick.offsetTop + (pick.offsetHeight - shuttle.offsetHeight) / 2;
			const [from, to] = i % 2 ? [x0 + travel, x0] : [x0, x0 + travel];
			frames.push(
				{ offset: at(i * pickMs), transform: `translate(${from}px, ${y}px)`, opacity: 1 },
				{ offset: at((i + 1) * pickMs) - 0.001, transform: `translate(${to}px, ${y}px)`, opacity: 1 },
			);
		});
		const last = frames[frames.length - 1];
		frames.push({ ...last, offset: at(picks.length * pickMs), opacity: 0 }, { ...last, offset: 1, opacity: 0 });
		const time = picks[0].getAnimations()[0]?.currentTime ?? 0;
		shuttleAnim?.cancel();
		shuttleAnim = shuttle.animate(frames, { duration: cycle, iterations: Infinity, delay: 900 });
		shuttleAnim.currentTime = time;
	};
	// Measure once the loom has a size, and again whenever it changes
	new ResizeObserver(debounce(runShuttle, 100)).observe(cloth);
}

export function mountLogin() {
	const { redirect_to: redirectTo = "/" } = boot();
	const loginForm = $("#login-form");
	const forgotForm = $("#forgot-form");
	const error = $("[data-slot='error']", loginForm);

	bindThemeToggles();
	animateLoom();

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

	const caps = $("[data-slot='caps']", loginForm);
	const updateCaps = (e) => {
		if (e.getModifierState) caps.hidden = !e.getModifierState("CapsLock");
	};
	loginForm.elements.pwd.addEventListener("keydown", updateCaps);
	loginForm.elements.pwd.addEventListener("keyup", updateCaps);
	loginForm.elements.pwd.addEventListener("blur", () => (caps.hidden = true));

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
