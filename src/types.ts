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

export interface Via {
  id: string;
  label: string;
  front?: Point;
  back?: Point;
  /** Physical diameter in the board's unit. */
  diameter: number;
}

/** An axis-aligned rectangular pad, in its side's image pixel space. */
export interface Pad {
  id: string;
  side: Side;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
  connectsTrace: string[];
  connectsVia: string[];
}

export type Tool = 'trace' | 'via' | 'pad';

export interface Selection {
  kind: 'trace' | 'via' | 'pad';
  id: string;
}

export interface BoardState {
  /** Used as the export's <title> and the downloaded filename. */
  boardName: string;
  images: Record<Side, BoardImage | null>;
  traces: Trace[];
  vias: Via[];
  pads: Pad[];
  tool: Tool;
  draftTrace: { side: Side; points: Point[] } | null;
  /** First corner of a pad being placed; the next click sets the opposite corner. */
  draftPad: { side: Side; start: Point } | null;
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
}
