import type { FlipAxis, PadShape, Point } from '../types';

/** Just the dimensions of an image or board, in pixels. */
export interface Size {
  width: number;
  height: number;
}

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

/**
 * Is `p` on this pad's copper?
 *
 * A round pad is the circle inscribed in its bounding box, so its corners
 * aren't part of it. Shared by the reducer (deciding what a finished trace
 * connects to) and the canvas (highlighting the pad a click would attach to),
 * so what looks clickable and what actually links can't drift apart.
 */
export function pointInPad(p: Point, pad: Rect & { shape: PadShape }): boolean {
  if (pad.shape !== 'round') return pointInRect(p, pad);
  const r = pad.width / 2;
  return distance(p, { x: pad.x + r, y: pad.y + pad.height / 2 }) <= r;
}

/**
 * The pad a point lands on, or null.
 *
 * Later pads win, matching the paint order on the canvas: the one drawn on top
 * is the one you meant to click.
 */
export function padAt<T extends Rect & { shape: PadShape }>(pads: T[], p: Point): T | null {
  for (let i = pads.length - 1; i >= 0; i--) {
    if (pointInPad(p, pads[i])) return pads[i];
  }
  return null;
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
 * Which axis it mirrors about depends on how the board was turned over between
 * photos, which the app can't infer — hence `flip`, set by the user. Turning it
 * left-to-right (the common case) mirrors x and shares y; end-over-end mirrors
 * y and shares x.
 */
export function throughBoard(p: Point, size: Size, flip: FlipAxis): Point {
  return flip === 'vertical'
    ? { x: p.x, y: size.height - p.y }
    : { x: size.width - p.x, y: p.y };
}

/** Floor on a via's grab radius, so a tiny via is still easy to hit. */
export const VIA_GRAB_FLOOR_PX = 8;

/**
 * The via a point should snap to, or null.
 *
 * Each via is grabbable within its own drawn radius, so a big hole has a big
 * target and a 0.4 mm via doesn't demand pixel-perfect aim. Shared by trace
 * snapping, wheel sizing, and the connections recorded when a trace is
 * finished, so all three agree on what counts as "on" a via.
 */
export function snapVia<T extends { front?: Point; back?: Point; diameter: number }>(
  vias: T[],
  side: 'front' | 'back',
  point: Point,
  pxPerUnit: number,
  /**
   * Image pixels per unit of the visible window — pass the zoom factor so the
   * floor stays a constant distance *on screen*. Without it, zooming in to
   * place something precisely would make snapping grabbier, not less.
   */
  zoom = 1,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const via of vias) {
    const p = via[side];
    if (!p) continue;
    const d = distance(p, point);
    const reach = Math.max((via.diameter / 2) * pxPerUnit, VIA_GRAB_FLOOR_PX * zoom);
    if (d <= reach && d < bestDist) {
      bestDist = d;
      best = via;
    }
  }
  return best;
}
