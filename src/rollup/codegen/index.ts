import {
  Plugin,
  PluginContext,
  LoadResult,
  ResolveIdResult,
} from 'rollup'

import { app_codegen } from 'sapper/core';
import { runtime_codegen } from 'sapper/api';
import { CompileOptions } from 'svelte/types/compiler/interfaces';
import { CodegenManifest } from '../../interfaces';

export interface SapperCodegenPluginOptions {
  routes_alias: string;
  manifest_data: CodegenManifest;
  package_alias: string;
  dev?: boolean;
  template_path: string;
  has_service_worker: boolean;
  svelte_options: CompileOptions;
}

export function SapperCodegenPlugin({
  package_alias = '@sapper',
  routes_alias = '@/routes',
  template_path,
  dev = false,
  has_service_worker,
  manifest_data,
  svelte_options,
}: SapperCodegenPluginOptions): Plugin {
  const package_id_prefix = package_alias + "/"

  const codegen = {
    ...app_codegen({
      prefix: package_id_prefix,
      bundler: 'rollup',
      manifest_data,
      dev,
      has_service_worker,
      template_path,
      routes_alias,
      svelte_options,
    }),
    ...runtime_codegen(package_id_prefix, svelte_options),
  }

  return {
    name: 'sapper-codegen',
    resolveId(
      this: PluginContext,
      source: string,
      importer: string | undefined
    ): ResolveIdResult {
      if (source.startsWith(package_id_prefix)) {
        return source
      }

      return null;
    },
    async load(this: PluginContext, id: string): Promise<LoadResult> {
      if (!id.startsWith(package_id_prefix)) {
        return null
      }

      const gen = codegen[id]
      if (gen) {
        return await gen()
      }

      return null
    },
  }
}
