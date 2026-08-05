import type {
  BoardImage,
  BoardState,
  HoleKind,
  LengthUnit,
  Pad,
  PhysicalSize,
  Point,
  RawImage,
  FlipAxis,
  RoundKind,
  Side,
  Tool,
  Trace,
  Via,
} from '../types';
import {
  type Rect,
  type Size,
  padSeriesRects,
  pointInPad,
  pointInRect,
  rectFromCorners,
  snapVia,
  throughBoard,
} from '../lib/geometry';
import { clampLength, convertLength, pxPerUnit } from '../lib/scale';
import { SMD_PACKAGES, cyclePackage, packagePads } from '../lib/packages';
import type { SavedSession } from '../lib/persistence';

export type Action =
  | { type: 'LOAD_IMAGE'; side: Side; image: BoardImage }
  | {
      type: 'APPLY_ALIGNMENT';
      side: Side;
      raw: RawImage;
      corners: Point[];
      correctedSrc: string;
      width: number;
      height: number;
    }
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'ADD_TRACE_POINT'; side: Side; point: Point }
  | { type: 'FINISH_TRACE' }
  | { type: 'CANCEL_DRAFT' }
  | { type: 'UNDO_DRAFT_POINT' }
  | { type: 'ADD_VIA'; side: Side; point: Point; kind: HoleKind }
  | { type: 'PAD_CORNER'; side: Side; point: Point }
  | { type: 'ADD_TEST_POINT'; side: Side; point: Point }
  | { type: 'ADD_PACKAGE'; side: Side; point: Point }
  /** Step through the footprint catalog (wheel) and turn it a quarter (right-click). */
  | { type: 'CYCLE_PACKAGE'; step: number }
  | { type: 'ROTATE_PACKAGE' }
  /** Flag a via/hole or pad as part of the ground net, or clear the flag. */
  | { type: 'TOGGLE_GROUND'; kind: 'via' | 'pad'; id: string }
  /** Wire an overlapping cluster into one net: shared color, full cross-links. */
  | { type: 'MERGE_OVERLAP'; traceIds: string[]; padIds: string[]; viaIds: string[] }
  /** Arm a pad series off an existing pad; the next canvas click ends it. */
  | { type: 'START_PAD_ARRAY'; padId: string; count: number }
  | { type: 'PLACE_PAD_ARRAY'; side: Side; point: Point }
  | { type: 'DELETE_SELECTED' }
  | { type: 'RENAME_TRACE'; id: string; label: string }
  | { type: 'RENAME_VIA'; id: string; label: string }
  | { type: 'RENAME_PAD'; id: string; label: string }
  /** Nudge a pad by a delta in its own side's image pixels. */
  | { type: 'MOVE_PAD'; id: string; dx: number; dy: number }
  | { type: 'SELECT'; selection: BoardState['selection'] }
  | { type: 'TOGGLE_TRACE_VIA'; traceId: string; viaId: string }
  | { type: 'SET_UNIT'; unit: LengthUnit }
  | { type: 'SET_BOARD_SIZE'; boardSize: PhysicalSize | null }
  | { type: 'SET_BACK_FLIP'; flip: FlipAxis }
  | { type: 'SET_DEFAULT_TRACE_WIDTH'; width: number }
  | { type: 'SET_DEFAULT_DIAMETER'; kind: RoundKind; diameter: number }
  | { type: 'SET_TRACE_WIDTH'; id: string; width: number | undefined }
  | { type: 'SET_VIA_DIAMETER'; id: string; diameter: number }
  | { type: 'SET_PAD_DIAMETER'; id: string; diameter: number }
  | { type: 'SET_BOARD_NAME'; boardName: string }
  | { type: 'RESTORE_SESSION'; session: SavedSession; images: Record<Side, BoardImage | null> }
  | { type: 'RESET_BOARD' };

const TRACE_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
];

