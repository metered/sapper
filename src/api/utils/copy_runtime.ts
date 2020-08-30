import * as fs from 'fs';
import * as path from 'path';
import { mkdirp } from './fs_utils';
import { compile as svelte_compile } from 'svelte/compiler';
import { CompileOptions } from 'svelte/types/compiler/interfaces';


const runtime = [
	{src: 'app.mjs.js', dst: 'app.mjs' },
	{src: 'server.mjs.js', dst: 'server.mjs' },
	{src: 'internal/shared.mjs' },
	{src: 'internal/layout.svelte' },
	{src: 'internal/error.svelte' },
].map(({src, dst}) => ({
	file: dst || src,
	source: fs.readFileSync(path.join(__dirname, `../runtime/${src}`), 'utf-8')
}));

export function copy_runtime(output: string) {
	runtime.forEach(({ file, source }) => {
		mkdirp(path.dirname(`${output}/${file}`));
		fs.writeFileSync(`${output}/${file}`, source);
	});
}

export function runtime_codegen(prefix: string, svelte_options: CompileOptions) {
	const emitters: Record<string, () => Promise<string>> = {}
	for (const {file, source} of runtime) {
		if (file.endsWith('.mjs')) {
			emitters[prefix + file.replace(/\.mjs$/, '')] = async () => source
		}	else if (file.endsWith('.svelte')) {
			const { js } = svelte_compile(source, svelte_options)
			emitters[prefix + file] = async () => js.code
		} else {
			emitters[prefix + file] = async () => source
		}
	}

	return emitters
}
