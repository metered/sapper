load("@build_bazel_rules_nodejs//:providers.bzl", "DeclarationInfo", "JSEcmaScriptModuleInfo", "JSModuleInfo", "NodeContextInfo", "NpmPackageInfo", "node_modules_aspect", "run_node", "declaration_info")

def _copy_typing_outs(src, name):
    return {
      "d_ts": "index.d.ts"
    }

def _copy_typing_impl(ctx):
    typings_in = ctx.attr.src[DeclarationInfo].declarations.to_list()[0]

    out = ctx.outputs.d_ts
    args = ctx.actions.args()
    args.add(typings_in.path)
    args.add(out.path)
    args.add(ctx.attr.typing_amd_module_name)

    executable = "copy_typing_bin"
    execution_requirements = {}

    run_node(
        ctx,
        progress_message = "Copying TypeScript types %s [rollup]" % out.short_path,
        executable = executable,
        inputs = [typings_in],
        outputs = [out],
        arguments = [args],
        mnemonic = "RollupTypes",
        execution_requirements = execution_requirements,
        env = {"COMPILATION_MODE": ctx.var["COMPILATION_MODE"]},
    )

    return [
      declaration_info(depset([out]), deps = []),
    ]

copy_typing = rule(
    implementation = _copy_typing_impl,
    attrs = {
        "src": attr.label(),
        "typing_amd_module_name": attr.string(),
        "copy_typing_bin": attr.label(
            default = Label("//tools/sapper:internal/copy_typing_bin"),
            cfg = "host",
            executable = True,
        ),
    },
    outputs = _copy_typing_outs,
)
