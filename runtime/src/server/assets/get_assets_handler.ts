import sirv from 'sirv';
import * as fs from 'fs';
import { dev, Req, Res, assets_manifest } from '@sapper/internal/manifest-server';

export function get_assets_handler<Rq extends Req, Rs extends Res>() {
  const entries = assets_manifest.entries
  console.log({
    "assets_manifest.directory": assets_manifest.directory,
    "assets_manifest.entries": entries,
  })
  return sirv<Rq, Rs>(assets_manifest.directory, {
    dev,
    setHeaders: (res: Rs, pathname: string, stats: fs.Stats) => {
      for (const { key, value } of entries[pathname.substring(1)]?.headers || []) {
        res.setHeader(key, value)
      }
    }
  })
}
