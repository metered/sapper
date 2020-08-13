load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary")
load("@npm//@bazel/rollup:index.bzl", "rollup_bundle")

load("//tools/internal/svelte:index.bzl", "svelte_library")
load("@build_bazel_rules_nodejs//:providers.bzl", "JSEcmaScriptModuleInfo", "JSModuleInfo", "LinkablePackageInfo", "NodeContextInfo", "NpmPackageInfo", "node_modules_aspect")

load(":internal/forest_layout.bzl", "forest_layout")

load(":internal/tree_artifact.bzl", "tree_artifact", "TreeArtifactInfo")

def _sapper_codegen_impl(ctx):
    deps_depsets = [
        ctx.attr.base[TreeArtifactInfo].sources
    ]

    output_dir = "/".join([p for p in [ctx.bin_dir.path, ctx.label.workspace_root, ctx.label.package, ctx.label.name] if p])
    outputs = [
        ctx.actions.declare_file(ctx.label.name + "/internal/App.svelte"),
        ctx.actions.declare_file(ctx.label.name + "/internal/error.svelte"),
        ctx.actions.declare_file(ctx.label.name + "/internal/layout.svelte"),
        ctx.actions.declare_file(ctx.label.name + "/internal/shared.mjs"),
        ctx.actions.declare_file(ctx.label.name + "/internal/manifest-client.mjs"),
        ctx.actions.declare_file(ctx.label.name + "/internal/manifest-server.mjs"),
        ctx.actions.declare_file(ctx.label.name + "/internal/manifest-data.json"),
        ctx.actions.declare_file(ctx.label.name + "/app.mjs"),
        ctx.actions.declare_file(ctx.label.name + "/server.mjs"),
        ctx.actions.declare_file(ctx.label.name + "/package.json"),
    ]
    base_path = ctx.attr.base[TreeArtifactInfo].path

    ctx.actions.run_shell(
        tools = [ctx.executable.sapper],
        inputs = depset(transitive = deps_depsets).to_list(),
        outputs = outputs,
        env = {
            "NODE_ENV": "development" if ctx.var["COMPILATION_MODE"] == "fastbuild" else "production",
            "COMPILATION_MODE": ctx.var["COMPILATION_MODE"],
        },
        command = """
{sapper} {sapper_command} {sapper_options} \\
    --bundler {bundler} \\
    --src {base}/src \\
    --static {base}/static \\
    --routes {base}/src/routes \\
    --routes_alias @/src/routes \\
    {output}
echo '{{"name": "@sapper"}}' > {output}/package.json
""".format(
            bundler = ctx.attr.bundler,
            sapper_command = ctx.attr.sapper_command,
            sapper_options = "" if ctx.var["COMPILATION_MODE"] == "opt" else "--dev",
            sapper = ctx.executable.sapper.path,
            base = base_path,
            output = output_dir,
        )
    )
    # outputs = [output_dir]

    return [
        DefaultInfo(
            files = depset(outputs),
            # runfiles = ctx.runfiles(files = ctx.files.srcs),
        ),
        # LinkablePackageInfo(
        #     package_name = "@sapper",
        #     path = output_dir,
        #     files = depset(outputs),
        # ),
    ]

    
_sapper_codegen = rule(
    implementation = _sapper_codegen_impl,
    attrs = {
        "base": attr.label(
            providers = [TreeArtifactInfo],
        ),
        "deps": attr.label_list(
            aspects = [node_modules_aspect],
        ),
        "node_context_data": attr.label(
            default = "@build_bazel_rules_nodejs//internal:node_context_data",
            providers = [NodeContextInfo],
            doc = "Internal use only",
        ),
        "sapper_command": attr.string(
            default = "codegen",
        ),
        "bundler": attr.string(),
        "sapper": attr.label(
            cfg = "host",
            executable = True,
        ),
    },
)


def _sapper_entrypoint_impl(ctx):
    entrypoint = ctx.actions.declare_file(ctx.label.name)
    outputs = [entrypoint]
    ctx.actions.write(entrypoint, ctx.attr.contents)

    return [
        DefaultInfo(
            files = depset(outputs),
        )
    ]
 
