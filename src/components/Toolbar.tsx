import type { Tool } from '../types';

interface Props {
  tool: Tool;
  hasDraft: boolean;
  hasPadDraft: boolean;
  hasSelection: boolean;
  onSetTool: (tool: Tool) => void;
  onFinishTrace: () => void;
  onUndoPoint: () => void;
  onCancelDraft: () => void;
  onDeleteSelected: () => void;
}

export function Toolbar({
  tool,
  hasDraft,
  hasPadDraft,
  hasSelection,
  onSetTool,
  onFinishTrace,
  onUndoPoint,
  onCancelDraft,
  onDeleteSelected,
}: Props) {
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
          Via / Hole
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

      {tool === 'via' && (
        <div className="toolbar-group">
          <span className="export-hint">Scroll over a via to resize it.</span>
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

      <div className="toolbar-group">
        <button type="button" onClick={onDeleteSelected} disabled={!hasSelection}>
          Delete selected
        </button>
      </div>
    </div>
  );
}
