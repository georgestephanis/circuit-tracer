import { useState } from 'react';
import type { Tool } from '../types';
import { FOOTPRINTS } from '../lib/packages';

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
  packageIndex: number;
  packageRotation: number;
  onSelectPackage: (index: number) => void;
  onRotatePackage: () => void;
  onSetTool: (tool: Tool) => void;
  onFinishTrace: () => void;
  onUndoPoint: () => void;
  onCancelDraft: () => void;
  onDeleteSelected: () => void;
  onStartPadArray: (padId: string, count: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 0–1, applied to everything drawn over both photos. */
  overlayOpacity: number;
  onSetOverlayOpacity: (opacity: number) => void;
  onFindOverlaps: () => void;
}

export function Toolbar({
  tool,
  hasDraft,
  hasPadDraft,
  hasSelection,
  selectedPadId,
  padArrayCount,
  packageIndex,
  packageRotation,
  onSelectPackage,
  onRotatePackage,
  onSetTool,
  onFinishTrace,
  onUndoPoint,
  onCancelDraft,
  onDeleteSelected,
  onStartPadArray,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  overlayOpacity,
  onSetOverlayOpacity,
  onFindOverlaps,
}: Props) {
  const [count, setCount] = useState(4);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={tool === 'pointer' ? 'active' : ''}
          onClick={() => onSetTool('pointer')}
          title="Pointer (0)"
        >
          Pointer
        </button>
        <button
          type="button"
          className={tool === 'trace' ? 'active' : ''}
          onClick={() => onSetTool('trace')}
        >
          Trace
        </button>
        <button type="button" className={tool === 'via' ? 'active' : ''} onClick={() => onSetTool('via')}
          title="Via (2)"
        >
          Via
        </button>
        <button
          type="button"
          className={tool === 'hole' ? 'active' : ''}
          onClick={() => onSetTool('hole')}
        >
          Hole
        </button>
        <button type="button" className={tool === 'pad' ? 'active' : ''} onClick={() => onSetTool('pad')}
          title="Pad (4)"
        >
          Pad
        </button>
        <button
          type="button"
          className={tool === 'testpoint' ? 'active' : ''}
          onClick={() => onSetTool('testpoint')}
        >
          Test point
        </button>
        <button
          type="button"
          className={tool === 'package' ? 'active' : ''}
          onClick={() => onSetTool('package')}
        >
          SMD package
        </button>
      </div>

      {tool === 'pointer' && (
        <div className="toolbar-group">
          <span className="export-hint">
            Click a trace, pad, via, or component to select it and see its whole net. Drag a
            pad to move it; shift-click pads to group them into a component.
          </span>
        </div>
      )}

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
            Placed on both sides at once. The preview under the cursor is drawn at the real
            size — change it in the Scale panel.
          </span>
        </div>
      )}

      {tool === 'testpoint' && (
        <div className="toolbar-group">
          <span className="export-hint">
            Click to drop a round test point. The preview is drawn at the real size.
          </span>
        </div>
      )}

      {tool === 'package' && (
        <div className="toolbar-group">
          <label className="inline-field">
            <span>Footprint</span>
            <select
              value={packageIndex}
              onChange={(e) => onSelectPackage(Number(e.target.value))}
            >
              {FOOTPRINTS.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onRotatePackage}>
            Rotate ({packageRotation * 90}°)
          </button>
          <span className="export-hint">
            Scroll to step through footprints, right-click to rotate. Click to drop both pads.
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

      {/* Fade the annotations back to check them against the photo underneath.
          A view setting, so it's always here rather than under a tool. */}
      <div className="toolbar-group">
        <label className="inline-field">
          <span>Overlay</span>
          <input
            type="range"
            className="opacity-slider"
            min={0}
            max={100}
            step={5}
            value={Math.round(overlayOpacity * 100)}
            onChange={(e) => onSetOverlayOpacity(Number(e.target.value) / 100)}
            title="Opacity of pads, traces, and vias over the photo"
          />
        </label>
        <span className="export-hint">{Math.round(overlayOpacity * 100)}%</span>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          onClick={onFindOverlaps}
          title="Scan for pads/vias/traces that touch without being wired into the same net"
        >
          Find overlaps
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Shift+Ctrl/Cmd+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={!hasSelection}
          title="Delete selected (Del)"
        >
          Delete selected
        </button>
      </div>
    </div>
  );
}
