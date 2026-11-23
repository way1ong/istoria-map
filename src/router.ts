import type { FindHow, FindKind, ToolUser } from './types';

export type Route =
  | { page: 'map'; period?: string; place?: string }
  | { page: 'history' }
  | { page: 'period'; id: string }
  | { page: 'place'; id: string }
  | { page: 'event'; id: string }
  | { page: 'compare'; map?: string; period?: string; base?: string }
  | { page: 'tools'; audience?: ToolUser }
  | { page: 'tool'; id: string }
  | { page: 'landscape' }
  | { page: 'finds'; kind?: FindKind; period?: string; how?: FindHow }
  | { page: 'find'; id: string }
  | { page: 'chronology'; period?: string };

/** Види знахідок у порядку фішок розділу «Знахідки». */
export const FIND_KINDS: FindKind[] = ['hoard', 'coins', 'burial', 'ritual', 'object', 'remains'];

/** Способи, якими знайдено річ (find.found.how). */
export const FIND_HOWS: FindHow[] = ['excavation', 'chance', 'detector', 'unknown'];

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [path, query = ''] = clean.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'history':
      return { page: 'history' };
    case 'compare':
      return { page: 'compare', map: params.get('map') ?? undefined, period: params.get('period') ?? undefined, base: params.get('base') ?? undefined };
    case 'period':
      return parts[1] ? { page: 'period', id: parts[1] } : { page: 'history' };
    case 'place':
      return parts[1] ? { page: 'place', id: parts[1] } : { page: 'map' };
    case 'event':
      return parts[1] ? { page: 'event', id: parts[1] } : { page: 'map' };
    case 'tools': {
      const a = params.get('for');
      return { page: 'tools', audience: a === 'detectorist' || a === 'archaeologist' ? a : undefined };
    }
    case 'tool':
      return parts[1] ? { page: 'tool', id: parts[1] } : { page: 'tools' };
    case 'landscape':
      return { page: 'landscape' };
    case 'finds': {
      const k = params.get('kind');
      const h = params.get('how');
      return {
        page: 'finds',
        kind: FIND_KINDS.includes(k as FindKind) ? (k as FindKind) : undefined,
        period: params.get('period') ?? undefined,
        how: FIND_HOWS.includes(h as FindHow) ? (h as FindHow) : undefined,
      };
    }
    case 'find':
      return parts[1] ? { page: 'find', id: parts[1] } : { page: 'finds' };
    case 'chronology':
      return { page: 'chronology', period: params.get('period') ?? undefined };
    default:
      return {
        page: 'map',
        period: params.get('period') ?? undefined,
        place: params.get('place') ?? undefined,
      };
  }
}

export function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function onRoute(handler: (r: Route) => void): void {
  const run = () => handler(parseRoute(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
