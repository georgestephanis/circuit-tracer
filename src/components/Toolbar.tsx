import { useState } from 'react';
import type { Tool } from '../types';

/** Series shorter than this aren't a series; the reducer enforces it too. */
const MIN_SERIES = 2;

interface Props {
  tool: Tool;
  hasDraft: boolean;
  hasPadDraft: boolean;
  hasSelection: boolean;
  /** The selected pad, if the current selection is one — the series source. */
  selectedPadId: string | null;
  /** How many pads the armed series will end up with, or null if not armed. */
  padArrayCount: number | null;
  onSetTool: (tool: Tool) => void;
  onFinishTrace: () => void;
  onUndoPoint: () => void;
  onCancelDraft: () => void;
  onDeleteSelected: () => void;
  onStartPadArray: (padId: string, count: number) => void;
}

export function Toolbar({
  tool,
  hasDraft,
  hasPadDraft,
  hasSelection,
  selectedPadId,
  padArrayCount,
  onSetTool,
  onFinishTrace,
  onUndoPoint,
  onCancelDraft,
  onDeleteSelected,
  onStartPadArray,
}: Props) {
  const [count, setCount] = useState(4);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={tool === 'trace' ? 'active' : ''}
          onClick={() => onSetTool('trace')}
        >
          Trace
        </button>
        <button type="button" className={tool === 'via' ? 'active' : ''} onClick={() => onSetTool('via')}>
          Via
        </button>
        <button
          type="button"
          className={tool === 'hole' ? 'active' : ''}
          onClick={() => onSetTool('hole')}
        >
          Hole
        </button>
        <button type="button" className={tool === 'pad' ? 'active' : ''} onClick={() => onSetTool('pad')}>
          Pad
        </button>
      </div>

      {tool === 'trace' && (
        <div className="toolbar-group">
          <button type="button" onClick={onFinishTrace} disabled={!hasDraft}>
            Finish trace (Enter)
          </button>
          <button type="button" onClick={onUndoPoint} disabled={!hasDraft}>
            Undo point
          </button>
          <button type="button" onClick={onCancelDraft} disabled={!hasDraft}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {(tool === 'via' || tool === 'hole') && (
        <div className="toolbar-group">
          <span className="export-hint">
            Placed on both sides at once. Scroll over one to resize it, or over bare board to
            change the default {tool} size.
          </span>
        </div>
      )}

      {tool === 'pad' && (
        <div className="toolbar-group">
          <span className="export-hint">
            {hasPadDraft
              ? 'Click the opposite corner to finish the pad.'
              : 'Click two opposite corners to place a pad.'}
          </span>
          <button type="button" onClick={onCancelDraft} disabled={!hasPadDraft}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {padArrayCount !== null ? (
        <div className="toolbar-group">
          <span className="export-hint">
            Click where pad {padArrayCount} of the series goes — the rest fill in evenly.
          </span>
          <button type="button" onClick={onCancelDraft}>
            Cancel (Esc)
          </button>
        </div>
      ) : (
        selectedPadId && (
          <div className="toolbar-group">
            <label className="inline-field">
              <span>Series of</span>
              <input
                type="number"
                min={MIN_SERIES}
                step={1}
                value={count}
                onChange={(e) => setCount(Math.max(MIN_SERIES, Number(e.target.value) || 0))}
              />
            </label>
            <button type="button" onClick={() => onStartPadArray(selectedPadId, count)}>
              Repeat pad…
            </button>
          </div>
        )
      )}

      <div className="toolbar-group">
        <button type="button" onClick={onDeleteSelected} disabled={!hasSelection}>
          Delete selected
        </button>
      </div>
    </div>
  );
}
