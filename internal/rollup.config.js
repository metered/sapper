import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import { SapperServerPlugin } from 'sapper/rollup'
// import { RollupWarning, WarningHandler } from 'rollup';

const mode = process.env.NODE_ENV || (process.env.COMPILATION_MODE === "fastbuild" ?  "development" : "production");
const dev = mode === 'development';

// declare const routes_alias: string
// declare const routes_src_dir: string
// declare const package_alias: string
// declare const template_path: string
// declare const client_bundler_config: string
// declare const client_entry_point: string

module.exports = {
  plugins: [
    replace({
      'process.browser': 'false',
      'process.env.NODE_ENV': `'${mode}'`
    }),
    json(),
    resolve({
      preferBuiltins: true,
      extensions: ['.mjs', '.ssr.mjs', '.js', '.json', '.node'],
      dedupe: ['svelte']
    }),
    commonjs(),
    ...SapperServerPlugin({
      sourcemap: dev ? 'inline' : false,
      typing: `${typing}`,
      typing_amd_module_name: `${typing_amd_module_name}`,
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
  external: (id/*: string*/, importer /*: string*/) => {
    const ex = [
      // Relative paths
      (id/*: string*/) => !/^\.\.?\//.test(id),
      // Routes
      (id/*: string*/) => !/^@\//.test(id),
      // Sapper runtime and generated code
      (id/*: string*/) => !/^@sapper\/?/.test(id),
      // Svelte code (to ensure it matches the version included in client)
      (id/*: string*/) => !/^svelte\/?/.test(id),
      // Svelte components
      (id/*: string*/) => !/\.svelte$/.test(id),

      (id/*: string*/) => ![
        // 'metered/packages/app-theme',
        // 'metered/packages/app-playground/python',
      ].includes(id),
    ].every(test => test(id))
    // console.log({id, importer, ex})

    return ex
  },

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
