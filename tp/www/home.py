from tp.access import get_doctype_permissions, has_page_access
from tp.portal import build_context

no_cache = 1


def get_context(context):
	can_create_contract = (
		has_page_access("contracts") and get_doctype_permissions("Weaving Contract Terry")["create"]
	)
	context.can_create_contract = can_create_contract
	return build_context(context, "home")
