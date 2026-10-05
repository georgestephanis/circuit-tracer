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
  /** Catalog section, used to group the picker. */
  group?: string;
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
 * down the left row and back up the right, JEDEC-style. `padWidth` runs along
 * the row (it must fit inside `pitch`), `padLength` across it.
 */
function dualRow(
  name: string,
  pinCount: number,
  pitch: number,
  rowSpacing: number,
  padWidth: number,
  padLength: number,
  shape?: PadShape,
): Footprint {
  const perRow = pinCount / 2;
  const span = (perRow - 1) * pitch;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < perRow; i++) {
    pads.push({
      dx: -rowSpacing / 2,
      dy: -span / 2 + i * pitch,
      width: padLength,
      height: padWidth,
      shape,
      role: String(i + 1),
    });
  }
  for (let i = 0; i < perRow; i++) {
    pads.push({
      dx: rowSpacing / 2,
      dy: span / 2 - i * pitch,
      width: padLength,
      height: padWidth,
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

/**
 * A quad flat IC (QFN/QFP-style), pins counter-clockwise from pin 1 at the top
 * of the left side, with an optional square exposed pad in the middle.
 * `padLength` runs perpendicular to the body edge, `padWidth` along it.
 */
function quadFlat(
  name: string,
  pinCount: number,
  pitch: number,
  rowSpacing: number,
  padWidth: number,
  padLength: number,
  exposedPad?: number,
): Footprint {
  const perSide = pinCount / 4;
  const span = (perSide - 1) * pitch;
  const c = rowSpacing / 2;
  const pads: FootprintPad[] = [];
  // Left (down), bottom (right), right (up), top (left) — y grows downward.
  const sides: [number, number, number, number, boolean][] = [
    [-c, -span / 2, 0, pitch, true],
    [-span / 2, c, pitch, 0, false],
    [c, span / 2, 0, -pitch, true],
    [span / 2, -c, -pitch, 0, false],
  ];
  for (const [x0, y0, sx, sy, vertical] of sides) {
    for (let i = 0; i < perSide; i++) {
      pads.push({
        dx: x0 + i * sx,
        dy: y0 + i * sy,
        width: vertical ? padLength : padWidth,
        height: vertical ? padWidth : padLength,
        role: String(pads.length + 1),
      });
    }
  }
  if (exposedPad) {
    pads.push({ dx: 0, dy: 0, width: exposedPad, height: exposedPad, role: 'EP' });
  }
  return { name, pads };
}

/**
 * The catalog, by section. Within a section, smallest/simplest first; the
 * picker and scroll-cycling follow this order.
 */
const SECTIONS: { group: string; footprints: Footprint[] }[] = [
  {
    // Chip resistors, ceramic capacitors, ferrite beads, chip inductors.
    group: 'Chip passives',
    footprints: [
      twoPad('01005', 0.2, 0.22, 0.4),
      twoPad('0201', 0.3, 0.3, 0.6),
      twoPad('0402', 0.55, 0.6, 1.0),
      twoPad('0603', 0.85, 0.95, 1.6),
      twoPad('0805', 1.0, 1.3, 2.0),
      twoPad('1206', 1.15, 1.6, 3.0),
      twoPad('1210', 1.15, 2.7, 3.0),
      twoPad('1812', 1.2, 3.4, 4.2),
      twoPad('2010', 1.4, 2.7, 4.7),
      twoPad('2220', 1.4, 5.3, 5.4),
      twoPad('2512', 1.6, 3.4, 6.0),
    ],
  },
  {
    group: 'Polarized capacitors',
    footprints: [
      twoPad('Tantalum A (3216)', 1.35, 1.35, 2.9, ['+', '-']),
      twoPad('Tantalum B (3528)', 1.35, 2.35, 3.1, ['+', '-']),
      twoPad('Tantalum C (6032)', 2.3, 2.35, 5.0, ['+', '-']),
      twoPad('Tantalum D (7343)', 2.4, 2.55, 6.2, ['+', '-']),
      twoPad('Electrolytic 4 mm', 2.6, 1.6, 3.6, ['+', '-']),
      twoPad('Electrolytic 5 mm', 3.0, 1.6, 4.4, ['+', '-']),
      twoPad('Electrolytic 6.3 mm', 3.5, 1.6, 5.4, ['+', '-']),
      twoPad('Electrolytic 8 mm', 4.2, 2.2, 7.0, ['+', '-']),
    ],
  },
  {
    group: 'Diodes',
    footprints: [
      twoPad('SOD-523', 0.5, 0.6, 1.4, ['K', 'A']),
      twoPad('SOD-323', 0.6, 0.45, 2.1, ['K', 'A']),
      twoPad('SOD-123', 1.0, 1.2, 3.0, ['K', 'A']),
      twoPad('MiniMELF (SOD-80)', 1.0, 1.5, 3.5, ['K', 'A']),
      twoPad('SMA (DO-214AC)', 2.5, 1.7, 4.0, ['K', 'A']),
      twoPad('SMB (DO-214AA)', 2.5, 2.3, 4.3, ['K', 'A']),
      twoPad('SMC (DO-214AB)', 2.5, 3.3, 6.8, ['K', 'A']),
    ],
  },
  {
    // Small transistor, regulator, and power packages.
    group: 'SOT and power',
    footprints: [
      {
        name: 'SOT-323 (SC-70)',
        pads: [
          { dx: -0.65, dy: 0.9, width: 0.4, height: 0.7, role: '1' },
          { dx: 0.65, dy: 0.9, width: 0.4, height: 0.7, role: '2' },
          { dx: 0, dy: -0.9, width: 0.4, height: 0.7, role: '3' },
        ],
      },
      {
        name: 'SOT-363 (SC-70-6)',
        pads: [
          { dx: -0.65, dy: 0.9, width: 0.4, height: 0.7, role: '1' },
          { dx: 0, dy: 0.9, width: 0.4, height: 0.7, role: '2' },
          { dx: 0.65, dy: 0.9, width: 0.4, height: 0.7, role: '3' },
          { dx: 0.65, dy: -0.9, width: 0.4, height: 0.7, role: '4' },
          { dx: 0, dy: -0.9, width: 0.4, height: 0.7, role: '5' },
          { dx: -0.65, dy: -0.9, width: 0.4, height: 0.7, role: '6' },
        ],
      },
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
        // The tab is pin 2, continued under the body.
        name: 'SOT-89',
        pads: [
          { dx: -1.5, dy: 1.7, width: 0.7, height: 1.1, role: '1' },
          { dx: 0, dy: 1.7, width: 0.7, height: 1.1, role: '2' },
          { dx: 1.5, dy: 1.7, width: 0.7, height: 1.1, role: '3' },
          { dx: 0, dy: -0.6, width: 1.8, height: 2.0, role: '2' },
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
      {
        // DPAK: the middle lead is usually clipped; the tab is pin 2.
        name: 'TO-252 (DPAK)',
        pads: [
          { dx: -2.28, dy: 3.0, width: 1.1, height: 1.8, role: '1' },
          { dx: 2.28, dy: 3.0, width: 1.1, height: 1.8, role: '3' },
          { dx: 0, dy: -1.5, width: 6.0, height: 5.8, role: '2' },
        ],
      },
    ],
  },
  {
    group: 'Gull-wing ICs',
    footprints: [
      dualRow('SOIC-8', 8, 1.27, 6.0, 0.6, 1.55),
      dualRow('SOIC-14', 14, 1.27, 6.0, 0.6, 1.55),
      dualRow('SOIC-16', 16, 1.27, 6.0, 0.6, 1.55),
      dualRow('MSOP-8', 8, 0.65, 4.4, 0.4, 1.45),
      dualRow('MSOP-10', 10, 0.5, 4.4, 0.3, 1.45),
      dualRow('TSSOP-8', 8, 0.65, 5.8, 0.4, 1.45),
      dualRow('TSSOP-14', 14, 0.65, 5.8, 0.4, 1.45),
      dualRow('TSSOP-16', 16, 0.65, 5.8, 0.4, 1.45),
      dualRow('TSSOP-20', 20, 0.65, 5.8, 0.4, 1.45),
      quadFlat('TQFP-32 (7 mm)', 32, 0.8, 8.4, 0.55, 1.5),
      quadFlat('TQFP-44 (10 mm)', 44, 0.8, 11.4, 0.55, 1.5),
      quadFlat('TQFP-48 (7 mm)', 48, 0.5, 8.4, 0.3, 1.5),
      quadFlat('TQFP-64 (10 mm)', 64, 0.5, 11.4, 0.3, 1.5),
    ],
  },
  {
    // Leadless, with a central exposed pad.
    group: 'QFN',
    footprints: [
      quadFlat('QFN-16 (3 mm)', 16, 0.5, 2.9, 0.25, 0.8, 1.7),
      quadFlat('QFN-20 (4 mm)', 20, 0.5, 3.9, 0.25, 0.8, 2.6),
      quadFlat('QFN-24 (4 mm)', 24, 0.5, 3.9, 0.25, 0.8, 2.6),
      quadFlat('QFN-32 (5 mm)', 32, 0.5, 4.9, 0.25, 0.8, 3.4),
    ],
  },
  {
    group: 'Crystals',
    footprints: [
      {
        // 4-pad ceramic crystal: 1 and 3 are the crystal, 2 and 4 are case/GND.
        name: 'Crystal 3225 (4-pad)',
        pads: [
          { dx: -1.1, dy: 0.8, width: 1.4, height: 1.2, role: '1' },
          { dx: 1.1, dy: 0.8, width: 1.4, height: 1.2, role: '2' },
          { dx: 1.1, dy: -0.8, width: 1.4, height: 1.2, role: '3' },
          { dx: -1.1, dy: -0.8, width: 1.4, height: 1.2, role: '4' },
        ],
      },
      twoPad('Crystal HC-49 SMD', 5.5, 2.0, 9.5),
    ],
  },
  {
    group: 'Through-hole',
    footprints: [
      inlineHoles('TO-92', 1.27, 1.0),
      inlineHoles('TO-220', 2.54, 1.3),
      dualRow('DIP-8', 8, 2.54, 7.62, 1.0, 1.0, 'round'),
      dualRow('DIP-14', 14, 2.54, 7.62, 1.0, 1.0, 'round'),
      dualRow('DIP-16', 16, 2.54, 7.62, 1.0, 1.0, 'round'),
      twoHole('Radial capacitor', 2.5, 0.8, ['+', '-']),
      twoHole('Axial resistor', 10.16, 0.8),
      twoHole('Axial diode', 7.0, 0.8, ['A', 'K']),
    ],
  },
];

export const FOOTPRINTS: Footprint[] = SECTIONS.flatMap(({ group, footprints }) =>
  footprints.map((fp) => ({ ...fp, group })),
);

/** The catalog split back into its sections, with each entry's `FOOTPRINTS` index. */
export const FOOTPRINT_GROUPS = SECTIONS.map(({ group }) => ({
  group,
  items: FOOTPRINTS.flatMap((footprint, index) =>
    footprint.group === group ? [{ footprint, index }] : [],
  ),
}));

/** The footprint the package tool starts on: the most common hand-solder size. */
export const DEFAULT_PACKAGE_INDEX = Math.max(
  0,
  FOOTPRINTS.findIndex((fp) => fp.name === '0603'),
);

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
