import type { Point } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Build a normalized rect from two opposite corners. */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  // Project p onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Shortest distance from `p` to a polyline, or Infinity if it has no segments. */
export function distanceToPolyline(p: Point, points: Point[]): number {
  let best = points.length === 1 ? distance(p, points[0]) : Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}

/**
 * The copies that turn one pad into a series of `count`.
 *
 * The source pad is #1 and `end` is where #count is centred, so this returns
 * the count - 1 evenly spaced rects between them, endpoint included. Shared by
 * the reducer and the on-canvas preview so the two can't drift apart.
 */
export function padSeriesRects(source: Rect, end: Point, count: number): Rect[] {
  const gaps = count - 1;
  if (gaps < 1) return [];
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const rects: Rect[] = [];
  for (let i = 1; i <= gaps; i++) {
    const cx = from.x + ((end.x - from.x) * i) / gaps;
    const cy = from.y + ((end.y - from.y) * i) / gaps;
    rects.push({
      x: Math.round(cx - source.width / 2),
      y: Math.round(cy - source.height / 2),
      width: source.width,
      height: source.height,
    });
  }
  return rects;
}

/**
 * Where a point on one side of the board comes out on the other side.
 *
 * Assumes the back photo was taken by flipping the board left-to-right about
 * its vertical axis — the usual way you turn a board over — so the two sides
 * share a y axis and mirror in x.
 */
export function throughBoard(p: Point, boardWidth: number): Point {
  return { x: boardWidth - p.x, y: p.y };
}

/** Nearest via on the given side within a pixel radius, or null. */
export function nearestVia<T extends { front?: Point; back?: Point }>(
  vias: T[],
  side: 'front' | 'back',
  point: Point,
  radius: number,
): T | null {
  let best: T | null = null;
  let bestDist = radius;
  for (const via of vias) {
    const p = via[side];
    if (!p) continue;
    const d = distance(p, point);
    if (d <= bestDist) {
      bestDist = d;
      best = via;
    }
  }
  return best;
}
