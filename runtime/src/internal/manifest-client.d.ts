/// <reference lib="dom" />

import {
  Preload as _Preload,
  DOMComponentConstructor,
  DOMComponentModule,
  Page,
  ErrorProps,
} from './shared';

export type Fetch = (
  url: RequestInfo,
  init?: RequestInit
  ) => Promise<Response>;
  
export type Preload<Props> = _Preload<Fetch, Props>

export interface Branch<Props> {
  // component?: DOMComponentModule<Fetch, Props>;
  segment: string;
  part?: number;
  match?: RegExpExecArray;
}

export type DOMComponentLoader<Props=unknown> = {
  js: () => Promise<DOMComponentModule<Fetch, Props>>,
  css: string[]
};

export type Route = {
  pattern: RegExp;
  parts: Array<{
    i: number;
    params?: (match: RegExpExecArray) => Record<string, string>;
  }>;
};

export type Manifest = {
  ignore: RegExp[];
  root: DOMComponentModule<Fetch>;
  error: () => Promise<DOMComponentModule<Fetch, ErrorProps>>;
  pages: Route[]
};

export type ScrollPosition = {
  x: number;
  y: number;
};

export type Target = {
  href: string;
  route: Route;
  match: RegExpExecArray;
  page: Page;
};

export type NavigateHook = (
  fn: () => Promise<void>,
  options: {
    target: Target;
    id: number | null;
    noscroll?: boolean;
    hash?: string;
  }
) => Promise<void>

export interface History {
  pushState(state: unknown, title: string, href: string): void;
  replaceState(state: unknown, title: string, href: string): void;
  scrollRestoration: "auto" | "manual";
}

export const routes: Route[]
export const components: DOMComponentLoader[]
export const ignore: RegExp[]
export const error: DOMComponentModule<Fetch, ErrorProps>
export const root: DOMComponentModule<Fetch, unknown>
