import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  GROUND_COLOR,
  type BoardState,
  type Point,
  type RawImage,
  type Selection,
  type Side,
} from '../types';
import {
  type Rect,
  VIA_GRAB_FLOOR_PX,
  componentBoundingRect,
  padAt,
  padSeriesRects,
  pointsToPath,
  rectFromCorners,
  snapVia,
  throughBoard,
} from '../lib/geometry';
import { buildGroundPlanePath } from '../lib/groundPlane';
import { UNIT_LABELS, formatLength, pxPerUnit } from '../lib/scale';
import { FOOTPRINTS, packagePads } from '../lib/packages';
import { ImageUploader } from './ImageUploader';

/** Zoom change per wheel notch. */
const ZOOM_STEP = 1.2;
/** Tightest zoom, as a fraction of the photo's width. */
const MIN_VIEW_FRACTION = 0.02;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Props {
  side: Side;
  state: BoardState;
  onAddShot: (side: Side, raw: RawImage) => void;
  onCanvasClick: (side: Side, point: Point) => void;
  onCanvasDoubleClick: (side: Side) => void;
  onSelectTrace: (id: string) => void;
  onSelectVia: (id: string) => void;
  onSelectPad: (id: string) => void;
  onSelectGroundPlane: (id: string) => void;
  /** Commit a finished pad drag, as a delta in this side's image pixels. */
  onMovePad: (id: string, dx: number, dy: number) => void;
  /** Pads shift-clicked on the canvas, waiting to be grouped into a Component. */
  padPick: string[];
  onTogglePadPick: (id: string) => void;
  /** Vias/holes shift-clicked on the canvas, waiting to be grouped into a Component. */
  viaPick: string[];
  onToggleViaPick: (id: string) => void;
  onSelectComponent: (id: string) => void;
  onAlign: (side: Side, shotId: string) => void;
  onCyclePackage: (step: number) => void;
  onRotatePackage: () => void;
  /** Cursor position on the *other* side, so we can preview where a hole exits here. */
  otherSideHover: Point | null;
  onHoverPoint: (side: Side, point: Point | null) => void;
  /** 0–1 opacity for everything drawn over the photo. */
  overlayOpacity: number;
  /** The overlap-finder's current candidate, so its members can be haloed. */
  highlight: { traces: Set<string>; pads: Set<string>; vias: Set<string> } | null;
  /**
   * The net of whatever's hovered or selected — everything else on the board
   * (and the background photo) dims so the net stands out. Null means
   * nothing's hovered/selected, so nothing dims.
   */
  follow: { traces: Set<string>; pads: Set<string>; vias: Set<string> } | null;
  /** A just-made sidebar selection, briefly pulsed here so it's easy to find. */
  flash: Selection | null;
  /** Hovering a trace/pad/via, or leaving one (null), for the follow highlight. */
  onHoverItem: (item: Selection | null) => void;
  /** Whether this side's background photo is drawn at all. */
  showBackground: boolean;
  /** Independent on/off per SVG layer — orthogonal to overlayOpacity's fade. */
  layerVisibility: {
    pads: boolean;
    traces: boolean;
    vias: boolean;
    components: boolean;
    groundPlanes: boolean;
  };
  /**
   * Cosmetic-only mirroring while working (e.g. to match how the board is
   * physically oriented in front of you). Purely a CSS transform — never
   * touches coordinates, geometry, or the backFlip hole mapping.
   */
  visualFlip: { horizontal: boolean; vertical: boolean } | null;
}

