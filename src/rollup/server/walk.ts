import * as fs from 'fs';
import * as path from 'path';

export async function* walk(dir: string): AsyncGenerator<{entry: string, read: () => Promise<Uint8Array>}> {
  try {
    await fs.promises.stat(dir)
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err
    }
    return
  }

  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield {
      entry,
      read: async () => await fs.promises.readFile(entry),
    };
  }
}
