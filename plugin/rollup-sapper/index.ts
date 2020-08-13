import {
  Plugin,
  PluginContext,
  TransformPluginContext,
  TransformResult,
  NormalizedInputOptions,
  RenderedChunk,
  NormalizedOutputOptions,
  SourceMapInput,
  RollupWarning,
  OutputBundle,
  OutputChunk,
  ResolvedId,
} from 'rollup'

import * as fs from 'fs';
import * as path from 'path';

import inject_resources from './inject';
import summarize from './summarize';
import { resource_dependencies } from './resources';
import { ManifestData, PageResource } from './interfaces';
import { chunk_content_from_modules, extract_sourcemap, emit_code_and_sourcemap } from './code';
import { find, ChunkResolver } from './chunk';
import { graph } from './graph';

function munge_warning_or_error(warning_or_error: any) {
  return {
    file: warning_or_error.filename,
    message: [warning_or_error.message, warning_or_error.frame].filter(Boolean).join('\n')
  };
}

export default function SapperBuildPlugin({
  sourcemap,
  mode,
  client_dir,
}: {
  sourcemap: boolean | 'inline'
  mode: 'client' | 'server' | undefined,
  client_dir?: string,
}): Plugin {
  
  let entry_point: string | undefined
  const warnings: RollupWarning[] = []

  const get_entry_point_output_chunk = (bundle: OutputBundle) => {
    if (entry_point === undefined) {
      throw new Error("Internal error: entry_point cannot be undefined")
    }

    const entry_point_output_chunk = bundle[entry_point]
    if (!entry_point_output_chunk) {
      throw new Error(`Internal error: No chunk for entry point: ${entry_point} in: ${Object.keys(bundle)}`)
    }

    if (entry_point_output_chunk.type !== 'chunk') {
      throw new Error(`Internal error: Wrong type for entry point chunk: ${entry_point} in: ${Object.keys(bundle)}`)
    }

    return entry_point_output_chunk
  }

  const get_client_package = (options: NormalizedOutputOptions) => {
    if (!options.dir) {
      throw new Error("Internal error: rollup output dir is undefined")
    }

    switch (mode) {
      case 'server':
        return require(path.resolve(options.dir, '../client/package.json'))
      case 'client':
        return require(path.resolve(options.dir, 'package.json'))
    }
  }

  const get_package_path = (options: NormalizedOutputOptions) => {
    if (!options.dir) {
      throw new Error("Internal error: rollup output dir is undefined")
    }

    return path.join(options.dir, 'package.json')
  }

  return {
    name: 'sapper-build',
    buildStart(this: PluginContext, options: NormalizedInputOptions): void {
      console.log("buildStart")
      const input = options.input
      const inputs: {alias: string, file: string}[] = []

      if (typeof input === 'string') {
        inputs.push({alias: 'main', file: input})
      } else if (Array.isArray(input)) {
        inputs.push(...input.map(file => ({file, alias: file})))
      } else {
        for (const alias in input) {
          inputs.push({file: input[alias], alias})
        }
      }
      if (!entry_point) {
        entry_point = inputs[0].alias
        if (!/\.[mc]?js$/.test(entry_point)) {
          entry_point = entry_point + ".js"
        }
      }
    },
    transform(this: TransformPluginContext, code: string, id: string): TransformResult {
      if (/\.css$/.test(id)) {
        return ``;
      }

      return null
    },
    async generateBundle(this: PluginContext, options: NormalizedOutputOptions, bundle: OutputBundle): Promise<void> {
      const entry_point_output_chunk = get_entry_point_output_chunk(bundle)

      const emitted: any[] = []
      const chunk_resolver = new ChunkResolver<OutputChunk>({
        id: chunk => chunk.fileName,
        resolve_id: chunk_file => {
          const oc = bundle[chunk_file]
          return oc && oc.type === 'chunk' ? oc : undefined
        },
        internals: chunk => ({
          id: chunk.fileName,
          name: chunk.name,
          file_name: chunk.fileName,
          dep_names: [...chunk.imports],
          manifest: Object.keys(chunk.modules),
          type: options.format === 'es' ? 'module' : 'script',
        }),
        module_imports: js_module => {
          const module_info = this.getModuleInfo(js_module)
          return [
            ...module_info.importedIds,
            ...module_info.dynamicallyImportedIds,
          ].filter(id => /\.css$/.test(id))
        },
        chunks_from_modules: async (chunk, css_modules) => {
          const name = chunk.name + '.css'
          const file_name = emit_code_and_sourcemap({
            sourcemap,
            output: await chunk_content_from_modules(
              css_modules,
              async (css_module) => extract_sourcemap(await fs.promises.readFile(css_module, 'utf-8'), css_module),
            ),
            sourcemap_url_prefix: '',
            output_file_name: name,
            emit: (name, source) => {
              const moduleid = this.emitFile({ name, type: 'asset', source })
              const file = this.getFileName(moduleid)
              emitted.push({
                length: source.length,
                fileName: file,
                modules: Object.fromEntries(
                  Array.from(
                    css_modules,
                    css_module => [css_module, { renderedLength: fs.statSync(css_module).size }]
                  )
                ),
              })
              return file
            },
          })

          return [
            {
              id: file_name,
              name,
              file_name,
              manifest: css_modules,
              type: 'style',
              dep_names: [],
            },
          ]
        },
      })

      // output chunks that are javascript
      const output_chunks = Object.values(bundle).filter(output => output.type === 'chunk') as OutputChunk[]
      const chunks = await Promise.all(output_chunks.map(chunk => chunk_resolver.resolve_chunk(chunk)))

      if (mode === 'client') {
        const resolved_manifest_data = await this.resolve("@sapper/internal/manifest-data.json")
        if (!resolved_manifest_data) {
          throw new Error("Internal error: couldn't find manifest data")
        }
        const manifest_data = JSON.parse(await fs.promises.readFile(resolved_manifest_data.id, 'utf-8')) as ManifestData

        const {
          main: main_resources,
          routes: route_resources,
        } = await resource_dependencies(
          await chunk_resolver.resolve_chunk(entry_point_output_chunk),
          async route => {
            const resolved = await this.resolve(`${manifest_data.routes_alias}/${route}`)
            const chunk = resolved && chunks.find(chunk => find(chunk.manifest, module_id => module_id === resolved.id))
            if (!chunk) {
              throw new Error(`Internal error: could not find chunk that owns ${route}`);
            }

            return chunk
          },
          manifest_data.components,
          "",
        )

        await fs.promises.writeFile(
          get_package_path(options),
          JSON.stringify({
            sapper: {
              main: main_resources,
              routes: route_resources,
            }
          })
        )

        console.log(graph(route_resources, chunk_resolver.chunks()))
      }

      const summary = summarize({
        warnings: warnings.map(munge_warning_or_error),
        chunks: [
          ...output_chunks.map(chunk => ({
            length: (chunk.code || "").length,
            fileName: chunk.fileName,
            modules: chunk.modules
          })),
          ...emitted,
        ].sort(({ fileName: a }, { fileName: b }) => a.localeCompare(b)),
      });
      console.log(summary);
    },

    async writeBundle(
      this: PluginContext,
      options: NormalizedOutputOptions,
      bundle: OutputBundle,
    ): Promise<void> {
      const entry_point_output_chunk = get_entry_point_output_chunk(bundle)
      const {
        sapper: {
          main: main_resources,
          routes: route_resources,
        },
      } = get_client_package(options)

      await fs.promises.writeFile(
        `${options.dir}/${entry_point_output_chunk.fileName}`,
        inject_resources(
          entry_point_output_chunk.code,
          route_resources,
          main_resources,
          [],
        ),
      )
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
    // resolveId (
    //   this: PluginContext,
    //   source: string,
    //   importer: string | undefined
    // ): ResolveIdResult {
    //   return null
    // },
    // renderChunk(
    //   this: PluginContext,
    //   code: string,
    //   chunk: RenderedChunk,
    //   options: NormalizedOutputOptions
    // ): { code: string; map?: SourceMapInput } | string | null {
    //   return null
    // },
  }
}
