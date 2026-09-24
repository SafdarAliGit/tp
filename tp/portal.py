"""Shared context for portal pages in `tp/www`.

Each www page calls `build_context(context, "<page key>")`: guests are sent to /login,
users without access get the shell with an access-denied view (HTTP 403).
"""

import json
import os
from functools import cache
from urllib.parse import quote

import frappe
from frappe import _
from frappe.sessions import get_csrf_token

from tp.access import (
	get_doctype_permissions,
	get_link_routes,
	get_navigation,
	get_page,
	has_page_access,
)

APP_NAME = "Towel Production"


PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")


def _asset_url(path: str) -> str:
	"""/assets/tp/<path>?v=<mtime> so browsers refetch a file only when it changes."""
	try:
		version = int(os.path.getmtime(os.path.join(PUBLIC_DIR, path)))
	except OSError:
		version = 0
	return f"/assets/tp/{path}?v={version}"


@cache
def _import_map_cached() -> str:
	return _build_import_map()


def _build_import_map() -> str:
	"""Maps "@tp/<module>.js" to a versioned URL for every file in public/js."""
	js_dir = os.path.join(PUBLIC_DIR, "js")
	imports = {}
	for root, _dirs, files in os.walk(js_dir):
		for file in files:
			if file.endswith(".js"):
				rel = os.path.relpath(os.path.join(root, file), js_dir).replace(os.sep, "/")
				imports[f"@tp/{rel}"] = _asset_url(f"js/{rel}")
	return json.dumps({"imports": imports}, indent=None)


def asset_url(path: str) -> str:
	return _asset_url(path) if frappe.conf.developer_mode else _cached_asset_url(path)


@cache
def _cached_asset_url(path: str) -> str:
	return _asset_url(path)


def import_map() -> str:
	return _build_import_map() if frappe.conf.developer_mode else _import_map_cached()


def script_json(data) -> str:
	"""JSON safe to embed inside <script type="application/json">."""
	return json.dumps(data, default=str).replace("<", "\\u003c")


def base_context(context):
	"""Context shared by every portal template, including the login page."""
	context.app_name = APP_NAME
	context.asset = asset_url
	context.import_map = import_map()
	return context


def redirect_to_login():
	path = frappe.local.request.full_path.rstrip("?") if frappe.local.request else "/"
	frappe.local.flags.redirect_location = (
		"/login" if path in ("/", "/home") else "/login?redirect-to=" + quote(path)
	)
	raise frappe.Redirect(302)


def _initials(name: str) -> str:
	parts = [p for p in (name or "").split() if p]
	return "".join(p[0] for p in parts[:2]).upper() or "?"


def build_context(context, page: str, **boot):
	if frappe.session.user == "Guest":
		redirect_to_login()

	context.no_cache = 1
	context.no_breadcrumbs = 1
	# Frappe creates the CSRF token lazily; make sure it exists so API calls from the page validate
	get_csrf_token()
	definition = get_page(page) or frappe._dict(page=page, title=page.title())
	allowed = has_page_access(page)

	user = frappe.get_cached_doc("User", frappe.session.user)
	roles = frappe.get_roles()

	base_context(context)
	context.page = definition
	context.title = _(definition.title)
	context.access_denied = not allowed
	context.navigation = get_navigation()
	context.user_info = frappe._dict(
		name=user.name,
		full_name=user.full_name or user.name,
		email=user.email,
		image=user.user_image,
		initials=_initials(user.full_name or user.name),
		desk_access=user.user_type == "System User",
		is_admin=user.name == "Administrator" or "System Manager" in roles,
	)

	if not allowed:
		context.http_status_code = 403
		boot = {}

	context.boot_json = script_json(
		{
			"page": page,
			"user": {"name": user.name, "full_name": context.user_info.full_name},
			"permissions": get_doctype_permissions(definition.get("reference_doctype")),
			"currency": frappe.defaults.get_global_default("currency"),
			"number_format": frappe.db.get_default("number_format") or "#,###.##",
			"link_routes": get_link_routes() if allowed else {},
			"desk": context.user_info.desk_access,
			**boot,
		}
	)
	return context


def set_home_page():
	"""`before_request` hook: serve the portal dashboard (tp/www/home.html) at `/` for everyone,
	overriding role/workspace home pages. Desk routes keep Frappe's behaviour."""
	request = getattr(frappe.local, "request", None)
	path = request.path if request else ""
	if not (path.startswith("/desk") or path.startswith("/app")):
		frappe.local.flags.home_page = "home"


def resource_boot(key: str) -> dict:
	"""Boot data for the generic list + drawer UI of a resource (tp/config/resources.py)."""
	from tp.api.resources import form_fields
	from tp.config.resources import RESOURCES

	config = RESOURCES[key]
	return {
		"key": key,
		"singular": config["singular"],
		"title_field": config["title_field"],
		"tabs": [
			{"key": t["key"], "label": t["label"], "filters": t["filters"]} for t in config.get("tabs", ())
		],
		"order_by": config.get("order_by", "modified desc"),
		"list_fields": config["list_fields"],
		"form_fields": form_fields(config),
	}


def build_resource_context(context, key: str):
	"""Context for a master-data page declared in tp/config/resources.py."""
	from tp.config.resources import RESOURCES

	config = RESOURCES[key]
	context.resource_key = key
	context.singular = config["singular"]
	return build_context(context, config["page"], resource=resource_boot(key))
