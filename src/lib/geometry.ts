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
 * The bounding rect around a Component's member pads, or null if none of
 * `padIds` are found in `pads`. Shared by the canvas outline and the SVG
 * export so the two can't drift apart.
 */
export function componentBoundingRect<T extends Rect & { id: string }>(
  pads: T[],
  padIds: string[],
): Rect | null {
  const idSet = new Set(padIds);
  const members = pads.filter((p) => idSet.has(p.id));
  if (members.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of members) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function circlesOverlap(c1: Point, r1: number, c2: Point, r2: number): boolean {
  return distance(c1, c2) <= r1 + r2;
}

export function circleIntersectsRect(c: Point, r: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(c.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(c.y, rect.y + rect.height));
  return distance(c, { x: closestX, y: closestY }) <= r;
}

function padCenter(pad: Rect): Point {
  return { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
}

/** True if two pads' copper areas overlap — a round pad is its inscribed circle. */
export function padsOverlap(a: Rect & { shape: PadShape }, b: Rect & { shape: PadShape }): boolean {
  if (a.shape !== 'round' && b.shape !== 'round') return rectsOverlap(a, b);
  if (a.shape === 'round' && b.shape === 'round') {
    return circlesOverlap(padCenter(a), a.width / 2, padCenter(b), b.width / 2);
  }
  const rect = a.shape === 'round' ? b : a;
  const circle = a.shape === 'round' ? a : b;
  return circleIntersectsRect(padCenter(circle), circle.width / 2, rect);
}

/** True if a circle (e.g. a via) touches a pad's copper. */
export function circleTouchesPad(
  pad: Rect & { shape: PadShape },
  center: Point,
  radius: number,
): boolean {
  if (pad.shape === 'round') return circlesOverlap(padCenter(pad), pad.width / 2, center, radius);
  return circleIntersectsRect(center, radius, pad);
}

/** Orientation of the turn a->b->c makes: 0 collinear, 1 clockwise, 2 counter-clockwise. */
function orientation(a: Point, b: Point, c: Point): number {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

/**
 * Shortest distance between two segments — 0 if they cross. Two straight
 * segments' closest approach is always at one of the four endpoints, so this
 * only needs point-to-segment checks once the crossing case is ruled out.
 */
function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distanceToPolyline(b1, [a1, a2]),
    distanceToPolyline(b2, [a1, a2]),
    distanceToPolyline(a1, [b1, b2]),
    distanceToPolyline(a2, [b1, b2]),
  );
}

/** Shortest distance between two polylines — 0 if they cross anywhere. */
export function polylineDistance(a: Point[], b: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      best = Math.min(best, segmentDistance(a[i - 1], a[i], b[j - 1], b[j]));
      if (best === 0) return 0;
    }
  }
  return best;
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const { x, y, width, height } = rect;
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/**
 * True if a polyline (e.g. a trace) touches a pad's copper anywhere along its
 * length. `margin` is the polyline's own half-width in the same pixel space —
 * a trace is a stroked line, not an infinitely thin one, so its copper
 * reaches `margin` past its centerline on either side.
 */
export function polylineTouchesPad(
  points: Point[],
  pad: Rect & { shape: PadShape },
  margin = 0,
): boolean {
  if (pad.shape === 'round') {
    return distanceToPolyline(padCenter(pad), points) <= pad.width / 2 + margin;
  }
  const rect: Rect = margin
    ? { x: pad.x - margin, y: pad.y - margin, width: pad.width + margin * 2, height: pad.height + margin * 2 }
    : pad;
  if (points.some((p) => pointInRect(p, rect))) return true;
  for (let i = 1; i < points.length; i++) {
    if (segmentIntersectsRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
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
