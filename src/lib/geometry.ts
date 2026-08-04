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

export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
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
