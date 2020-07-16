import { Req, Res, ServerRoute, ErrorHandler } from '@sapper/internal/manifest-server';

export function get_server_route_handler<Rq extends Req, Rs extends Res>(opts: {
	routes: ServerRoute[],
	error_handler?: ErrorHandler<Rq, Rs>,
}) {
	const { routes, error_handler } = opts
	async function handle_route(route: ServerRoute, req: Rq, res: Rs, next: () => void) {
		const match = route.pattern.exec(req.path)
		if (match) {
			req.params = route.params(match);
		}

		const method = req.method?.toLowerCase();
		// 'delete' cannot be exported from a module because it is a keyword,
		// so check for 'del' instead
		const method_export = method === 'delete' ? 'del' : method;
		const handle_method = method_export && route.handlers[method_export];
		if (handle_method) {
			if (process.env.SAPPER_EXPORT) {
				const chunks: any[] = [];
				const headers: Record<string, string> = {};

				// intercept data so that it can be exported
				res.write = function(chunk: any) {
					chunks.push(Buffer.from(chunk));
					return (res.write as any).apply(res, arguments);
				};

				res.setHeader = function(name: string, value: string) {
					headers[name.toLowerCase()] = value;
					(res.setHeader as any).apply(res, arguments);
				};

				res.end = function(chunk?: any) {
					if (chunk) chunks.push(Buffer.from(chunk));
					(res.end as any).apply(res, arguments);

					if (!process.send) {
						throw new Error("Cannot use SAPPER_EXPORT environment variable outside of process.fork subprocess")
					}
					process.send({
						__sapper__: true,
						event: 'file',
						url: req.url,
						method: req.method,
						status: res.statusCode,
						type: headers['content-type'],
						body: Buffer.concat(chunks).toString()
					});
				};
			}

			const handle_error = (err?: Error) => {
				res.statusCode = 500;
				res.end(err?.message);
			};
			
			const handle_next = async (err?: Error) => {
				if (err && error_handler) {
					try {
						await error_handler(err, req, res, handle_error);
					} catch (error) {
						handle_error(err);
					}
				} else if (err) {
					handle_error(err);
				} else {
					process.nextTick(next);
				}
			};

			try {
				await handle_method(req, res, handle_next);
			} catch (err) {
				console.error(err);
				await handle_next(err);
			}
		} else {
			// no matching handler for method
			process.nextTick(next);
		}
	}

	return function find_route(req: Rq, res: Rs, next: () => void) {
		for (const route of routes) {
			if (route.pattern.test(req.path)) {
				handle_route(route, req, res, next);
				return;
			}
		}

		next();
	};
}
