import * as path from 'path';
import colors from 'kleur';
import pb from 'pretty-bytes';

import { CompileError } from '../interfaces';

export function left_pad(str: string, len: number) {
  while (str.length < len) str = ` ${str}`;
  return str;
}

export default function print(result: {
  warnings: CompileError[];
  chunks: {length: number, fileName: string, modules: Record<string, {renderedLength: number}>}[];
}) {
  return [
    result.warnings.map(warning => {
      return warning.file
        ? `> ${colors.bold(warning.file)}\n${warning.message}`
        : `> ${warning.message}`;
    }),

    result.chunks.map(chunk => {
      const size_color = chunk.length > 150000 ? colors.bold().red : chunk.length > 50000 ? colors.bold().yellow : colors.bold().white;
      const size_label = left_pad(pb(chunk.length), 10);

      const lines = [size_color(`${size_label} ${chunk.fileName}`)];

      const deps = Object.keys(chunk.modules)
        .map(file => {
          return {
            file: path.relative(process.cwd(), file),
            size: chunk.modules[file].renderedLength
          };
        })
        .filter(dep => dep.size > 0)
        .sort((a, b) => b.size - a.size);

      const total_unminified = deps.reduce((t, d) => t + d.size, 0);

      deps.forEach((dep, i) => {
        const c = i === deps.length - 1 ? '└' : '│';
        let line = `           ${c} ${dep.file}`;

        if (deps.length > 1) {
          const p = (100 * dep.size / total_unminified).toFixed(1);
          line += ` (${p}%)`;
        }

        lines.push(colors.gray(line));
      });

      return lines.join('\n');
    }).join('\n')
  ].join('\n\n')
}
