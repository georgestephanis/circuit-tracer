import type {
  BoardState,
  FlipAxis,
  LengthUnit,
  Pad,
  PhysicalSize,
  Point,
  Side,
  Trace,
  Via,
} from '../types';

const STORAGE_KEY = 'circuit-tracer/sessions/v1';
// v2 split vias and holes: every via carries a `kind`, and holes have their own
// default diameter. v1 sessions have no way to say which is which, so they're
// dropped by the version filter in readAll() rather than guessed at.
//
// v3 added round pads (test points), the ground flag, and the back-flip axis.
// All read safely on older data — a pad with no `shape` is a rect, no `ground`
// is not ground, and the flip defaults to the axis that was hardcoded before it
// was configurable — so v2 sessions are normalized on load, not discarded.
const SCHEMA_VERSION = 3;
/** Versions whose data can be read as-is once normalized by `migrate()`. */
const READABLE_VERSIONS = [2, SCHEMA_VERSION];
/** How many boards' worth of work to keep before evicting the oldest. */
const MAX_SESSIONS = 8;

/** Enough to reproduce a side's perspective correction from the original photo. */
export interface SavedAlignment {
  corners: Point[];
  width: number;
  height: number;
}

/**
 * Everything about a board except the photos themselves.
 *
 * Images are deliberately not stored — a couple of base64 photos would blow
 * localStorage's few-megabyte budget immediately. Instead the alignment corners
 * are saved, and the corrected image is re-derived by re-warping the photo the
 * user re-uploads.
 */
export interface SavedSession {
  version: number;
  savedAt: string;
  boardName: string;
  traces: Trace[];
  vias: Via[];
  pads: Pad[];
  nextTraceNum: number;
  nextViaNum: number;
  nextPadNum: number;
  alignedSize: { width: number; height: number } | null;
  unit: LengthUnit;
  boardSize: PhysicalSize | null;
  defaultTraceWidth: number;
  defaultViaDiameter: number;
  defaultHoleDiameter: number;
  defaultTestPointDiameter: number;
  backFlip: FlipAxis;
  alignment: Partial<Record<Side, SavedAlignment>>;
}

/** djb2 over the image's data URL — cheap, stable, and good enough to identify a re-upload. */
function hashSource(src: string): string {
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  }
  return `${src.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/**
 * Identify a board by the photos it was traced from, so re-uploading the same
 * two files finds the same saved work. A side with no image contributes "-",
 * which lets a one-sided session still be saved and found.
 */
export function sessionKeyFor(frontSrc: string | null, backSrc: string | null): string | null {
  if (!frontSrc && !backSrc) return null;
  return `${frontSrc ? hashSource(frontSrc) : '-'}:${backSrc ? hashSource(backSrc) : '-'}`;
}

function readAll(): Record<string, SavedSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedSession>;
    if (!parsed || typeof parsed !== 'object') return {};
    // Drop anything written by an incompatible build; bring the rest current.
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, s]) => s && READABLE_VERSIONS.includes(s.version))
        .map(([k, s]) => [k, migrate(s)]),
    );
  } catch {
    return {};
  }
}

/**
 * Fill in fields added after a session was written. Only ever adds defaults
 * that are *correct* for the older data — every pad written before v3 was a
 * rectangle and nothing was flagged as ground, so neither is a guess.
 */
function migrate(s: SavedSession): SavedSession {
  if (s.version === SCHEMA_VERSION) return s;
  return {
    ...s,
    version: SCHEMA_VERSION,
    pads: s.pads.map((p) => ({ ...p, shape: p.shape ?? 'rect' })),
    defaultTestPointDiameter: s.defaultTestPointDiameter ?? 0.75,
    backFlip: s.backFlip ?? 'horizontal',
  };
}

export function loadSession(key: string): SavedSession | null {
  return readAll()[key] ?? null;
}

/** Returns an error message if the write failed (e.g. storage full), else null. */
export function saveSession(key: string, session: SavedSession): string | null {
  const all = readAll();
  all[key] = session;

  const keys = Object.keys(all);
  if (keys.length > MAX_SESSIONS) {
    keys
      .sort((a, b) => (all[a].savedAt < all[b].savedAt ? -1 : 1))
      .slice(0, keys.length - MAX_SESSIONS)
      .forEach((k) => delete all[k]);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return null;
  } catch {
    return "Couldn't autosave — browser storage is full or unavailable.";
  }
}

export function clearSession(key: string): void {
  const all = readAll();
  delete all[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* nothing useful to do if we can't write */
  }
}

export function clearAllSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function snapshotFromState(state: BoardState): SavedSession {
  const alignment: Partial<Record<Side, SavedAlignment>> = {};
  for (const side of ['front', 'back'] as Side[]) {
    const image = state.images[side];
    if (image?.corners) {
      alignment[side] = { corners: image.corners, width: image.width, height: image.height };
    }
  }

  return {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    boardName: state.boardName,
    traces: state.traces,
    vias: state.vias,
    pads: state.pads,
    nextTraceNum: state.nextTraceNum,
    nextViaNum: state.nextViaNum,
    nextPadNum: state.nextPadNum,
    alignedSize: state.alignedSize,
    unit: state.unit,
    boardSize: state.boardSize,
    defaultTraceWidth: state.defaultTraceWidth,
    defaultViaDiameter: state.defaultViaDiameter,
    defaultHoleDiameter: state.defaultHoleDiameter,
    defaultTestPointDiameter: state.defaultTestPointDiameter,
    backFlip: state.backFlip,
    alignment,
  };
}

/** Whether there's anything worth saving or worth protecting from being overwritten. */
export function hasWork(
  source: Pick<BoardState, 'traces' | 'vias' | 'pads' | 'boardSize' | 'boardName'> & {
    images?: BoardState['images'];
    alignment?: Partial<Record<Side, SavedAlignment>>;
  },
): boolean {
  const aligned = source.alignment
    ? Object.keys(source.alignment).length > 0
    : Boolean(source.images?.front?.corners || source.images?.back?.corners);
  return (
    source.traces.length > 0 ||
    source.vias.length > 0 ||
    source.pads.length > 0 ||
    aligned ||
    source.boardSize !== null ||
    source.boardName.trim() !== ''
  );
}
