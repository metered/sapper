import * as child_process from 'child_process';

export interface Route {
	id: string;
	handlers: {
		type: 'page' | 'route';
		file: string;
	}[];
	pattern: RegExp;
	test: (url: string) => boolean;
	exec: (url: string) => Record<string, string>;
	parts: string[];
	params: string[];
};

export interface Template {
	render: (data: Record<string, string>) => string;
	stream: (req: unknown, res: unknown, data: Record<string, string | Promise<string>>) => void;
};

export interface WritableStore<T> {
	set: (value: T) => void;
	update: (fn: (value: T) => T) => void;
	subscribe: (fn: (T: any) => void) => () => void;
};

export interface PageComponent {
	default?: undefined | true;
	type?: undefined | string;
	file?: undefined | string
	name: string;
}

export interface DefaultPageComponent extends PageComponent {
	default?: true;
	type: string;
	file?: undefined;
};

export interface UserPageComponent extends PageComponent {
	default?: undefined;
	type?: undefined;
	file: string;
};

export interface ManfiestDataPagePart {
	component: UserPageComponent;
	params: string[];
}

export interface ManfiestDataPage {
	pattern: RegExp;
	parts: ManfiestDataPagePart[]
};

export interface ServerRoute {
	name: string;
	pattern: RegExp;
	file: string;
	params: string[];
};

export interface Dirs {
	dest: string,
	src: string,
	routes: string
};

export interface CodegenManifest {
	routes_alias: string;
	root: PageComponent;
	error: PageComponent;
	components: UserPageComponent[];
	pages: ManfiestDataPage[];
	server_routes: ServerRoute[];
};



export interface ReadyEvent {
	port: number;
	process: child_process.ChildProcess;
};

export interface ErrorEvent {
	type: string;
	error: Error & {
		frame?: unknown;
		loc?: {
			file?: string;
			line: number;
			column: number;
		};
	};
};

export interface FatalEvent {
	message: string;
	log?: unknown;
};

export interface InvalidEvent {
	changed: string[];
	invalid: {
		client: boolean;
		server: boolean;
		serviceworker: boolean;
	}
};

export interface BuildEvent {
	type: string;
	errors: Array<{ file: string, message: string, duplicate: boolean }>;
	warnings: Array<{ file: string, message: string, duplicate: boolean }>;
	duration: number;
};

export interface FileEvent {
	file: string;
	size: number;
};

export interface FailureEvent {

};

export interface DoneEvent {};



export interface RouteHeader { key: string, value: string }
// export interface RouteRewrite { source: string, destination: string }
export type RouteManifestAssetEntries = Record<string, { headers: RouteHeader[] }>
export interface RouteManifestAssets {
	directory: string;
	entries: RouteManifestAssetEntries;
}
export interface RouteManifest {
	// rewrites: RouteRewrite[];
	// headers: { source: string, headers: RouteHeader[] }[];
	assets: RouteManifestAssets;
	functions: Record<string, unknown>;
}
