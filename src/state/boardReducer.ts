import type {
  BoardImage,
  BoardState,
  LengthUnit,
  Pad,
  PhysicalSize,
  Point,
  RawImage,
  Side,
  Tool,
  Trace,
} from '../types';
import { pointInRect, rectFromCorners } from '../lib/geometry';
import { clampLength, convertLength } from '../lib/scale';
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
  | { type: 'ADD_VIA'; side: Side; point: Point; viaId: string | null }
  | { type: 'PAD_CORNER'; side: Side; point: Point }
  | { type: 'DELETE_SELECTED' }
  | { type: 'RENAME_TRACE'; id: string; label: string }
  | { type: 'RENAME_VIA'; id: string; label: string }
  | { type: 'RENAME_PAD'; id: string; label: string }
  | { type: 'SELECT'; selection: BoardState['selection'] }
  | { type: 'TOGGLE_TRACE_VIA'; traceId: string; viaId: string }
  | { type: 'SET_UNIT'; unit: LengthUnit }
  | { type: 'SET_BOARD_SIZE'; boardSize: PhysicalSize | null }
  | { type: 'SET_DEFAULT_TRACE_WIDTH'; width: number }
  | { type: 'SET_DEFAULT_VIA_DIAMETER'; diameter: number }
  | { type: 'SET_TRACE_WIDTH'; id: string; width: number | undefined }
  | { type: 'SET_VIA_DIAMETER'; id: string; diameter: number }
  /** Multiplicative resize, used by scroll-wheel sizing. */
  | { type: 'SCALE_VIA_DIAMETER'; id: string; factor: number }
  | { type: 'SCALE_DEFAULT_VIA_DIAMETER'; factor: number }
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
  selection: null,
  nextTraceNum: 1,
  nextViaNum: 1,
  nextPadNum: 1,
  alignedSize: null,
  unit: 'mm',
  boardSize: null,
  defaultTraceWidth: 0.25,
  defaultViaDiameter: 0.8,
};

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
      // this side no longer lines up: drop this side's traces and pads, and drop
      // this side's half of every via (removing the via entirely if that leaves
      // it with no position on either side).
      const traces = state.traces.filter((t) => t.side !== side);
      const pads = state.pads.filter((p) => p.side !== side);
      const vias = state.vias
        .map((v) => ({ ...v, [side]: undefined }))
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
      };
    }

    case 'SET_TOOL':
      return { ...state, tool: action.tool, draftTrace: null, draftPad: null };

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
      return { ...state, draftTrace: null, draftPad: null };

    case 'FINISH_TRACE': {
      const draft = state.draftTrace;
      if (!draft || draft.points.length < 2) return { ...state, draftTrace: null };
      const id = `trace-${draft.side}-${state.nextTraceNum}`;
      const color = TRACE_COLORS[(state.nextTraceNum - 1) % TRACE_COLORS.length];

      // Merge with any pad on this side that the trace runs through, so a trace
      // drawn after its pads still ends up connected.
      const touched = state.pads.filter(
        (pad) => pad.side === draft.side && draft.points.some((p) => pointInRect(p, pad)),
      );
      const touchedIds = touched.map((p) => p.id);

      const trace: Trace = {
        id,
        side: draft.side,
        points: draft.points,
        label: '',
        color,
        connectsVia: [],
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
      if (action.viaId) {
        return {
          ...state,
          vias: state.vias.map((v) =>
            v.id === action.viaId ? { ...v, [action.side]: action.point } : v,
          ),
        };
      }
      const id = `via-${state.nextViaNum}`;
      return {
        ...state,
        vias: [
          ...state.vias,
          { id, label: '', diameter: state.defaultViaDiameter, [action.side]: action.point },
        ],
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

      // A pad merges with whatever copper it covers: traces on this side with a
      // point inside it, and vias placed on this side inside it.
      const touchedTraces = state.traces.filter(
        (t) => t.side === action.side && t.points.some((p) => pointInRect(p, rect)),
      );
      const touchedVias = state.vias.filter((v) => {
        const p = v[action.side];
        return p ? pointInRect(p, rect) : false;
      });

      const pad: Pad = {
        id,
        side: action.side,
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
        traces: state.traces.map((t) =>
          t.width === undefined ? t : { ...t, width: conv(t.width) },
        ),
        vias: state.vias.map((v) => ({ ...v, diameter: conv(v.diameter) })),
      };
    }

    case 'SET_BOARD_SIZE':
      return { ...state, boardSize: action.boardSize };

    case 'SET_DEFAULT_TRACE_WIDTH':
      return { ...state, defaultTraceWidth: clampLength(action.width, state.unit) };

    case 'SET_DEFAULT_VIA_DIAMETER':
      return { ...state, defaultViaDiameter: clampLength(action.diameter, state.unit) };

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

    case 'SCALE_VIA_DIAMETER':
      return {
        ...state,
        vias: state.vias.map((v) =>
          v.id === action.id
            ? { ...v, diameter: clampLength(v.diameter * action.factor, state.unit) }
            : v,
        ),
      };

    case 'SCALE_DEFAULT_VIA_DIAMETER':
      return {
        ...state,
        defaultViaDiameter: clampLength(state.defaultViaDiameter * action.factor, state.unit),
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
        tool: state.tool,
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
