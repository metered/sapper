import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';

import {
  Preload as _Preload,
  SSRLevel1,
  SSRComponent,
  ErrorProps,
  Session,
  BaseContext,
  Query,
} from './shared';
import { RequestInfo, RequestInit, Response, HeadersInit } from 'node-fetch';

export type Fetch = (
  url: RequestInfo,
  init?: RequestInit
) => Promise<Response>;

type PreloadContextFetch = (
  url: RequestInfo,
  init?: FetchRequestInit
) => Promise<Response>;

export type FetchRequestInfo = RequestInfo

// node-fetch does not support mode, cache or credentials options
type FetchRequestCredentials = "include" | "omit" | "same-origin";
export type FetchRequestInit = RequestInit & { credentials?: FetchRequestCredentials }
export type FetchHeadersInit = HeadersInit

type Preload<Props> = _Preload<PreloadContextFetch, Props>

export type BaseContextSeed<Req, Res> = (req: Req, res: Res) => BaseContext<Fetch>
export type SessionSeed<Req, Res> = (req: Req, res: Res) => Session | Promise<Session>

export const src_dir: string
export const build_dir: string
export const dev: boolean
export const manifest: Manifest

import { IncomingMessage, ServerResponse } from 'http';

export interface SSRLevel<Props> extends SSRLevel1<Props> {
  segment?: string;
}

export type ErrorHandler<Rq extends Req, Rs extends Res> = (error: Error, req: Rq, res: Rs, next_handler: (error: Error) => void) => void | Promise<void>;

export type ServerRoute = {
  pattern: RegExp;
  handlers: Record<string, Handler<Req, Res>>;
  params: (match: RegExpMatchArray) => Record<string, string>;
};

export type ManifestPagePart<Props> = {
  name: string | null;
  file?: string;
  component: SSRComponent<Props>;
  params?: (match: RegExpMatchArray | null) => Record<string, string>;
  preload?: Preload<Props>;
}

export type ManifestPage = {
  pattern: RegExp | null;
  parts: ManifestPagePart<unknown>[];
};

export type Manifest = {
  server_routes: ServerRoute[];
  pages: ManifestPage[];
  root: SSRComponent<unknown>;
  root_preload?: Preload<unknown>;
  error: SSRComponent<ErrorProps>;
}

export type Handler<Rq extends Req, Rs extends Res> = (req: Rq, res: Rs, next: () => void) => void;

export interface Req extends IncomingMessage {
  url: string;
  baseUrl?: string;
  originalUrl: string;
  method?: string;
  path: string;
  params: Record<string, string>;
  query: Query;
  headers: IncomingHttpHeaders;
}

export interface Res extends ServerResponse {
  write: (data: any) => boolean;
  locals?: {
    nonce?: string;
    name?: string;
  };

  statusCode: number
  end(data?: any, encoding?: any, _cb?: () => void): void
  setHeader(name: string, value: number | string | string[]): void;
  getHeader(name: string): number | string | string[] | undefined;

  writeHead(statusCode: number, reasonPhrase?: string, headers?: OutgoingHttpHeaders): this;
  writeHead(statusCode: number, headers?: OutgoingHttpHeaders): this;
}

