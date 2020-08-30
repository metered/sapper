// export function find<T>(ts: Iterable<T>, fn: (t: T) => boolean): T | undefined {
//   for (const t of ts) {
//     if (fn(t)) {
//       return t
//     }
//   }
//   return undefined
// }

export type ChunkType = 'script' | 'module' | 'style'

export interface ChunkMeta {
  readonly id: string;
  readonly name: string;
  readonly type: ChunkType;
  readonly file_name: string;
}

export interface Chunk extends ChunkMeta {
  readonly deps: Iterable<this>;
  readonly dynamic_deps: Iterable<this>;
  readonly manifest: ReadonlySet<string>;
}

export interface Internals extends ChunkMeta {
  readonly dep_ids: Iterable<string>;
  readonly dynamic_dep_ids: Iterable<string>;
  readonly manifest: Iterable<string>;
}

export function* walk_dep_graph(chunks: Iterable<Chunk>, include_dynamic: boolean, seen_dynamic?: Set<Chunk>, seen_static?: Set<Chunk>, is_dynamic?: boolean): Generator<{dynamic: boolean, chunk: Chunk}> {
  if (!seen_static) {
    seen_static = new Set<Chunk>()
  }

  if (!seen_dynamic) {
    seen_dynamic = new Set<Chunk>()
  }

  if (is_dynamic === undefined) {
    is_dynamic = false
  }

  const seen = is_dynamic ? seen_dynamic : seen_static

  for (const chunk of chunks) {
    if (seen.has(chunk)) {
      continue
    }

    seen.add(chunk)

    yield {
      dynamic: is_dynamic,
      chunk,
    }

    yield* walk_dep_graph(chunk.deps, include_dynamic, seen_dynamic, seen_static, is_dynamic)

    if (include_dynamic) {
      yield* walk_dep_graph(chunk.dynamic_deps, include_dynamic, seen_dynamic, seen_static, true)
    }
  }
}

export class ChunkResolver<S> {
  private readonly resolve_id: ((chunk_file: string) => S | undefined);
  private readonly id: (s: S) => string;
  private readonly internals: (s: S) => Internals;

  private readonly module_imports: (importer_module_id: string) => Iterable<string>;
  private readonly chunks_from_modules: (s: S, module_ids: Iterable<string>) => PromiseLike<Iterable<Internals>> | Iterable<Internals>;
  private readonly chunk_cache: Map<string, Chunk>;

  constructor(opt: {
    resolve_id: ((chunk_file: string) => S | undefined),
    id: (s: S) => string,
    internals: (s: S) => Internals,
    module_imports: (importer_module_id: string) => Iterable<string>,    
    chunks_from_modules: (s: S, module_ids: Iterable<string>) => PromiseLike<Iterable<Internals>> | Iterable<Internals>,
  }) {
    this.resolve_id = opt.resolve_id
    this.id = opt.id
    this.internals = opt.internals
    this.module_imports = opt.module_imports
    this.chunks_from_modules = opt.chunks_from_modules
    this.chunk_cache = new Map<string, Chunk>()
  }

  private async define_chunk(id: string, internals: Internals) {
    if (this.chunk_cache.has(id)) {
      throw new Error(`Name collision: already have a chunk with id: ${id}`)
    }

    const chunk = {
      id,
      name: internals.name,
      type: internals.type,
      file_name: internals.file_name,
      manifest: new Set(internals.manifest),
      deps: [] as Chunk[],
      dynamic_deps: [] as Chunk[],
    }
    this.chunk_cache.set(id, chunk)

    for (const dep_id of internals.dep_ids) {
      const dep_chunk = await this.resolve_chunk_by_id(dep_id)
      if (dep_chunk) {
        chunk.deps.push(dep_chunk)
      } else {
        console.log(`While defining "${id}", needed missing "${dep_id}". Have: ${JSON.stringify(Array.from(this.chunk_cache.keys()))}`)
      }
    }

    for (const dynamic_dep_id of internals.dynamic_dep_ids) {
      const dynamic_dep_chunk = await this.resolve_chunk_by_id(dynamic_dep_id)
      if (dynamic_dep_chunk) {
        chunk.dynamic_deps.push(dynamic_dep_chunk)
      } else {
        console.log(`While defining "${id}", needed missing "${dynamic_dep_id}". Have: ${JSON.stringify(Array.from(this.chunk_cache.keys()))}`)
      }
    }

    return chunk
  }

  resolve_chunk_by_id(id: string): Promise<Chunk> | Chunk | undefined {
    const chunk = this.chunk_cache.get(id)
    const s = this.resolve_id(id)
    return chunk || (s && this.resolve_chunk(s))
  }

  resolve_chunk(s: S): Promise<Chunk>;
  resolve_chunk(s: undefined): Promise<undefined>;
  resolve_chunk(s: S | undefined): Promise<Chunk | undefined>;
  async resolve_chunk(s: S | undefined): Promise<Chunk | undefined> {
    if (!s) {
      return undefined
    }

    const id = this.id(s)
    let chunk = this.chunk_cache.get(id)
    if (!chunk) {
      const c = await this.define_chunk(id, this.internals(s))

      // accumulate a set of orphaned_module_ids imported by this s but not by any of imports.
      const orphaned_module_ids = new Set<string>()
      for (const module of c.manifest) {
        for (const addl_module of this.module_imports(module)) {
          let imported_by = undefined
          for (const visit of walk_dep_graph(c.deps, false)) {
            if (visit.chunk.manifest.has(module)) {
              imported_by = visit
              break
            }
          }

          if (!imported_by) {
            orphaned_module_ids.add(addl_module)
            if (addl_module.endsWith(".css")) { console.log("addl_module  needed", addl_module, id) }
          } else {
            if (addl_module.endsWith(".css")) { console.log("addl_module covered", addl_module, id, imported_by.chunk.id) }
          }
        }
      }

      // if we have anything orphaned, then promote them to be a chunk of their own.
      console.log("orphaned_module_ids.size", orphaned_module_ids)
      if (orphaned_module_ids.size) {
        for (const proto_chunk of await this.chunks_from_modules(s, orphaned_module_ids)) {
          const new_chunk: Chunk = await this.define_chunk(proto_chunk.id, proto_chunk)
          c.deps.push(new_chunk)
        }
      }

      chunk = c
    }

    return chunk
  }

  chunks() {
    return this.chunk_cache.values()
  }
}
