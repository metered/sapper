import { Chunk } from "./chunk";
import { PageResource } from '../interfaces';

export function graph(routes: Record<string, PageResource[]>, chunks: Iterable<Chunk>) {
  const visited = new Set<Chunk>()
  const to_visit = new Set<Chunk>(chunks)
  const nodes = []
  const edges = []

  const route_label = (route: string) => JSON.stringify(`/${route.replace(/\.svelte/, '')}`)
  nodes.push(`{ rank = min; ${Object.keys(routes).map(d => route_label(d)).join("; ")} };`)
  for (const route of Object.keys(routes).sort()) {
    const resources = routes[route]
    for (const resource of resources) {
      edges.push(`  ${route_label(route)} -> ${JSON.stringify(resource.file)};`)
    }
  }

  for (const chunk of to_visit) {
    if (visited.has(chunk)) {
      continue
    }
    visited.add(chunk);

    for (const dep of chunk.deps) {
      to_visit.add(dep)

      edges.push(`  ${JSON.stringify(chunk.file_name)} -> ${JSON.stringify(dep.file_name)};`)
    }
  }


  // Style inspired by https://github.com/sverweij/dependency-cruiser/blob/develop/src/report/dot/default-theme.json
  // TODO give different colors to routes, script/module, css
  // TODO show total transitive size, direct size
  return `strict digraph {
  ordering=out;
  rankdir=LR;
  splines=true;
  overlap=false;
  nodesep=0.16;
  ranksep=0.18;
  fontname="Helvetica-bold";
  fontsize=9;
  style="rounded,bold,filled";
  fillcolor="#ffffff";
  compound=true;

  node [shape=box, style="rounded,filled", height=0.2, color=black, fillcolor="#ffffcc", fontcolor=black, fontname=Helvetica, fontsize=9];
  edge [arrowhead=normal, arrowsize=0.6, penwidth=2.0, color="#00000033", fontname=Helvetica, fontsize=9]

${nodes.join("\n")}
${edges.join("\n")}
}`
}
