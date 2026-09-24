/**
 * Pill tone for a document status, shared by every page that lists ERPNext documents.
 *
 *   html`<span class="pill ${statusTone(doc.status)}">${doc.status}</span>`
 */
export function statusTone(status) {
	if (["Cancelled", "Stopped", "Closed", "Rejected", "Expired"].includes(status)) return "pill--danger";
	if (status === "Draft" || !status) return "";
	if (/^(Pending|Partially|To |Overdue|Unpaid|On Hold)/.test(status)) return "pill--warning";
	if (["Submitted", "Ordered", "Received", "Transferred", "Issued", "Completed", "Paid", "Delivered"].includes(status)) return "pill--success";
	return "pill--info";
}
