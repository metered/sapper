import {
  Plugin,
  PluginContext,
  TransformPluginContext,
  TransformResult,
  NormalizedInputOptions,
  RenderedChunk,
  NormalizedOutputOptions,
  SourceMapInput,
  RollupOptions,
  rollup,
  OutputBundle,
  ResolveIdResult,
  EmittedAsset,
} from 'rollup'

// import nollup from 'nollup'

import mime from 'mime/lite';
import * as fs from 'fs';
import * as path from 'path';
import { inject_resources, inject_assets } from './inject';
import { load_rollup_config } from './load-config';
import { walk } from './walk';
import { SapperClientPlugin } from '../client';
import { SapperCodegenPlugin, SapperCodegenPluginOptions } from '../codegen';
import { ClientResourceSet } from '../interfaces';
import { create_manifest_data } from 'sapper/core';
import { RouteHeader, RouteManifest, RouteManifestAssets } from '../../interfaces';

interface SapperServerPluginOptions extends Omit<SapperCodegenPluginOptions, 'svelte_options' | 'manifest_data'> {
  sourcemap: boolean | 'inline';
  client_config_path: string;
  client_entry_point: string;

  manifest_path: string;
  static_dir: string;
  routes_src_dir: string;
  route_static_extensions?: string[];
}

