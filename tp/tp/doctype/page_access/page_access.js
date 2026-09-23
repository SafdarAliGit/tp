// Copyright (c) 2026, Safdar Ali and contributors
// For license information, please see license.txt

frappe.ui.form.on("Page Access", {
	refresh(frm) {
		if (!frm.is_new() && frm.doc.route) {
			frm.add_web_link(frm.doc.route, __("Open Page"));
		}
	},
});
