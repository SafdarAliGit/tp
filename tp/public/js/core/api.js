/**
 * Thin client for Frappe whitelisted methods.
 *
 *   import { api } from "@tp/core/api.js";
 *   const data = await api.get("tp.api.contracts.get", { name });
 *   await api.post("tp.api.contracts.save", { doc });
 *
 * Errors are thrown as ApiError with a readable `message` taken from Frappe's response.
 */

export class ApiError extends Error {
	constructor(message, { status, type, data } = {}) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.type = type;
		this.data = data;
	}
}

const stripHtml = (html) => {
	const div = document.createElement("div");
	div.innerHTML = html;
	return (div.textContent || "").trim();
};

function extractMessage(body, status) {
	if (body?._server_messages) {
		try {
			const messages = JSON.parse(body._server_messages).map((m) => {
				const parsed = typeof m === "string" ? JSON.parse(m) : m;
				return stripHtml(parsed.message || "");
			});
			const text = messages.filter(Boolean).join("\n");
			if (text) return text;
		} catch {
			/* fall through */
		}
	}
	if (body?.message && typeof body.message === "string") return stripHtml(body.message);
	if (body?.exception) return stripHtml(String(body.exception).split(":").slice(1).join(":") || body.exception);
	if (status === 403) return "You do not have permission to do that.";
	if (status === 404) return "The requested record was not found.";
	if (status === 417) return "Please check the highlighted values.";
	if (status >= 500) return "Something went wrong on the server. Please try again.";
	return "Request failed. Please try again.";
}

function loggedIn() {
	const match = document.cookie.match(/(?:^|;\s*)user_id=([^;]*)/);
	const user = match ? decodeURIComponent(match[1]) : "";
	return Boolean(user) && user !== "Guest";
}

function toQuery(args) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(args || {})) {
		if (value === undefined || value === null || value === "") continue;
		params.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
	}
	return params.toString();
}

export async function call(method, args = {}, { httpMethod = "POST", signal } = {}) {
	let url = `/api/method/${method}`;
	const init = {
		method: httpMethod,
		credentials: "same-origin",
		signal,
		headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
	};

	if (httpMethod === "GET") {
		const qs = toQuery(args);
		if (qs) url += `?${qs}`;
	} else {
		init.headers["Content-Type"] = "application/json";
		init.headers["X-Frappe-CSRF-Token"] = window.frappe?.csrf_token || "";
		init.body = JSON.stringify(args);
	}

	let response;
	try {
		response = await fetch(url, init);
	} catch (err) {
		if (err.name === "AbortError") throw err;
		throw new ApiError("Can't reach the server. Check your connection.", { status: 0 });
	}

	let body = {};
	try {
		body = await response.json();
	} catch {
		/* non-JSON response */
	}

	if (!response.ok || body.exc_type || body.exception) {
		const sessionExpired = response.status === 403 && (/Session/.test(body.exc_type || "") || !loggedIn());
		if (sessionExpired) {
			window.location.href = `/login?redirect-to=${encodeURIComponent(location.pathname + location.search)}`;
		}
		throw new ApiError(extractMessage(body, response.status), {
			status: response.status,
			type: body.exc_type,
			data: body,
		});
	}
	return body.message;
}

export const api = {
	call,
	get: (method, args, opts) => call(method, args, { ...opts, httpMethod: "GET" }),
	post: (method, args, opts) => call(method, args, { ...opts, httpMethod: "POST" }),
};
