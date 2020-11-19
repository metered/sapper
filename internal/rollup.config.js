import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import { SapperServerPlugin } from 'sapper/rollup'

const mode = process.env.NODE_ENV || (process.env.COMPILATION_MODE === "fastbuild" ?  "development" : "production");
const dev = mode === 'development';

const builtinModules = require('module').builtinModules

module.exports = {
  external: [
    'superagent-proxy', // superagent
    ...require('module').builtinModules,
    /@opentelemetry\//,

    'aws-sdk/clients/ssm',
  ],
  plugins: [
    json(),
    resolve({
      preferBuiltins: true,
      extensions: ['.mjs', '.ssr.mjs', '.js', '.json', '.node'],
      dedupe: ['svelte']
    }),
    commonjs(),
    replace({
      'process.browser': 'false',
    }),
    ...SapperServerPlugin({
      sourcemap: false,
      // sourcemap: dev ? 'inline' : false,

      manifest_path: `${manifest_path}`,
      client_config_path: `${client_bundler_config}`,
      client_entry_point: `${client_entry_point}`,

      static_dir: `${static_dir}`,
      routes_alias: `${routes_alias}`,
      routes_src_dir: `${routes_src_dir}`,
      package_alias: `${package_alias}`,
      template_path: `${template_path}`,
      // TODO fix this!
      has_service_worker: false,
      route_static_extensions: ['.svelte', '.html'],
      dev,
    }),
  ],

  preserveEntrySignatures: 'strict',
  onwarn(warning/*: RollupWarning*/, handler/*: WarningHandler*/) {
  // We don't want any unresloved imports in our bundle
    // if there is, it either means stuff is broken or there's a missing dependency
    if (warning.code === 'UNRESOLVED_IMPORT') {
      throw new Error(warning.message);
    }

    if (warning.code === 'CIRCULAR_DEPENDENCY' && /[/\\]@sapper[/\\]/.test(warning.message)) {
      return
    }

    // Use default for everything else
    handler(warning);
  },
};
