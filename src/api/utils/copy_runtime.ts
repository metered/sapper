import * as fs from 'fs';
import * as path from 'path';
import { mkdirp } from './fs_utils';

const runtime = [
	{src: 'app.mjs.js', dst: 'app.mjs' },
	{src: 'server.mjs.js', dst: 'server.mjs' },
	{src: 'internal/shared.mjs' },
	{src: 'internal/layout.svelte' },
	{src: 'internal/error.svelte' },
].map(({src, dst}) => ({
	file: dst || src,
	source: fs.readFileSync(path.join(__dirname, `../../../runtime/${src}`), 'utf-8')
}));

export function copy_runtime(output: string) {
	runtime.forEach(({ file, source }) => {
		mkdirp(path.dirname(`${output}/${file}`));
		fs.writeFileSync(`${output}/${file}`, source);
	});
}