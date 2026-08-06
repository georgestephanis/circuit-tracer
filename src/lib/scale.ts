import type { LengthUnit, PhysicalSize } from '../types';

/** How many millimetres one of each unit is worth. */
const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  mil: 0.0254,
  in: 25.4,
};

export const UNIT_LABELS: Record<LengthUnit, string> = {
  mm: 'mm',
  mil: 'mil',
  in: 'in',
};

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value;
  return (value * MM_PER_UNIT[from]) / MM_PER_UNIT[to];
}

/**
 * Board width assumed when the user hasn't entered real dimensions yet, so that
 * physical widths/diameters still render at a sane size. Roughly a 10 cm board.
 */
export const ASSUMED_BOARD_WIDTH_MM = 100;

/** Smallest / largest physical size we let a via or trace be, as a sanity clamp. */
const MIN_LENGTH_MM = 0.05;
const MAX_LENGTH_MM = 50;

export function clampLength(value: number, unit: LengthUnit): number {
  const min = convertLength(MIN_LENGTH_MM, 'mm', unit);
  const max = convertLength(MAX_LENGTH_MM, 'mm', unit);
  return Math.min(max, Math.max(min, value));
}

/**
 * Image pixels per physical unit for one side.
 *
 * When the board's real dimensions are known, both axes are considered and
 * averaged — a perspective-corrected photo won't have a perfectly matching
 * aspect ratio, and trace widths need a single scalar. When they aren't known,
 * `ASSUMED_BOARD_WIDTH_MM` stands in so nothing renders at an absurd size.
 */
export function pxPerUnit(
  image: { width: number; height: number } | null,
  boardSize: PhysicalSize | null,
  unit: LengthUnit,
): number {
  if (!image) return 1;
  if (boardSize && boardSize.width > 0 && boardSize.height > 0) {
    return (image.width / boardSize.width + image.height / boardSize.height) / 2;
  }
  return image.width / convertLength(ASSUMED_BOARD_WIDTH_MM, 'mm', unit);
}

/** Format a physical length for display, with a unit-appropriate precision. */
export function formatLength(value: number, unit: LengthUnit): string {
  const decimals = unit === 'mil' ? 0 : unit === 'in' ? 3 : 2;
  return value.toFixed(decimals);
}
