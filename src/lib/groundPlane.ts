import type { GroundPlane, Pad, Point, Trace, Via } from '../types';
import { circlePoints, isClockwise, padCenter, pointsToPath, rectAlongSegment } from './geometry';

function ringPath(points: Point[], wantClockwise: boolean): string {
  const oriented = isClockwise(points) === wantClockwise ? points : [...points].reverse();
  return `${pointsToPath(oriented)} Z`;
}

function padHoleRings(pad: Pad): Point[][] {
  if (pad.shape === 'round') {
    return [circlePoints(padCenter(pad), pad.width / 2)];
  }
  const { x, y, width: w, height: h } = pad;
  return [
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  ];
}

function viaHoleRings(via: Via, side: 'front' | 'back', scale: number): Point[][] {
  const center = via[side];
  if (!center) return [];
  return [circlePoints(center, (via.diameter / 2) * scale)];
}

function traceHoleRings(trace: Trace, scale: number, defaultTraceWidth: number): Point[][] {
  const widthPx = (trace.width ?? defaultTraceWidth) * scale;
  const rings: Point[][] = [];
  for (const p of trace.points) {
    rings.push(circlePoints(p, widthPx / 2));
  }
  for (let i = 1; i < trace.points.length; i++) {
    rings.push(rectAlongSegment(trace.points[i - 1], trace.points[i], widthPx));
  }
  return rings;
}

/**
 * The ground plane's fill, as an SVG path `d` string: one outer subpath for
 * `plane.points`, plus one hole subpath per non-`ground` pad/via/trace on its
 * side, wound opposite the outer ring so `fill-rule="nonzero"` cuts them out.
 * Recomputed from live state on every call — never cached — so it can't go
 * stale when copper is added, moved, or removed.
 */
export function buildGroundPlanePath(
  plane: GroundPlane,
  pads: Pad[],
  vias: Via[],
  traces: Trace[],
  scale: number,
  defaultTraceWidth: number,
): string {
  const outerClockwise = isClockwise(plane.points);
  const holeClockwise = !outerClockwise;

  const holeRings: Point[][] = [];

  for (const pad of pads) {
    if (pad.side !== plane.side || pad.ground) continue;
    holeRings.push(...padHoleRings(pad));
  }

  for (const via of vias) {
    if (via.ground) continue;
    holeRings.push(...viaHoleRings(via, plane.side, scale));
  }

  for (const trace of traces) {
    if (trace.side !== plane.side) continue;
    holeRings.push(...traceHoleRings(trace, scale, defaultTraceWidth));
  }

  const subpaths = [ringPath(plane.points, outerClockwise), ...holeRings.map((r) => ringPath(r, holeClockwise))];
  return subpaths.join(' ');
}
