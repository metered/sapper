import { UserPageComponent, PageResourceNode, PageResource, ClientResourceSet } from '../interfaces';

import { dedupe } from '../dedupe';

function chunk_resources(resource_prefix: string, chunk_deps: Iterable<PageResourceNode>) {
  return dedupe<PageResource>(
    Array.from(chunk_deps, n => ({
      type: n.type,
      file: `${resource_prefix}${n.file_name}`,
    }))
  )
}

export async function main_resource_dependencies<T extends PageResourceNode>({
  entry_point_chunk,
  transitive_deps,
  resource_prefix,
}: {
  entry_point_chunk: T,
  transitive_deps: (t: T) => Iterable<T>,
  resource_prefix: string
}) {
  return chunk_resources(resource_prefix, [entry_point_chunk, ...transitive_deps(entry_point_chunk)])
}

export async function route_resource_dependencies<T extends PageResourceNode>({
  resolve_component,
  transitive_deps,
  components,
  resource_prefix,
}: {
  resolve_component: (file: string) => Promise<T>,
  transitive_deps: (t: T) => Iterable<T>,
  components: UserPageComponent[],
  resource_prefix: string
}) {
  const route_resources: Record<string, PageResource[]> = {}

  // figure out which chunks each component depends on
  for (const component of components) {
    const chunk = await resolve_component(component.file)
    const chunk_deps = [chunk, ...transitive_deps(chunk)]

    route_resources[component.file] = chunk_resources(resource_prefix, chunk_deps)
  }

  return route_resources
}
