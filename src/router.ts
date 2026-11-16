export type Route =
  | { page: 'map'; period?: string; place?: string }
  | { page: 'history' }
  | { page: 'period'; id: string }
  | { page: 'place'; id: string }
  | { page: 'event'; id: string }
  | { page: 'compare'; map?: string; period?: string; base?: string };

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
