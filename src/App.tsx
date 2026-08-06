import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { historyReducer, initialHistory } from './state/history';
import type { BoardImage, Point, Side, Tool } from './types';
import { BoardPanel } from './components/BoardPanel';
import { AlignOverlay } from './components/AlignOverlay';
import { Toolbar } from './components/Toolbar';
import { TraceList } from './components/TraceList';
import { ViaList } from './components/ViaList';
import { PadList } from './components/PadList';
import { ComponentList } from './components/ComponentList';
import { SidebarSection } from './components/SidebarSection';
import { ScalePanel } from './components/ScalePanel';
import { ExportBar } from './components/ExportBar';
import { RestoreBanner } from './components/RestoreBanner';
import { OverlapBanner } from './components/OverlapBanner';
import { buildCombinedSvg, downloadSvg } from './lib/svgExport';
import { downloadNetlist } from './lib/netlist';
import { loadImageElement, quadOutputSize, warpPerspective } from './lib/homography';
import { findOverlapGroups, type OverlapGroup } from './lib/overlaps';
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

/** Number keys pick a tool, in toolbar order. */
const TOOL_KEYS: Record<string, Tool | undefined> = {
  '1': 'trace',
  '2': 'via',
  '3': 'hole',
  '4': 'pad',
  '5': 'testpoint',
  '6': 'package',
};

