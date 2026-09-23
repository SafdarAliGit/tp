from tp.portal import build_resource_context

no_cache = 1


def get_context(context):
	return build_resource_context(context, "colors")
