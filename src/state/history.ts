import type { BoardState } from '../types';
import { boardReducer, initialState, type Action } from './boardReducer';

/** How many steps back you can go before the oldest is dropped. */
const MAX_HISTORY = 50;

export interface History {
  past: BoardState[];
  present: BoardState;
  future: BoardState[];
}

export type HistoryAction = Action | { type: 'UNDO' } | { type: 'REDO' };

export const initialHistory: History = { past: [], present: initialState, future: [] };

/**
 * Actions that change how you're *looking* at the board rather than the board
 * itself. Undo should step over these — nobody expects Ctrl-Z to put a tool
 * back, and letting a selection consume an undo press makes the whole stack
 * feel broken.
 */
const TRANSPARENT: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'SET_TOOL',
  'SELECT',
  'CYCLE_PACKAGE',
  'ROTATE_PACKAGE',
  'START_PAD_ARRAY',
  'CANCEL_DRAFT',
  'TOGGLE_PAD_PICK',
  'SET_ACTIVE_SHOT',
]);

/**
 * Actions after which there's nothing coherent to go back to, so the stack is
 * cleared rather than left pointing at a board that no longer exists.
 */
const RESETS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'RESTORE_SESSION',
  'RESET_BOARD',
]);

export function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'UNDO') {
    const previous = history.past[history.past.length - 1];
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };
  }

  if (action.type === 'REDO') {
    const [next, ...rest] = history.future;
    if (!next) return history;
    return {
      past: [...history.past, history.present],
      present: next,
      future: rest,
    };
  }

  const present = boardReducer(history.present, action);

  // A reducer that returned the same object did nothing, so there's nothing to
  // record — this keeps no-op actions from filling the stack with dead steps.
  if (present === history.present) return history;

  if (RESETS.has(action.type)) return { past: [], present, future: [] };
  if (TRANSPARENT.has(action.type)) return { ...history, present };

  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present,
    // Doing something new abandons the redo branch, as everywhere else.
    future: [],
  };
}
