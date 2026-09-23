/** Locale-aware formatting helpers. */

const settings = { currency: null };

export function configureFormat({ currency } = {}) {
	if (currency) settings.currency = currency;
}

export const flt = (value, precision) => {
	const n = parseFloat(value);
	if (!Number.isFinite(n)) return 0;
	return precision === undefined ? n : Math.round(n * 10 ** precision) / 10 ** precision;
};

export function number(value, digits = 2) {
	return new Intl.NumberFormat(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
	}).format(flt(value));
}

export function fixed(value, digits = 2) {
	return new Intl.NumberFormat(undefined, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(flt(value));
}

export function compact(value) {
	return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(flt(value));
}

export function currency(value, { compact: isCompact = false } = {}) {
	const code = settings.currency;
	const options = isCompact
		? { notation: "compact", maximumFractionDigits: 1 }
		: { minimumFractionDigits: 2, maximumFractionDigits: 2 };
	if (!code) return new Intl.NumberFormat(undefined, options).format(flt(value));
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency: code, ...options }).format(flt(value));
	} catch {
		return `${code} ${new Intl.NumberFormat(undefined, options).format(flt(value))}`;
	}
}

const parseDate = (value) => {
	if (!value) return null;
	const [datePart, timePart] = String(value).split(" ");
	const [y, m, d] = datePart.split("-").map(Number);
	if (!y) return null;
	if (!timePart) return new Date(y, m - 1, d);
	const [hh, mm, ss] = timePart.split(":").map(parseFloat);
	return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
};

export function date(value, opts = { day: "2-digit", month: "short", year: "numeric" }) {
	const d = parseDate(value);
	return d ? new Intl.DateTimeFormat(undefined, opts).format(d) : "";
}

export function relative(value) {
	const d = parseDate(value);
	if (!d) return "";
	const seconds = Math.round((d.getTime() - Date.now()) / 1000);
	const units = [
		["year", 31536000],
		["month", 2592000],
		["week", 604800],
		["day", 86400],
		["hour", 3600],
		["minute", 60],
	];
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
	}
	return "just now";
}

export function monthLabel(key, style = "short") {
	const [y, m] = key.split("-").map(Number);
	return new Intl.DateTimeFormat(undefined, { month: style }).format(new Date(y, m - 1, 1));
}
