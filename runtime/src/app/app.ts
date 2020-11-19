/// <reference lib="dom" />

import { writable } from 'svelte/store';
import App, {
	AppProps,
	AppContext,
	BrowserAppPropsUpdate,
	BrowserAppPropsInit,
} from '@sapper/internal/App.svelte';
import {
	Redirect,
	PreloadError,
	Query,
	Page,
	DOMComponentModule,
	DOMComponentConstructor,
	DOMLevel,
	Session,
	PreloadContext,
	ErrorProps,
	CONTEXT_KEY,
	Preloader,
	ContextInit,
	Stores,
} from '@sapper/internal/shared';
import {
	root,
	error,
	ignore,
	components,
	routes,
	Target,
	ScrollPosition,
	DOMComponentLoader,
	Branch,
	Preload,
	Fetch,
	History,
	NavigateHook,
} from '@sapper/internal/manifest-client';

import goto from './goto';
import { page_store } from './stores';

type InitialData = {
	error?: Error
	baseUrl?: string
	status: number
	preloaded: unknown[]
	session: Session
};

declare const __SAPPER__: InitialData

type HydratedTarget = {
	redirect?: Redirect;
	preload_error?: PreloadError,
	props: AppProps<unknown>;
	branch: Branch<unknown>[];
}

export const initial_data: InitialData = typeof __SAPPER__ !== 'undefined' ?
		__SAPPER__ :
	{ session: {}, preloaded: [], status: 200 };

let ready = false;
let root_component: InstanceType<typeof App>;
let current_token: {};
let root_preloaded: unknown;
let current_branch: Branch<unknown>[] = [];
let current_query = '{}';

let _fetch: Fetch = typeof fetch !== 'undefined' ? (req: any, init?: any) => fetch(req, init) : () => { throw new Error("fetch not supported here.") }

const stores = {
	page: page_store({}),
	preloading: writable<null | boolean>(null),
	session: writable(initial_data.session),
	fetch: writable(_fetch),
};

let $session: Session | undefined;
let session_dirty: boolean;

stores.session.subscribe(async value => {
	$session = value;

	if (!ready || !session_dirty) return;

	session_dirty = true;

	const target = select_target(new URL(location.href));
	if (!target) return;

	const token = current_token = {};
	const { redirect, props, branch } = await hydrate_target(target);
	if (token !== current_token) return; // a secondary navigation happened while we were loading
	if (redirect) {
		await goto(redirect.location, { replaceState: true });
	} else {
		await render(branch, props, target.page);
	}
});

export let prefetching: {
	href: string;
	promise: Promise<HydratedTarget>;
} | null = null;
export function set_prefetching(href: string, promise: Promise<HydratedTarget>) {
	prefetching = { href, promise };
	return prefetching
}

export let target: Node;
export function set_target(element: Node) {
	target = element;
}

export let uid = 1;
export function set_uid(n: number) {
	uid = n;
}

export let cid: number;
export function set_cid(n: number) {
	cid = n;
}

let _history: History = typeof history !== 'undefined' ? history : {
	pushState: (state: unknown, title: string, href: string): void => {},
	replaceState: (state: unknown, title: string, href: string): void => {},
	scrollRestoration: 'auto'
};
export { _history as history };

let navigateHook: NavigateHook = fn => fn()

let preloader: Preloader<typeof fetch, unknown>
let inital_contexts_setter: ContextInit<Stores<Fetch>> | undefined

export function set_base_context(c: AppContext) {
	_fetch = c.fetch
	preloader = c.preload
	inital_contexts_setter = c.layout
	// _history = c.history
	stores.fetch.set(c.fetch)
	navigateHook = c.aroundNavigate
}
export const scroll_history: Record<string, ScrollPosition> = {};

export function extract_query(search: string): Query {
	const query = Object.create(null);
	if (search.length > 0) {
		search.slice(1).split('&').forEach(searchParam => {
			const m = /([^=]*)(?:=(.*))?/.exec(decodeURIComponent(searchParam.replace(/\+/g, ' '))) || [];
			const key = m[1]
			const value = m[2] || true
			if (typeof query[key] === 'string') query[key] = [<string>query[key]];
			if (typeof query[key] === 'object') (query[key] as string[]).push(value === true ? '' : value);
			else query[key] = value;
		});
	}
	return query;
}

