import { dev, manifest, Handler, Req, Res, ErrorHandler, BaseContextSeed, SessionSeed } from '@sapper/internal/manifest-server';
import { get_assets_handler } from './get_assets_handler';

type IgnoreValue = Array<IgnoreValue> | RegExp | ((uri: string) => boolean) | string;

export interface AssetsOptions<Rq extends Req, Rs extends Res> {
  ignore?: IgnoreValue;
}

export default function assets<Rq extends Req, Rs extends Res>(opts: AssetsOptions<Rq, Rs> = {}) {
  const { ignore } = opts;

  let emitted_basepath = false;

  return compose_handlers<Rq, Rs>(ignore, [
    (req: Rq, res: Rs, next: () => void) => {
      ensure_req_base_url(req)

      if (!emitted_basepath && process.send) {
        process.send({
          __sapper__: true,
          event: 'basepath',
          basepath: req.baseUrl
        });

        emitted_basepath = true;
      }

      ensure_req_path(req)
      next();
    },

    get_assets_handler<Rq, Rs>(),
  ].filter(Boolean) as Handler<Rq & Req, Rs & Res>[]);
}

export function compose_handlers<Rq extends Req, Rs extends Res>(ignore: IgnoreValue | undefined, handlers: Handler<Rq, Rs>[]): Handler<Rq, Rs> {
  const total = handlers.length;

  function nth_handler(n: number, req: Rq, res: Rs, next: () => void) {
    if (n >= total) {
      return next();
    }

    handlers[n](req, res, () => nth_handler(n + 1, req, res, next));
  }

  return !ignore
    ? (req, res, next) => nth_handler(0, req, res, next)
    : (req, res, next) => {
      if (should_ignore(req.path, ignore)) {
        next();
      } else {
        nth_handler(0, req, res, next);
      }
    };
}

export function should_ignore(uri: string, val: IgnoreValue): boolean {
  if (Array.isArray(val)) return val.some(x => should_ignore(uri, x));
  if (val instanceof RegExp) return val.test(uri);
  if (typeof val === 'function') return val(uri);
  return uri.startsWith(val.charCodeAt(0) === 47 ? val : `/${val}`);
}

function ensure_req_base_url(req: Req) {
  if (req.baseUrl === undefined) {
    let { originalUrl } = req;
    if (req.url === '/' && originalUrl[originalUrl.length - 1] !== '/') {
      originalUrl += '/';
    }

    req.baseUrl = originalUrl
      ? originalUrl.slice(0, -req.url.length)
      : '';
  }
}

function ensure_req_path(req: Req) {
  if (req.path === undefined) {
    req.path = req.url.replace(/\?.*/, '');
  }
}