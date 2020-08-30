import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import * as fs from 'fs'
const pkg = JSON.parse(fs.readFileSync('./tools/sapper/package.json', 'utf-8'));

const external = [].concat(
	Object.keys(pkg.dependencies),
	Object.keys(process.binding('natives')),
	'sapper/core.js',
	'svelte/compiler',
);

export default {
	output: {
		sourcemap: true,
		chunkFileNames: '[name].js'
	},
	external,
	plugins: [
		// {
		// 	resolveId(id, importer) {
		// 		console.log("resolveId(", id, importer, ")");
		// 		return null;
		// 	}
		// },
		json(),
		resolve({
			preferBuiltins: true,
			extensions: ['.mjs', '.js']
		}),
		commonjs(),
	]
};