export function select_target(url: URL): Target | null {
	if (url.origin !== location.origin) return null;
	if (initial_data.baseUrl === undefined) return null;
	if (!url.pathname.startsWith(initial_data.baseUrl)) return null;

	let path = url.pathname.slice(initial_data.baseUrl.length);

	if (path === '') {
		path = '/';
	}

	// avoid accidental clashes between server routes and page routes
	if (ignore.some(pattern => pattern.test(path))) return null;

	for (let i = 0; i < routes.length; i += 1) {
		const route = routes[i];

		const match = route.pattern.exec(path);

		if (match) {
			const query = extract_query(url.search);
			const part = route.parts[route.parts.length - 1];
			const params = part.params ? part.params(match) : {};

			const page = { host: location.host, path, query, params };

			return { href: url.href, route, match, page };
		}
	}

	return null
}

export async function handle_error(url: URL, status: number, _error: Error) {
	const { host, pathname, search } = url;

	const props: BrowserAppPropsUpdate<ErrorProps> = {
		stores,
		level1: {
			props: {
				error: _error,
				status,
			},
			component: error.default
		},
		segments: pathname.split('/').filter(Boolean),
	}
	const query = extract_query(search);
	await render([], props, { host, path: pathname, query, params: {} });
}

export function scroll_state() {
	return {
		x: pageXOffset,
		y: pageYOffset
	};
}

export async function navigate(target: Target, id: number | null, noscroll?: boolean, hash?: string): Promise<void> {
	return navigateHook(navigate0.bind(null, target, id, noscroll, hash), {target, id, noscroll, hash})
}

async function navigate0(target: Target, id: number | null, noscroll?: boolean, hash?: string): Promise<void> {
	if (id) {
		// popstate or initial navigation
		cid = id;
	} else {
		const current_scroll = scroll_state();

		// clicked on a link. preserve scroll state
		scroll_history[cid] = current_scroll;

		id = cid = ++uid;
		scroll_history[cid] = noscroll ? current_scroll : { x: 0, y: 0 };
	}

	cid = id;

	if (root_component) stores.preloading.set(true);

	const loaded = prefetching && prefetching.href === target.href ?
		prefetching.promise :
		hydrate_target(target);

	prefetching = null;

	
	const token = current_token = {};
	const loaded_result = await loaded
	const { redirect } = loaded_result;
	if (token !== current_token) return; // a secondary navigation happened while we were loading
	if (redirect) {
		await goto(redirect.location, { replaceState: true });
	} else {
		const { props, branch, preload_error } = loaded_result
		if (preload_error) {
			if (preload_error.error.message.includes("Failed to fetch dynamically imported module")) {
				window.location.reload()
			}
			await handle_error(new URL(target.href), preload_error.statusCode, preload_error.error)
		} else {
			await render(branch, props, target.page);
		}
	}
	if (document.activeElement && (document.activeElement instanceof HTMLElement)) document.activeElement.blur();

	if (!noscroll) {
		let scroll = scroll_history[id];

		if (hash) {
			// scroll is an element id (from a hash), we need to compute y.
			const deep_linked = document.getElementById(hash.slice(1));

			if (deep_linked) {
				scroll = {
					x: 0,
					y: deep_linked.getBoundingClientRect().top + scrollY
				};
			}
		}

		scroll_history[cid] = scroll;
		if (scroll) scrollTo(scroll.x, scroll.y);
	}
}

async function render<L1>(branch: Branch<unknown>[], _props: BrowserAppPropsUpdate<L1>, page: Page) {
	stores.page.set(page);
	stores.preloading.set(false);

	if (root_component) {
		root_component.$set(_props);
	} else {
		const props = _props as BrowserAppPropsInit<typeof root_preloaded, L1>
		props.context_init = (input) => {
			input.setContext(CONTEXT_KEY, {
				page: { subscribe: stores.page.subscribe },
				preloading: { subscribe: stores.preloading.subscribe },
				session: stores.session,
				fetch: { subscribe: stores.fetch.subscribe },
			});

			if (inital_contexts_setter) {
				inital_contexts_setter(input)
			}
		}			
		props.level0 = {
			props: await root_preloaded
		};
		props.notify = stores.page.notify;

		// first load — remove SSR'd <head> contents
		const start = document.querySelector('#sapper-head-start');
		const end = document.querySelector('#sapper-head-end');

		if (start && end) {
			while (start.nextSibling && start.nextSibling !== end) detach(start.nextSibling);
			detach(start);
			detach(end);
		}

		root_component = new App({
			target,
			props,
			hydrate: true
		});
	}

	current_branch = branch;
	current_query = JSON.stringify(page.query);
	ready = true;
	session_dirty = false;
}

