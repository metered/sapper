import * as fs from 'fs';
import * as path from 'path';
import minify_html from './utils/minify_html';
import {
	read_template
} from 'sapper/core';
import { copy_shimport } from './utils/copy_shimport';
import validate_bundler from './utils/validate_bundler';
import { copy_runtime } from './utils/copy_runtime';
import { rimraf, mkdirp } from './utils/fs_utils';

type Opts = {
	cwd?: string;
	src?: string;
	routes?: string;
	dest?: string;
	output?: string;
	static?: string;
	legacy?: boolean;
	bundler?: 'rollup' | 'webpack';
	ext?: string;
};

export async function build({
	cwd,
	src = 'src',
	routes = 'src/routes',
	output = 'src/node_modules/@sapper',
	static: static_files = 'static',
	dest = '__sapper__/build',

	bundler,
	legacy = false,
}: Opts = {}) {
	bundler = validate_bundler(bundler);

	cwd = path.resolve(cwd);
	src = path.resolve(cwd, src);
	dest = path.resolve(cwd, dest);
	routes = path.resolve(cwd, routes);
	output = path.resolve(cwd, output);
	static_files = path.resolve(cwd, static_files);

	if (legacy && bundler === 'webpack') {
		throw new Error(`Legacy builds are not supported for projects using webpack`);
	}


	rimraf(output);
	mkdirp(output);
	copy_runtime(output);

	rimraf(dest);
	mkdirp(`${dest}/client`);
	copy_shimport(dest);

	// minify src/template.html
	// TODO compile this to a function? could be quicker than str.replace(...).replace(...).replace(...)
	const template = read_template(src);
	fs.writeFileSync(`${dest}/template.html`, minify_html(template));


	// create src/node_modules/@sapper/app.mjs and server.mjs

	if (legacy) {
		process.env.SAPPER_LEGACY_BUILD = 'true';



		delete process.env.SAPPER_LEGACY_BUILD;
	}








}
