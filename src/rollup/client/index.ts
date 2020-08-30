import {
  Plugin,
  PluginContext,
  TransformPluginContext,
  TransformResult,
  NormalizedInputOptions,
  NormalizedOutputOptions,
  RollupWarning,
  OutputBundle,
  OutputChunk,
  ModuleInfo,
} from 'rollup'

import * as fs from 'fs';
import * as path from 'path';

import { discover_unconditional_imports } from './discover'
// import inject_resources from './inject';
import summarize from './summarize';
import { main_resource_dependencies, route_resource_dependencies } from './resources';
import { ClientResourceSet, PageResourceType } from '../interfaces';
import { CodegenManifest } from '../../interfaces';
import { chunk_content_from_modules, extract_sourcemap, emit_code_and_sourcemap } from './code';
import { walk_dep_graph, ChunkResolver, Chunk } from './chunk';
// import { graph } from './graph';

function munge_warning_or_error(warning_or_error: any) {
  return {
    file: warning_or_error.filename,
    message: [warning_or_error.message, warning_or_error.frame].filter(Boolean).join('\n')
  };
}

function get_entry_point_output_chunk(chunks: OutputChunk[], entry_point: string | undefined) {
  if (entry_point === undefined) {
    throw new Error("Internal error: entry_point cannot be undefined")
  }

  const entry_point_output_chunk = chunks.find(chunk => chunk.modules[entry_point])
  if (!entry_point_output_chunk) {
    throw new Error(`Internal error: No chunk for entry point: ${entry_point} in: ${chunks.map(chunk => Object.keys(chunk.modules))}`)
  }

  if (entry_point_output_chunk.type !== 'chunk') {
    throw new Error(`Internal error: Wrong type for entry point chunk: ${entry_point} in: ${chunks.map(chunk => Object.keys(chunk.modules))}`)
  }

  return entry_point_output_chunk
}

export interface SapperClientPackage {
  sapper: ClientResourceSet
}

interface SapperClientPluginOptions {
  sourcemap: boolean | 'inline';
  emit?: (crs: ClientResourceSet) => void
  manifest_data: CodegenManifest;
}

function make_essential_module_filter(ctx: PluginContext, chunk: OutputChunk, essential_imports: (module_info: ModuleInfo) => string[]) {
  const essential_module_ids = new Set<string>()
  for (const module_id of Object.keys(chunk.modules)) {
    const module_info = ctx.getModuleInfo(module_id)
    for (const id of essential_imports(module_info)) {
      essential_module_ids.add(id)
    }
  }

  return (id: string) => essential_module_ids.has(id)
}

