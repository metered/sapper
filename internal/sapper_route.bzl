load("@npm//@bazel/typescript:index.bzl", "ts_library")

load(":internal/forest_layout.bzl", "forest_layout")

load("//tools/internal/svelte:index.bzl", "svelte_library")

def _just_files_impl(ctx):
    if ctx.attr.output_group:
        files = []
        for target in ctx.attr.files:
            files.extend(getattr(target[OutputGroupInfo], ctx.attr.output_group).to_list())
    else:
        files = ctx.files.files
    return [
        DefaultInfo(files = depset(files))
    ]

_just_files = rule(
    implementation = _just_files_impl,
    attrs = {
        "files": attr.label_list(
            allow_files = True,
        ),
        "output_group": attr.string(),
        "deps": attr.label_list(),
    },
)

def sapper_route(
    name,
    prefix=None,
    deps=[],
    server_deps=[],
    ts_output_group="es6_sources",
    **kwargs,
):

    if prefix == None:
        prefix = name + "/"

    ts_sources = native.glob(["*.ts"])
    ts_files = []
    if ts_sources:
        ts_library(
            name = name + "__ts",
            srcs = ts_sources,
            deps = server_deps,
            generate_externs = False,
        )

        # native.filegroup(
        #     name = name + "__files-ts",
        #     srcs = [":" + name + "__ts"],
        #     # data = server_deps,
        #     output_group = ts_output_group,
        # )

        _just_files(
            name = name + "__files-ts",
            files = [":" + name + "__ts"],
            # data = server_deps,
            output_group = ts_output_group,
        )

        ts_files = [
            ":" + name + "__files-ts",
        ]

    forest_layout(
        tree = "server_routes",
        name = name + "__server_routes",
        deps = deps + server_deps,
        prefix = prefix,
        exclude_suffixes = [".externs.js"],
        srcs = ts_files
    )

    deps = [
        ":" + name + "__server_routes",
    ]

    svelte_files = native.glob(["*.svelte"])
    forest_layout(
        tree = "pages",
        name = name,
        deps = deps,
        prefix = prefix,
        srcs = svelte_files,
    )

    # TODO carry along assets so we can use them at compile time.
    # digest the asset and put it in flat folder than never gets a prefix
    # aggregate all of these and dump them in static when we render.
    # Generate .ts file for each one that contains the proper asset basename
    # How do we properly set the base_url at runtime for where we end up putting it?
    # forest_layout(
    #     tree = "assets",
    # )