import type { Point } from '../types';
import type { Rect } from './geometry';

/**
 * A two-pad SMD chip footprint, in millimetres.
 *
 * These are nominal hand-solder land patterns for the common chip sizes — close
 * enough to identify a part on a photo, which is what this tool is for. They
 * are not a substitute for a manufacturer's recommended footprint.
 *
 * `pitch` is centre-to-centre between the two pads, along the part's long axis.
 */
export interface SmdPackage {
  name: string;
  padWidth: number;
  padHeight: number;
  pitch: number;
}

/** Ordered smallest to largest; the wheel steps through this list. */
export const SMD_PACKAGES: SmdPackage[] = [
  { name: '0402', padWidth: 0.55, padHeight: 0.6, pitch: 1.0 },
  { name: '0603', padWidth: 0.85, padHeight: 0.95, pitch: 1.6 },
  { name: '0805', padWidth: 1.0, padHeight: 1.3, pitch: 2.0 },
  { name: '1206', padWidth: 1.15, padHeight: 1.6, pitch: 3.0 },
  { name: '1210', padWidth: 1.15, padHeight: 2.7, pitch: 3.0 },
  { name: '2010', padWidth: 1.4, padHeight: 2.7, pitch: 4.7 },
  { name: '2512', padWidth: 1.6, padHeight: 3.4, pitch: 6.0 },
];

/** Step through the catalog, wrapping at both ends. */
export function cyclePackage(index: number, step: number): number {
  const n = SMD_PACKAGES.length;
  return (((index + step) % n) + n) % n;
}

/**
 * The two pad rects for a package centred on `at`, in image pixels.
 *
 * `rotated` swaps the axes: chip parts are symmetrical, so a quarter turn is
 * the only orientation control needed to aim one along a trace.
 */
export function packagePads(
  pkg: SmdPackage,
  at: Point,
  scale: number,
  rotated: boolean,
): Rect[] {
  // Unrotated, the pads sit left and right of centre along the x axis.
  const along = (pkg.pitch / 2) * scale;
  const w = (rotated ? pkg.padHeight : pkg.padWidth) * scale;
  const h = (rotated ? pkg.padWidth : pkg.padHeight) * scale;

  return [-1, 1].map((dir) => {
    const cx = at.x + (rotated ? 0 : dir * along);
    const cy = at.y + (rotated ? dir * along : 0);
    return {
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      width: w,
      height: h,
    };
  });
}
