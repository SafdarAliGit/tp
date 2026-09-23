from tp.portal import build_context

no_cache = 1


def get_context(context):
	return build_context(context, "contracts")
