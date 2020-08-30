load("@bazel_skylib//lib:paths.bzl", "paths")
load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary")
load("//tools/internal/typescript:index.bzl", "ts_library")

load("@build_bazel_rules_svelte//:providers.bzl", "SvelteComponentInfo")
load("@build_bazel_rules_nodejs//:providers.bzl", "JSEcmaScriptModuleInfo", "JSModuleInfo", "JSNamedModuleInfo", "NodeContextInfo", "NpmPackageInfo", "DeclarationInfo", "node_modules_aspect", "run_node", "js_ecma_script_module_info")


ForestLayoutInfo = provider(fields=['layouts', 'sources'])

def forest_layout_info(
    layouts,
    provider_tranches = [
        [ForestLayoutInfo, SvelteComponentInfo, JSEcmaScriptModuleInfo],
        [NpmPackageInfo],
    ],
    deps = [],
):
    """Constructs a ForestLayoutInfo including all transitive sources from ForestLayoutInfo providers in a list of deps.
Returns a single ForestLayoutInfo.
"""
    transitive_depsets = [
        depset(layout.values())
        for layout in layouts.values()
    ]

    for dep in deps:
        for provider_tranche in provider_tranches:
            for provider in provider_tranche:
                if provider in dep:
                    transitive_depsets.append(dep[provider].sources)
                    break

    return ForestLayoutInfo(
        layouts = layouts,
        sources = depset(transitive = transitive_depsets),
    )

def _should_exclude(exclude_suffixes, path):
    for suffix in exclude_suffixes:
        if path.endswith(suffix):
            return True
    return False

def _get_layout(layouts, tree):
    if tree not in layouts:
        layouts[tree] = {}
    return layouts[tree]

def _add_to_layout(ctx, layouts, strip_prefix_tranches, tree, files, exclude_suffixes = [], prefix = "", prefixes = {}):
    layout = _get_layout(layouts, tree)
    _prefix = prefixes.get(tree, "") + prefix

    for file in files:
        short_path = file.short_path
        for strip_prefix_tranche in strip_prefix_tranches:
            for strip_prefix in strip_prefix_tranche:
                if short_path.startswith(strip_prefix):
                    short_path = short_path[len(strip_prefix):]
                    break

        if _should_exclude(exclude_suffixes, short_path):
            continue

        short_path = _prefix + short_path
        if short_path in layout:
            fail("conflict for {short_path} between {file1} and {file2}".format(
                short_path = short_path,
                file1 = layout[short_path],
                file2 = file,
            ))
        else:
            layout[short_path] = file
        # print("_add_to_layout", ctx.label, short_path, file)

def _forest_layout_impl(ctx):
    msg = "forest_layout\n"
    msg += "  name: " + str(ctx.label) + "\n"
    if ctx.attr.deps:
        msg += "  deps: " + "\n"
        for dep in ctx.attr.deps:
            msg += "    " + str(dep.label) + "\n"
    if ctx.attr.srcs:
        msg += "  srcs:" + "\n"
        for file in ctx.attr.srcs:
            msg += "    " + str(file) + "\n"
    if ctx.attr.mapped_srcs:
        msg += "  mapped_srcs:" + "\n"
        for prefix, file in ctx.attr.mapped_srcs.items():
            msg += "    " + str(prefix) + ": " + str(file) + "\n"
    # print(msg)

    layouts = {}
    prefixes = {
        ctx.attr.tree: ctx.attr.prefix,
    }

    fallback_providers = [
        {
            "provider": SvelteComponentInfo,
            "tree": "routes",
            "attr": "sources",
        },
        {
            "provider": JSEcmaScriptModuleInfo,
            "tree": "routes",
            "attr": "sources",
        },
        # {
        #     "provider": DefaultInfo,
        #     "tree": "static",
        #     "attr": "files",
        # },
    ]

    for dep in ctx.attr.deps:
        if ForestLayoutInfo in dep:
            dep_layouts = dep[ForestLayoutInfo].layouts
            for tree, dep_layout in dep_layouts.items():
                layout = _get_layout(layouts, tree)
                prefix = prefixes.get(tree, "")
                for short_path, file in dep_layout.items():
                    short_path = prefix + short_path
                    if short_path in layout:
                        fail("conflict for " + short_path + " between " + str(layout[short_path]) + " and " + str(file))
                    layout[short_path] = file
                    # print("forest dep", ctx.label, short_path, file)

    for target in ctx.attr.srcs:
        _add_to_layout(ctx, 
            layouts = layouts,
            prefixes = prefixes,
            strip_prefix_tranches = [
                [ctx.label.package + "/"],
                [ctx.attr.strip_prefix] if ctx.attr.strip_prefix else [],
            ],
            tree = ctx.attr.tree,
            files = target.files.to_list(),
            exclude_suffixes = ctx.attr.exclude_suffixes,
        )

    for target, mapped_to in ctx.attr.mapped_srcs.items():
        if mapped_to.endswith('/'):
            _add_to_layout(ctx, 
                layouts = layouts,
                prefixes = prefixes,
                strip_prefix_tranches = [
                    [target.label.package + "/"],
                ],
                exclude_suffixes = ctx.attr.exclude_suffixes,
                prefix = mapped_to,
                tree = ctx.attr.tree,
                files = target.files.to_list(),
            )
        else:
            target_files = target.files.to_list()
            tree = ctx.attr.tree
            layout = _get_layout(layouts, tree)
            if len(target_files) != 1:
                fail("Can't remap multiple layout files {target_files} to a single path. Perhaps you meant '{mapped_to}/'?".format(
                    mapped_to = mapped_to,
                    target_files = target_files,
                ))
            layout[prefixes.get(tree, "") + mapped_to] = target_files[0]

    return [
        forest_layout_info(
            layouts = layouts,
            deps = ctx.attr.deps + ctx.attr.mapped_srcs.keys() + ctx.attr.srcs,
        ),
    ]
    
forest_layout = rule(
    implementation = _forest_layout_impl,
    attrs = {
        "strip_prefix": attr.string(
            default = "",
        ),
        "exclude_suffixes": attr.string_list(),
        "deps": attr.label_list(
            aspects = [node_modules_aspect],
        ),
        "prefix": attr.string(),
        "tree": attr.string(
            default = "static",
        ),
        "srcs": attr.label_list(
            allow_files = True,
            aspects = [node_modules_aspect],
        ),
        "mapped_srcs": attr.label_keyed_string_dict(
            allow_files = True,
            aspects = [node_modules_aspect],
        ),
    }
)
