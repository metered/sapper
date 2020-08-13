load("@bazel_skylib//lib:paths.bzl", "paths")

# load("@build_bazel_rules_nodejs//:providers.bzl", "", "", "", "NodeContextInfo", "NpmPackageInfo", "DeclarationInfo", "node_modules_aspect", "run_node", "js_ecma_script_module_info")

load(":internal/forest_layout.bzl", "forest_layout", "ForestLayoutInfo")

load("@build_bazel_rules_nodejs//:providers.bzl", "LinkablePackageInfo")

TreeArtifactInfo = provider(fields=['path', 'files', 'sources'])

def tree_artifact_info(path, files, deps = []):
    """Constructs a TreeArtifactInfo including all transitive sources from TreeArtifactInfo providers in a list of deps.
Returns a single TreeArtifactInfo.
"""
    transitive_depsets = [files]
    for dep in deps:
        if ForestLayoutInfo in dep:
            transitive_depsets.append(dep[ForestLayoutInfo].sources)

    return TreeArtifactInfo(
        path = path,
        files = files,
        sources = depset(transitive = transitive_depsets),
    )

def _emit_leaf(cmd, dirs, dst, src):
    # print("_emit_leaf", src, "->", dst)
    dst_dir = paths.dirname(dst.path)
    dirs[dst_dir] = True
    return cmd + "cp '{src}' '{dst}'\n".format(src=src.path, dst=dst.path)

def _tree_artifact_impl(ctx):
    dirs = {}
    cmd = ""
    inputs = []
    outputs = []
    for dep in ctx.attr.deps:
        layouts = dep[ForestLayoutInfo].layouts
        for output_group, prefix in ctx.attr.mapped_output_groups.items():
            if output_group in layouts:
                layout = layouts[output_group]
                for dst_subpath, src in layout.items():
                    dst = ctx.actions.declare_file(ctx.label.name + "/" + prefix + dst_subpath)
                    cmd = _emit_leaf(cmd, dirs, dst, src)
                    outputs.append(dst)
                    inputs.append(src)

    for dst_dir in sorted(dirs.keys(), reverse=True):
        cmd = "rm -rf '{dst_dir}' && mkdir -p '{dst_dir}'\n".format(dst_dir=dst_dir) + cmd

    ctx.actions.run_shell(
        outputs=outputs,
        inputs=depset(inputs),
        arguments=[],
        command=cmd,
    )

    files = depset(outputs)
    path = "/".join([p for p in [ctx.bin_dir.path, ctx.label.workspace_root, ctx.label.package, ctx.label.name] if p])

    providers = [
        tree_artifact_info(path, files, ctx.attr.deps),
        DefaultInfo(files = files),
    ]

    if ctx.attr.package_name:
        providers.append(
            LinkablePackageInfo(
                package_name = ctx.attr.package_name,
                path = path,
                files = files,
            )
        )

    return providers

tree_artifact = rule(
    implementation = _tree_artifact_impl,
    attrs = {
        "deps": attr.label_list(
            providers = [ForestLayoutInfo],
        ),
        "package_name": attr.string(),
        "mapped_output_groups": attr.string_dict(),
    }
)