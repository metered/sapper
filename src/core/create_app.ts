import * as fs from 'fs';
import * as path from 'path';
import { posixify, stringify, walk, write_if_changed } from '../utils';
import { ManfiestDataPage, PageComponent, ManifestData } from '../interfaces';

export function create_app({
	bundler,
	manifest_data,
	dev_port,
	dev,
	has_service_worker,
	cwd,
	src,
	routes,
	output,
}: {
	bundler: string,
	manifest_data: ManifestData;
	dev_port?: number;
	dev: boolean;
	has_service_worker: boolean;
	cwd: string;
	src: string;
	routes: string;
	output: string;
}) {
	if (!fs.existsSync(output)) fs.mkdirSync(output);

	const src_dir = posixify(path.normalize(path.relative(cwd, src)));
	const path_to_template = `${src_dir}/template.html`

	// webpack has its own loader
	const shimport_version = bundler === 'webpack' ? null : require('shimport/package.json').version

	const path_to_routes = routes.startsWith('@') ? routes : path.relative(`${output}/internal`, routes);

	const client_manifest = generate_client_manifest(manifest_data, path_to_routes, bundler, dev, dev_port);
	const server_manifest = generate_server_manifest(manifest_data, path_to_routes, path_to_template, dev, has_service_worker, shimport_version);

	const app = generate_app(manifest_data, path_to_routes);

	write_if_changed(`${output}/internal/manifest-client.mjs`, client_manifest);
	write_if_changed(`${output}/internal/manifest-server.mjs`, server_manifest);
	write_if_changed(`${output}/internal/App.svelte`, app);
}

export function create_serviceworker_manifest({ manifest_data, output, client_files, static_files }: {
	manifest_data: ManifestData;
	output: string;
	client_files: string[];
	static_files: string;
}) {
	let files: string[] = ['service-worker-index.html'];

	if (fs.existsSync(static_files)) {
		files = files.concat(walk(static_files));
	} else {
		// TODO remove in a future version
		if (fs.existsSync('assets')) {
			throw new Error(`As of Sapper 0.21, the assets/ directory should become static/`);
		}
	}

	let code = `
		// This file is generated by Sapper — do not edit it!
		export const timestamp = ${Date.now()};

		export const files = [\n\t${files.map((x: string) => stringify(x)).join(',\n\t')}\n];
		export { files as assets }; // legacy

		export const shell = [\n\t${client_files.map((x: string) => stringify(x)).join(',\n\t')}\n];

		export const routes = [\n\t${manifest_data.pages.map((r: ManfiestDataPage) => `{ pattern: ${r.pattern} }`).join(',\n\t')}\n];
	`.replace(/^\t\t/gm, '').trim();

	write_if_changed(`${output}/service-worker.js`, code);
}

function create_param_match(param: string, i: number) {
	return /^\.{3}.+$/.test(param)
		? `${param.replace(/.{3}/, '')}: d(match[${i + 1}]).split('/')`
		: `${param}: d(match[${i + 1}])`
}

