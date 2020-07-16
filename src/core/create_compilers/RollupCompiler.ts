import * as path from 'path';
import color from 'kleur';
import relative from 'require-relative';
import { RollupError, RenderedChunk, WarningHandler, RollupWarning, InputOptions, rollup as _rollup, watch as _watch, InputOption } from 'rollup';
import { Compiler, CompileResult } from './interfaces';
import RollupResult from './RollupResult';

const stderr = console.error.bind(console);

let rollup: {rollup: typeof _rollup, watch: typeof _watch};

export default class RollupCompiler implements Compiler<RollupResult> {
	_: Promise<any>;
	_oninvalid?: (filename: string) => void;
	_start: number;
	input: InputOption;
	warnings: RollupWarning[];
	errors: any[];
	chunks: RenderedChunk[];
	css_files: Array<{ id: string, code: string }>;

	constructor(config: any) {
		this._ = this.get_config(config);
		this._start = Date.now()
		this.input = "";
		this.warnings = [];
		this.errors = [];
		this.chunks = [];
		this.css_files = [];
	}

	async get_config(mod: any) {
		// TODO this is hacky, and doesn't need to apply to all three compilers
		(mod.plugins || (mod.plugins = [])).push({
			name: 'sapper-internal',
			options: (opts: InputOptions) => {
				if (opts.input === undefined) {
					throw new Error("Internal error: input from rollup is undefined")
				}
				this.input = opts.input;
			},
			renderChunk: (code: string, chunk: RenderedChunk) => {
				console.log("renderChunk", {chunk})
				this.chunks.push(chunk);
			},
			transform: (code: string, id: string) => {
				if (/\.css$/.test(id)) {
					this.css_files.push({ id, code });
					return ``;
				}
			}
		});

		const onwarn = mod.onwarn || ((warning: RollupWarning, handler: WarningHandler) => {
			handler(warning);
		});

		mod.onwarn = (warning: any) => {
			onwarn(warning, (warning: RollupWarning) => {
				this.warnings.push(warning);
			});
		};

		return mod;
	}

	oninvalid(cb: (filename: string) => void) {
		this._oninvalid = cb;
	}

	async compile(): Promise<RollupResult> {
		const config = await this._;
		const sourcemap = config.output.sourcemap;

		const start = Date.now();

		try {
			const bundle = await rollup.rollup(config);
			await bundle.write(config.output);

			return new RollupResult(Date.now() - start, this, sourcemap);
		} catch (err) {
			// flush warnings
			stderr(new RollupResult(Date.now() - start, this, sourcemap).print());

			handleError(err);

			// should never get here.
			throw err
		}
	}

	async watch(cb: (err?: Error, stats?: RollupResult) => void) {
		const config = await this._;
		const sourcemap = config.output.sourcemap;

		const watcher = rollup.watch(config);

		watcher.on('change', (id: string) => {
			this.chunks = [];
			this.warnings = [];
			this.errors = [];
			this._oninvalid && this._oninvalid(id);
		});

		watcher.on('event', (event: any) => {
			switch (event.code) {
				case 'FATAL':
					// TODO kill the process?
					if (event.error.filename) {
						// TODO this is a bit messy. Also, can
						// Rollup emit other kinds of error?
						event.error.message = [
							`Failed to build — error in ${event.error.filename}: ${event.error.message}`,
							event.error.frame
						].filter(Boolean).join('\n');
					}

					cb(event.error);
					break;

				case 'ERROR':
					this.errors.push(event.error);
					cb(undefined, new RollupResult(Date.now() - this._start, this, sourcemap));
					break;

				case 'START':
				case 'END':
					// TODO is there anything to do with this info?
					break;

				case 'BUNDLE_START':
					this._start = Date.now();
					break;

				case 'BUNDLE_END':
					cb(undefined, new RollupResult(Date.now() - this._start, this, sourcemap));
					break;

				default:
					console.log(`Unexpected event ${event.code}`);
			}
		});
	}

	static async load_config(cwd: string) {
		if (!rollup) rollup = relative('rollup', cwd);

		const input = path.resolve(cwd, 'rollup.config.js');

		const bundle = await rollup.rollup({
			input,
			inlineDynamicImports: true,
			external: (id: string) => {
				return (id[0] !== '.' && !path.isAbsolute(id)) || id.slice(-5, id.length) === '.json';
			}
		});

		const resp = await bundle.generate({ format: 'cjs' });
		const { code } = resp.output ? resp.output[0] : (resp as any);

		// temporarily override require
		const defaultLoader = require.extensions['.js'];
		require.extensions['.js'] = (module: any, filename: string) => {
			if (filename === input) {
				module._compile(code, filename);
			} else {
				defaultLoader(module, filename);
			}
		};

		const config: any = require(input);
		delete require.cache[input];

		return config;
	}
}


// copied from https://github.com/rollup/rollup/blob/master/cli/logging.ts
// and updated so that it will compile here

export function handleError(err: RollupError, recover = false) {
	let description = err.message || err;
	if (err.name) description = `${err.name}: ${description}`;
	const message =
		(err.plugin
			? `(plugin ${(err).plugin}) ${description}`
			: description) || err;

	stderr(color.bold().red(`[!] ${color.bold(message.toString())}`));

	if (err.url) {
		stderr(color.cyan(err.url));
	}

	if (err.loc) {
		stderr(`${(err.loc.file || err.id)!} (${err.loc.line}:${err.loc.column})`);
	} else if (err.id) {
		stderr(err.id);
	}

	if (err.frame) {
		stderr(color.dim(err.frame));
	}

	if (err.stack) {
		stderr(color.dim(err.stack));
	}

	stderr('');

	if (!recover) process.exit(1);
}
