// Шар власних шляхів на мапі (src/tracks.ts): кольорова лінія з білою облямівкою, щоб її було видно
// і на сучасній, і на старій мапі. Основна мапа й обидві мапи режиму «Порівняти».
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { loadTracks, onTracksChange, tracksGeoJSON } from './tracks';

/** Нижній із двох шарів шляхів: старі мапи вставляються під нього. */
export const TRACKS_CASING = 'tracks-casing';
export const TRACKS_LINE = 'tracks-line';
const TRACKS_SRC = 'my-tracks';

/**
 * Додає шляхи в поточний стиль мапи під шаром beforeId (мітки місць); викликати після кожного style.load.
 * Дані — лише з цього браузера; перше читання зі сховища запускається тут.
 */
export function addTracksLayer(map: MLMap, beforeId?: string): void {
  if (map.getSource(TRACKS_SRC)) return;
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  map.addSource(TRACKS_SRC, { type: 'geojson', data: tracksGeoJSON() });
  map.addLayer({
    id: TRACKS_CASING, type: 'line', source: TRACKS_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 6.5], 'line-opacity': 0.85 },
  }, before);
  map.addLayer({
    id: TRACKS_LINE, type: 'line', source: TRACKS_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4] },
  }, before);
  void loadTracks();
}

/** Перемальовує лінії, коли шляхи змінюються (запис, файл, колір, видимість); повертає функцію відписки. */
export function watchTracks(map: MLMap): () => void {
  return onTracksChange(() => (map.getSource(TRACKS_SRC) as GeoJSONSource | undefined)?.setData(tracksGeoJSON()));
}