function generate_client_manifest(
	manifest_data: ManifestData,
	path_to_routes: string,
	bundler: string,
	dev: boolean,
	dev_port?: number
) {
	const page_ids = new Set(manifest_data.pages.map(page =>
		page.pattern.toString()));

	const server_routes_to_ignore = manifest_data.server_routes.filter(route =>
		!page_ids.has(route.pattern.toString()));

	const component_indexes: Record<string, number> = {};

	const components = `[
		${manifest_data.components.map((component, i) => {
			const annotation = bundler === 'webpack'
				? `/* webpackChunkName: "${component.name}" */ `
				: '';

			const source = get_file(path_to_routes, component);

			component_indexes[component.name] = i;

			return `{
					js: () => import(${annotation}${stringify(source)}),
					css: "__SAPPER_CSS_PLACEHOLDER:${stringify(component.file, false)}__"
				}`;
		}).join(',\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	let needs_decode = false;

	let routes = `[
				${manifest_data.pages.map(page => `{
					// ${page.parts[page.parts.length - 1].component.file}
					pattern: ${page.pattern},
					parts: [
						${page.parts.map(part => {
							if (part === null) return 'null';

							if (part.params.length > 0) {
								needs_decode = true;
								const props = part.params.map(create_param_match);
								return `{ i: ${component_indexes[part.component.name]}, params: match => ({ ${props.join(', ')} }) }`;
							}

							return `{ i: ${component_indexes[part.component.name]} }`;
						}).join(',\n\t\t\t\t\t\t')}
					]
				}`).join(',\n\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	if (needs_decode) {
		routes = `(d => ${routes})(decodeURIComponent)`
	}

	return `
		// This file is generated by Sapper — do not edit it!
		export { default as Root } from '${stringify(get_file(path_to_routes, manifest_data.root), false)}';
		export { preload as root_preload } from '${manifest_data.root.has_preload ? stringify(get_file(path_to_routes, manifest_data.root), false) : './shared'}';
		export { default as ErrorComponent } from '${stringify(get_file(path_to_routes, manifest_data.error), false)}';

		export const ignore = [${server_routes_to_ignore.map(route => route.pattern).join(', ')}];

		export const components = ${components};

		export const routes = ${routes};

		${dev ? `if (typeof window !== 'undefined') {
			(${fs.readFileSync(path.resolve(__dirname, "../../sapper-dev-client.js"))})(${dev_port});
		}` : ''}
	`.replace(/^\t{2}/gm, '').trim();
}

function generate_server_manifest(
	manifest_data: ManifestData,
	path_to_routes: string,
	path_to_template: string,
	dev: boolean,
	has_service_worker: boolean,
	shimport_version: string | null,
) {
	const imports = new Array<string>().concat(
		manifest_data.server_routes.map((route, i) =>
			`import * as route_${i} from ${stringify(posixify(`${path_to_routes}/${route.file}`))};`),
		manifest_data.components.map((component, i) =>
			`import component_${i}${component.has_preload ? `, { preload as preload_${i} }` : ''} from ${stringify(get_file(path_to_routes, component))};`),
		`import root${manifest_data.root.has_preload ? `, { preload as root_preload }` : ''} from ${stringify(get_file(path_to_routes, manifest_data.root))};`,
		`import error from ${stringify(get_file(path_to_routes, manifest_data.error))};`,
		`import path from 'path'`,
	);

	const component_lookup: Record<string, number> = {};
	manifest_data.components.forEach((component, i) => {
		component_lookup[component.name] = i;
	});

	return `
		// This file is generated by Sapper — do not edit it!
		${imports.join('\n')}

		const d = decodeURIComponent;

		export const has_service_worker = ${JSON.stringify(has_service_worker)};

		export const manifest = {
			server_routes: [
				${manifest_data.server_routes.map((route, i) => `{
					// ${route.file}
					pattern: ${route.pattern},
					handlers: route_${i},
					params: ${route.params.length > 0
						? `match => ({ ${route.params.map(create_param_match).join(', ')} })`
						: `() => ({})`}
				}`).join(',\n\n\t\t\t\t')}
			],

			pages: [
				${manifest_data.pages.map(page => `{
					// ${page.parts[page.parts.length - 1].component.file}
					pattern: ${page.pattern},
					resources: ${[page.parts.filter(Boolean).map(part => part.component.file)].map(component_files =>
						component_files.length ? `"__SAPPER_RESOURCES_PLACEHOLDER:${component_files.join(":")}__"` : `[]`
					).join("")},
					parts: [
						${page.parts.map(part => {
							if (part === null) return 'null';

							const props = [
								`name: "${part.component.name}"`,
								`file: ${stringify(part.component.file)}`,
								`component: component_${component_lookup[part.component.name]}`,
								part.component.has_preload && `preload: preload_${component_lookup[part.component.name]}`
							].filter(Boolean);

							if (part.params.length > 0) {
								const params = part.params.map(create_param_match);
								props.push(`params: match => ({ ${params.join(', ')} })`);
							}

							return `{ ${props.join(', ')} }`;
						}).join(',\n\t\t\t\t\t\t')}
					]
				}`).join(',\n\n\t\t\t\t')}
			],

			shimport_version: ${JSON.stringify(shimport_version)},
			main_resources: "__SAPPER_MAIN_RESOURCES_PLACEHOLDER__",
			main_legacy_resources: "__SAPPER_MAIN_LEGACY_RESOURCES_PLACEHOLDER__",

			root,
			root_preload${manifest_data.root.has_preload ? '' : `: () => {}`},
			error
		};

		export let build_dir = path.join(path.relative(process.cwd(), __dirname), '..');

		export function set_build_dir(s) {
			build_dir = s
		}

		export function read_template() {
			return ${dev && false ? // HACK(ajbouh) Don't read template from source directory.
					`fs.readFileSync("${path_to_template}", "utf-8")` :
					JSON.stringify(fs.readFileSync(path_to_template, 'utf-8'))
			};
		}

		export const dev = ${dev ? 'true' : 'false'};
	`.replace(/^\t{2}/gm, '').trim();
}

function generate_app(manifest_data: ManifestData, path_to_routes: string) {
	// TODO remove default layout altogether

	const max_depth = Math.max(1, ...manifest_data.pages.map(page => page.parts.filter(Boolean).length));

	const levels = [];
	for (let i = 0; i < max_depth; i += 1) {
		levels.push(i + 1);
	}

	let l = max_depth;

	let pyramid = `<svelte:component this="{level${l}.component}" {...level${l}.props}/>`;

	while (l-- > 1) {
		pyramid = `
			<svelte:component this="{level${l}.component}" segment="{segments[${l}]}" {...level${l}.props}>
				{#if level${l + 1}}
					${pyramid.replace(/\n/g, '\n\t\t\t\t\t')}
				{/if}
			</svelte:component>
		`.replace(/^\t\t\t/gm, '').trim();
	}

	return `
		<!-- This file is generated by Sapper — do not edit it! -->
		<script>
			import { setContext, afterUpdate } from 'svelte';
			import Layout from '${get_file(path_to_routes, manifest_data.root)}';

			export let stores;
			export let segments;
			export let level0;
			export let context_init;
			${levels.map(l => `export let level${l} = null;`).join('\n\t\t\t')}
			export let notify;

			afterUpdate(notify);
			context_init({setContext, stores})
		</script>

		<Layout segment="{segments[0]}" {...level0.props}>
			{#if level1}
			${pyramid.replace(/\n/g, '\n\t\t\t\t')}
			{/if}
		</Layout>
	`.replace(/^\t\t/gm, '').trim();
}

function get_file(path_to_routes: string, component: PageComponent) {
	if (component.default) return `./${component.type}.svelte`;
	return posixify(`${path_to_routes}/${component.file}`);
}
