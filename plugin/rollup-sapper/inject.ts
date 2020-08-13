import { PageResource } from './interfaces';

import { dedupe, Json } from './resources'

function flatten_and_dedupe<T extends Json>(lists: T[][]): T[] {
  return dedupe((<T[]>[]).concat(...lists))
}

export function replace_pattern_in_source_code(
  source: string,
  pattern: RegExp,
  replace_fn: (m: string, ...groups: any[]) => { quotes: string, replacement: string },
) {
  return source.replace(pattern, (m, ...groups) => {
    let { quotes, replacement } = replace_fn(m, ...groups)
    // console.log("replacing", pattern, m, "with", replacement)

    // If the quotation marks are escaped, then
    // the source code is in a string literal
    // (e.g., source maps) rather than raw
    // JavaScript source. We need to stringify
    // again and then remove the extra quotation
    // marks so that replacement is correct.
    if (quotes[0] === '\\') {
      replacement = JSON.stringify(replacement);
      replacement = replacement.substring(1, replacement.length - 1);
    }

    return replacement;
  });
}

export default function inject_resources(
  source: string,
  route_resources: Record<string, PageResource[]>,
  main_resources: PageResource[],
  main_legacy_resources: PageResource[],
): string {
  let replaced = replace_pattern_in_source_code(
    source,
    /(\\?["'])__SAPPER_CSS_PLACEHOLDER:([^"']+?)__\1/g,
    (m, quotes, route) => {
      const css_deps = (route_resources[route] || []).filter(({ type }) => type === 'style').map(({ file }) => file)
      return {
        quotes,
        replacement: JSON.stringify(
          process.env.SAPPER_LEGACY_BUILD && css_deps ?
            css_deps.map(_ => `legacy/${_}`) :
            css_deps
        ),
      }
    }
  )

  replaced = replace_pattern_in_source_code(
    replaced,
    /(\\?["'])__SAPPER_RESOURCES_PLACEHOLDER:([^"']+?)__\1/g,
    (m, quotes: string, routes_str: string) => {
      return {
        quotes,
        replacement: JSON.stringify(
          flatten_and_dedupe(
            routes_str.split(":").map(route => route_resources[route] || [])
          )
        )
      }
    }
  )

  replaced = replace_pattern_in_source_code(
    replaced,
    /(\\?["'])__SAPPER_MAIN_RESOURCES_PLACEHOLDER__\1/g,
    (m, quotes) => {
      return {
        quotes,
        replacement: JSON.stringify(main_resources)
      }
    }
  )

  replaced = replace_pattern_in_source_code(
    replaced,
    /(\\?["'])__SAPPER_MAIN_LEGACY_RESOURCES_PLACEHOLDER__\1/g,
    (m, quotes) => {
      return {
        quotes,
        replacement: JSON.stringify(main_legacy_resources)
      }
    }
  )
      
  return replaced
}
