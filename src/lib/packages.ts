import type { PadShape, Point } from '../types';
import type { Rect } from './geometry';

/**
 * One pad or hole in a footprint, as an offset from the part's centre and a
 * size, in millimetres. `role` is a short pin identifier (a number, or a
 * polarity like "A"/"K"/"+"/"-") used to pre-fill the stamped pad's label.
 */
export interface FootprintPad {
  dx: number;
  dy: number;
  width: number;
  height: number;
  shape?: PadShape;
  role?: string;
}

/**
 * A component footprint, in millimetres, centred on the origin.
 *
 * These are nominal hand-solder land patterns for common parts — close enough
 * to identify a part on a photo, which is what this tool is for. They are not
 * a substitute for a manufacturer's recommended footprint.
 */
export interface Footprint {
  name: string;
  pads: FootprintPad[];
}

/** Two pads side by side along the x axis, e.g. a chip resistor/capacitor. */
function twoPad(
  name: string,
  padWidth: number,
  padHeight: number,
  pitch: number,
  roles?: [string, string],
): Footprint {
  const along = pitch / 2;
  return {
    name,
    pads: [-1, 1].map((dir, i) => ({
      dx: dir * along,
      dy: 0,
      width: padWidth,
      height: padHeight,
      role: roles?.[i],
    })),
  };
}

/**
 * A dual-row IC footprint (SOIC/TSSOP/DIP-style): pin 1 at top-left, numbered
 * down the left row and back up the right, JEDEC-style.
 */
function dualRow(
  name: string,
  pinCount: number,
  pitch: number,
  rowSpacing: number,
  padWidth: number,
  padHeight: number,
  shape?: PadShape,
): Footprint {
  const perRow = pinCount / 2;
  const span = (perRow - 1) * pitch;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < perRow; i++) {
    pads.push({
      dx: -rowSpacing / 2,
      dy: -span / 2 + i * pitch,
      width: padWidth,
      height: padHeight,
      shape,
      role: String(i + 1),
    });
  }
  for (let i = 0; i < perRow; i++) {
    pads.push({
      dx: rowSpacing / 2,
      dy: span / 2 - i * pitch,
      width: padWidth,
      height: padHeight,
      shape,
      role: String(perRow + i + 1),
    });
  }
  return { name, pads };
}

/** Three pins in a straight line, e.g. a through-hole transistor. */
function inlineHoles(name: string, pitch: number, diameter: number, count = 3): Footprint {
  const span = (count - 1) * pitch;
  return {
    name,
    pads: Array.from({ length: count }, (_, i) => ({
      dx: -span / 2 + i * pitch,
      dy: 0,
      width: diameter,
      height: diameter,
      shape: 'round' as const,
      role: String(i + 1),
    })),
  };
}

/** Two round holes side by side, e.g. a radial capacitor. */
function twoHole(
  name: string,
  pitch: number,
  diameter: number,
  roles?: [string, string],
): Footprint {
  const along = pitch / 2;
  return {
    name,
    pads: [-1, 1].map((dir, i) => ({
      dx: dir * along,
      dy: 0,
      width: diameter,
      height: diameter,
      shape: 'round' as const,
      role: roles?.[i],
    })),
  };
}

