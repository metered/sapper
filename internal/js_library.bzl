# Copyright 2017 The Bazel Authors. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""js_library can be used to expose and share any library package.
DO NOT USE - this is not fully designed yet and it is a work in progress.
"""

load(
  "@build_bazel_rules_nodejs//:providers.bzl",
    "DeclarationInfo",
    "JSModuleInfo",
    "JSNamedModuleInfo",
    "JSEcmaScriptModuleInfo",
    "LinkablePackageInfo",
    "NpmPackageInfo",
    "declaration_info",
    "js_module_info",
    "js_named_module_info",
    "js_ecma_script_module_info",
)
load(
  ":internal/copy_file.bzl",
    "copy_bash",
    "copy_cmd",
)

_AMD_NAMES_DOC = """Mapping from require module names to global variables.
This allows devmode JS sources to load unnamed UMD bundles from third-party libraries."""

AmdNamesInfo = provider(
    doc = "provide access to the amd_names attribute of js_library",
    fields = {"names": _AMD_NAMES_DOC},
)

def write_amd_names_shim(actions, amd_names_shim, targets):
    """Shim AMD names for UMD bundles that were shipped anonymous.
    These are collected from our bootstrap deps (the only place global scripts should appear)
    Args:
      actions: skylark rule execution context.actions
      amd_names_shim: File where the shim is written
      targets: dependencies to be scanned for AmdNamesInfo providers
    """

    amd_names_shim_content = """// GENERATED by js_library.bzl
