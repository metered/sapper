import {
  Session,
  ComponentConstructor,
  Level0,
  Level1,
  SSRComponent,
  SSRLevel1,
  ContextInit,
  BaseContext,
  Stores,
} from './shared';

export type AppContext = BaseContext<typeof fetch> & { history: History }
export type AppContextSeed = (session: Session) => AppContext

export interface BaseAppPropsInternal<Level0Props> {
  stores: Stores<any>
  context_init: ContextInit<Stores<any>>
  segments: string[]
  level0: Level0<Level0Props>
}

export interface BrowserAppPropsInit<Level0Props, Level1Props> extends BaseAppPropsInternal<Level0Props> {
  notify: unknown
  level1?: Level1<Level1Props>
  // [levelN: string]: Level | string[] | number | unknown;
}

export interface SSRAppPropsRender<Level0Props, Level1Props> extends BaseAppPropsInternal<Level0Props> {
  level1?: SSRLevel1<Level1Props>
  // [levelN: string]: SSRLevel | string[] | number | unknown;
}

export type BrowserAppPropsUpdate<L1> = Omit<BrowserAppPropsInit<never, L1>, 'context_init' | 'notify' | 'level0'>

export type AppProps<L1> = BrowserAppPropsUpdate<L1> & Omit<SSRAppPropsRender<never, L1>, 'context_init' | 'notify' | 'level0'>

declare const App: ComponentConstructor<
  BrowserAppPropsInit<any, any>,
  BrowserAppPropsUpdate<any>
  > & SSRComponent<SSRAppPropsRender<any, any>>

export default App
