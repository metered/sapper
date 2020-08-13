import sucrase from 'rollup-plugin-sucrase';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import { builtinModules } from 'module';

function template(kind, external) {
	return {
		input: `runtime/src/${kind}/index.ts`,
		output: {
			file: `runtime/${kind}.mjs`,
			format: 'es',
		},
		external,
		plugins: [
			resolve({
				extensions: ['.mjs', '.js', '.ts', '.json']
			}),
			commonjs(),
			sucrase({
				transforms: ['typescript']
			})
		]
	};
}

export default template('server', id => /^(svelte\/?|@sapper\/)/.test(id) || builtinModules.includes(id))
