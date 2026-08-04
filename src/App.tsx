import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { boardReducer, initialState } from './state/boardReducer';
import type { BoardImage, Point, Side } from './types';
import { BoardPanel } from './components/BoardPanel';
import { AlignOverlay } from './components/AlignOverlay';
import { Toolbar } from './components/Toolbar';
import { ViaLinkPicker } from './components/ViaLinkPicker';
import { TraceList } from './components/TraceList';
import { ViaList } from './components/ViaList';
import { PadList } from './components/PadList';
import { ScalePanel } from './components/ScalePanel';
import { ExportBar } from './components/ExportBar';
import { RestoreBanner } from './components/RestoreBanner';
import { buildCombinedSvg, downloadSvg } from './lib/svgExport';
import { loadImageElement, quadOutputSize, warpPerspective } from './lib/homography';
import { pxPerUnit } from './lib/scale';
import {
  clearSession,
  hasWork,
  loadSession,
  saveSession,
  sessionKeyFor,
  snapshotFromState,
  type SavedSession,
} from './lib/persistence';
import './App.css';

/** Debounce autosaves so dragging/typing doesn't hammer localStorage. */
const AUTOSAVE_DELAY_MS = 600;

function App() {
  const [state, dispatch] = useReducer(boardReducer, initialState);
  const [pendingVia, setPendingVia] = useState<{ side: Side; point: Point } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [aligning, setAligning] = useState<Side | null>(null);
  const [alignBusy, setAlignBusy] = useState(false);
  const [alignError, setAlignError] = useState<string | null>(null);
  const [offer, setOffer] = useState<SavedSession | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** Session keys we've already offered to restore, so a dismissal sticks. */
  const offeredKeys = useRef<Set<string>>(new Set());

  const sessionKey = useMemo(
    () => sessionKeyFor(state.images.front?.raw?.src ?? state.images.front?.src ?? null,
                        state.images.back?.raw?.src ?? state.images.back?.src ?? null),
    [state.images.front, state.images.back],
  );

  const hasDraft = Boolean(state.draftTrace);
  const hasSelection = Boolean(state.selection);
  const canExport = Boolean(state.images.front && state.images.back);

  function handleLoadImage(side: Side, image: BoardImage) {
    dispatch({ type: 'LOAD_IMAGE', side, image });
  }

  function handleCanvasClick(side: Side, point: Point) {
    if (state.tool === 'trace') {
      dispatch({ type: 'ADD_TRACE_POINT', side, point });
    } else if (state.tool === 'pad') {
      dispatch({ type: 'PAD_CORNER', side, point });
    } else {
      setPendingVia({ side, point });
    }
  }

  function handleCanvasDoubleClick(side: Side) {
    if (state.draftTrace && state.draftTrace.side === side) {
      dispatch({ type: 'FINISH_TRACE' });
    }
  }

  function handleChooseVia(viaId: string | null) {
    if (!pendingVia) return;
    dispatch({ type: 'ADD_VIA', side: pendingVia.side, point: pendingVia.point, viaId });
    setPendingVia(null);
  }

  function handleAlign(side: Side) {
    const hasWork =
      state.traces.some((t) => t.side === side) || state.vias.some((v) => Boolean(v[side]));
    if (
      hasWork &&
      !window.confirm(
        `Re-aligning the ${side} will change its pixel space, so the traces and vias already placed on that side will be removed. Continue?`,
      )
    ) {
      return;
    }
    setAlignError(null);
    setAligning(side);
  }

  async function handleAlignConfirm(corners: Point[]) {
    if (!aligning) return;
    const image = state.images[aligning];
    if (!image) return;

    const raw = image.raw ?? { src: image.src, width: image.width, height: image.height };
    setAlignBusy(true);
    setAlignError(null);
    try {
      const el = await loadImageElement(raw.src);
      const size = state.alignedSize ?? quadOutputSize(corners);
      const correctedSrc = warpPerspective(el, corners, size.width, size.height);
      dispatch({
        type: 'APPLY_ALIGNMENT',
        side: aligning,
        raw,
        corners,
        correctedSrc,
        width: size.width,
        height: size.height,
      });
      setAligning(null);
    } catch (err) {
      setAlignError(err instanceof Error ? err.message : String(err));
    } finally {
      setAlignBusy(false);
    }
  }

  // Offer to restore when the uploaded photos match a saved session — but never
  // over the top of work already in progress in this tab.
  useEffect(() => {
    if (!sessionKey || offer || restoreBusy) return;
    if (offeredKeys.current.has(sessionKey)) return;
    if (hasWork(state)) return;

    const found = loadSession(sessionKey);
    if (found && hasWork(found)) {
      offeredKeys.current.add(sessionKey);
      setOffer(found);
    }
  }, [sessionKey, offer, restoreBusy, state]);

  // Debounced autosave of everything except the photos themselves.
  useEffect(() => {
    if (!sessionKey || restoreBusy) return;
    if (!hasWork(state)) return;

    const timer = setTimeout(() => {
      const snapshot = snapshotFromState(state);
      const err = saveSession(sessionKey, snapshot);
      setSaveError(err);
      if (!err) setSavedAt(snapshot.savedAt);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [state, sessionKey, restoreBusy]);

  async function handleRestore() {
    if (!offer) return;
    setRestoreBusy(true);
    setAlignError(null);
    try {
      // Re-derive each corrected image by re-warping the freshly uploaded photo
      // with the corners we saved, rather than storing the warped raster.
      const images = { ...state.images };
      for (const side of ['front', 'back'] as Side[]) {
        const saved = offer.alignment[side];
        const current = images[side];
        if (!saved || !current) continue;
        const raw = current.raw ?? {
          src: current.src,
          width: current.width,
          height: current.height,
        };
        const el = await loadImageElement(raw.src);
        const correctedSrc = warpPerspective(el, saved.corners, saved.width, saved.height);
        images[side] = {
          src: correctedSrc,
          width: saved.width,
          height: saved.height,
          raw,
          corners: saved.corners,
        };
      }
      dispatch({ type: 'RESTORE_SESSION', session: offer, images });
      setOffer(null);
    } catch (err) {
      setAlignError(
        `Couldn't restore the saved alignment: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRestoreBusy(false);
    }
  }

  function handleDismissOffer() {
    // Clear the stored copy too, so "Start fresh" isn't re-offered on reload.
    if (sessionKey) clearSession(sessionKey);
    setOffer(null);
  }

  function handleExport() {
    const boardName = state.boardName;
    try {
      const svg = buildCombinedSvg(state, boardName);
      downloadSvg(svg, boardName);
      setExportError(null);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (aligning) {
        // While the align overlay is open it owns the keyboard.
        if (e.key === 'Escape' && !alignBusy) setAligning(null);
        return;
      }

      if (e.key === 'Enter') {
        if (state.draftTrace) dispatch({ type: 'FINISH_TRACE' });
      } else if (e.key === 'Escape') {
        if (pendingVia) setPendingVia(null);
        else if (state.draftTrace || state.draftPad) dispatch({ type: 'CANCEL_DRAFT' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection) {
          e.preventDefault();
          dispatch({ type: 'DELETE_SELECTED' });
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.draftTrace, state.draftPad, state.selection, pendingVia, aligning, alignBusy]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Circuit Board Tracer</h1>
        <ExportBar
          canExport={canExport}
          boardName={state.boardName}
          onSetBoardName={(boardName) => dispatch({ type: 'SET_BOARD_NAME', boardName })}
          onExport={handleExport}
        />
      </header>
      {exportError && <div className="export-error">{exportError}</div>}
      {saveError && <div className="export-error">{saveError}</div>}
      {alignError && !aligning && <div className="export-error">{alignError}</div>}

      {offer && (
        <RestoreBanner
          session={offer}
          busy={restoreBusy}
          onRestore={handleRestore}
          onDismiss={handleDismissOffer}
        />
      )}

      <Toolbar
        tool={state.tool}
        hasDraft={hasDraft}
        hasPadDraft={Boolean(state.draftPad)}
        hasSelection={hasSelection}
        onSetTool={(tool) => dispatch({ type: 'SET_TOOL', tool })}
        onFinishTrace={() => dispatch({ type: 'FINISH_TRACE' })}
        onUndoPoint={() => dispatch({ type: 'UNDO_DRAFT_POINT' })}
        onCancelDraft={() => dispatch({ type: 'CANCEL_DRAFT' })}
        onDeleteSelected={() => dispatch({ type: 'DELETE_SELECTED' })}
      />

      <main className="board-area">
        {(['front', 'back'] as Side[]).map((side) => (
          <BoardPanel
            key={side}
            side={side}
            state={state}
            onLoadImage={handleLoadImage}
            onCanvasClick={handleCanvasClick}
            onCanvasDoubleClick={handleCanvasDoubleClick}
            onSelectTrace={(id) => dispatch({ type: 'SELECT', selection: { kind: 'trace', id } })}
            onSelectVia={(id) => dispatch({ type: 'SELECT', selection: { kind: 'via', id } })}
            onSelectPad={(id) => dispatch({ type: 'SELECT', selection: { kind: 'pad', id } })}
            onAlign={handleAlign}
            onScaleVia={(id, factor) => dispatch({ type: 'SCALE_VIA_DIAMETER', id, factor })}
            onScaleDefaultVia={(factor) =>
              dispatch({ type: 'SCALE_DEFAULT_VIA_DIAMETER', factor })
            }
          />
        ))}
      </main>

      <aside className="sidebar">
        <div className="sidebar-section">
          <h3>Session</h3>
          <p className="list-empty">
            {!sessionKey
              ? 'Upload an image to start autosaving.'
              : savedAt
                ? `Autosaved at ${new Date(savedAt).toLocaleTimeString()}. Re-upload the same images to pick up here.`
                : 'Autosaves as you work. Photos are never stored — re-upload them to restore.'}
          </p>
          {sessionKey && savedAt && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Discard the autosaved work for these images and clear the board?',
                  )
                ) {
                  clearSession(sessionKey);
                  offeredKeys.current.add(sessionKey);
                  setSavedAt(null);
                  dispatch({ type: 'RESET_BOARD' });
                }
              }}
            >
              Discard saved work
            </button>
          )}
        </div>
        <div className="sidebar-section">
          <h3>Scale</h3>
          <ScalePanel
            unit={state.unit}
            boardSize={state.boardSize}
            defaultTraceWidth={state.defaultTraceWidth}
            defaultViaDiameter={state.defaultViaDiameter}
            onSetUnit={(unit) => dispatch({ type: 'SET_UNIT', unit })}
            onSetBoardSize={(boardSize) => dispatch({ type: 'SET_BOARD_SIZE', boardSize })}
            onSetDefaultTraceWidth={(width) =>
              dispatch({ type: 'SET_DEFAULT_TRACE_WIDTH', width })
            }
            onSetDefaultViaDiameter={(diameter) =>
              dispatch({ type: 'SET_DEFAULT_VIA_DIAMETER', diameter })
            }
          />
        </div>
        <div className="sidebar-section">
          <h3>Traces</h3>
          <TraceList
            traces={state.traces}
            selection={state.selection}
            unit={state.unit}
            defaultWidth={state.defaultTraceWidth}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'trace', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_TRACE', id, label })}
            onSetWidth={(id, width) => dispatch({ type: 'SET_TRACE_WIDTH', id, width })}
          />
        </div>
        <div className="sidebar-section">
          <h3>Pads</h3>
          <PadList
            pads={state.pads}
            selection={state.selection}
            unit={state.unit}
            scaleFor={(pad) => pxPerUnit(state.images[pad.side], state.boardSize, state.unit)}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'pad', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_PAD', id, label })}
          />
        </div>
        <div className="sidebar-section">
          <h3>Vias</h3>
          <ViaList
            vias={state.vias}
            selection={state.selection}
            unit={state.unit}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'via', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_VIA', id, label })}
            onSetDiameter={(id, diameter) => dispatch({ type: 'SET_VIA_DIAMETER', id, diameter })}
          />
        </div>
      </aside>

      {aligning &&
        (() => {
          const image = state.images[aligning];
          if (!image) return null;
          const raw = image.raw ?? image;
          return (
            <AlignOverlay
              side={aligning}
              src={raw.src}
              width={raw.width}
              height={raw.height}
              initialCorners={image.corners}
              lockedSize={state.alignedSize}
              busy={alignBusy}
              error={alignError}
              onConfirm={handleAlignConfirm}
              onCancel={() => setAligning(null)}
            />
          );
        })()}

      {pendingVia && (
        <ViaLinkPicker
          side={pendingVia.side}
          vias={state.vias}
          onChoose={handleChooseVia}
          onCancel={() => setPendingVia(null)}
        />
      )}
    </div>
  );
}

export default App;