// Shim these global symbols which were defined by a bootstrap script
// so that they can be loaded with named require statements.
"""
    for t in targets:
        if AmdNamesInfo in t:
            for n in t[AmdNamesInfo].names.items():
                amd_names_shim_content += "define(\"%s\", function() { return %s });\n" % n
    actions.write(amd_names_shim, amd_names_shim_content)

def _impl(ctx):
    input_files = ctx.files.srcs + ctx.files.named_module_srcs
    all_files = []
    typings = []
    js_files = []
    mjs_files = []
    named_module_files = []
    include_npm_package_info = False

    for idx, f in enumerate(input_files):
        file = f

        # copy files into bin if needed
        if file.is_source and not file.path.startswith("external/"):
            dst = ctx.actions.declare_file(file.basename, sibling = file)
            if ctx.attr.is_windows:
                copy_cmd(ctx, file, dst)
            else:
                copy_bash(ctx, file, dst)

            # re-assign file to the one now copied into the bin folder
            file = dst

        # register js files
        if file.basename.endswith(".js") or file.basename.endswith(".js.map") or file.basename.endswith(".json") or file.is_directory:
            js_files.append(file)
        
        if file.basename.endswith(".mjs") or file.basename.endswith(".mjs.map") or file.basename.endswith(".json") or file.is_directory:
            mjs_files.append(file)

        # register typings
        if (
            (
                file.path.endswith(".d.ts") or
                file.path.endswith(".d.ts.map") or
                # package.json may be required to resolve "typings" key
                file.path.endswith("/package.json")
            ) and
            # exclude eg. external/npm/node_modules/protobufjs/node_modules/@types/node/index.d.ts
            # these would be duplicates of the typings provided directly in another dependency.
            # also exclude all /node_modules/typescript/lib/lib.*.d.ts files as these are determined by
            # the tsconfig "lib" attribute
            len(file.path.split("/node_modules/")) < 3 and file.path.find("/node_modules/typescript/lib/lib.") == -1
        ):
            typings.append(file)

        # auto detect if it entirely an npm package
        #
        # NOTE: it probably can be removed once we support node_modules from more than
        # a single workspace
        if file.is_source and file.path.startswith("external/"):
            # We cannot always expose the NpmPackageInfo as the linker
            # only allow us to reference node modules from a single workspace at a time.
            # Here we are automatically decide if we should or not including that provider
            # by running through the sources and check if we have a src coming from an external
            # workspace which indicates we should include the provider.
            include_npm_package_info = True

        # ctx.files.named_module_srcs are merged after ctx.files.srcs
        if idx >= len(ctx.files.srcs):
            named_module_files.append(file)

        # every single file on bin should be added here
        all_files.append(file)

    files_depset = depset(all_files)
    js_files_depset = depset(js_files)
    mjs_files_depset = depset(mjs_files)
    named_module_files_depset = depset(named_module_files)
    typings_depset = depset(typings)

    files_depsets = [files_depset]
    npm_sources_depsets = [files_depset]
    direct_sources_depsets = [files_depset]
    direct_named_module_sources_depsets = [named_module_files_depset]
    typings_depsets = [typings_depset]
    js_files_depsets = [js_files_depset]
    mjs_files_depsets = [mjs_files_depset]

    for dep in ctx.attr.deps:
        if NpmPackageInfo in dep:
            npm_sources_depsets.append(dep[NpmPackageInfo].sources)
        else:
            if JSModuleInfo in dep:
                js_files_depsets.append(dep[JSModuleInfo].direct_sources)
                direct_sources_depsets.append(dep[JSModuleInfo].direct_sources)
            if JSEcmaScriptModuleInfo in dep:
                mjs_files_depsets.append(dep[JSEcmaScriptModuleInfo].direct_sources)
                direct_sources_depsets.append(dep[JSEcmaScriptModuleInfo].direct_sources)
            if JSNamedModuleInfo in dep:
                direct_named_module_sources_depsets.append(dep[JSNamedModuleInfo].direct_sources)
                direct_sources_depsets.append(dep[JSNamedModuleInfo].direct_sources)
            if DeclarationInfo in dep:
                typings_depsets.append(dep[DeclarationInfo].declarations)
                direct_sources_depsets.append(dep[DeclarationInfo].declarations)
            if DefaultInfo in dep:
                files_depsets.append(dep[DefaultInfo].files)

    providers = [
        DefaultInfo(
            files = depset(transitive = files_depsets),
            runfiles = ctx.runfiles(
                files = all_files,
                transitive_files = depset(transitive = files_depsets),
            ),
        ),
        AmdNamesInfo(names = ctx.attr.amd_names),
        js_module_info(
            sources = depset(transitive = js_files_depsets),
            deps = ctx.attr.deps,
        ),
        js_ecma_script_module_info(
            sources = depset(transitive = mjs_files_depsets),
            deps = ctx.attr.deps,
        ),
        js_named_module_info(
            sources = depset(transitive = direct_named_module_sources_depsets),
            deps = ctx.attr.deps,
        ),
    ]

    if ctx.attr.package_name:
        path = "/".join([p for p in [ctx.bin_dir.path, ctx.label.workspace_root, ctx.label.package, ctx.attr.package_path_prefix] if p])
        providers.append(LinkablePackageInfo(
            package_name = ctx.attr.package_name,
            path = path,
            files = depset(all_files, transitive = direct_sources_depsets),
        ))

    if include_npm_package_info:
        workspace_name = ctx.label.workspace_name if ctx.label.workspace_name else ctx.workspace_name
        providers.append(NpmPackageInfo(
            direct_sources = depset(transitive = direct_sources_depsets),
            sources = depset(transitive = npm_sources_depsets),
            workspace = workspace_name,
        ))

    # Don't provide DeclarationInfo if there are no typings to provide.
    # Improves error messaging downstream if DeclarationInfo is required.
    if len(typings) or len(typings_depsets) > 1:
        decls = depset(transitive = typings_depsets)
        providers.append(declaration_info(
            declarations = decls,
            deps = ctx.attr.deps,
        ))
        providers.append(OutputGroupInfo(types = decls))

    return providers

_js_library = rule(
    implementation = _impl,
    attrs = {
        "amd_names": attr.string_dict(
            doc = _AMD_NAMES_DOC,
        ),
        "deps": attr.label_list(
            doc = """Transitive dependencies of the package.
            It should include fine grained npm dependencies from the sources
            or other targets we want to include in the library but also propagate their own deps.""",
        ),
        "is_windows": attr.bool(
            doc = "Automatically set by macro",
            mandatory = True,
        ),
        # module_name for legacy ts_library module_mapping support
        # which is still being used in a couple of tests
        # TODO: remove once legacy module_mapping is removed
        "module_name": attr.string(
            doc = "Internal use only. It will be removed soon.",
        ),
        "named_module_srcs": attr.label_list(
            doc = """A subset of srcs that are javascript named-UMD or
            named-AMD for use in rules such as ts_devserver.
            They will be copied into the package bin folder if needed.""",
            allow_files = True,
        ),
        "package_name": attr.string(
            doc = """Optional package_name that this package may be imported as.""",
        ),
        "package_path_prefix": attr.string(

        ),
        "srcs": attr.label_list(
            doc = """The list of files that comprise the package.
            They will be copied into the package bin folder if needed.""",
            allow_files = True,
        ),
    },
    doc = "Defines a js_library package",
)

def js_library(
        name,
        srcs = [],
        amd_names = {},
        package_name = None,
        deps = [],
        named_module_srcs = [],
        **kwargs):
    """Internal use only yet. It will be released into a public API in a future release."""
    module_name = kwargs.pop("module_name", None)
    if module_name:
        fail("use package_name instead of module_name in target //%s:%s" % (native.package_name(), name))
    if kwargs.pop("is_windows", None):
        fail("is_windows is set by the js_library macro and should not be set explicitely")
    _js_library(
        name = name,
        amd_names = amd_names,
        srcs = srcs,
        named_module_srcs = named_module_srcs,
        deps = deps,
        package_name = package_name,
        # module_name for legacy ts_library module_mapping support
        # which is still being used in a couple of tests
        # TODO: remove once legacy module_mapping is removed
        module_name = package_name,
        is_windows = select({
            "@bazel_tools//src/conditions:host_windows": True,
            "//conditions:default": False,
        }),
        **kwargs
    )