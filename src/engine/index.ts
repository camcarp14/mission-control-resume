/* ==== ENGINE INDEX ==== */

// Single import surface for the engine so UI code never reaches into
// individual modules — keeps the pure/impure boundary a one-line grep.
export { MOBILE_BREAKPOINT, gap, stationPositions } from './layout';
export type { Vec } from './layout';
export { makePath } from './path';
export type { FlightPath } from './path';
export { mulberry32, starLayerDataUri } from './starfield';
export type { StarLayerSpec } from './starfield';
