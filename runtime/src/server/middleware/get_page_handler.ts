import { writable } from 'svelte/store';
import cookie from 'cookie';
import devalue from 'devalue';
import URL from 'url';
import { Session, Redirect, PreloadError, PreloadContext, CONTEXT_KEY } from '@sapper/internal/shared';
import { has_service_worker, dev, read_template, ServerManifest, ServerPage, Req, Res, SSRLevel, Fetch, FetchRequestInfo, FetchRequestInit, BaseContextSeed } from '@sapper/internal/manifest-server';
import App, { SSRAppPropsRender } from '@sapper/internal/App.svelte';
import { Headers as FetchHeaders } from 'node-fetch'

type LinkPreloadAs = 'audio' | 'document' | 'embed' | 'fetch' | 'font' | 'image' | 'object' | 'script' | 'style' | 'track' | 'video' | 'worker'

export function get_page_handler<Rq extends Req, Rs extends Res>(
	manifest: ServerManifest,
	session_getter: (req: Rq, res: Rs) => Session | Promise<Session>,
	base_context_getter: BaseContextSeed<Rq, Rs>,
) {
	const { pages } = manifest;
	const error_route = manifest.error;

	function bail(req: Req, res: Res, err: Error) {
		console.error(err);

		const message = dev ? escape_html(err.message) : 'Internal server error';

		res.statusCode = 500;
		res.end(`<pre>${message}</pre>`);
	}

	function handle_error(req: Rq, res: Rs, statusCode: number, error: Error) {
		handle_page({
			pattern: null,
			resources: [],
			parts: [
				{ name: null, component: error_route }
			]
		}, req, res, statusCode, error || new Error('Unknown error in preload function'));
	}

	async function handle_page(page: ServerPage, req: Rq, res: Rs, status = 200, error: Error | null = null) {
		const is_service_worker_index = req.path === '/service-worker-index.html';

		res.setHeader('Content-Type', 'text/html');
		res.setHeader('Cache-Control', dev ? 'no-cache' : 'max-age=600');

		// TODO detect other stuff we can preload? images, fonts?
		let preloaded_resources = Array.from(manifest.main_resources);

		if (!error && !is_service_worker_index) {
			page.parts.forEach(part => {
				if (!part) return;
				if (!part.name) return;

				for (const resource of page.resources) {
					preloaded_resources.push(resource)
				}
			});
		}

		// TODO only set to true for chromium browsers, based on:
		// - https://caniuse.com/#feat=link-rel-modulepreload
		// - https://groups.google.com/a/chromium.org/g/blink-dev/c/ynkrM70KDD4?pli=1
		// - https://www.chromestatus.com/feature/5762805915451392
		const use_modulepreload = /Chrome/.test(req.headers["user-agent"] || '')

		const link = preloaded_resources
			.map(resource => {
				const href = `${req.baseUrl}/client/${resource.file}`;

				if (resource.type === 'module') {
					return use_modulepreload ?
							`<${href}>; rel=modulepreload` :
							`<${href}>; rel=preload; as=script; crossorigin`;
				}

				const rel = 'preload'

				// values for as set by https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link
				const as: LinkPreloadAs = resource.type

				return `<${href}>; rel=${rel}; as=${as}`;
			}).filter(Boolean)
			.join(', ');

		if (link) {
			res.setHeader('Link', link);
		}

		let session: Session = {};
		try {
			session = await session_getter(req, res);
		} catch (err) {
			return bail(req, res, err);
		}

		let redirect = <Redirect | undefined> undefined;
		let preload_error: PreloadError | undefined = undefined;

		const base_context = base_context_getter(req, res)
		const preload_context: PreloadContext<Fetch> = {
			redirect: (statusCode: number, location: string) => {
				if (redirect && (redirect.statusCode !== statusCode || redirect.location !== location)) {
					throw new Error(`Conflicting redirects`);
				}
				location = location.replace(/^\//g, ''); // leading slash (only)
				redirect = { statusCode, location };
			},
			error: (statusCode: number, message: Error | string) => {
				preload_error = { statusCode, error: typeof message === 'string' ? new Error(message) : message };
			},
			fetch: (url: FetchRequestInfo, init?: FetchRequestInit) => {
				if (typeof url !== 'string') {
					return base_context.fetch(url, init)
				}

				const port = process.env.PORT || '0'
				const parsed = new URL.URL(url, `http://127.0.0.1:${port}${req.baseUrl ? req.baseUrl + '/' :''}`);

				init = Object.assign({}, init);

				const include_credentials = (
					init.credentials === 'include' ||
					init.credentials !== 'omit' && parsed.origin === `http://127.0.0.1:${port}`
				);

				if (include_credentials) {
					const init_headers = init.headers = new FetchHeaders(init.headers);

					const cookies = Object.assign(
						{},
						cookie.parse(req.headers.cookie || ''),
						cookie.parse(init_headers.get('cookie') || '')
					);

					const set_cookie = res.getHeader('Set-Cookie');
					(Array.isArray(set_cookie) ? set_cookie : [set_cookie]).forEach(str => {
						const match = /([^=]+)=([^;]+)/.exec(<string>str);
						if (match) cookies[match[1]] = match[2];
					});

					const str = Object.keys(cookies)
						.map(key => `${key}=${cookies[key]}`)
						.join('; ');

					init_headers.set('cookie', str);

					if (!init_headers.get('authorization') && req.headers.authorization) {
						init_headers.set('authorization', req.headers.authorization);
					}
				}

				return base_context.fetch(parsed.href, init);
			}
		};

		let preloaded: unknown[];
		let match: RegExpMatchArray | null;
		let params = <Record<string, string> | undefined> undefined;

		try {
			const root_preloaded = manifest.root.preload
				? base_context.preload(preload_context, manifest.root.preload, {
					host: req.headers.host,
					path: req.path,
					query: req.query,
					params: {}
				}, session) : {};

			match = (error || !page.pattern) ? null : page.pattern.exec(req.path);

			let toPreload = [root_preloaded];
			if (!is_service_worker_index) {
				toPreload = toPreload.concat(page.parts.map(part => {
					if (!part) return null;

					// the deepest level is used below, to initialise the store
					params = part.params ? part.params(match) : {};

					return part.component.preload
						? base_context.preload(preload_context, part.component.preload, {
							host: req.headers.host,
							path: req.path,
							query: req.query,
							params
						}, session)
						: {};
				}))
			}

			preloaded = await Promise.all(toPreload);
		} catch (err) {
			if (error) {
				return bail(req, res, err)
			}

			preload_error = { statusCode: 500, error: err };
			preloaded = []; // appease TypeScript
		}

		try {
			if (redirect) {
				const location = URL.resolve((req.baseUrl || '') + '/', redirect.location);

				res.statusCode = redirect.statusCode;
				res.setHeader('Location', location);
				res.end();

				return;
			}

			if (preload_error) {
				handle_error(req, res, preload_error.statusCode, preload_error.error);
				return;
			}

			const segments = req.path.split('/').filter(Boolean);

			// TODO make this less confusing
			const layout_segments = [segments[0]];
			let l = 1;

			page.parts.forEach((part, i) => {
				layout_segments[l] = segments[i + 1];
				if (!part) return null;
				l++;
			});

			const stores = {
				page: {
					subscribe: writable({
						host: req.headers.host,
						path: req.path,
						query: req.query,
						params
					}).subscribe
				},
				preloading: {
					subscribe: writable(null).subscribe
				},
				session: writable(session),
				fetch: writable(base_context.fetch),
			}
			const props: SSRAppPropsRender<unknown, unknown> = {
				context_init: (input) => {
					input.setContext(CONTEXT_KEY, stores);

					if (base_context.layout) {
						base_context.layout(input)
					}
				},
				stores,
				segments: layout_segments,
				level0: {
					props: preloaded[0]
				},
				level1: error ? {
					component: manifest.error.default,
					props: {
						error,
						status
					}
				} : {
					component: page.parts[0]?.component.default,
					props: preloaded[1] || {},
				}
			};

			if (!is_service_worker_index && !error) {
				let l = 2;
				for (let i = 1; i < page.parts.length; i += 1) {
					const part = page.parts[i];
					if (!part) continue;

					const level: SSRLevel<unknown> = {
						component: part.component.default,
						props: preloaded[i + 1] || {},
						segment: segments[i]
					};
					(props as any)[`level${l++}`] = level
				}
			}

			const { html, head, css } = App.render(props);

			const serialized = {
				preloaded: `[${preloaded.map(data => try_serialize(data)).join(',')}]`,
				session: session && try_serialize(session, err => {
					throw new Error(`Failed to serialize session data: ${err.message}`);
				}),
				error: preload_error ? serialize_error(preload_error.error) : error ? serialize_error(error) : undefined,
			};

			let script = `__SAPPER__={${[
				error && `error:${serialized.error},status:${status}`,
				`baseUrl:"${req.baseUrl}"`,
				serialized.preloaded && `preloaded:${serialized.preloaded}`,
				serialized.session && `session:${serialized.session}`
			].filter(Boolean).join(',')}};`;

			if (has_service_worker) {
				script += `if('serviceWorker' in navigator)navigator.serviceWorker.register('${req.baseUrl}/service-worker.js');`;
			}

			// Under what circumstances should we just inline the needed JavaScript and CSS?

			const main_js = manifest.main_resources.find(({type}) => type === 'script' || type === 'module')
			if (!main_js) {
				throw new Error("Internal error: missing main script resource")
			}
			const main_src = `${req.baseUrl}/client/${main_js.file}`;

			if (manifest.shimport_version) {
				if (manifest.main_legacy_resources) {
					// main_legacy_resources ... what about css? need to filter this down to js...
					const legacy_main = `${req.baseUrl}/client/legacy/${manifest.main_legacy_resources.filter(({type}) => type === 'script')}`;
					script += `(function(){try{eval("async function x(){}");var main="${main_src}"}catch(e){main="${legacy_main}"};var s=document.createElement("script");try{new Function("if(0)import('')")();s.src=main;s.type="module";s.crossOrigin="use-credentials";}catch(e){s.src="${req.baseUrl}/client/shimport@${manifest.shimport_version}.js";s.setAttribute("data-main",main);}document.head.appendChild(s);}());`;
				} else {
					script += `var s=document.createElement("script");try{new Function("if(0)import('')")();s.src="${main_src}";s.type="module";s.crossOrigin="use-credentials";}catch(e){s.src="${req.baseUrl}/client/shimport@${manifest.shimport_version}.js";s.setAttribute("data-main","${main_src}")}document.head.appendChild(s)`;
				}
			} else {
				script += `</script><script src="${main_src}">`;
			}

			let styles: string;

			if (preloaded_resources.length) {
				styles = preloaded_resources.filter(({type}) => type === 'style')
					.map(({ file }) => `<link rel="stylesheet" href="client/${file}">`)
					.join('')
			} else {
				styles = (css && css.code ? `<style>${css.code}</style>` : '');
			}

			// users can set a CSP nonce using res.locals.nonce
			const nonce_attr = (res.locals && res.locals.nonce) ? ` nonce="${res.locals.nonce}"` : '';

			const body = read_template()
				.replace('%sapper.base%', () => `<base href="${req.baseUrl}/">`)
				.replace('%sapper.scripts%', () => `<script${nonce_attr}>${script}</script>`)
				.replace('%sapper.html%', () => html)
				.replace('%sapper.head%', () => `<noscript id='sapper-head-start'></noscript>${head}<noscript id='sapper-head-end'></noscript>`)
				.replace('%sapper.styles%', () => styles);

			res.statusCode = status;
			res.end(body);
		} catch(err) {
			if (error) {
				bail(req, res, err)
			} else {
				handle_error(req, res, 500, err);
			}
		}
	}

	return function find_route(req: Rq, res: Rs, next: () => void) {
		if (req.path === '/service-worker-index.html') {
			const homePage = pages.find(page => page.pattern?.test('/'));
			if (homePage) {
				handle_page(homePage, req, res);
				return;
			}
		}

		for (const page of pages) {
			if (page.pattern?.test(req.path)) {
				handle_page(page, req, res);
				return;
			}
		}

		handle_error(req, res, 404, new Error('Not found'));
	};
}

function try_serialize(data: any, fail?: (err: Error) => void) {
	try {
		return devalue(data);
	} catch (err) {
		if (fail) fail(err);
		return null;
	}
}

// Ensure we return something truthy so the client will not re-render the page over the error
function serialize_error(error: Error | { message: string }) {
	if (!error) return null;
	let serialized = try_serialize(error);
	if (!serialized) {
		const { name, message, stack } = error as Error;
		serialized = try_serialize({ name, message, stack });
	}
	if (!serialized) {
		serialized = '{}';
	}
	return serialized;
}

function escape_html(html: string) {
	const chars: Record<string, string> = {
		'"' : 'quot',
		"'": '#39',
		'&': 'amp',
		'<' : 'lt',
		'>' : 'gt'
	};

	return html.replace(/["'&<>]/g, c => `&${chars[c]};`);
}
