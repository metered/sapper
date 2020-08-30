import * as fs from 'fs';
import * as path from 'path';
import { create_app, create_manifest_data } from 'sapper/core';
import validate_bundler from './utils/validate_bundler';
import { copy_runtime } from './utils/copy_runtime';
import { rimraf, mkdirp } from './utils/fs_utils';
import { posixify } from '../utils';

type Opts = {
  cwd?: string;
  src?: string;
  routes?: string;
  routes_alias?: string;
  output?: string;
  bundler?: 'rollup' | 'webpack';
  dev?: boolean;
  has_service_worker?: boolean;
  ext?: string;
};

export async function codegen({
  cwd = ".",
  src = 'src',
  routes = 'src/routes',
  routes_alias,
  output = 'src/node_modules/@sapper',
  bundler,
  dev = false,
  has_service_worker = false,
  ext,
}: Opts = {}) {
  bundler = validate_bundler(bundler);

  routes_alias = routes_alias || routes

  cwd = path.resolve(cwd);
  src = path.resolve(cwd, src);
  routes = path.resolve(cwd, routes);
  output = path.resolve(cwd, output);

  rimraf(output);
  mkdirp(output);
  copy_runtime(output);

  const manifest_data_path = path.join(output, 'internal', 'manifest-data.json')

  const manifest_data = create_manifest_data(routes, routes_alias, ext);
  await fs.promises.writeFile(manifest_data_path, JSON.stringify(manifest_data));

  // routes.startsWith('@') ? routes : path.relative(`${output}/internal`, routes)
  const src_dir = posixify(path.normalize(path.relative(cwd, src)));
  const template_path = `${src_dir}/template.html`

  // create src/node_modules/@sapper/app.mjs and server.mjs
  create_app({
    bundler,
    manifest_data,
    template_path,
    routes_alias,
    output,
    dev,
    has_service_worker,
  });
}