export const initialState: BoardState = {
  boardName: '',
  images: { front: null, back: null },
  traces: [],
  vias: [],
  pads: [],
  tool: 'trace',
  draftTrace: null,
  draftPad: null,
  padArray: null,
  selection: null,
  nextTraceNum: 1,
  nextViaNum: 1,
  nextPadNum: 1,
  alignedSize: null,
  unit: 'mm',
  boardSize: null,
  defaultTraceWidth: 0.25,
  // A signal via is a small drilled dot; a component/mounting hole is roughly a
  // standard 1 mm through-hole. Both are editable per-item and per-board.
  defaultViaDiameter: 0.4,
  defaultHoleDiameter: 1,
  defaultTestPointDiameter: 0.75,
  backFlip: 'horizontal',
  packageIndex: 1,
  packageRotated: false,
};

/** Set the board's default size for one of the round things you can place. */
function withDefaultDiameter(state: BoardState, kind: RoundKind, value: number): BoardState {
  return kind === 'hole'
    ? { ...state, defaultHoleDiameter: value }
    : kind === 'testpoint'
      ? { ...state, defaultTestPointDiameter: value }
      : { ...state, defaultViaDiameter: value };
}

/** The pixel space a point is mirrored within, or null if it isn't known yet. */
function boardSizePx(state: BoardState, side: Side): Size | null {
  return state.alignedSize ?? state.images[side] ?? null;
}

/** Drop a selection that no longer points at anything that exists. */
function pruneSelection(state: BoardState, next: Partial<BoardState>): BoardState['selection'] {
  const sel = state.selection;
  if (!sel) return null;
  const traces = next.traces ?? state.traces;
  const vias = next.vias ?? state.vias;
  const pads = next.pads ?? state.pads;
  const alive =
    sel.kind === 'trace'
      ? traces.some((t) => t.id === sel.id)
      : sel.kind === 'via'
        ? vias.some((v) => v.id === sel.id)
        : pads.some((p) => p.id === sel.id);
  return alive ? sel : null;
}

