load(":internal/rollup_bundle.bzl", "rollup_bundle")
load("//tools/internal/svelte:index.bzl", "svelte_library")
load("@build_bazel_rules_nodejs//:providers.bzl", "JSEcmaScriptModuleInfo", "JSModuleInfo", "NpmPackageInfo")
load(":internal/forest_layout.bzl", "forest_layout")
load(":internal/js_library.bzl", "js_library")
load(":internal/copy_typing.bzl", "copy_typing")
load(":internal/tree_artifact.bzl", "tree_artifact", "TreeArtifactInfo")


def _just_files_impl(ctx):
    path = "/".join([p for p in [ctx.bin_dir.path, ctx.label.workspace_root, ctx.label.package] if p])
    return [
        DefaultInfo(files = depset(transitive = [depset(ctx.files.files)]))
    ]

_just_files = rule(
    implementation = _just_files_impl,
    attrs = {
        "files": attr.label_list(
            allow_files = True,
        ),
        "deps": attr.label_list(),
    },
)

def _no_ext(f):
    return f.short_path[:-len(f.extension) - 1]

def _resolve_js_input(f, inputs):
    if f.extension == "js" or f.extension == "mjs":
        return f

    # look for corresponding js file in inputs
    no_ext = _no_ext(f)
    for i in inputs:
        if i.extension == "js" or i.extension == "mjs":
            if _no_ext(i) == no_ext:
                return i
    fail("Could not find corresponding javascript entry point for %s. Add the %s.js to your deps." % (f.path, no_ext))

def _filter_js(files):
    return [f for f in files if f.extension == "js" or f.extension == "mjs"]

def _sapper_server_rollup_config_impl(ctx):
    config = ctx.actions.declare_file("_%s.rollup_config.js" % ctx.label.name)

    # rollup_bundle supports deps with JS providers. For each dep,
    # JSEcmaScriptModuleInfo is used if found, then JSModuleInfo and finally
    # the DefaultInfo files are used if the former providers are not found.
    deps_depsets = []
    for dep in ctx.attr.deps:
        if JSEcmaScriptModuleInfo in dep:
            deps_depsets.append(dep[JSEcmaScriptModuleInfo].sources)
        elif JSModuleInfo in dep:
            deps_depsets.append(dep[JSModuleInfo].sources)
        elif hasattr(dep, "files"):
            deps_depsets.append(dep.files)

        # Also include files from npm deps as inputs.
        # These deps are identified by the NpmPackageInfo provider.
        if NpmPackageInfo in dep:
            deps_depsets.append(dep[NpmPackageInfo].sources)

    deps_inputs = depset(transitive = deps_depsets).to_list()

    inputs = _filter_js(ctx.files.client_entry_point) + _filter_js(ctx.files.client_bundler_config) + deps_inputs

    client_entry_point = _resolve_js_input(ctx.file.client_entry_point, inputs)
    client_bundler_config = _resolve_js_input(ctx.file.client_bundler_config, inputs)
    ctx.actions.expand_template(
        template = ctx.file._config_file,
        output = config,
        substitutions = {
            "${client_entry_point}": "/".join([f for f in [client_entry_point.path] if f]),
            "${client_bundler_config}": "/".join([f for f in [client_bundler_config.path] if f]),
            "${manifest_path}": ctx.attr.manifest_path,
            "${routes_alias}": ctx.attr.routes_alias,
            "${package_alias}": ctx.attr.package_alias,
            "${routes_src_dir}": ctx.attr.routes_src_dir[TreeArtifactInfo].path + "/src/routes",
            "${static_dir}": ctx.attr.static_dir[TreeArtifactInfo].path,
            "${template_path}": ctx.file.template_path.path,
        },
    )

    return [
        DefaultInfo(
            files = depset([config]),
        )
    ]

_sapper_server_rollup_config = rule(
    implementation = _sapper_server_rollup_config_impl,
    attrs = {
        "_config_file": attr.label(
            default = "//tools/sapper:internal/rollup.config.js",
            allow_single_file = True,
        ),
        "deps": attr.label_list(),
        "client_entry_point": attr.label(
            allow_single_file = True,
        ),
        "client_bundler_config": attr.label(
            allow_single_file = True,
        ),
        "typing": attr.label(
            allow_single_file = True,
        ),
        "typing_amd_module_name": attr.string(),
        "manifest_path": attr.string(),
        "static_dir": attr.label(),
        "routes_src_dir": attr.label(),
        "routes_alias": attr.string(),
        "package_alias": attr.string(),
        "template_path": attr.label(
            allow_single_file = True,
        ),
    },
)


def sapper(*,
        name,
        package_name,
        client,
        client_srcs=[],
        client_template,
        client_entry_point,
        client_bundler_config,
        server,
        server_entry_point,
        bundler_deps=[],
        srcs=[],
        deps=None,
        tags=None,
        **kwargs,
    ):

    forest_layout(
        name = "_" + name + ".root",
        tree = "root",
        deps = srcs,
    )

    tree_artifact(
        name = "_" + name + ".routes",
        deps = [
            ":" + "_" + name + ".root",
        ],
        mapped_output_groups = {
            "pages": "src/routes/",
            "server_routes": "src/routes/",
        },
    )

    svelte_library(
        name = "_" + name + ".sapper-routes",
        srcs = [
            ":" + "_" + name + ".routes",
        ],
        package_name = "@",
    )

    tree_artifact(
        name = "_" + name + ".static",
        deps = [
            ":" + "_" + name + ".root",
        ],
        mapped_output_groups = {
            "static": "",
        },
    )

    if not client_srcs:
        client_srcs = []





    copy_typing(
        name = "%s.out-decls" % name,
        src = server,
        typing_amd_module_name = package_name,
    )

    for format in ["cjs", "esm"]:
        name_format = "%s.%s" % (name, format)

        native.filegroup(
            name = "_" + name_format + ".declarations",
            srcs = [
                server,
            ],
        )

        manifest_file = "%s-manifest.json" % name_format
        _sapper_server_rollup_config(
            name = "_" + name_format + ".rollup.config.js",
            deps = [
                client,
            ],
            client_entry_point = client_entry_point,
            client_bundler_config = client_bundler_config,
            manifest_path = manifest_file,
            package_alias = "@sapper",
            routes_alias = "@/src/routes",
            static_dir = ":" + "_" + name + ".static",

            routes_src_dir = ":" + "_" + name + ".routes",
            template_path = client_template,
        )

        rollup_bundle(
            name = name_format + ".bundle",
            srcs = [
                ":" + "_" + name + ".static",
                ":" + "_" + name + ".routes",
                ":" + "_" + name_format + ".declarations",
                client_entry_point,
                client_bundler_config,
                client_template,
            ] + client_srcs,
            deps = [
                client,
                server,
                ":" + "_" + name + ".sapper-routes",
                "//tools/sapper:sapper_pkg",
            ] + bundler_deps + deps + srcs,
            config_file = "_" + name_format + ".rollup.config.js",
            format = format,
            extra_outputs = [manifest_file],
            asset_file_names = "assets/[name][extname]",
            entry_points = {
                server_entry_point: "index",
            },
        )

        _just_files(
            name = name_format + ".bundle-files",
            files = [
                ":" + name_format + ".bundle",
            ]
        )

        js_library(
            name = name_format,
            srcs = [
                ":" + name_format + ".bundle-files",
                ":" + "%s.out-decls" % name,
            ],
            package_name = package_name,
            deps = deps + [ 
                # TODO We want all the npm dependencies of srcs... 
                server, # We want to use all the dependencies of server...
            ],
        )