/** Ordered smallest/simplest to largest; the picker lists them in this order. */
export const FOOTPRINTS: Footprint[] = [
  // Two-pad SMD chip passives.
  twoPad('0402', 0.55, 0.6, 1.0),
  twoPad('0603', 0.85, 0.95, 1.6),
  twoPad('0805', 1.0, 1.3, 2.0),
  twoPad('1206', 1.15, 1.6, 3.0),
  twoPad('1210', 1.15, 2.7, 3.0),
  twoPad('2010', 1.4, 2.7, 4.7),
  twoPad('2512', 1.6, 3.4, 6.0),
  twoPad('SOD-123', 1.0, 1.2, 3.0, ['K', 'A']),

  // Small SMD transistor/regulator packages.
  {
    name: 'SOT-23',
    pads: [
      { dx: -0.95, dy: 0.95, width: 0.6, height: 1.0, role: '1' },
      { dx: 0.95, dy: 0.95, width: 0.6, height: 1.0, role: '2' },
      { dx: 0, dy: -0.95, width: 0.6, height: 1.0, role: '3' },
    ],
  },
  {
    name: 'SOT-23-5',
    pads: [
      { dx: -0.95, dy: 0.95, width: 0.4, height: 0.9, role: '1' },
      { dx: 0, dy: 0.95, width: 0.4, height: 0.9, role: '2' },
      { dx: 0.95, dy: 0.95, width: 0.4, height: 0.9, role: '3' },
      { dx: 0.475, dy: -0.95, width: 0.4, height: 0.9, role: '4' },
      { dx: -0.475, dy: -0.95, width: 0.4, height: 0.9, role: '5' },
    ],
  },
  {
    name: 'SOT-23-6',
    pads: [
      { dx: -0.95, dy: 0.95, width: 0.4, height: 0.9, role: '1' },
      { dx: 0, dy: 0.95, width: 0.4, height: 0.9, role: '2' },
      { dx: 0.95, dy: 0.95, width: 0.4, height: 0.9, role: '3' },
      { dx: 0.95, dy: -0.95, width: 0.4, height: 0.9, role: '4' },
      { dx: 0, dy: -0.95, width: 0.4, height: 0.9, role: '5' },
      { dx: -0.95, dy: -0.95, width: 0.4, height: 0.9, role: '6' },
    ],
  },
  {
    name: 'SOT-223',
    pads: [
      { dx: -2.3, dy: 1.6, width: 0.9, height: 1.6, role: '1' },
      { dx: 0, dy: 1.6, width: 0.9, height: 1.6, role: '2' },
      { dx: 2.3, dy: 1.6, width: 0.9, height: 1.6, role: '3' },
      { dx: 0, dy: -1.6, width: 2.4, height: 1.8, role: '4' },
    ],
  },

  // Gull-wing and shrink ICs.
  dualRow('SOIC-8', 8, 1.27, 6.0, 0.6, 1.55),
  dualRow('SOIC-14', 14, 1.27, 6.0, 0.6, 1.55),
  dualRow('SOIC-16', 16, 1.27, 6.0, 0.6, 1.55),
  dualRow('TSSOP-8', 8, 0.65, 4.4, 0.4, 1.2),

  // Through-hole.
  inlineHoles('TO-92', 1.27, 1.0),
  inlineHoles('TO-220', 2.54, 1.3),
  dualRow('DIP-8', 8, 2.54, 7.62, 1.0, 1.0, 'round'),
  dualRow('DIP-14', 14, 2.54, 7.62, 1.0, 1.0, 'round'),
  twoHole('Radial capacitor', 2.5, 0.8, ['+', '-']),
  twoHole('Axial diode', 7.0, 0.8, ['A', 'K']),
];

/** Step through the catalog, wrapping at both ends. */
export function cyclePackage(index: number, step: number): number {
  const n = FOOTPRINTS.length;
  return (((index + step) % n) + n) % n;
}

export interface PlacedPad {
  rect: Rect;
  shape: PadShape;
  role?: string;
}

/**
 * A footprint's pads centred on `at`, in image pixels.
 *
 * `rotation` is a count of quarter turns (0-3) applied to every pad's offset
 * and dimensions, so asymmetric footprints (e.g. SOT-23) can be aimed in any
 * of the four axis-aligned orientations, not just flipped end for end.
 */
export function packagePads(
  fp: Footprint,
  at: Point,
  scale: number,
  rotation: number,
): PlacedPad[] {
  const turns = ((rotation % 4) + 4) % 4;

  return fp.pads.map((pad) => {
    let { dx, dy, width, height } = pad;
    for (let i = 0; i < turns; i++) {
      [dx, dy] = [-dy, dx];
      [width, height] = [height, width];
    }
    const w = width * scale;
    const h = height * scale;
    return {
      rect: {
        x: Math.round(at.x + dx * scale - w / 2),
        y: Math.round(at.y + dy * scale - h / 2),
        width: w,
        height: h,
      },
      shape: pad.shape ?? 'rect',
      role: pad.role,
    };
  });
}
