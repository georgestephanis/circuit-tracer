export type Side = 'front' | 'back';

export interface Point {
  x: number;
  y: number;
}

/** Physical length units the board can be measured in. */
export type LengthUnit = 'mm' | 'mil' | 'in';

/** A physical board measurement, in the board's current `unit`. */
export interface PhysicalSize {
  width: number;
  height: number;
}

export interface RawImage {
  src: string;
  width: number;
  height: number;
}

export interface BoardImage {
  /** The corrected/working image — what the editor draws and the export embeds. */
  src: string;
  width: number;
  height: number;
  /** The untouched original upload, kept once this side has been aligned. */
  raw?: RawImage;
  /** The 4 board corners, in `raw`'s pixel space, clockwise from top-left. */
  corners?: Point[];
}

export interface Trace {
  id: string;
  side: Side;
  points: Point[];
  label: string;
  color: string;
  connectsVia: string[];
  connectsPad: string[];
  /** Physical width in the board's unit. Undefined means "use the board default". */
  width?: number;
}

/**
 * What a through-board opening is. Both are stored as `Via`s and connect the
 * two sides the same way; they differ in default size and how they're drawn.
 */
export type HoleKind = 'via' | 'hole';

/**
 * A through-board opening — a signal via or a mounting/component hole.
 *
 * A via is physically one hole through the board, so it normally carries a
 * position on both sides. `front`/`back` stay optional because re-aligning a
 * side can leave one half without a position.
 */
export interface Via {
  id: string;
  kind: HoleKind;
  label: string;
  front?: Point;
  back?: Point;
  /** Physical diameter in the board's unit. */
  diameter: number;
  /** Part of the ground net — see `GROUND_COLOR`. */
  ground?: boolean;
}

/**
 * The one color every grounded via, hole, and pad is drawn in, whatever color
 * it would otherwise have. Ground items are implicitly one net: they're all
 * tied together without needing pairwise connections recorded between them.
 * Deliberately outside the trace palette so it can't collide with a real net.
 */
export const GROUND_COLOR = '#6b7280';

/** An axis-aligned rectangular pad, in its side's image pixel space. */
/**
 * A rectangular pad, or a round test point — both are single-sided copper that
 * merges with whatever it covers, so they share one type. `x`/`y`/`width`/
 * `height` are the bounding box either way; a round pad is the inscribed circle
 * and is always kept square.
 */
export interface Pad {
  id: string;
  side: Side;
  shape: PadShape;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
  connectsTrace: string[];
  connectsVia: string[];
  /** Part of the ground net — see `GROUND_COLOR`. */
  ground?: boolean;
}

export type PadShape = 'rect' | 'round';

/**
 * Which axis the board was flipped about to photograph its back.
 * `horizontal` = turned left-to-right; `vertical` = turned end-over-end.
 */
export type FlipAxis = 'horizontal' | 'vertical';

export type Tool = 'trace' | 'via' | 'hole' | 'pad' | 'testpoint' | 'package';

/** Anything sized by a diameter rather than a width — see `SET_DEFAULT_DIAMETER`. */
export type RoundKind = HoleKind | 'testpoint';

export interface Selection {
  kind: 'trace' | 'via' | 'pad';
  id: string;
}

export interface BoardState {
  /** Used as the export's <title> and the downloaded filename. */
  boardName: string;
  images: Record<Side, BoardImage | null>;
  traces: Trace[];
  /** Every through-board opening, of both kinds — see `Via.kind`. */
  vias: Via[];
  pads: Pad[];
  tool: Tool;
  draftTrace: { side: Side; points: Point[] } | null;
  /** First corner of a pad being placed; the next click sets the opposite corner. */
  draftPad: { side: Side; start: Point } | null;
  /**
   * A pad series waiting on its end point: `count` copies of `sourceId`, evenly
   * spaced from that pad to wherever the next click lands.
   */
  padArray: { sourceId: string; count: number } | null;
  selection: Selection | null;
  nextTraceNum: number;
  nextViaNum: number;
  nextPadNum: number;
  /** Shared corrected-image size, established by whichever side is aligned first. */
  alignedSize: { width: number; height: number } | null;
  /** Unit all physical measurements in this state are expressed in. */
  unit: LengthUnit;
  /** The board's real-world size. Null until the user enters it. */
  boardSize: PhysicalSize | null;
  /** Default physical width for new traces, in `unit`. */
  defaultTraceWidth: number;
  /** Default physical diameter for new vias, in `unit`. */
  defaultViaDiameter: number;
  /** Default physical diameter for new holes, in `unit`. */
  defaultHoleDiameter: number;
  /** Default physical diameter for new test points, in `unit`. */
  defaultTestPointDiameter: number;
  /**
   * How the board was turned over between the two photos, which decides where
   * a hole drilled on one side comes out on the other.
   */
  backFlip: FlipAxis;
  /** Index into `SMD_PACKAGES` for the footprint the package tool will place. */
  packageIndex: number;
  /** Whether that footprint is turned a quarter turn from its default axis. */
  packageRotated: boolean;
}
