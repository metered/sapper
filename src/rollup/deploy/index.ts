import {
  Plugin,
  PluginContext,
  NormalizedInputOptions,
  NormalizedOutputOptions,
  OutputBundle,
} from 'rollup'

import * as fs from 'fs';
import * as path from 'path';
import { RouteHeader, RouteManifest, RouteManifestAssets } from '../../interfaces';

function* get_assets_visitor(
  manifest_path: string,
  manifest: RouteManifest,
): Iterable<{ name: string, headers: RouteHeader[], read: () => Promise<Uint8Array> }> {
  const assets_manifest = manifest.assets
  const entries = assets_manifest.entries

  console.log({
    "assets_manifest.directory": assets_manifest.directory,
    "assets_manifest.entries": entries,
  })

  for (const [name, entry] of Object.entries(entries)) {
    yield {
      name,
      ...entry,
      read(): Promise<Uint8Array> {
        const p = path.resolve(path.dirname(manifest_path), path.join(assets_manifest.directory, name))
        return fs.promises.readFile(p)
      }
    }
  }
}

interface SapperDeployPluginOptions {
  input_manifest_path: string;
  output_manifest_name: string;
}

export function SapperDeployPlugin({
  input_manifest_path,
  output_manifest_name,
}: SapperDeployPluginOptions): Plugin[] {
  let sapper_manifest_data: RouteManifest

  const assetX: Record<string, { headers?: RouteHeader[] }> = {}

  return [
    {
      name: 'sapper-deploy',
      async buildStart(this: PluginContext, options: NormalizedInputOptions): Promise<void> {
        console.log({ input_manifest_path })
        sapper_manifest_data = JSON.parse(await fs.promises.readFile(input_manifest_path, 'utf-8'))

        const emitAsset = (file: { name: string, source: string | Uint8Array, headers?: RouteHeader[] }) => {
          const referenceId = this.emitFile({
            type: 'asset',
            source: file.source,
            name: file.name,
          })
          assetX[referenceId] = { headers: file.headers }
        }

        for (const asset of get_assets_visitor(input_manifest_path, sapper_manifest_data)) {
          emitAsset({
            name: asset.name,
            source: await asset.read(),
            headers: asset.headers,
          })
        }

        console.dir({ sapper_manifest_data }, { depth: null })
      },
      async generateBundle(this: PluginContext, options: NormalizedOutputOptions, bundle: OutputBundle) {
        const manifest_assets: RouteManifestAssets = {
          directory: path.dirname(options.assetFileNames as string), // this must be a string!! (not a fn),
          entries: {},
        }

        const manifest_asset_prefix_len = manifest_assets.directory.length + 1

        for (const [referenceId, { headers }] of Object.entries(assetX)) {
          const emittedFileName = this.getFileName(referenceId).substring(manifest_asset_prefix_len)
          manifest_assets.entries[emittedFileName] = {
            headers: headers || [],
          }
        }

        if (options.dir) {
          const output_manifest_path = path.join(options.dir, output_manifest_name)
          console.log({ "options.dir": options.dir, output_manifest_path})
          await fs.promises.writeFile(
            output_manifest_path,
            JSON.stringify({
              assets: manifest_assets,
              // functions: {
              //   "index.js": {}
              // },
            } as RouteManifest, null, 2)
          )
        }
      },
    }
  ]
}