function addUnique(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

/**
 * The copper a new pad at `rect` sits on — traces on this side with a point
 * inside it, and vias/holes placed on this side inside it. A pad merges with
 * whatever it covers so the union reads as one continuous shape.
 */
function padConnections(state: BoardState, side: Side, rect: Rect) {
  const traces = state.traces.filter(
    (t) => t.side === side && t.points.some((p) => pointInRect(p, rect)),
  );
  const vias = state.vias.filter((v) => {
    const p = v[side];
    return p ? pointInRect(p, rect) : false;
  });
  return { traces, vias };
}

export function boardReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'LOAD_IMAGE':
      return {
        ...state,
        images: { ...state.images, [action.side]: action.image },
      };

    case 'APPLY_ALIGNMENT': {
      const { side, raw, corners, correctedSrc, width, height } = action;
      const image: BoardImage = { src: correctedSrc, width, height, raw, corners };

      // The corrected image is a new pixel space, so anything already drawn on
      // this side no longer lines up: drop this side's traces and pads. Vias
      // survive — this side's half is re-derived by mirroring the other side's
      // position into the new space, and only a via with nothing left on either
      // side is dropped.
      const traces = state.traces.filter((t) => t.side !== side);
      const pads = state.pads.filter((p) => p.side !== side);
      const other: Side = side === 'front' ? 'back' : 'front';
      const vias = state.vias
        .map((v) => {
          const kept = v[other];
          const rebuilt = kept
            ? throughBoard(kept, { width, height }, state.backFlip)
            : undefined;
          return side === 'front' ? { ...v, front: rebuilt } : { ...v, back: rebuilt };
        })
        .filter((v) => v.front || v.back);

      const keptTraceIds = new Set(traces.map((t) => t.id));
      const keptPadIds = new Set(pads.map((p) => p.id));
      const keptViaIds = new Set(vias.map((v) => v.id));

      const next = {
        traces: traces.map((t) => ({
          ...t,
          connectsPad: t.connectsPad.filter((id) => keptPadIds.has(id)),
          connectsVia: t.connectsVia.filter((id) => keptViaIds.has(id)),
        })),
        pads: pads.map((p) => ({
          ...p,
          connectsTrace: p.connectsTrace.filter((id) => keptTraceIds.has(id)),
          connectsVia: p.connectsVia.filter((id) => keptViaIds.has(id)),
        })),
        vias,
      };

      return {
        ...state,
        ...next,
        images: { ...state.images, [side]: image },
        alignedSize: state.alignedSize ?? { width, height },
        selection: pruneSelection(state, next),
        draftTrace: state.draftTrace?.side === side ? null : state.draftTrace,
        draftPad: state.draftPad?.side === side ? null : state.draftPad,
        // This side's pads are gone, so any series armed off one of them is too.
        padArray: null,
      };
    }

    case 'SET_TOOL':
      return { ...state, tool: action.tool, draftTrace: null, draftPad: null, padArray: null };

    case 'ADD_TRACE_POINT': {
      const draft = state.draftTrace;
      if (!draft || draft.side !== action.side) {
        return {
          ...state,
          draftTrace: { side: action.side, points: [action.point] },
        };
      }
      return {
        ...state,
        draftTrace: { ...draft, points: [...draft.points, action.point] },
      };
    }

    case 'UNDO_DRAFT_POINT': {
      const draft = state.draftTrace;
      if (!draft) return state;
      const points = draft.points.slice(0, -1);
      return { ...state, draftTrace: points.length ? { ...draft, points } : null };
    }

    case 'CANCEL_DRAFT':
      return { ...state, draftTrace: null, draftPad: null, padArray: null };

    case 'FINISH_TRACE': {
      const draft = state.draftTrace;
      if (!draft || draft.points.length < 2) return { ...state, draftTrace: null };
      const id = `trace-${draft.side}-${state.nextTraceNum}`;
      const color = TRACE_COLORS[(state.nextTraceNum - 1) % TRACE_COLORS.length];

      // Merge with any pad on this side that the trace runs through, so a trace
      // drawn after its pads still ends up connected. Clicking a pad while
      // tracing drops a point on it, so this is also what links the pads a
      // trace was deliberately started and ended on.
      const touched = state.pads.filter(
        (pad) => pad.side === draft.side && draft.points.some((p) => pointInPad(p, pad)),
      );
      const touchedIds = touched.map((p) => p.id);

      // Same for vias: any point sitting on one connects the trace to it. Points
      // clicked on a via were snapped to its centre, so this picks those up, and
      // it also catches a point dropped on a via without snapping.
      const scale = pxPerUnit(state.images[draft.side], state.boardSize, state.unit);
      const touchedVias = state.vias.filter((v) =>
        draft.points.some((p) => snapVia([v], draft.side, p, scale) !== null),
      );

      const trace: Trace = {
        id,
        side: draft.side,
        points: draft.points,
        label: '',
        color,
        connectsVia: touchedVias.map((v) => v.id),
        connectsPad: touchedIds,
      };

      return {
        ...state,
        traces: [...state.traces, trace],
        pads: state.pads.map((pad) =>
          touchedIds.includes(pad.id)
            ? { ...pad, connectsTrace: addUnique(pad.connectsTrace, id) }
            : pad,
        ),
        nextTraceNum: state.nextTraceNum + 1,
        draftTrace: null,
      };
    }

    case 'ADD_VIA': {
      const { side, point, kind } = action;

      // One drill goes all the way through the board, so placing on one side
      // also places where it emerges on the other. If we don't know the board
      // width yet there's nothing to mirror about, so only this side is placed.
      const size = boardSizePx(state, side);
      const other = size === null ? undefined : throughBoard(point, size, state.backFlip);

      const via: Via = {
        id: `${kind}-${state.nextViaNum}`,
        kind,
        label: '',
        diameter: kind === 'hole' ? state.defaultHoleDiameter : state.defaultViaDiameter,
        front: side === 'front' ? point : other,
        back: side === 'back' ? point : other,
      };

      return {
        ...state,
        vias: [...state.vias, via],
        nextViaNum: state.nextViaNum + 1,
      };
    }

    case 'PAD_CORNER': {
      const draft = state.draftPad;
      if (!draft || draft.side !== action.side) {
        return { ...state, draftPad: { side: action.side, start: action.point } };
      }

      const rect = rectFromCorners(draft.start, action.point);
      if (rect.width < 2 || rect.height < 2) {
        // Too small to be a real pad — treat the second click as a restart.
        return { ...state, draftPad: { side: action.side, start: action.point } };
      }

      const id = `pad-${action.side}-${state.nextPadNum}`;
      const { traces: touchedTraces, vias: touchedVias } = padConnections(state, action.side, rect);

      const pad: Pad = {
        id,
        side: action.side,
        shape: 'rect',
        ...rect,
        label: '',
        // Adopt the color of the copper it merges with, so the union reads as
        // one continuous shape; otherwise take the next palette color.
        color: touchedTraces[0]?.color ?? TRACE_COLORS[(state.nextPadNum - 1) % TRACE_COLORS.length],
        connectsTrace: touchedTraces.map((t) => t.id),
        connectsVia: touchedVias.map((v) => v.id),
      };

      return {
        ...state,
        pads: [...state.pads, pad],
        traces: state.traces.map((t) =>
          pad.connectsTrace.includes(t.id)
            ? { ...t, connectsPad: addUnique(t.connectsPad, id) }
            : t,
        ),
        nextPadNum: state.nextPadNum + 1,
        draftPad: null,
      };
    }

    case 'ADD_TEST_POINT': {
      // A test point is a round pad placed by one click, centred on it.
      const scale = pxPerUnit(state.images[action.side], state.boardSize, state.unit);
      const size = state.defaultTestPointDiameter * scale;
      const rect: Rect = {
        x: Math.round(action.point.x - size / 2),
        y: Math.round(action.point.y - size / 2),
        width: size,
        height: size,
      };
      const { traces, vias } = padConnections(state, action.side, rect);
      const id = `tp-${action.side}-${state.nextPadNum}`;

      const pad: Pad = {
        id,
        side: action.side,
        shape: 'round',
        ...rect,
        label: '',
        // Like any pad, it adopts the color of the copper it lands on so the
        // two read as one shape.
        color: traces[0]?.color ?? TRACE_COLORS[(state.nextPadNum - 1) % TRACE_COLORS.length],
        connectsTrace: traces.map((t) => t.id),
        connectsVia: vias.map((v) => v.id),
      };

      return {
        ...state,
        pads: [...state.pads, pad],
        traces: state.traces.map((t) =>
          pad.connectsTrace.includes(t.id)
            ? { ...t, connectsPad: addUnique(t.connectsPad, id) }
            : t,
        ),
        nextPadNum: state.nextPadNum + 1,
      };
    }

    case 'CYCLE_PACKAGE':
      return { ...state, packageIndex: cyclePackage(state.packageIndex, action.step) };

    case 'ROTATE_PACKAGE':
      return { ...state, packageRotated: !state.packageRotated };

    case 'ADD_PACKAGE': {
      // Both pads of the footprint land in one click, as one part.
      const scale = pxPerUnit(state.images[action.side], state.boardSize, state.unit);
      const pkg = SMD_PACKAGES[state.packageIndex];
      const rects = packagePads(pkg, action.point, scale, state.packageRotated);

      const created: Pad[] = [];
      let num = state.nextPadNum;
      for (const rect of rects) {
        const { traces, vias } = padConnections(state, action.side, rect);
        created.push({
          id: `pad-${action.side}-${num}`,
          side: action.side,
          shape: 'rect',
          ...rect,
          label: '',
          color: traces[0]?.color ?? TRACE_COLORS[(num - 1) % TRACE_COLORS.length],
          connectsTrace: traces.map((t) => t.id),
          connectsVia: vias.map((v) => v.id),
        });
        num++;
      }

      const padsByTrace = new Map<string, string[]>();
      for (const pad of created) {
        for (const traceId of pad.connectsTrace) {
          padsByTrace.set(traceId, [...(padsByTrace.get(traceId) ?? []), pad.id]);
        }
      }

      return {
        ...state,
        pads: [...state.pads, ...created],
        traces: state.traces.map((t) => {
          const ids = padsByTrace.get(t.id);
          return ids ? { ...t, connectsPad: ids.reduce(addUnique, t.connectsPad) } : t;
        }),
        nextPadNum: num,
      };
    }

    case 'TOGGLE_GROUND':
      return action.kind === 'via'
        ? {
            ...state,
            vias: state.vias.map((v) => (v.id === action.id ? { ...v, ground: !v.ground } : v)),
          }
        : {
            ...state,
            pads: state.pads.map((p) => (p.id === action.id ? { ...p, ground: !p.ground } : p)),
          };

    case 'MERGE_OVERLAP': {
      const { traceIds, padIds, viaIds } = action;
      const traceSet = new Set(traceIds);
      const padSet = new Set(padIds);
      // The merged shape adopts whichever color is already in play, so it reads
      // as a continuation of existing copper rather than a brand new net.
      const color =
        state.traces.find((t) => traceSet.has(t.id))?.color ??
        state.pads.find((p) => padSet.has(p.id))?.color ??
        TRACE_COLORS[(state.nextTraceNum - 1) % TRACE_COLORS.length];

      return {
        ...state,
        traces: state.traces.map((t) =>
          traceSet.has(t.id)
            ? { ...t, color, connectsPad: [...padIds], connectsVia: [...viaIds] }
            : t,
        ),
        pads: state.pads.map((p) =>
          padSet.has(p.id)
            ? { ...p, color, connectsTrace: [...traceIds], connectsVia: [...viaIds] }
            : p,
        ),
      };
    }

    case 'START_PAD_ARRAY': {
      const source = state.pads.find((p) => p.id === action.padId);
      if (!source || action.count < 2) return state;
      return {
        ...state,
        padArray: { sourceId: action.padId, count: Math.floor(action.count) },
        draftTrace: null,
        draftPad: null,
      };
    }

    case 'PLACE_PAD_ARRAY': {
      const spec = state.padArray;
      if (!spec) return state;
      const source = state.pads.find((p) => p.id === spec.sourceId);
      // The series runs along one side, so a click on the other side is ignored
      // rather than silently placing pads where they can't be seen.
      if (!source || source.side !== action.side) return state;

      const rects = padSeriesRects(source, action.point, spec.count);
      if (rects.length === 0) return { ...state, padArray: null };

      const created: Pad[] = [];
      let num = state.nextPadNum;

      for (const rect of rects) {
        const { traces, vias } = padConnections(state, action.side, rect);
        created.push({
          id: `${source.shape === 'round' ? 'tp' : 'pad'}-${action.side}-${num}`,
          side: action.side,
          // The copies are the same footprint as the source, round or not.
          shape: source.shape,
          ...rect,
          label: '',
          // A series is one connector, so the copies keep the source's color.
          color: source.color,
          ground: source.ground,
          connectsTrace: traces.map((t) => t.id),
          connectsVia: vias.map((v) => v.id),
        });
        num++;
      }

      // Mirror each new pad's trace links back onto the traces themselves.
      const padsByTrace = new Map<string, string[]>();
      for (const pad of created) {
        for (const traceId of pad.connectsTrace) {
          padsByTrace.set(traceId, [...(padsByTrace.get(traceId) ?? []), pad.id]);
        }
      }

      return {
        ...state,
        pads: [...state.pads, ...created],
        traces: state.traces.map((t) => {
          const ids = padsByTrace.get(t.id);
          return ids ? { ...t, connectsPad: ids.reduce(addUnique, t.connectsPad) } : t;
        }),
        nextPadNum: num,
        padArray: null,
      };
    }

    case 'RENAME_TRACE':
      return {
        ...state,
        traces: state.traces.map((t) => (t.id === action.id ? { ...t, label: action.label } : t)),
      };

    case 'RENAME_VIA':
      return {
        ...state,
        vias: state.vias.map((v) => (v.id === action.id ? { ...v, label: action.label } : v)),
      };

    case 'RENAME_PAD':
      return {
        ...state,
        pads: state.pads.map((p) => (p.id === action.id ? { ...p, label: action.label } : p)),
      };

    case 'MOVE_PAD': {
      const pad = state.pads.find((p) => p.id === action.id);
      if (!pad) return state;

      // Keep the pad on the photo — a pad dragged off the edge is unreachable.
      const image = state.images[pad.side];
      const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
      const x = image ? clamp(pad.x + action.dx, image.width - pad.width) : pad.x + action.dx;
      const y = image ? clamp(pad.y + action.dy, image.height - pad.height) : pad.y + action.dy;
      if (x === pad.x && y === pad.y) return state;

      // The pad has moved off some copper and onto other copper, so its
      // connections are recomputed from the new position rather than carried
      // over — and both directions of every link have to follow.
      const rect: Rect = { x, y, width: pad.width, height: pad.height };
      const { traces, vias } = padConnections(state, pad.side, rect);
      const traceIds = traces.map((t) => t.id);
      const moved: Pad = {
        ...pad,
        ...rect,
        connectsTrace: traceIds,
        connectsVia: vias.map((v) => v.id),
      };

      return {
        ...state,
        pads: state.pads.map((p) => (p.id === pad.id ? moved : p)),
        traces: state.traces.map((t) => {
          const linked = traceIds.includes(t.id);
          if (linked === t.connectsPad.includes(pad.id)) return t;
          return {
            ...t,
            connectsPad: linked
              ? addUnique(t.connectsPad, pad.id)
              : t.connectsPad.filter((id) => id !== pad.id),
          };
        }),
      };
    }

    case 'SELECT':
      return { ...state, selection: action.selection };

    case 'TOGGLE_TRACE_VIA':
      return {
        ...state,
        traces: state.traces.map((t) => {
          if (t.id !== action.traceId) return t;
          const has = t.connectsVia.includes(action.viaId);
          return {
            ...t,
            connectsVia: has
              ? t.connectsVia.filter((v) => v !== action.viaId)
              : [...t.connectsVia, action.viaId],
          };
        }),
      };

    case 'SET_UNIT': {
      // Changing the display unit must not resize anything, so convert every
      // stored physical measurement into the new unit.
      const from = state.unit;
      const to = action.unit;
      if (from === to) return state;
      const conv = (v: number) => convertLength(v, from, to);
      return {
        ...state,
        unit: to,
        boardSize: state.boardSize
          ? { width: conv(state.boardSize.width), height: conv(state.boardSize.height) }
          : null,
        defaultTraceWidth: conv(state.defaultTraceWidth),
        defaultViaDiameter: conv(state.defaultViaDiameter),
        defaultHoleDiameter: conv(state.defaultHoleDiameter),
        defaultTestPointDiameter: conv(state.defaultTestPointDiameter),
        traces: state.traces.map((t) =>
          t.width === undefined ? t : { ...t, width: conv(t.width) },
        ),
        vias: state.vias.map((v) => ({ ...v, diameter: conv(v.diameter) })),
      };
    }

    case 'SET_BACK_FLIP': {
      if (action.flip === state.backFlip) return state;
      const size = boardSizePx(state, 'front') ?? boardSizePx(state, 'back');

      // Changing the flip has to move everything already placed, or the toggle
      // would only affect future vias and leave existing ones wrong. The side a
      // via was originally clicked on isn't recorded, so the front position is
      // treated as authoritative and the back re-derived from it.
      return {
        ...state,
        backFlip: action.flip,
        vias: size
          ? state.vias.map((v) =>
              v.front
                ? { ...v, back: throughBoard(v.front, size, action.flip) }
                : v.back
                  ? { ...v, front: throughBoard(v.back, size, action.flip) }
                  : v,
            )
          : state.vias,
      };
    }

    case 'SET_BOARD_SIZE':
      return { ...state, boardSize: action.boardSize };

    case 'SET_DEFAULT_TRACE_WIDTH':
      return { ...state, defaultTraceWidth: clampLength(action.width, state.unit) };

    case 'SET_DEFAULT_DIAMETER':
      return withDefaultDiameter(state, action.kind, clampLength(action.diameter, state.unit));

    case 'SET_TRACE_WIDTH':
      return {
        ...state,
        traces: state.traces.map((t) =>
          t.id === action.id
            ? {
                ...t,
                width:
                  action.width === undefined ? undefined : clampLength(action.width, state.unit),
              }
            : t,
        ),
      };

    case 'SET_VIA_DIAMETER':
      return {
        ...state,
        vias: state.vias.map((v) =>
          v.id === action.id ? { ...v, diameter: clampLength(action.diameter, state.unit) } : v,
        ),
      };

    // Resizing a round pad keeps it square — it's the inscribed circle, so its
    // bounding box has to stay one diameter on a side.
    case 'SET_PAD_DIAMETER':
      return {
        ...state,
        pads: state.pads.map((p) => {
          if (p.id !== action.id) return p;
          const scale = pxPerUnit(state.images[p.side], state.boardSize, state.unit);
          const size = clampLength(action.diameter, state.unit) * scale;
          return {
            ...p,
            x: Math.round(p.x + p.width / 2 - size / 2),
            y: Math.round(p.y + p.height / 2 - size / 2),
            width: size,
            height: size,
          };
        }),
      };

    case 'SET_BOARD_NAME':
      return { ...state, boardName: action.boardName };

    case 'RESTORE_SESSION': {
      const { session, images } = action;
      return {
        ...initialState,
        images,
        boardName: session.boardName,
        traces: session.traces,
        vias: session.vias,
        pads: session.pads,
        nextTraceNum: session.nextTraceNum,
        nextViaNum: session.nextViaNum,
        nextPadNum: session.nextPadNum,
        alignedSize: session.alignedSize,
        unit: session.unit,
        boardSize: session.boardSize,
        defaultTraceWidth: session.defaultTraceWidth,
        defaultViaDiameter: session.defaultViaDiameter,
        defaultHoleDiameter: session.defaultHoleDiameter,
        defaultTestPointDiameter: session.defaultTestPointDiameter,
        backFlip: session.backFlip,
        // Tool and footprint choice are UI state, not board data — a restore
        // shouldn't yank the tool out from under you.
        tool: state.tool,
        packageIndex: state.packageIndex,
        packageRotated: state.packageRotated,
      };
    }

    case 'RESET_BOARD':
      return { ...initialState, tool: state.tool };

    case 'DELETE_SELECTED': {
      if (!state.selection) return state;
      const { kind, id } = state.selection;

      if (kind === 'trace') {
        return {
          ...state,
          traces: state.traces.filter((t) => t.id !== id),
          pads: state.pads.map((p) => ({
            ...p,
            connectsTrace: p.connectsTrace.filter((t) => t !== id),
          })),
          selection: null,
        };
      }

      if (kind === 'pad') {
        return {
          ...state,
          pads: state.pads.filter((p) => p.id !== id),
          traces: state.traces.map((t) => ({
            ...t,
            connectsPad: t.connectsPad.filter((p) => p !== id),
          })),
          padArray: state.padArray?.sourceId === id ? null : state.padArray,
          selection: null,
        };
      }

      return {
        ...state,
        vias: state.vias.filter((v) => v.id !== id),
        traces: state.traces.map((t) => ({
          ...t,
          connectsVia: t.connectsVia.filter((v) => v !== id),
        })),
        pads: state.pads.map((p) => ({
          ...p,
          connectsVia: p.connectsVia.filter((v) => v !== id),
        })),
        selection: null,
      };
    }

    default:
      return state;
  }
}
