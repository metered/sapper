import {Readable} from 'svelte/store';

export type ContextKey<T> = unknown

export type Stores<Fetch> = {
  page: Readable<Page | {}>
  preloading: Readable<unknown>
  session: Readable<Session>
  fetch: Readable<Fetch>
}
export const CONTEXT_KEY: ContextKey<Stores<any>>

export type Params = Record<string, string>;
export type Query = Record<string, string | string[] | true>;

export type Session = Record<string, unknown>

export type Page = {
  host: string | undefined;
  path: string;
  params: Params;
  query: Query;
};

export type Redirect = {
  statusCode: number;
  location: string;
};

export type PreloadError = {
  statusCode: number,
  error: Error
}

export interface Level0<Props = unknown> {
  props: Props;
}

export type ContextInitInput<Stores> = {
  setContext<T>(key: ContextKey<T>, value: T): void
  stores: Stores
}

export type ContextInit<Stores> = (input: ContextInitInput<Stores>) => void

export type Preloader<Fetch> = <Props>(
  ctx: PreloadContext<Fetch>,
  preload: Preload<Fetch, Props>,
  page: Page,
  session: Session,
) => (Props | Promise <Props>)

export type BaseContext<Fetch> = {
  fetch: Fetch;
  preload: Preloader<Fetch>
  layout?: ContextInit<Stores<Fetch>>
}

export type PreloadContext<Fetch> = {
  fetch: Fetch;
  redirect: (statusCode: number, location: string) => void;
  error: (status: number, error: Error | string) => void;
};

export type Preload<Fetch, Props, S extends Session = Session> = (
  this: PreloadContext<Fetch>,
  page: Page,
  session: S,
) => Props | Promise<Props>

export interface ComponentModule<Props = unknown> {
  default: ComponentConstructor<Props>
}

export interface ComponentConstructor<InitProps = unknown, SetProps = InitProps> {
  new(options: { target: unknown, props: InitProps, hydrate: boolean }): Component<SetProps>;
}

export interface Component<Props> {
  $set: (data: Props) => void;
  $destroy: () => void;
}

export interface SSRComponent<Props> {
  render(props: Props): {
    html: string
    head: string
    css: { code: string, map: unknown };
  }
}

export interface Level1<Props = unknown> extends Level0<Props> {
  component: ComponentConstructor<Props>;
  props: Props;
}

export interface Level<Props = unknown> extends Level1<Props> {
  segment: string;
  match?: RegExpExecArray;
  part: number;
}

export interface SSRLevel1<Props = unknown> extends Level0<Props> {
  component: SSRComponent<Props>
  props: Props;
}

export interface SSRLevel<Props = unknown> extends SSRLevel1<Props> {
  match?: RegExpExecArray;
  part: number;
}

export interface ErrorProps {
  status: number
  error: Error
}
