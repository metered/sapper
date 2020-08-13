load("@npm//@bazel/typescript:index.bzl", "ts_library")

load(":internal/forest_layout.bzl", "forest_layout")

load("//tools/internal/svelte:index.bzl", "svelte_library")

def sapper_route(name, prefix=None, deps=[], ts_output_group="es6_sources", **kwargs):
    if prefix == None:
        prefix = name + "/"

    ts_sources = native.glob(["*.ts"])
    ts_files = []
    if ts_sources:
        ts_library(
            name = name + "__ts",
            srcs = ts_sources,
            deps = deps,
            generate_externs = False,
        )

        native.filegroup(
            name = name + "__files-ts",
            srcs = [":" + name + "__ts"],
            output_group = ts_output_group,
        )

        ts_files = [
            ":" + name + "__files-ts",
        ]

    forest_layout(
        tree = "server_routes",
        name = name + "__server_routes",
        deps = deps,
        prefix = prefix,
        exclude_suffixes = [".externs.js"],
        files = ts_files
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
        files = svelte_files,
    )
