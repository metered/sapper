import { UserPageComponent, PageResourceNode, PageResource } from './interfaces';

type JsonPrimitive = string | number | boolean | null
interface JsonMap extends Record<string, JsonPrimitive | JsonArray | JsonMap> { }
interface JsonArray extends Array<JsonPrimitive | JsonArray | JsonMap> { }
export type Json = JsonPrimitive | JsonMap | JsonArray

export function dedupe<T extends Json>(ts: T[]): T[] {
  const deduped = new Set(ts.map(e => JSON.stringify(e)))
  return Array.from(deduped).sort().map(s => JSON.parse(s) as T)
}

function chunk_resources(resource_prefix: string, chunk_deps: Iterable<PageResourceNode>) {
  return dedupe<PageResource>(
    Array.from(chunk_deps, n => ({
      type: n.type,
      file: `${resource_prefix}${n.file_name}`,
    }))
  )
}

export async function resource_dependencies(
  entry_point_chunk: PageResourceNode,
  resolve_component: (file: string) => Promise<PageResourceNode>,
  components: UserPageComponent[],
  resource_prefix: string
) {
  const route_resources: Record<string, PageResource[]> = {}

  // figure out which chunks each component depends on
  for (const component of components) {
    const chunk = await resolve_component(component.file)
    const chunk_deps = [chunk, ...chunk.transitive_deps]
    route_resources[component.file] = chunk_resources(resource_prefix, chunk_deps)
  }

  const main_resources = chunk_resources(resource_prefix, [entry_point_chunk, ...entry_point_chunk.transitive_deps])

  return {
    main: main_resources,
    routes: route_resources,
  };
}

