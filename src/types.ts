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

/**
 * One uploaded photo of a side — e.g. "Populated" and "Bare" shots of the
 * front. Every shot of a side warps into that side's shared `alignedSize`
 * (see `BoardState.alignedSize`), so `Trace`/`Pad`/`Via` — which belong to
 * the *side*, not to any one shot — are unaffected by which shot is active.
 */
export interface Shot {
  id: string;
  /** User-facing label, e.g. "Populated" or "Bare". */
  name: string;
  /** The corrected/working image — what the editor draws and the export embeds. */
  src: string;
  width: number;
  height: number;
  /** The untouched original upload, kept once this shot has been aligned. */
  raw?: RawImage;
  /** This shot's own 4 board corners, in `raw`'s pixel space, clockwise from top-left. */
  corners?: Point[];
}

/** A side's collection of shots, plus which one is currently displayed/exported. */
export interface SidePhotos {
  activeShotId: string;
  shots: Record<string, Shot>;
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
  /** The `Component` this via/hole is a through-hole lead of, if any. */
  component?: string;
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
  /** The `Component` this pad is a footprint of, if any. */
  component?: string;
}

export type PadShape = 'rect' | 'round';

/** Common component kinds, plus a catch-all for anything else. */
export type ComponentType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'led'
  | 'transistor'
  | 'ic'
  | 'connector'
  | 'crystal'
  | 'switch'
  | 'other';

export const COMPONENT_TYPES: ComponentType[] = [
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'led',
  'transistor',
  'ic',
  'connector',
  'crystal',
  'switch',
  'other',
];

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  inductor: 'Inductor',
  diode: 'Diode',
  led: 'LED',
  transistor: 'Transistor',
  ic: 'IC',
  connector: 'Connector',
  crystal: 'Crystal / oscillator',
  switch: 'Switch',
  other: 'Other',
};

/** Component types where a "value" (e.g. "10kΩ", "100nF") is meaningful. */
export const VALUED_COMPONENT_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'resistor',
  'capacitor',
  'inductor',
  'crystal',
]);

/**
 * A group of 2+ pads and/or vias/holes that are one physical component's
 * footprint — e.g. the two legs of a resistor, or the through-hole leads of a
 * radial capacitor. `padIds`/`viaIds` and `Pad.component`/`Via.component` are
 * kept in sync on both sides, same as every other connection in this app (see
 * "Connections are stored bidirectionally" in AGENTS.md).
 */
export interface Component {
  id: string;
  side: Side;
  /** Silkscreen designation, e.g. "U3". */
  label: string;
  refDes: string;
  /** Free text: part number, value, datasheet link, etc. */
  notes: string;
  padIds: string[];
  /** Through-hole leads — vias/holes grouped into this component. */
  viaIds: string[];
  componentType: ComponentType;
  /** Free-text value, e.g. "10kΩ" or "100nF" — mainly for resistors/capacitors/etc. */
  value: string;
  /**
   * Free-text role per member id (pad or via), e.g. "Anode", "Pin 1" — for
   * components where the pads/leads aren't interchangeable.
   */
  roles: Record<string, string>;
}

/**
 * Which axis the board was flipped about to photograph its back.
 * `horizontal` = turned left-to-right; `vertical` = turned end-over-end.
 */
export type FlipAxis = 'horizontal' | 'vertical';

/**
 * `pointer` places nothing — it's the default, for selecting an existing
 * trace/pad/via/component (to inspect, move a pad, or shift-click pads into
 * a component). Every other tool places something on click.
 */
export type Tool = 'pointer' | 'trace' | 'via' | 'hole' | 'pad' | 'testpoint' | 'package';

/** Anything sized by a diameter rather than a width — see `SET_DEFAULT_DIAMETER`. */
export type RoundKind = HoleKind | 'testpoint';

export interface Selection {
  kind: 'trace' | 'via' | 'pad' | 'component';
  id: string;
}

export interface BoardState {
  /** Used as the export's <title> and the downloaded filename. */
  boardName: string;
  /** Free-text notes about the board, embedded in the SVG export. */
  notes: string;
  images: Record<Side, SidePhotos | null>;
  traces: Trace[];
  /** Every through-board opening, of both kinds — see `Via.kind`. */
  vias: Via[];
  pads: Pad[];
  components: Component[];
  tool: Tool;
  draftTrace: { side: Side; points: Point[] } | null;
  /** First corner of a pad being placed; the next click sets the opposite corner. */
  draftPad: { side: Side; start: Point } | null;
  /**
   * A pad series waiting on its end point: `count` copies of `sourceId`, evenly
   * spaced from that pad to wherever the next click lands.
   */
  padArray: { sourceId: string; count: number } | null;
  /**
   * Pads shift-clicked on the canvas, waiting to be grouped into a
   * `Component`. Same "armed by a click, cleared by `SET_TOOL`/`CANCEL_DRAFT`"
   * lifecycle as `draftPad`/`padArray`. Always pads on a single side.
   */
  padPick: string[];
  /**
   * Vias/holes shift-clicked on the canvas, waiting to be grouped into a
   * `Component` alongside `padPick` (through-hole leads aren't tied to one
   * side). Same armed/cleared lifecycle as `padPick`.
   */
  viaPick: string[];
  selection: Selection | null;
  nextTraceNum: number;
  nextViaNum: number;
  nextPadNum: number;
  nextComponentNum: number;
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
  /** Index into `FOOTPRINTS` for the footprint the package tool will place. */
  packageIndex: number;
  /** Quarter turns (0-3) applied to that footprint's default orientation. */
  packageRotation: number;
}
