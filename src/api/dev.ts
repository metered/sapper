import * as path from 'path';
import * as http from 'http';
import * as child_process from 'child_process';
import * as ports from 'port-authority';
import { EventEmitter } from 'events';
import {
	read_template,
} from 'sapper/core';
import Deferred from './utils/Deferred';
import validate_bundler from './utils/validate_bundler';
import { copy_shimport } from './utils/copy_shimport';
import {
	FatalEvent,
	InvalidEvent
} from '../interfaces';
import { copy_runtime } from './utils/copy_runtime';
import { rimraf, mkdirp } from './utils/fs_utils';

type Opts = {
	cwd?: string,
	src?: string,
	dest?: string,
	routes?: string,
	output?: string,
	static?: string,
	'dev-port'?: number,
	live?: boolean,
	hot?: boolean,
	'devtools-port'?: number,
	bundler?: 'rollup' | 'webpack',
	port?: number,
	ext: string
};

export function dev(opts: Opts) {
	return new Watcher(opts);
}

class Watcher extends EventEmitter {
	bundler: 'rollup' | 'webpack';
	dirs: {
		cwd: string;
		src: string;
		dest: string;
		routes: string;
		output: string;
		static: string;
	}
	port: number;
	closed: boolean;

	dev_port?: number;
	live?: boolean;
	hot?: boolean;

	devtools_port?: number;

	dev_server?: DevServer;
	proc?: child_process.ChildProcess | null;
	filewatchers: Array<{ close: () => void }>;
	deferred?: Deferred;

	crashed?: boolean;
	restarting?: boolean;
	current_build: {
		changed: Set<string>;
		rebuilding: Set<'server' | 'client' | 'serviceworker'>;
		unique_warnings: Set<string>;
		unique_errors: Set<string>;
	}
	ext: string;

	constructor({
		cwd = '.',
		src = 'src',
		routes = 'src/routes',
		output = 'src/node_modules/@sapper',
		static: static_files = 'static',
		dest = '__sapper__/dev',
		'dev-port': dev_port,
		live,
		hot,
		'devtools-port': devtools_port,
		bundler,
		port = +(process.env.PORT || '0'),
		ext
	}: Opts) {
		super();

		cwd = path.resolve(cwd);

		this.bundler = validate_bundler(bundler);
		this.dirs = {
			cwd,
			src: path.resolve(cwd, src),
			dest: path.resolve(cwd, dest),
			routes: path.resolve(cwd, routes),
			output: path.resolve(cwd, output),
			static: path.resolve(cwd, static_files)
		};
		this.ext = ext;
		this.port = port;
		this.closed = false;

		this.dev_port = dev_port;
		this.live = live;
		this.hot = hot;

		this.devtools_port = devtools_port;

		this.filewatchers = [];

		this.current_build = {
			changed: new Set(),
			rebuilding: new Set(),
			unique_errors: new Set(),
			unique_warnings: new Set()
		};

		// remove this in a future version
		const template = read_template(src);
		if (template.indexOf('%sapper.base%') === -1) {
			const error: Error & { code?: string } = new Error(`As of Sapper v0.10, your template.html file must include %sapper.base% in the <head>`);
			error.code = `missing-sapper-base`;
			throw error;
		}

		process.env.NODE_ENV = 'development';

		process.on('exit', () => {
			this.close();
		});

		this.init();
	}

	async init() {
		if (this.port) {
			if (!await ports.check(this.port)) {
				this.emit('fatal', <FatalEvent>{
					message: `Port ${this.port} is unavailable`
				});
				return;
			}
		} else {
			this.port = await ports.find(3000);
		}

		const {
			dest,
			output,
		} = this.dirs;

		rimraf(output);
		mkdirp(output);
		copy_runtime(output);

		rimraf(dest);
		mkdirp(`${dest}/client`);
		if (this.bundler === 'rollup') copy_shimport(dest);

		if (!this.dev_port) this.dev_port = await ports.find(10000);

		// Chrome looks for debugging targets on ports 9222 and 9229 by default
		if (!this.devtools_port) this.devtools_port = await ports.find(9222);

		// TODO watch the configs themselves?
	}

	close() {
		if (this.closed) return;
		this.closed = true;

		if (this.dev_server) this.dev_server.close();

		if (this.proc) this.proc.kill();
		this.filewatchers.forEach(watcher => {
			watcher.close();
		});
	}

	restart(filename: string, type: 'client' | 'server' | 'serviceworker') {
		if (this.restarting) {
			this.current_build.changed.add(filename);
			this.current_build.rebuilding.add(type);
		} else {
			this.restarting = true;

			this.current_build = {
				changed: new Set([filename]),
				rebuilding: new Set([type]),
				unique_warnings: new Set(),
				unique_errors: new Set()
			};

			process.nextTick(() => {
				this.emit('invalid', <InvalidEvent>{
					changed: Array.from(this.current_build.changed),
					invalid: {
						server: this.current_build.rebuilding.has('server'),
						client: this.current_build.rebuilding.has('client'),
						serviceworker: this.current_build.rebuilding.has('serviceworker'),
					}
				});

				this.restarting = false;
			});
		}
	}

}

const INTERVAL = 10000;

class DevServer {
	clients: Set<http.ServerResponse>;
	interval: ReturnType<typeof setTimeout>;
	_: http.Server;

	constructor(port: number, interval = 10000) {
		this.clients = new Set();

		this._ = http.createServer((req, res) => {
			if (req.url !== '/__sapper__') return;

			req.socket.setKeepAlive(true);
			res.writeHead(200, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': 'Cache-Control',
				'Content-Type': 'text/event-stream;charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				'Connection': 'keep-alive',
				// While behind nginx, event stream should not be buffered:
				// http://nginx.org/docs/http/ngx_http_proxy_module.html#proxy_buffering
				'X-Accel-Buffering': 'no'
			});

			res.write('\n');

			this.clients.add(res);
			req.on('close', () => {
				this.clients.delete(res);
			});
		});

		this._.listen(port);

		this.interval = setInterval(() => {
			this.send(null);
		}, INTERVAL);
	}

	close() {
		this._.close();
		clearInterval(this.interval);
	}

	send(data: any) {
		this.clients.forEach(client => {
			client.write(`data: ${JSON.stringify(data)}\n\n`);
		});
	}
}







