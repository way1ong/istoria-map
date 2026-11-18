import type { ExpressionSpecification } from 'maplibre-gl';

// Розмір кружків місць залежить від масштабу: на огляді всієї країни (зум 5–7) кружки дрібні,
// щоб сотні місць не зливалися в одну пляму; при наближенні до околиць (зум 12+) — повного розміру.
export const DOT_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 3, 7, 4, 9, 5.5, 12, 7, 15, 8];
export const DOT_STROKE: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 1, 8, 1.5, 11, 2.5];
/** Напівпрозорий ореол навколо кружка (і більша ціль для пальця). */
export const HALO_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 4, 7, 6, 9, 9, 12, 14];
/** Кружки в режимі «Порівняти» трохи менші, ніж на головній мапі. */
export const CMP_DOT_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 2.5, 9, 4.5, 12, 6];
