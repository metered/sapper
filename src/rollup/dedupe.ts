import { Json } from './interfaces';

export function dedupe<T extends Json>(ts: T[]): T[] {
  const deduped = new Set(ts.map(e => JSON.stringify(e)))
  return Array.from(deduped).sort().map(s => JSON.parse(s) as T)
}