_sapper_entrypoint = rule(
    implementation = _sapper_entrypoint_impl,
    attrs = {
        "contents": attr.string()
    },
)

def _just_files_impl(ctx):
    return [
        DefaultInfo(files = depset(ctx.files.files))
    ]

_just_files = rule(
    implementation = _just_files_impl,
    attrs = {
        "files": attr.label_list(
            allow_files = True,
        ),
    },
)


def sapper(
        name,
        client,
        client_entry_point,
        client_bundler_config,
        server,
        server_entry_point,
        server_bundler_config,
        client_bundler_deps=[],
        server_bundler_deps=[],
        files=[],
        mapped_files={},
        deps=None,
        tags=None,
        **kwargs,
    ):
    nodejs_binary(
        name = name + ".sapper-tool",
        entry_point = "//tools/sapper:src/cli.ts",
        data = [
            "//tools/sapper:cli",
            "//tools/sapper:config",
        ],
    )

    forest_layout(
        name = name + ".root",
        tree = "root",
        deps = deps,
        mapped_files = mapped_files,
        files = files,
    )

    tree_artifact(
        name = name + ".tree",
        deps = [
            ":" + name + ".root",
        ],
        package_name = "@",
        mapped_output_groups = {
            "root": "",
            "pages": "src/routes/",
            "server_routes": "src/routes/",
        },
    )

    _sapper_codegen(
        name = name + ".sapper-codegen",
        base = ":" + name + ".tree",
        sapper = ":" + name + ".sapper-tool",
        deps = deps,
        bundler = 'rollup',
        **kwargs,
    )

    svelte_library(
        name = name + ".sapper-libgen",
        srcs = [
            ":"  + name + ".sapper-codegen",
        ],
        package_name = "@sapper",
    )

    tree_artifact(
        name = name + ".routes",
        deps = [
            ":" + name + ".root",
        ],
        mapped_output_groups = {
            "pages": "src/routes/",
            "server_routes": "src/routes/",
        },
    )

    svelte_library(
        name = name + ".sapper-routes",
        srcs = [
            ":" + name + ".routes",
        ],
        package_name = "@",
    )

    rollup_bundle(
        name = name + "/__sapper__/build/client",
        deps = [
            client,
            "//tools/sapper:config",
            ":" + name + ".sapper-routes",
            ":" + name + ".sapper-libgen",
        ] + client_bundler_deps + deps,
        config_file = client_bundler_config,
        format = 'esm',
        output_dir = True,
        entry_points = {
            client_entry_point: "index"
        },
    )

    _just_files(
        name = name + ".sapper-client-bundle",
        files = [
            ":" + name + "/__sapper__/build/client",
        ]
    )

    rollup_bundle(
        name = name + "/__sapper__/build/server",
        srcs = [
            "//:package.json",
        ],
        deps = [
            server,
            "//tools/sapper:config",
            ":" + name + ".sapper-routes",
            ":" + name + ".sapper-libgen",
            ":" + name + ".sapper-client-bundle",
        ] + server_bundler_deps + deps,
        config_file = server_bundler_config,
        format = "cjs",
        output_dir = True,
        entry_points = {
            server_entry_point: "server",
        },
    )

    tree_artifact(
        name = name + "/static",
        deps = [
            ":" + name + ".root",
        ],
        mapped_output_groups = {
            "static": "",
        },
    )

    _sapper_entrypoint(
        name = name + "/__sapper__/build/index.js",
        contents = """
// generated by sapper bazel rule
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PORT = process.env.PORT || 3000;

console.log('Starting server on port ' + process.env.PORT);
require('./server/server.js');
"""
    )

    nodejs_binary(
        name = name + ".server",
        entry_point = ":" + name + "/__sapper__/build",
        data = [
            ":" + name + "/__sapper__/build/index.js",
            ":" + name + "/__sapper__/build/client",
            ":" + name + "/__sapper__/build/server",
            ":" + name + "/static",
        ]
    )
