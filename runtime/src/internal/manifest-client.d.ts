/// <reference lib="dom" />

import {
  Preload as _Preload,
  ComponentConstructor,
  ComponentModule,
  Page,
  ErrorProps,
} from './shared';

export type Fetch = (
  url: RequestInfo,
  init?: RequestInit
  ) => Promise<Response>;
  
export type Preload<Props> = _Preload<Fetch, Props>

export interface Branch<Props> {
  component?: ComponentConstructor<Props>;
  segment: string;
  part?: number;
  preload?: Preload<Props>;
  match?: RegExpExecArray;
}

export type ComponentLoader<Props=unknown> = {
  js: () => Promise<ComponentModule<Props>>,
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
  root: ComponentConstructor;
  error: () => Promise<ComponentModule<ErrorProps>>;
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

export interface History {
  pushState(state: unknown, title: string, href: string): void;
  replaceState(state: unknown, title: string, href: string): void;
  scrollRestoration: "auto" | "manual";
}

export const routes: Route[]
export const components: ComponentLoader[]
export const ignore: RegExp[]
export const ErrorComponent: ComponentConstructor<ErrorProps>

export const root_preload: Preload<unknown>