export function SapperServerPlugin({
  sourcemap,
  client_config_path,
  client_entry_point,
  manifest_path,

  dev,
  route_static_extensions = ['.svelte', '.html'],
  static_dir,
  routes_src_dir,
  routes_alias,
  ...codegen_options
}: SapperServerPluginOptions): Plugin[] {
  let client_resources: ClientResourceSet | undefined

  const sapper_manifest_data = create_manifest_data(
    routes_src_dir,
    routes_alias,
    route_static_extensions.join(' ')
  )

  const assetX: Record<string, { headers?: RouteHeader[] }> = {}

  return [
    SapperCodegenPlugin({
        svelte_options: {
          generate: 'ssr',
          hydratable: true,
          css: false,
        },
        dev,
        routes_alias,
        manifest_data: sapper_manifest_data,
        ...codegen_options,
    }),
    {
      name: 'sapper-server',
      async buildStart(this: PluginContext, options: NormalizedInputOptions): Promise<void> {
        // we need to emit client assets here, using a nested build of rollup (!)
        // consider using nollup when in development mode, for SPEED
        const client_config = await load_rollup_config(client_config_path)
        let client_options: RollupOptions = Object.assign(Object.create(null), client_config[0])

        console.log({ client_config })

        const sapper_client_plugin = SapperClientPlugin({
          sourcemap,
          emit: (v) => client_resources = v,
          transform_asset: async (emitted_asset) => {
            const plugins = client_options.plugins || []
            for (const plugin of plugins) {
              const transform_asset = (plugin as any).transformAsset
              if (!transform_asset) {
                continue
              }

              const {source, name, fileName} = emitted_asset
              const transformed = await (transform_asset(source, name, fileName) as PromiseLike<string | EmittedAsset>)
              if (!transformed) {
                continue
              }

              if (typeof transformed === 'string') {
                emitted_asset = Object.assign(Object.create(null), emitted_asset, { source: transformed })
              } else if (typeof transformed === 'object') {
                emitted_asset = transformed
              }
            }

            return emitted_asset
          },
          manifest_data: sapper_manifest_data,
        })

        const codegen_plugin = SapperCodegenPlugin({
          svelte_options: {
            generate: 'dom',
            hydratable: true,
            css: false,
          },
          routes_alias,
          manifest_data: sapper_manifest_data,
          ...codegen_options,
        })

        client_options.input = client_entry_point
        client_options.plugins = client_options.plugins || []
        client_options.preserveSymlinks = options.preserveSymlinks
        client_options.plugins.push(codegen_plugin)
        client_options.plugins.push(sapper_client_plugin)
        console.log({ client_options })

        // const client_build = await nollup(client_options)
        const client_build = await rollup(client_options)
        const client_bundle = await client_build.generate({
          format: 'es',
          sourcemap,
          entryFileNames: '[name].[hash].js',
          chunkFileNames: '[name].[hash].js',
          assetFileNames: '[name].[hash][extname]',
        });

        if (!client_resources) {
          throw new Error("Internal error: client_resources was not emitted")
        }

        const emitAsset = (file: { name: string, source: string | Uint8Array, headers?: RouteHeader[]}) => {
          const referenceId = this.emitFile({
            type: 'asset',
            source: file.source,
            name: file.name,
          })
          assetX[referenceId] = {headers: file.headers}
        }

        // fs.existsSync(path.join(build_dir, 'service-worker.js')) && serve({
        //   pathname: '/service-worker.js',
        //   cache_control: 'no-cache, no-store, must-revalidate'
        // }),

        // fs.existsSync(path.join(build_dir, 'service-worker.js.map')) && serve({
        //   pathname: '/service-worker.js.map',
        //   cache_control: 'no-cache, no-store, must-revalidate'
        // }),

        for (const client_output of client_bundle.output) {
          const content_type = mime.getType(client_output.fileName)
          const headers = [
            {
              key: 'Cache-Control',
              value: ((client_output.fileName === 'index.js') || dev) ? 'no-cache' : 'max-age=31536000, immutable',
            },
            ...(content_type ? [{ key: 'Content-Type', value: content_type }] : [])
          ]

          switch (client_output.type) {
            case 'asset':
              emitAsset({
                name: `client/${client_output.fileName}`,
                source: client_output.source,
                headers,
              })
              break
            case 'chunk':
              // TODO handle source maps...
              const code = inject_resources(
                client_output.code,
                client_resources.routes,
                client_resources.main,
                client_resources.main_legacy,
              )
              emitAsset({
                name: `client/${client_output.fileName}`,
                source: code,
                headers,
              })
              break
          }
        }

        console.dir({ sapper_manifest_data }, { depth: null })

        if (static_dir) {
          for await (const {entry, read} of walk(static_dir)) {
            const name = entry.substring(static_dir.length + 1)
            const content_type = mime.getType(name)
            const headers = content_type ? [{ key: 'Content-Type', value: content_type }] : []

            emitAsset({
              name: name,
              source: await read(),
              headers,
            })
          }
        }
      },
      transform(this: TransformPluginContext, code: string, id: string): TransformResult {
        if (/\.css$/.test(id)) {
          // TODO should we emit a warning? why are we seeing css for server-side routes?
          return ``;
        }

        return null
      },

      renderChunk(
        this: PluginContext,
        code_: string,
        chunk: RenderedChunk,
        options: NormalizedOutputOptions
      ): { code: string; map?: SourceMapInput } | string | null {
        if (!client_resources) {
          throw new Error("Internal error: client_resources was not emitted")
        }

        // TODO ensure the source map is accurate...
        let map = chunk.map;
        let code = inject_resources(
          code_,
          client_resources.routes,
          client_resources.main,
          client_resources.main_legacy,
        )

        if (code !== code_) {
          return {
            code,
            map,
          }
        }

        return null
      },
      async generateBundle(this: PluginContext, options: NormalizedOutputOptions, bundle: OutputBundle) {
        const manifest_assets: RouteManifestAssets = {
          directory: path.dirname(options.assetFileNames as string), // this must be a string!! (not a fn),
          entries: {},
        }

        const manifest_asset_prefix_len = manifest_assets.directory.length + 1

        for (const [referenceId, {headers}] of Object.entries(assetX)) {
          const emittedFileName = this.getFileName(referenceId).substring(manifest_asset_prefix_len)
          manifest_assets.entries[emittedFileName] = {
            headers: headers || [],
          }
        }

        for (const k of Object.keys(bundle)) {
          const v = bundle[k]
          if (v.type === 'chunk') {
            v.code = inject_assets(
              v.code,
              manifest_assets,
            )
          }
        }

        if (options.dir) {
          await fs.promises.writeFile(
            path.join(options.dir, manifest_path),
            JSON.stringify({
              assets: manifest_assets,
              functions: {
                "index.js": {}
              },
            } as RouteManifest, null, 2)
          )
        }
      },
      // buildEnd(this: PluginContext, err?: Error): void { },
      // options (this: MinimalPluginContext, options: InputOptions): InputOptions {
      //   return options
      // },
      // load(this: PluginContext, id: string): LoadResult {
      //   return null
      // },
      // async resolveDynamicImport (
      //   this: PluginContext,
      //   specifier: string | AcornNode,
      //   importer: string
      // ): Promise<ResolveIdResult> {
      //   return null
      // },
      resolveId (
        this: PluginContext,
        source: string,
        importer: string | undefined
      ): ResolveIdResult {
        console.log("resolveId", { source, importer })
        return null
      },
    }
  ]
}
