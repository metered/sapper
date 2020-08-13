
export type PagePart = {
  component: UserPageComponent;
  params: string[];
}

export type PageResourceType = 'script' | 'style' | 'module';

export type PageResource = {
  type: PageResourceType;
  file: string;
};

export type Page = {
  pattern: RegExp;
  parts: PagePart[];
  resources: PageResource[];
};

export type ServerRoute = {
  name: string;
  pattern: RegExp;
  file: string;
  params: string[];
};

export type PageComponent = {
  default?: undefined | true;
  type?: undefined | string;
  file?: undefined | string
  name: string;
  has_preload: boolean;
}

export type UserPageComponent = PageComponent & {
  default?: undefined;
  type?: undefined;
  file: string;
};

export type ManifestData = {
  routes_alias: string;
  root: PageComponent;
  error: PageComponent;
  components: UserPageComponent[];
  pages: Page[];
  server_routes: ServerRoute[];
};

export interface PageResourceNode {
  type: PageResourceType;
  transitive_deps: Iterable<this>;
  file_name: string;
}

export interface CompileError {
  file: string;
  message: string;
}
