import fs from 'fs';
import path from 'path';
import mime from 'mime/lite';
import { build_dir, dev, manifest, Handler, Req, Res, ErrorHandler, BaseContextSeed, SessionSeed } from '@sapper/internal/manifest-server';
import { get_server_route_handler } from './get_server_route_handler';
import { get_page_handler } from './get_page_handler';
import { get_dev_handler } from './get_dev_handler';
import nodeFetch from 'node-fetch';

type IgnoreValue = Array<IgnoreValue> | RegExp | ((uri: string) => boolean) | string;

export type MiddlewareOptions<Rq extends Req, Rs extends Res> = {
	session?: SessionSeed<Rq, Rs>,
	context?: BaseContextSeed<Rq, Rs>,
	ignore?: IgnoreValue,
	error_handler?: ErrorHandler<Rq, Rs>,
}

export default function middleware<Rq extends Req, Rs extends Res>(opts: MiddlewareOptions<Rq, Rs> = {}) {
	const { session, error_handler, context, ignore } = opts;

	let emitted_basepath = false;

	return compose_handlers<Rq, Rs>(ignore, [
		(req: Rq, res: Rs, next: () => void) => {
			if (req.baseUrl === undefined) {
				let { originalUrl } = req;
				if (req.url === '/' && originalUrl[originalUrl.length - 1] !== '/') {
					originalUrl += '/';
				}

				req.baseUrl = originalUrl
					? originalUrl.slice(0, -req.url.length)
					: '';
			}

			if (!emitted_basepath && process.send) {
				process.send({
					__sapper__: true,
					event: 'basepath',
					basepath: req.baseUrl
				});

				emitted_basepath = true;
			}

			if (req.path === undefined) {
				req.path = req.url.replace(/\?.*/, '');
			}

			next();
		},

		dev && get_dev_handler(),

		fs.existsSync(path.join(build_dir, 'service-worker.js')) && serve({
			pathname: '/service-worker.js',
			cache_control: 'no-cache, no-store, must-revalidate'
		}),

		fs.existsSync(path.join(build_dir, 'service-worker.js.map')) && serve({
			pathname: '/service-worker.js.map',
			cache_control: 'no-cache, no-store, must-revalidate'
		}),

		serve({
			prefix: '/client/',
			cache_control: dev ? 'no-cache' : 'max-age=31536000, immutable'
		}),

		get_server_route_handler({
			routes: manifest.server_routes, 
			error_handler
		}),

		get_page_handler(
			manifest,
			session || noopSession,
			context || noopContext,
		)
	].filter(Boolean) as Handler<Rq & Req, Rs & Res>[]);
}

export function compose_handlers<Rq extends Req, Rs extends Res>(ignore: IgnoreValue | undefined, handlers: Handler<Rq, Rs>[]): Handler<Rq, Rs> {
	const total = handlers.length;

	function nth_handler(n: number, req: Rq, res: Rs, next: () => void) {
		if (n >= total) {
			return next();
		}

		handlers[n](req, res, () => nth_handler(n+1, req, res, next));
	}

	return !ignore
		? (req, res, next) => nth_handler(0, req, res, next)
		: (req, res, next) => {
			if (should_ignore(req.path, ignore)) {
				next();
			} else {
				nth_handler(0, req, res, next);
			}
		};
}

export function should_ignore(uri: string, val: IgnoreValue): boolean {
	if (Array.isArray(val)) return val.some(x => should_ignore(uri, x));
	if (val instanceof RegExp) return val.test(uri);
	if (typeof val === 'function') return val(uri);
	return uri.startsWith(val.charCodeAt(0) === 47 ? val : `/${val}`);
}

export function serve({ prefix, pathname, cache_control }: {
	prefix?: string,
	pathname?: string,
	cache_control: string
}) {
	const filter = pathname
		? (req: Req) => req.path === pathname
		: (req: Req) => req.path.startsWith(prefix || '');

	const cache: Map<string, Buffer> = new Map();

	const read = dev
		? (file: string) => fs.readFileSync(path.join(build_dir, file))
		: (file: string) => (cache.has(file) ? cache : cache.set(file, fs.readFileSync(path.join(build_dir, file)))).get(file)

	return (req: Req, res: Res, next: () => void) => {
		if (filter(req)) {
			const type = mime.getType(req.path);

			try {
				const file = path.posix.normalize(decodeURIComponent(req.path));
				const data = read(file);

				if (type) {
					res.setHeader('Content-Type', type);
				}
				res.setHeader('Cache-Control', cache_control);
				res.end(data);
			} catch (err) {
				res.statusCode = 404;
				res.end('not found');
			}
		} else {
			next();
		}
	};
}

const noopSession: SessionSeed<any, any> = (...o: any[]) => ({})

const noopContext: BaseContextSeed<any, any> = (...o: any[]) => ({
	fetch: nodeFetch,
	preload: (ctx, fn, page, session) => fn.call(ctx, page, session),
})
