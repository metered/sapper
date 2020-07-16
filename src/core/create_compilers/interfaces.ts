import { ManifestData, Dirs } from '../../interfaces';

export interface Compiler<T extends CompileResult = CompileResult> {
	oninvalid(cb: (filename: string) => void): void
	compile(): Promise<T>
	watch(cb: (err?: Error, stats?: T) => void): void
}

export type Compilers<T extends CompileResult = CompileResult> = {
	client: Compiler<T>;
	server: Compiler<T>;
	serviceworker?: Compiler<T>;
}

export type Chunk = {
	file: string;
	imports: string[];
	modules: string[];
}

export type CssFile = {
	id: string;
	code: string;
};

export interface CompileError {
	file: string;
	message: string;
}

export interface CompileResult {
	duration?: number;
	errors: CompileError[];
	warnings: CompileError[];
	chunks: Chunk[];
	assets: Record<string, string | string[]>;
	css_files?: CssFile[];

	print: () => void;
	to_json: (manifest_data: ManifestData, dirs: Dirs) => BuildInfo
}

export type BuildInfo = {
	bundler: string;
	shimport: string | null;
	assets: Record<string, string | string[]>;
	legacy_assets?: Record<string, string | string[]>;
	css?: {
		main: string | null,
		chunks: Record<string, string[]>
	}
}