function part_changed(i: number, segment: string, match: RegExpExecArray, stringified_query: string) {
	// TODO only check query string changes for preload functions
	// that do in fact depend on it (using static analysis or
	// runtime instrumentation)
	if (stringified_query !== current_query) return true;

	const previous = current_branch[i];

	if (!previous) return false;
	if (segment !== previous.segment) return true;
	if (previous.match) {
		if (JSON.stringify(previous.match.slice(1, i + 2)) !== JSON.stringify(match.slice(1, i + 2))) {
			return true;
		}
	}
}

export async function hydrate_target(target: Target): Promise<HydratedTarget> {
	const { route, page } = target;

	if (!$session) {
		throw new Error("Internal error: $session is not yet defined")
	}

	const segments = page.path.split('/').filter(Boolean);

	let redirect: Redirect | undefined = undefined;
	let preload_error: PreloadError | undefined = undefined

	const props: AppProps<unknown> = { stores, segments: [segments[0]] };

	const preload_context: PreloadContext<Fetch> = {
		fetch: (info: RequestInfo, init?: RequestInit) => _fetch(info, init),
		redirect: (statusCode: number, location: string) => {
			if (redirect && (redirect.statusCode !== statusCode || redirect.location !== location)) {
				throw new Error(`Conflicting redirects`);
			}
			redirect = { statusCode, location };
		},
		error: (statusCode: number, error: Error | string) => {
			preload_error = {
				error: typeof error === 'string' ? new Error(error) : error,
				statusCode,
			}
		}
	};

	if (!root_preloaded) {
		const root_preload = root.preload || (() => {});
		root_preloaded = initial_data.preloaded[0] || preloader(preload_context, root_preload, {
			host: page.host,
			path: page.path,
			query: page.query,
			params: {}
		}, $session);
	}

	let branch: Branch<unknown>[];
	let l = 1;

	try {
		const stringified_query = JSON.stringify(page.query);
		const match = route.pattern.exec(page.path);
		if (!match) {
			throw Error(`Internal error: route pattern ${route.pattern} doesn't match path: ${page.path}`)
		}

		let segment_dirty = false;

		branch = await Promise.all(route.parts.map(async (part, i) => {
			const segment = segments[i];

			if (part_changed(i, segment, match, stringified_query)) segment_dirty = true;

			props.segments[l] = segments[i + 1]; // TODO make this less confusing
			if (!part) return { segment };

			const j = l++;

			if (!session_dirty && !segment_dirty && current_branch[i] && current_branch[i].part === part.i) {
				return current_branch[i];
			}

			segment_dirty = false;

			const component = await load_component(components[part.i]);

			let preloaded;
			if (ready || !initial_data.preloaded[i + 1]) {
				if (!$session) {
					throw new Error("Internal error: $session is not yet defined")
				}
				preloaded = component.preload
					? await preloader(preload_context, component.preload, {
						host: page.host,
						path: page.path,
						query: page.query,
						params: part.params ? part.params(target.match) : {}
					}, $session)
					: {};
			} else {
				preloaded = initial_data.preloaded[i + 1];
			}

			const level: DOMLevel = { component: component.default, props: preloaded, segment, match, part: part.i }
			return ((props as any)[`level${j}`] = level);
		}));
	} catch (error) {
		preload_error = {
			error: error,
			statusCode: 500.
		}
		branch = [];
	}

	return { redirect, preload_error, props, branch };
}

function load_css(chunk: string) {
	const href = `client/${chunk}`;
	if (document.querySelector(`link[href="${href}"]`)) return;

	return new Promise<void>((fulfil, reject) => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;

		link.onload = () => fulfil();
		link.onerror = reject;

		document.head.appendChild(link);
	});
}

export async function load_component<T>(component: DOMComponentLoader<T>): Promise<DOMComponentModule<Fetch, T>> {
	// TODO this is temporary — once placeholders are
	// always rewritten, scratch the ternary
	const promises: any[] = (typeof component.css === 'string' ? [] : component.css.map(load_css));
	promises.unshift(component.js());

	// NB TypeScript's definition of Promise.all doesn't have a generic definition for [head, ...rest]
	const values = await Promise.all(promises)
	return values[0] as DOMComponentModule<Fetch, T>
}

function detach(node: Node) {
	if (!node.parentNode) {
		console.warn("Could not detach orphaned node because it has no parentNode", node)
		return
	}
	node.parentNode.removeChild(node);
}
