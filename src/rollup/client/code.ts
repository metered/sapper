import * as codec from 'sourcemap-codec';

type SourceMap = {
  version: 3;
  file: string | null;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
};

const inline_sourcemap_header = 'data:application/json;charset=utf-8;base64,';

export function extract_sourcemap(raw: string, id: string) {
  let raw_map = <string | undefined>undefined;
  let map = null;

  const code = raw.replace(/\/\*#\s+sourceMappingURL=(.+)\s+\*\//g, (m, url) => {
    if (raw_map) {
      // TODO should not happen!
      throw new Error(`Found multiple sourcemaps in single file (${id})`);
    }

    raw_map = url;
    return '';
  }).trim();

  if (typeof raw_map === 'string') {
    if (raw_map.startsWith(inline_sourcemap_header)) {
      const json = Buffer.from(raw_map.slice(inline_sourcemap_header.length), 'base64').toString();
      map = JSON.parse(json);
    } else {
      // TODO do we want to handle non-inline sourcemaps? could be a rabbit hole
    }
  }

  return {
    code,
    map
  };
}

export async function chunk_content_from_modules(
  modules: Iterable<string>,
  resolve: (module: string) => Promise<{ code: string, map: SourceMap }>,
): Promise<{ code: string, map: SourceMap }> {
  const parts: string[] = [];
  const mappings: codec.SourceMapMappings = [];

  const sources = <string[]>[]
  const sourcesContent = <string[]>[]
  const names = <string[]>[]

  for (const module of modules) {
    const { code, map } = await resolve(module)

    parts.push(code);

    if (map) {
      const lines = codec.decode(map.mappings);

      if (sources.length > 0 || names.length > 0) {
        for (const line of lines) {
          for (const segment of line) {
            // adjust source index
            if (segment[1] !== undefined) segment[1] += sources.length;

            // adjust name index
            if (segment[4]) segment[4] += names.length;
          }
        }
      }

      sources.push(...map.sources);
      sourcesContent.push(...map.sourcesContent);
      names.push(...map.names);

      mappings.push(...lines);
    }
  }

  if (parts.length > 0) {
    console.log("using sources", sources, "but that's probably wrong. ideally we would have made it relative to some asset dir?")
    return {
      code: parts.join('\n'),
      map: {
        version: 3,
        file: null,
        // sources: sources.map(source => path.relative(asset_dir, source).replace(/\\/g, '/')),
        sources,
        sourcesContent,
        names,
        mappings: codec.encode(mappings)
      },
    };
  }

  throw new Error("Internal error: no content available for chunk")
}

export function emit_code_and_sourcemap({
  sourcemap,
  sourcemap_url_prefix,
  output_file_name,
  output: { map, code },
  emit,
}: {
  sourcemap: boolean | 'inline';
  sourcemap_url_prefix: string;
  output_file_name: string;
  output: { map: SourceMap, code: string };
  emit: (name: string, content: string) => string
}): string {
  map = Object.assign({}, map, { file: output_file_name });

  if (sourcemap === true) {
    const sourcemap_path = emit(`${output_file_name}.map`, JSON.stringify(map, null, '  '))
    code += `\n/*# sourceMappingURL=${sourcemap_url_prefix}${sourcemap_path} */`;
  }

  if (sourcemap === 'inline') {
    const base64 = Buffer.from(JSON.stringify(map), 'utf8').toString('base64')
    code += `\n/*# sourceMappingURL=${inline_sourcemap_header}${base64} */`;
  }

  return emit(output_file_name, code)
}
