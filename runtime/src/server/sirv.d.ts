declare module 'sirv' {
  import type { Stats } from 'fs';
  import type { IncomingMessage, ServerResponse } from 'http';

  type Arrayable<T> = T | T[];
  export type NextHandler = VoidFunction | Promise<void>;
  export type RequestHandler<Rq extends IncomingMessage, Rs extends ServerResponse> = (req: Rq, res: Rs, next?: NextHandler) => void;

  export interface Options<Rq extends IncomingMessage, Rs extends ServerResponse> {
    dev?: boolean;
    etag?: boolean;
    maxAge?: number;
    immutable?: boolean;
    single?: string | boolean;
    ignores?: false | Arrayable<string | RegExp>;
    extensions?: string[];
    dotfiles?: boolean;
    brotli?: boolean;
    gzip?: boolean;
    onNoMatch?: (req: Rq, res: Rs) => void;
    setHeaders?: (res: Rs, pathname: string, stats: Stats) => void;
  }

  export default function<Rq extends IncomingMessage, Rs extends ServerResponse> (dir?: string, opts?: Options<Rq, Rs>): RequestHandler<Rq, Rs>;
}