export function BoardPanel({
  side,
  state,
  onAddShot,
  onCanvasClick,
  onCanvasDoubleClick,
  onSelectTrace,
  onSelectVia,
  onSelectPad,
  onSelectGroundPlane,
  onMovePad,
  padPick,
  onTogglePadPick,
  viaPick,
  onToggleViaPick,
  onSelectComponent,
  onAlign,
  onCyclePackage,
  onRotatePackage,
  otherSideHover,
  onHoverPoint,
  overlayOpacity,
  highlight,
  follow,
  flash,
  onHoverItem,
  showBackground,
  layerVisibility,
  visualFlip,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /**
   * The window onto the photo, in image pixels — this is the SVG's viewBox.
   * null means "the whole image", which is also what a freshly loaded or
   * re-aligned photo resets to.
   */
  const [view, setView] = useState<Rect | null>(null);
  /** Where a pan drag started, in image pixels, or null when not panning. */
  const panFrom = useRef<{ point: Point; view: Rect } | null>(null);
  /**
   * A pad being dragged: where the drag started and how far it's come. The move
   * is only dispatched when the drag ends, so nudging a pad into place is one
   * undo step rather than one per mouse event; until then `delta` just offsets
   * how the pad is drawn.
   */
  const [padDrag, setPadDrag] = useState<{ id: string; from: Point; delta: Point } | null>(null);
  const photos = state.images[side];
  const image = photos ? (photos.shots[photos.activeShotId] ?? null) : null;
  const unit = state.unit;

  const scale = pxPerUnit(image, state.boardSize, state.unit);
  const viaRadiusPx = (diameter: number) => Math.max(2, (diameter / 2) * scale);
  const traceWidthPx = (width: number | undefined) =>
    Math.max(1, (width ?? state.defaultTraceWidth) * scale);

  function toImagePoint(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(local.x), y: Math.round(local.y) };
  }


  /** The visible window, falling back to the whole photo. */
  const viewBox: Rect = view ?? { x: 0, y: 0, width: image?.width ?? 1, height: image?.height ?? 1 };
  /**
   * Image pixels per unit of viewBox — 1 at fit-to-panel, smaller when zoomed
   * in. Overlay text and hairlines multiply by this so they stay the same size
   * on screen instead of ballooning as you zoom.
   */
  const viewScale = image ? viewBox.width / image.width : 1;

  // A new or re-aligned photo is a different pixel space, so any window onto
  // the old one is meaningless.
  useEffect(() => setView(null), [image?.src]);

  // Once zoomed, the wrap div becomes a fixed box (see .is-zoomed in
  // App.css) sized by the layout, not by the image's aspect ratio — track
  // its actual pixel box so the next zoom step can crop to *that* shape
  // instead of the photo's, letting the frame use all the width it's given
  // rather than wasting horizontal space to preserve the photo's aspect
  // ratio. Read via a ref in the wheel handler so it's always current
  // without re-subscribing the (non-passive) wheel listener on every resize.
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const frameSizeRef = useRef(frameSize);
  frameSizeRef.current = frameSize;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setFrameSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The wheel zooms about the cursor — except in package mode, where it steps
  // through the footprint catalog and Ctrl/Cmd+wheel zooms instead. React's
  // onWheel is passive, so preventDefault() there wouldn't stop the page
  // scrolling — attach a non-passive listener instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !image) return;

    function onWheel(e: WheelEvent) {
      if (e.deltaY === 0) return;
      e.preventDefault();

      if (state.tool === 'package' && !e.ctrlKey && !e.metaKey) {
        onCyclePackage(e.deltaY < 0 ? -1 : 1);
        return;
      }

      const at = toImagePoint(e.clientX, e.clientY);
      if (!at || !image) return;

      setView((current) => {
        const from = current ?? { x: 0, y: 0, width: image.width, height: image.height };
        const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        // Never zoom out past the whole photo, and stop before the window gets
        // so small that rounding to integer pixels starts to bite.
        const width = clamp(from.width * factor, image.width * MIN_VIEW_FRACTION, image.width);
        // Match the on-screen frame's aspect ratio once it's known, so the
        // crop fills the available box instead of always being shaped like
        // the whole photo. Falls back to the photo's own aspect before the
        // frame has been measured.
        const frame = frameSizeRef.current;
        const aspect = frame && frame.width > 0 ? frame.height / frame.width : image.height / image.width;
        const height = clamp(width * aspect, image.height * MIN_VIEW_FRACTION, image.height);

        // Keep whatever is under the cursor under the cursor.
        const kx = (at.x - from.x) / from.width;
        const ky = (at.y - from.y) / from.height;
        return {
          x: clamp(at.x - kx * width, 0, image.width - width),
          y: clamp(at.y - ky * height, 0, image.height - height),
          width,
          height,
        };
      });
    }

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [state.tool, onCyclePackage, image]);

  // Middle-button drag pans, leaving left-click free for placing things.
  function handlePointerDown(e: MouseEvent<SVGSVGElement>) {
    if (e.button !== 1 || !image) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    panFrom.current = { point: p, view: viewBox };
  }

  function handlePointerUp() {
    panFrom.current = null;
    endPadDrag();
  }

  /**
   * Begin dragging an already-selected pad. Selection first is deliberate: it
   * takes a click to arm the drag, so brushing past a pad while placing things
   * can't shift it by accident.
   */
  function startPadDrag(e: MouseEvent<SVGElement>, padId: string) {
    if (e.button !== 0 || tracing) return;
    if (state.selection?.kind !== 'pad' || state.selection.id !== padId) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation();
    setPadDrag({ id: padId, from: p, delta: { x: 0, y: 0 } });
  }

  function endPadDrag() {
    if (!padDrag) return;
    // A drag that went nowhere is a plain click; the reducer ignores a zero
    // move anyway, but not dispatching keeps it out of the undo stack.
    if (padDrag.delta.x !== 0 || padDrag.delta.y !== 0) {
      onMovePad(padDrag.id, padDrag.delta.x, padDrag.delta.y);
    }
    setPadDrag(null);
  }

  function handleContextMenu(e: MouseEvent<SVGSVGElement>) {
    // Right-click aims the footprint rather than opening the browser menu.
    if (state.tool !== 'package') return;
    e.preventDefault();
    onRotatePackage();
  }

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    // Clicking a via while tracing pins the point to its centre, so a trace
    // starts or ends exactly on the hole rather than near it. A pad is big
    // enough to aim at, so it keeps the exact point clicked — the trace meets
    // the pad where you put it, and the two are linked when the trace is
    // finished because that point is inside the pad.
    const snapped = tracing ? snapVia(state.vias, side, p, scale, viewScale) : null;
    onCanvasClick(side, snapped?.[side] ?? p);
  }

  const tracing = state.tool === 'trace';
  const placingHole = state.tool === 'via' || state.tool === 'hole';
  /** Tools that place something round at a fixed default size. */
  const placingRound = placingHole || state.tool === 'testpoint';
  const placingPackage = state.tool === 'package';
  const placingGroundPlane = state.tool === 'groundplane';
  const arraySource = state.padArray
    ? (state.pads.find((p) => p.id === state.padArray?.sourceId) ?? null)
    : null;
  const armingArray = Boolean(arraySource && arraySource.side === side);

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    // A pan in progress owns the pointer; the cursor's image coordinate is
    // computed against the view we started from, so the grabbed point tracks.
    const pan = panFrom.current;
    if (pan && image) {
      const p = toImagePoint(e.clientX, e.clientY);
      if (!p) return;
      setView({
        x: clamp(pan.view.x + (pan.point.x - p.x), 0, image.width - pan.view.width),
        y: clamp(pan.view.y + (pan.point.y - p.y), 0, image.height - pan.view.height),
        width: pan.view.width,
        height: pan.view.height,
      });
      return;
    }

    // A pad drag owns the pointer too, and tracks the cursor one-for-one.
    if (padDrag) {
      const p = toImagePoint(e.clientX, e.clientY);
      if (!p) return;
      setPadDrag({ ...padDrag, delta: { x: p.x - padDrag.from.x, y: p.y - padDrag.from.y } });
      return;
    }

    const drawingPad = Boolean(state.draftPad && state.draftPad.side === side);
    if (!drawingPad && !placingRound && !armingArray && !tracing && !placingPackage && !placingGroundPlane) {
      if (hover) setHover(null);
      onHoverPoint(side, null);
      return;
    }
    const p = toImagePoint(e.clientX, e.clientY);
    setHover(p);
    onHoverPoint(side, placingHole ? p : null);
  }

  function handleMouseLeave() {
    panFrom.current = null;
    // Leaving the panel commits the drag where it stands rather than dropping
    // it, so a pad dragged to the edge doesn't snap back.
    endPadDrag();
    setHover(null);
    onHoverPoint(side, null);
    onHoverItem(null);
  }

  const traces = state.traces.filter((t) => t.side === side);
  const pads = state.pads.filter((p) => p.side === side);

  /**
   * Everything drawn over the photo dims together, so overlapping copper fades
   * as one shape instead of compounding. A fully transparent overlay stops
   * taking clicks — you can't select what you can't see.
   */
  const overlay = {
    opacity: overlayOpacity,
    pointerEvents: overlayOpacity === 0 ? ('none' as const) : undefined,
  };
  /** A layer's own on/off, independent of and stacked with `overlay`'s fade. */
  const layerOverlay = (visible: boolean) => ({
    ...overlay,
    display: visible ? undefined : ('none' as const),
  });
  const draft = state.draftTrace && state.draftTrace.side === side ? state.draftTrace : null;
  const groundDraft =
    state.draftGroundPlane && state.draftGroundPlane.side === side ? state.draftGroundPlane : null;
  const padDraft = state.draftPad && state.draftPad.side === side ? state.draftPad : null;
  const padPreview = padDraft && hover ? rectFromCorners(padDraft.start, hover) : null;

  // While tracing: the via the cursor would snap to, the pad it would attach
  // to, and the rubber-band segment from the last placed point to wherever the
  // trace would go next.
  const traceSnap = tracing && hover ? snapVia(state.vias, side, hover, scale, viewScale) : null;
  // A via on top of a pad wins — it's the smaller target and it snaps.
  const padSnap = tracing && hover && !traceSnap ? padAt(pads, hover) : null;
  const pendingEnd = tracing ? (traceSnap?.[side] ?? hover) : null;
  const pendingStart = draft && draft.points.length > 0 ? draft.points[draft.points.length - 1] : null;
  const seriesPreview =
    arraySource && armingArray && state.padArray && hover
      ? padSeriesRects(arraySource, hover, state.padArray.count)
      : [];

  /**
   * What the active tool would place, drawn at true scale under the cursor with
   * its dimension labelled — so a size can be judged against the photo before
   * anything is committed.
   */
  // The footprint the package tool would drop here, at true scale.
  const pkg = FOOTPRINTS[state.packageIndex];
  const packagePreview =
    placingPackage && hover ? packagePads(pkg, hover, scale, state.packageRotation) : [];

  const sizePreview = (() => {
    if (!hover) return null;
    if (placingPackage) {
      return {
        kind: 'package' as const,
        radius: 0,
        text: `${pkg.name}${state.packageRotation ? ` ${state.packageRotation * 90}°` : ''}`,
      };
    }
    if (placingRound) {
      const diameter =
        state.tool === 'hole'
          ? state.defaultHoleDiameter
          : state.tool === 'testpoint'
            ? state.defaultTestPointDiameter
            : state.defaultViaDiameter;
      return {
        kind: state.tool,
        radius: viaRadiusPx(diameter),
        text: `${state.tool === 'testpoint' ? 'test point' : state.tool} ⌀ ${formatLength(diameter, unit)} ${UNIT_LABELS[unit]}`,
      };
    }
    if (state.tool === 'trace') {
      return {
        kind: 'trace' as const,
        radius: traceWidthPx(undefined) / 2,
        text: `trace ${formatLength(state.defaultTraceWidth, unit)} ${UNIT_LABELS[unit]} wide`,
      };
    }
    return null;
  })();

  return (
    <div className="board-panel">
      <div className="board-panel-header">
        <h2>{side === 'front' ? 'Front' : 'Back'}</h2>
        <div className="board-panel-actions">
          {view && (
            <>
              <span className="export-hint">{Math.round(1 / viewScale)}×</span>
              <button type="button" onClick={() => setView(null)} title="Fit the whole board">
                Reset view
              </button>
            </>
          )}
          {image && (
            <button type="button" onClick={() => onAlign(side, image.id)}>
              {image.corners ? 'Re-align' : 'Align'}
            </button>
          )}
        </div>
      </div>
      {!image ? (
        <ImageUploader side={side} onLoad={onAddShot} />
      ) : (
        <>
          <div ref={wrapRef} className={`board-canvas-wrap${view ? ' is-zoomed' : ''}`}>
            <svg
              ref={svgRef}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              className={`board-canvas tool-${state.tool}`}
              style={
                visualFlip && (visualFlip.horizontal || visualFlip.vertical)
                  ? {
                      transform: `scale(${visualFlip.horizontal ? -1 : 1}, ${visualFlip.vertical ? -1 : 1})`,
                    }
                  : undefined
              }
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onDoubleClick={() => onCanvasDoubleClick(side)}
              onMouseDown={handlePointerDown}
              onMouseUp={handlePointerUp}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {showBackground && (
                <image
                  href={image.src}
                  x={0}
                  y={0}
                  width={image.width}
                  height={image.height}
                  className={follow ? 'dimmed' : ''}
                />
              )}

              {/*
                Ground planes sit beneath everything else, including pads —
                the cutouts baked into their path are what keep them from
                shorting to non-ground copper.
              */}
              <g {...layerOverlay(layerVisibility.groundPlanes)}>
                {state.groundPlanes
                  .filter((plane) => plane.side === side)
                  .map((plane) => {
                    const selected =
                      state.selection?.kind === 'groundplane' && state.selection.id === plane.id;
                    return (
                      <path
                        key={plane.id}
                        d={buildGroundPlanePath(
                          plane,
                          state.pads,
                          state.vias,
                          state.traces,
                          scale,
                          state.defaultTraceWidth,
                        )}
                        fill={GROUND_COLOR}
                        fillRule="nonzero"
                        className={selected ? 'ground-plane selected' : 'ground-plane'}
                        pointerEvents={state.tool === 'pointer' ? 'auto' : 'none'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectGroundPlane(plane.id);
                        }}
                      />
                    );
                  })}
              </g>

              {/*
                Pads sit under the traces so the two read as one copper shape.

                While the trace tool is active nothing on the canvas takes the
                click: a click on a pad, via, or existing trace has to reach the
                canvas handler so it places a trace point where you clicked
                instead of selecting what's underneath. Selection is still
                available from the sidebar lists, and from the canvas under any
                other tool.
              */}
              <g {...layerOverlay(layerVisibility.pads)}>
                {pads.map((pad) => {
                  const selected =
                    state.selection?.kind === 'pad' && state.selection.id === pad.id;
                  const picked = padPick.includes(pad.id);
                  const dimmed = Boolean(follow && !follow.pads.has(pad.id));
                  const flashed = flash?.kind === 'pad' && flash.id === pad.id;
                  const className =
                    'pad-shape' +
                    (pad.ground ? ' ground' : '') +
                    (selected ? ' selected' : '') +
                    (picked ? ' picked' : '') +
                    (dimmed ? ' dimmed' : '') +
                    (flashed ? ' flash' : '') +
                    // A selected pad can be dragged, so it gets the move cursor.
                    (selected && !tracing ? ' draggable' : '');
                  const fill = pad.ground ? GROUND_COLOR : pad.color;
                  const select = (e: MouseEvent<SVGElement>) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      onTogglePadPick(pad.id);
                      return;
                    }
                    onSelectPad(pad.id);
                  };
                  const onMouseDown = (e: MouseEvent<SVGElement>) => startPadDrag(e, pad.id);
                  const onMouseEnter = () => onHoverItem({ kind: 'pad', id: pad.id });
                  const onMouseLeave = () => onHoverItem(null);
                  // An in-flight drag is drawn as an offset; the real move is
                  // dispatched on drop.
                  const drag = padDrag?.id === pad.id ? padDrag.delta : null;
                  const transform = drag ? `translate(${drag.x} ${drag.y})` : undefined;
                  // A round pad is the circle inscribed in its bounding box.
                  return pad.shape === 'round' ? (
                    <circle
                      key={pad.id}
                      cx={pad.x + pad.width / 2}
                      cy={pad.y + pad.height / 2}
                      r={pad.width / 2}
                      fill={fill}
                      className={className}
                      transform={transform}
                      onClick={select}
                      onMouseDown={onMouseDown}
                      onMouseEnter={onMouseEnter}
                      onMouseLeave={onMouseLeave}
                      pointerEvents={tracing ? 'none' : undefined}
                    />
                  ) : (
                    <rect
                      key={pad.id}
                      x={pad.x}
                      y={pad.y}
                      width={pad.width}
                      height={pad.height}
                      fill={fill}
                      className={className}
                      transform={transform}
                      onClick={select}
                      onMouseDown={onMouseDown}
                      onMouseEnter={onMouseEnter}
                      onMouseLeave={onMouseLeave}
                      pointerEvents={tracing ? 'none' : undefined}
                    />
                  );
                })}
              </g>

              <g {...layerOverlay(layerVisibility.components)}>
                {state.components
                  .filter((c) => c.side === side)
                  .map((c) => {
                    const viaRects = state.vias
                      .filter((v) => c.viaIds.includes(v.id) && v[side])
                      .map((v) => {
                        const p = v[side]!;
                        const r = viaRadiusPx(v.diameter);
                        return { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 };
                      });
                    const rect = componentBoundingRect(pads, c.padIds, viaRects);
                    if (!rect) return null;
                    const selected =
                      state.selection?.kind === 'component' && state.selection.id === c.id;
                    // A component follows if any of its pads or leads is in the net.
                    const dimmed = Boolean(
                      follow &&
                        !c.padIds.some((id) => follow.pads.has(id)) &&
                        !c.viaIds.some((id) => follow.vias.has(id)),
                    );
                    const flashed = flash?.kind === 'component' && flash.id === c.id;
                    const pad = Math.max(4, image.width * 0.006) * viewScale;
                    const fs = image.width * 0.016 * viewScale;
                    const select = (e: MouseEvent<SVGElement>) => {
                      e.stopPropagation();
                      onSelectComponent(c.id);
                    };
                    return (
                      <g
                        key={c.id}
                        onClick={select}
                        className={(dimmed ? 'dimmed' : '') + (flashed ? ' flash' : '')}
                        pointerEvents={tracing ? 'none' : undefined}
                      >
                        <rect
                          x={rect.x - pad}
                          y={rect.y - pad}
                          width={rect.width + pad * 2}
                          height={rect.height + pad * 2}
                          className={'component-outline' + (selected ? ' selected' : '')}
                        />
                        <text
                          x={rect.x - pad}
                          y={rect.y - pad - fs * 0.4}
                          className="component-label"
                          fontSize={fs}
                        >
                          {c.label || c.refDes || c.id}
                        </text>
                      </g>
                    );
                  })}
              </g>

              {/* The pad a trace click would attach to. */}
              {padSnap &&
                (padSnap.shape === 'round' ? (
                  <circle
                    cx={padSnap.x + padSnap.width / 2}
                    cy={padSnap.y + padSnap.height / 2}
                    r={padSnap.width / 2 + Math.max(1, image.width * 0.002) * viewScale}
                    className="pad-snap-target"
                    pointerEvents="none"
                  />
                ) : (
                  <rect
                    x={padSnap.x}
                    y={padSnap.y}
                    width={padSnap.width}
                    height={padSnap.height}
                    className="pad-snap-target"
                    pointerEvents="none"
                  />
                ))}

              <g {...layerOverlay(layerVisibility.traces)}>
                {traces.map((t) => {
                  const dimmed = Boolean(follow && !follow.traces.has(t.id));
                  const flashed = flash?.kind === 'trace' && flash.id === t.id;
                  return (
                    <path
                      key={t.id}
                      d={pointsToPath(t.points)}
                      stroke={t.color}
                      strokeWidth={traceWidthPx(t.width)}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={
                        (state.selection?.kind === 'trace' && state.selection.id === t.id
                          ? 'selected'
                          : '') +
                        (dimmed ? ' dimmed' : '') +
                        (flashed ? ' flash' : '')
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTrace(t.id);
                      }}
                      onMouseEnter={() => onHoverItem({ kind: 'trace', id: t.id })}
                      onMouseLeave={() => onHoverItem(null)}
                      pointerEvents={tracing ? 'none' : undefined}
                    />
                  );
                })}
              </g>

              {draft && (
                <path
                  d={pointsToPath(draft.points)}
                  stroke="#ffffff"
                  strokeWidth={traceWidthPx(undefined)}
                  strokeDasharray="6 4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              )}

              {groundDraft && (
                <g pointerEvents="none">
                  <path
                    d={pointsToPath(groundDraft.points)}
                    stroke={GROUND_COLOR}
                    strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {hover && groundDraft.points.length > 0 && (
                    <line
                      x1={groundDraft.points[groundDraft.points.length - 1].x}
                      y1={groundDraft.points[groundDraft.points.length - 1].y}
                      x2={hover.x}
                      y2={hover.y}
                      stroke={GROUND_COLOR}
                      strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                      strokeDasharray="6 4"
                    />
                  )}
                  {groundDraft.points.length > 1 && (
                    <line
                      x1={groundDraft.points[groundDraft.points.length - 1].x}
                      y1={groundDraft.points[groundDraft.points.length - 1].y}
                      x2={groundDraft.points[0].x}
                      y2={groundDraft.points[0].y}
                      stroke={GROUND_COLOR}
                      strokeWidth={Math.max(1, image.width * 0.0015) * viewScale}
                      strokeDasharray="2 4"
                      opacity={0.6}
                    />
                  )}
                </g>
              )}

              {padDraft && !padPreview && (
                <circle
                  cx={padDraft.start.x}
                  cy={padDraft.start.y}
                  r={Math.max(3, image.width * 0.004) * viewScale}
                  className="align-corner"
                  pointerEvents="none"
                />
              )}

              {padPreview && (
                <rect
                  x={padPreview.x}
                  y={padPreview.y}
                  width={padPreview.width}
                  height={padPreview.height}
                  fill="rgba(56, 189, 248, 0.25)"
                  stroke="#38bdf8"
                  strokeWidth={Math.max(1, image.width * 0.003) * viewScale}
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
              )}

              <g {...layerOverlay(layerVisibility.vias)}>
                {state.vias.map((v) => {
                  const p = v[side];
                  if (!p) return null;
                  const linked = Boolean(v.front && v.back);
                  const r = viaRadiusPx(v.diameter);
                  const dimmed = Boolean(follow && !follow.vias.has(v.id));
                  const flashed = flash?.kind === 'via' && flash.id === v.id;
                  const picked = viaPick.includes(v.id);
                  return (
                    <circle
                      key={v.id}
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      // A hole is drawn as a ring so it reads as an opening you
                      // can see through; a via is a solid plated dot.
                      strokeWidth={v.kind === 'hole' ? Math.max(1, r * 0.35) : 0}
                      className={
                        `via-marker via-marker--${v.kind}` +
                        (linked ? ' via-marker--linked' : ' via-marker--unlinked') +
                        (v.ground ? ' ground' : '') +
                        (state.selection?.kind === 'via' && state.selection.id === v.id
                          ? ' selected'
                          : '') +
                        (picked ? ' picked' : '') +
                        (dimmed ? ' dimmed' : '') +
                        (flashed ? ' flash' : '')
                      }
                      // Ground is a flat override, not another shade in the
                      // linked/unlinked palette — inline wins over both classes
                      // where the CSS alone couldn't (a class beats `.ground`
                      // on specificity regardless of source order).
                      style={v.ground ? { fill: GROUND_COLOR, stroke: GROUND_COLOR } : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) {
                          onToggleViaPick(v.id);
                          return;
                        }
                        onSelectVia(v.id);
                      }}
                      onMouseEnter={() => onHoverItem({ kind: 'via', id: v.id })}
                      onMouseLeave={() => onHoverItem(null)}
                      pointerEvents={tracing ? 'none' : undefined}
                    />
                  );
                })}
              </g>

              {/* Items flagged by the overlap finder as touching without being
                  wired into the same net — a non-interactive halo, since the
                  merge decision lives in the banner, not the canvas. */}
              {highlight && (
                <g pointerEvents="none">
                  {pads
                    .filter((p) => highlight.pads.has(p.id))
                    .map((p) =>
                      p.shape === 'round' ? (
                        <circle
                          key={p.id}
                          cx={p.x + p.width / 2}
                          cy={p.y + p.height / 2}
                          r={p.width / 2 + Math.max(2, image.width * 0.002) * viewScale}
                          className="overlap-highlight"
                        />
                      ) : (
                        <rect
                          key={p.id}
                          x={p.x - Math.max(2, image.width * 0.002) * viewScale}
                          y={p.y - Math.max(2, image.width * 0.002) * viewScale}
                          width={p.width + Math.max(2, image.width * 0.002) * viewScale * 2}
                          height={p.height + Math.max(2, image.width * 0.002) * viewScale * 2}
                          className="overlap-highlight"
                        />
                      ),
                    )}
                  {traces
                    .filter((t) => highlight.traces.has(t.id))
                    .map((t) => (
                      <path
                        key={t.id}
                        d={pointsToPath(t.points)}
                        strokeWidth={traceWidthPx(t.width) + Math.max(2, image.width * 0.003) * viewScale}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="overlap-highlight"
                      />
                    ))}
                  {state.vias
                    .filter((v) => highlight.vias.has(v.id) && v[side])
                    .map((v) => {
                      const p = v[side]!;
                      return (
                        <circle
                          key={v.id}
                          cx={p.x}
                          cy={p.y}
                          r={viaRadiusPx(v.diameter) + Math.max(2, image.width * 0.002) * viewScale}
                          className="overlap-highlight"
                        />
                      );
                    })}
                </g>
              )}

              {/* Rubber band from the last placed point to where the next would go. */}
              {pendingStart && pendingEnd && (
                <line
                  x1={pendingStart.x}
                  y1={pendingStart.y}
                  x2={pendingEnd.x}
                  y2={pendingEnd.y}
                  className="trace-pending"
                  strokeWidth={traceWidthPx(undefined)}
                  pointerEvents="none"
                />
              )}

              {/* The via a trace click would snap to. */}
              {traceSnap && traceSnap[side] && (
                <circle
                  cx={traceSnap[side].x}
                  cy={traceSnap[side].y}
                  r={Math.max(viaRadiusPx(traceSnap.diameter), VIA_GRAB_FLOOR_PX * viewScale) * 1.4}
                  className="via-snap-target"
                  pointerEvents="none"
                />
              )}

              {/* The footprint that would be dropped here. */}
              {packagePreview.map((p, i) =>
                p.shape === 'round' ? (
                  <circle
                    key={i}
                    cx={p.rect.x + p.rect.width / 2}
                    cy={p.rect.y + p.rect.height / 2}
                    r={p.rect.width / 2}
                    className="size-preview-mark"
                    strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                    pointerEvents="none"
                  />
                ) : (
                  <rect
                    key={i}
                    x={p.rect.x}
                    y={p.rect.y}
                    width={p.rect.width}
                    height={p.rect.height}
                    className="size-preview-mark"
                    strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                    pointerEvents="none"
                  />
                ),
              )}

              {/* The pad series that would be created if you clicked here. */}
              {seriesPreview.map((r, i) => (
                <rect
                  key={i}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  fill={arraySource ? arraySource.color : '#38bdf8'}
                  fillOpacity={0.4}
                  stroke="#38bdf8"
                  strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                  strokeDasharray="5 3"
                  pointerEvents="none"
                />
              ))}

              {/* Where the hole being placed on the other side would come out here. */}
              {placingHole && otherSideHover && (
                <circle
                  cx={throughBoard(otherSideHover, image, state.backFlip).x}
                  cy={throughBoard(otherSideHover, image, state.backFlip).y}
                  r={viaRadiusPx(
                    state.tool === 'hole' ? state.defaultHoleDiameter : state.defaultViaDiameter,
                  )}
                  className="via-marker via-marker--ghost"
                  pointerEvents="none"
                />
              )}

              {/* True-scale preview of what this tool would place, at the cursor. */}
              {sizePreview &&
                hover &&
                (() => {
                  // Font size is in image pixels, so scale it to the photo to
                  // stay legible whatever the panel is displayed at.
                  const fs = image.width * 0.022 * viewScale;
                  const nearRightEdge = hover.x > image.width * 0.7;
                  return (
                    <g pointerEvents="none">
                      {sizePreview.kind === 'package' ? null : sizePreview.kind === 'trace' ? (
                        // A stub of trace at the real width, to compare against
                        // the copper in the photo.
                        <line
                          x1={hover.x - sizePreview.radius * 6}
                          y1={hover.y}
                          x2={hover.x + sizePreview.radius * 6}
                          y2={hover.y}
                          className="size-preview-mark"
                          strokeWidth={sizePreview.radius * 2}
                        />
                      ) : (
                        <circle
                          cx={hover.x}
                          cy={hover.y}
                          r={sizePreview.radius}
                          className="size-preview-mark"
                          strokeWidth={Math.max(1, sizePreview.radius * 0.2)}
                        />
                      )}
                      <text
                        className="size-hint"
                        x={hover.x + (nearRightEdge ? -fs * 0.7 : fs * 0.7)}
                        y={hover.y - fs * 0.7 - sizePreview.radius}
                        textAnchor={nearRightEdge ? 'end' : 'start'}
                        fontSize={fs}
                        strokeWidth={fs * 0.22}
                      >
                        {sizePreview.text}
                      </text>
                    </g>
                  );
                })()}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
