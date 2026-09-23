import frappe

from tp.access import get_navigation


@frappe.whitelist(methods=["GET"])
def me() -> dict:
	"""Current user profile and navigation (for clients that need to refresh the shell)."""
	user = frappe.get_cached_doc("User", frappe.session.user)
	return {
		"user": user.name,
		"full_name": user.full_name,
		"email": user.email,
		"user_image": user.user_image,
		"navigation": get_navigation(),
	}