export function SapperClientPlugin({
  sourcemap,
  emit,
  manifest_data,
}: SapperClientPluginOptions): Plugin {
  let entry_point: string | undefined
  let client_resources: ClientResourceSet | undefined
  const warnings: RollupWarning[] = []

  return {
    name: 'sapper-client',
    buildStart(this: PluginContext, options: NormalizedInputOptions): void {
      console.log("buildStart")
      const input = options.input
      const inputs: { alias: string, file: string }[] = []

      if (typeof input === 'string') {
        inputs.push({ alias: 'main', file: input })
      } else if (Array.isArray(input)) {
        inputs.push(...input.map((file, i) => ({ file, alias: i === 0 ? 'main' : file })))
      } else {
        for (const alias in input) {
          inputs.push({ file: input[alias], alias })
        }
      }

      console.log({ inputs})

      if (!entry_point) {
        entry_point = inputs[0].file
        if (!/\.[mc]?js$/.test(entry_point)) {
          entry_point = entry_point + ".js"
        }
        entry_point = path.resolve(entry_point)
      }

      // we need to emit client assets here, using a nested build of rollup (!)
    },
    transform(this: TransformPluginContext, code: string, id: string): TransformResult {
      if (/\.css$/.test(id)) {
        return ``;
      }

      return null
    },
    async generateBundle(this: PluginContext, options: NormalizedOutputOptions, bundle: OutputBundle): Promise<void> {
      const output_chunks = Object.values(bundle).filter(output => output.type === 'chunk') as OutputChunk[]
      const output_chunk_bundle = Object.fromEntries(Object.entries(bundle).filter(([_, output]) => output.type === 'chunk')) as Record<string, OutputChunk>
      const entry_point_output_chunk = get_entry_point_output_chunk(output_chunks, entry_point)

      const output_chunk_id = (chunk: OutputChunk) => chunk.fileName
      const resolve_output_chunk = (chunk_file: string) => {
        const oc = bundle[chunk_file]
        return oc && oc.type === 'chunk' ? oc : undefined
      }
      const css_module_imports = (js_module: string) => {
        const module_info = this.getModuleInfo(js_module)
        return [
          ...module_info.importedIds,
          ...(module_info.dynamicallyImportedIds || []),
        ].filter(id => /\.css$/.test(id))
      }
      const css_chunks_from_css_modules = async (chunk: OutputChunk, css_modules: Iterable<string>) => {
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
            type: 'style' as PageResourceType,
            manifest: css_modules,
            dep_ids: [],
            dynamic_dep_ids: [],
          },
        ]
      }

      const emitted: any[] = []
      const route_module_ids = new Set(manifest_data.components.map(c => c.file))
      const entry_point_chunk_resolver = new ChunkResolver<OutputChunk>({
        id: output_chunk_id,
        resolve_id: resolve_output_chunk,
        module_imports: css_module_imports,
        chunks_from_modules: css_chunks_from_css_modules,
        internals: chunk => {
          const is_essential_module = make_essential_module_filter(this, chunk,
              module_info => (module_info.dynamicallyImportedIds || []).filter(id => !route_module_ids.has(id)))

          const is_essential_chunk = (import_id: string) => {
            const output_chunk = output_chunk_bundle[import_id]
            // If we have the chunk in our output bundle, we might want to ignore it as non-essential.
            // The most obvious reason to do this is because it is a chunk that we *only* need to load a route.
            return output_chunk ? Object.keys(output_chunk.modules).some(id => is_essential_module(id)) : true
          }
          
          return {
            id: chunk.fileName,
            name: chunk.name,
            file_name: chunk.fileName,
            type: options.format === 'es' ? 'module' : 'script',
            manifest: Object.keys(chunk.modules),
            dep_ids: chunk.imports,
            dynamic_dep_ids: (chunk.dynamicImports || []).filter(id => is_essential_chunk(id)),
          }
        },
      })

      const route_chunk_resolver = new ChunkResolver<OutputChunk>({
        id: output_chunk_id,
        resolve_id: resolve_output_chunk,
        module_imports: css_module_imports,
        chunks_from_modules: css_chunks_from_css_modules,
        internals: chunk => {
          return {
            id: chunk.fileName,
            name: chunk.name,
            file_name: chunk.fileName,
            type: options.format === 'es' ? 'module' : 'script',
            manifest: Object.keys(chunk.modules),
            dep_ids: chunk.imports,
            dynamic_dep_ids: (chunk.dynamicImports || []),
          }
        },
      })

      // output chunks that are javascript
      const chunks = await Promise.all(output_chunks.map(chunk => route_chunk_resolver.resolve_chunk(chunk)))
      // console.log({ output_chunks: output_chunks.map(c => !!c) })
      // console.log({ chunks: chunks.map(c => !!c) })

      // We still issue preloads for a *top-level*, *unconditional* dynamic imports      
      const transitive_resource_deps = (c: Chunk) => {
        const essential_dynamic_chunks = new Set(
          discover_unconditional_imports(this, output_chunk_bundle[c.id].code)
            .filter(id => id.startsWith("./"))
            .map(id => id.substring(2))
        )

        return Array.from(walk_dep_graph([c], true))
          .reduce((acc, { dynamic, chunk }) => ((chunk.type === 'style' || !dynamic || essential_dynamic_chunks.has(chunk.id)) && acc.push(chunk), acc), [] as Chunk[])
      }

      client_resources = {
        main: await main_resource_dependencies({
          entry_point_chunk: await entry_point_chunk_resolver.resolve_chunk(entry_point_output_chunk),
          transitive_deps: transitive_resource_deps,
          resource_prefix: "",
        }),
        routes: await route_resource_dependencies({
          resolve_component: async route => {
            const resolved = await this.resolve(`${manifest_data.routes_alias}/${route}`)
            const chunk = resolved && chunks.find(chunk => chunk.manifest.has(resolved.id))
            if (!chunk) {
              throw new Error(`Internal error: could not find chunk that owns ${route}`);
            }

            return chunk
          },
          transitive_deps: transitive_resource_deps,
          components: manifest_data.components,
          resource_prefix: "",
        })
      };
      
      // console.log(graph(client_resources.routes, chunk_resolver.chunks()))

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

      if (emit) {
        emit(client_resources)
      }
    },
  }
}