function App() {
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const state = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  /** Cursor position while placing a via/hole, so the other side can preview the exit. */
  const [holeHover, setHoleHover] = useState<{ side: Side; point: Point } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [aligning, setAligning] = useState<Side | null>(null);
  const [alignBusy, setAlignBusy] = useState(false);
  const [alignError, setAlignError] = useState<string | null>(null);
  const [offer, setOffer] = useState<SavedSession | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // How strongly the annotations are drawn over the photos. Pure view state,
  // like zoom: it isn't board data, so it stays out of the reducer, the undo
  // history, the autosave, and the export — those always get the real thing.
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  /** Session keys we've already offered to restore, so a dismissal sticks. */
  const offeredKeys = useRef<Set<string>>(new Set());
  // The overlap finder's run, stepped through one candidate at a time.
  const [overlapGroups, setOverlapGroups] = useState<OverlapGroup[]>([]);
  const [overlapIndex, setOverlapIndex] = useState(0);
  const currentOverlap = overlapGroups[overlapIndex] ?? null;
  const overlapHighlight = currentOverlap
    ? {
        traces: new Set(currentOverlap.traceIds),
        pads: new Set(currentOverlap.padIds),
        vias: new Set(currentOverlap.viaIds),
      }
    : null;

  const sessionKey = useMemo(
    () => sessionKeyFor(state.images.front?.raw?.src ?? state.images.front?.src ?? null,
                        state.images.back?.raw?.src ?? state.images.back?.src ?? null),
    [state.images.front, state.images.back],
  );

  // Test points are pads, but listing them among the rectangles buries them.
  const rectPads = state.pads.filter((p) => p.shape !== 'round');
  const testPoints = state.pads.filter((p) => p.shape === 'round');

  const hasDraft = Boolean(state.draftTrace);
  const hasSelection = Boolean(state.selection);
  const canExport = Boolean(state.images.front && state.images.back);

  function handleLoadImage(side: Side, image: BoardImage) {
    dispatch({ type: 'LOAD_IMAGE', side, image });
  }

  function handleCanvasClick(side: Side, point: Point) {
    // An armed pad series owns the next click, whatever tool is selected.
    if (state.padArray) {
      dispatch({ type: 'PLACE_PAD_ARRAY', side, point });
    } else if (state.tool === 'trace') {
      dispatch({ type: 'ADD_TRACE_POINT', side, point });
    } else if (state.tool === 'pad') {
      dispatch({ type: 'PAD_CORNER', side, point });
    } else if (state.tool === 'testpoint') {
      dispatch({ type: 'ADD_TEST_POINT', side, point });
    } else if (state.tool === 'package') {
      dispatch({ type: 'ADD_PACKAGE', side, point });
    } else {
      dispatch({ type: 'ADD_VIA', side, point, kind: state.tool });
    }
  }

  function handleCanvasDoubleClick(side: Side) {
    if (state.draftTrace && state.draftTrace.side === side) {
      dispatch({ type: 'FINISH_TRACE' });
    }
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

  function handleFindOverlaps() {
    const groups = findOverlapGroups(state);
    setOverlapGroups(groups);
    setOverlapIndex(0);
    if (groups.length === 0) window.alert('No overlapping copper found outside existing nets.');
  }

  function handleMergeOverlap() {
    if (!currentOverlap) return;
    dispatch({ type: 'MERGE_OVERLAP', ...currentOverlap });
    setOverlapIndex((i) => i + 1);
  }

  function handleSkipOverlap() {
    setOverlapIndex((i) => i + 1);
  }

  function handleCloseOverlaps() {
    setOverlapGroups([]);
    setOverlapIndex(0);
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

  function handleExportNetlist() {
    try {
      downloadNetlist(state, state.boardName);
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

      // Undo/redo, in both the conventional spellings.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      // Everything below is a bare key, so don't swallow browser shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const toolKey = TOOL_KEYS[e.key];
      if (toolKey) {
        dispatch({ type: 'SET_TOOL', tool: toolKey });
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        // Ground the selection, so a run of them can be flagged from the canvas
        // instead of hunting checkboxes in the sidebar.
        const sel = state.selection;
        if (sel && (sel.kind === 'via' || sel.kind === 'pad')) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_GROUND', kind: sel.kind, id: sel.id });
        }
        return;
      }

      if (e.key === 'Enter') {
        if (state.draftTrace) dispatch({ type: 'FINISH_TRACE' });
      } else if (e.key === 'Escape') {
        if (state.draftTrace || state.draftPad || state.padArray || state.padPick.length > 0) {
          dispatch({ type: 'CANCEL_DRAFT' });
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection) {
          e.preventDefault();
          dispatch({ type: 'DELETE_SELECTED' });
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    state.draftTrace,
    state.draftPad,
    state.padArray,
    state.padPick,
    state.selection,
    aligning,
    alignBusy,
  ]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Circuit Board Tracer</h1>
        <ExportBar
          canExport={canExport}
          canExportNetlist={state.components.length > 0}
          boardName={state.boardName}
          onSetBoardName={(boardName) => dispatch({ type: 'SET_BOARD_NAME', boardName })}
          onExport={handleExport}
          onExportNetlist={handleExportNetlist}
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

      {currentOverlap && (
        <OverlapBanner
          group={currentOverlap}
          index={overlapIndex}
          total={overlapGroups.length}
          onMerge={handleMergeOverlap}
          onSkip={handleSkipOverlap}
          onClose={handleCloseOverlaps}
        />
      )}

      <Toolbar
        tool={state.tool}
        hasDraft={hasDraft}
        hasPadDraft={Boolean(state.draftPad)}
        hasSelection={hasSelection}
        selectedPadId={state.selection?.kind === 'pad' ? state.selection.id : null}
        padArrayCount={state.padArray?.count ?? null}
        packageIndex={state.packageIndex}
        packageRotated={state.packageRotated}
        onSelectPackage={(index) =>
          dispatch({ type: 'CYCLE_PACKAGE', step: index - state.packageIndex })
        }
        onRotatePackage={() => dispatch({ type: 'ROTATE_PACKAGE' })}
        onSetTool={(tool) => dispatch({ type: 'SET_TOOL', tool })}
        onFinishTrace={() => dispatch({ type: 'FINISH_TRACE' })}
        onUndoPoint={() => dispatch({ type: 'UNDO_DRAFT_POINT' })}
        onCancelDraft={() => dispatch({ type: 'CANCEL_DRAFT' })}
        onDeleteSelected={() => dispatch({ type: 'DELETE_SELECTED' })}
        onStartPadArray={(padId, count) => dispatch({ type: 'START_PAD_ARRAY', padId, count })}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        overlayOpacity={overlayOpacity}
        onSetOverlayOpacity={setOverlayOpacity}
        onFindOverlaps={handleFindOverlaps}
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
            onMovePad={(id, dx, dy) => dispatch({ type: 'MOVE_PAD', id, dx, dy })}
            padPick={state.padPick}
            onTogglePadPick={(id) => dispatch({ type: 'TOGGLE_PAD_PICK', id })}
            onSelectComponent={(id) =>
              dispatch({ type: 'SELECT', selection: { kind: 'component', id } })
            }
            onAlign={handleAlign}
            onCyclePackage={(step) => dispatch({ type: 'CYCLE_PACKAGE', step })}
            onRotatePackage={() => dispatch({ type: 'ROTATE_PACKAGE' })}
            otherSideHover={holeHover && holeHover.side !== side ? holeHover.point : null}
            // Only the side the cursor is actually on may clear the hover, so a
            // mouseleave from the other panel can't wipe a live preview.
            onHoverPoint={(hoverSide, point) =>
              setHoleHover((prev) =>
                point
                  ? { side: hoverSide, point }
                  : prev && prev.side === hoverSide
                    ? null
                    : prev,
              )
            }
            overlayOpacity={overlayOpacity}
            highlight={overlapHighlight}
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
        {/* Scale is set once and then mostly left alone, so it collapses out of
            the way of the lists you actually work in — but it starts open on a
            board with no size yet, since nothing is measured correctly until
            that's filled in. */}
        <SidebarSection title="Scale" defaultOpen={!state.boardSize}>
          <ScalePanel
            unit={state.unit}
            boardSize={state.boardSize}
            defaultTraceWidth={state.defaultTraceWidth}
            defaultViaDiameter={state.defaultViaDiameter}
            defaultHoleDiameter={state.defaultHoleDiameter}
            defaultTestPointDiameter={state.defaultTestPointDiameter}
            backFlip={state.backFlip}
            onSetUnit={(unit) => dispatch({ type: 'SET_UNIT', unit })}
            onSetBoardSize={(boardSize) => dispatch({ type: 'SET_BOARD_SIZE', boardSize })}
            onSetDefaultTraceWidth={(width) =>
              dispatch({ type: 'SET_DEFAULT_TRACE_WIDTH', width })
            }
            onSetDefaultDiameter={(kind, diameter) =>
              dispatch({ type: 'SET_DEFAULT_DIAMETER', kind, diameter })
            }
            onSetBackFlip={(flip) => dispatch({ type: 'SET_BACK_FLIP', flip })}
          />
        </SidebarSection>
        <SidebarSection title="Traces" count={state.traces.length}>
          <TraceList
            traces={state.traces}
            selection={state.selection}
            unit={state.unit}
            defaultWidth={state.defaultTraceWidth}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'trace', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_TRACE', id, label })}
            onSetWidth={(id, width) => dispatch({ type: 'SET_TRACE_WIDTH', id, width })}
          />
        </SidebarSection>
        <SidebarSection title="Pads" count={rectPads.length}>
          <PadList
            pads={rectPads}
            selection={state.selection}
            unit={state.unit}
            scaleFor={(pad) => pxPerUnit(state.images[pad.side], state.boardSize, state.unit)}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'pad', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_PAD', id, label })}
            onSetDiameter={(id, diameter) => dispatch({ type: 'SET_PAD_DIAMETER', id, diameter })}
            onToggleGround={(id) => dispatch({ type: 'TOGGLE_GROUND', kind: 'pad', id })}
          />
        </SidebarSection>
        <SidebarSection title="Test points" count={testPoints.length}>
          <PadList
            pads={testPoints}
            selection={state.selection}
            unit={state.unit}
            scaleFor={(pad) => pxPerUnit(state.images[pad.side], state.boardSize, state.unit)}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'pad', id } })}
            onRename={(id, label) => dispatch({ type: 'RENAME_PAD', id, label })}
            onSetDiameter={(id, diameter) => dispatch({ type: 'SET_PAD_DIAMETER', id, diameter })}
            onToggleGround={(id) => dispatch({ type: 'TOGGLE_GROUND', kind: 'pad', id })}
          />
        </SidebarSection>
        <SidebarSection title="Components" count={state.components.length}>
          <ComponentList
            components={state.components}
            selectedId={state.selection?.kind === 'component' ? state.selection.id : null}
            padPick={state.padPick}
            onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'component', id } })}
            onGroup={(label, refDes, notes) =>
              dispatch({ type: 'ADD_COMPONENT', label, refDes, notes })
            }
            onClearPick={() => dispatch({ type: 'CANCEL_DRAFT' })}
            onRename={(id, label) => dispatch({ type: 'RENAME_COMPONENT', id, label })}
            onSetRefDes={(id, refDes) => dispatch({ type: 'SET_COMPONENT_REFDES', id, refDes })}
            onSetNotes={(id, notes) => dispatch({ type: 'SET_COMPONENT_NOTES', id, notes })}
          />
        </SidebarSection>
        {(['via', 'hole'] as const).map((kind) => (
          <SidebarSection
            key={kind}
            title={kind === 'via' ? 'Vias' : 'Holes'}
            count={state.vias.filter((v) => v.kind === kind).length}
          >
            <ViaList
              vias={state.vias.filter((v) => v.kind === kind)}
              kind={kind}
              selection={state.selection}
              unit={state.unit}
              onSelect={(id) => dispatch({ type: 'SELECT', selection: { kind: 'via', id } })}
              onRename={(id, label) => dispatch({ type: 'RENAME_VIA', id, label })}
              onSetDiameter={(id, diameter) =>
                dispatch({ type: 'SET_VIA_DIAMETER', id, diameter })
              }
              onToggleGround={(id) => dispatch({ type: 'TOGGLE_GROUND', kind: 'via', id })}
            />
          </SidebarSection>
        ))}
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
    </div>
  );
}

export default App;
