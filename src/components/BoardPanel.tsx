import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { GROUND_COLOR, type BoardImage, type BoardState, type Point, type Side } from '../types';
import {
  type Rect,
  VIA_GRAB_FLOOR_PX,
  padSeriesRects,
  pointsToPath,
  rectFromCorners,
  snapVia,
  throughBoard,
} from '../lib/geometry';
import { UNIT_LABELS, formatLength, pxPerUnit } from '../lib/scale';
import { SMD_PACKAGES, packagePads } from '../lib/packages';
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
  onLoadImage: (side: Side, image: BoardImage) => void;
  onCanvasClick: (side: Side, point: Point) => void;
  onCanvasDoubleClick: (side: Side) => void;
  onSelectTrace: (id: string) => void;
  onSelectVia: (id: string) => void;
  onSelectPad: (id: string) => void;
  onAlign: (side: Side) => void;
  onCyclePackage: (step: number) => void;
  onRotatePackage: () => void;
  /** Cursor position on the *other* side, so we can preview where a hole exits here. */
  otherSideHover: Point | null;
  onHoverPoint: (side: Side, point: Point | null) => void;
}

export function BoardPanel({
  side,
  state,
  onLoadImage,
  onCanvasClick,
  onCanvasDoubleClick,
  onSelectTrace,
  onSelectVia,
  onSelectPad,
  onAlign,
  onCyclePackage,
  onRotatePackage,
  otherSideHover,
  onHoverPoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /**
   * The window onto the photo, in image pixels — this is the SVG's viewBox.
   * null means "the whole image", which is also what a freshly loaded or
   * re-aligned photo resets to.
   */
  const [view, setView] = useState<Rect | null>(null);
  /** Where a pan drag started, in image pixels, or null when not panning. */
  const panFrom = useRef<{ point: Point; view: Rect } | null>(null);
  const image = state.images[side];
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
        const height = width * (image.height / image.width);

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
    // starts or ends exactly on the hole rather than near it.
    const snapped =
      state.tool === 'trace' ? snapVia(state.vias, side, p, scale, viewScale) : null;
    onCanvasClick(side, snapped?.[side] ?? p);
  }

  const placingHole = state.tool === 'via' || state.tool === 'hole';
  /** Tools that place something round at a fixed default size. */
  const placingRound = placingHole || state.tool === 'testpoint';
  const placingPackage = state.tool === 'package';
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

    const drawingPad = Boolean(state.draftPad && state.draftPad.side === side);
    const tracing = state.tool === 'trace';
    if (!drawingPad && !placingRound && !armingArray && !tracing && !placingPackage) {
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
    setHover(null);
    onHoverPoint(side, null);
  }

  const traces = state.traces.filter((t) => t.side === side);
  const pads = state.pads.filter((p) => p.side === side);
  const draft = state.draftTrace && state.draftTrace.side === side ? state.draftTrace : null;
  const padDraft = state.draftPad && state.draftPad.side === side ? state.draftPad : null;
  const padPreview = padDraft && hover ? rectFromCorners(padDraft.start, hover) : null;

  // While tracing: the via the cursor would snap to, and the rubber-band
  // segment from the last placed point to wherever the trace would go next.
  const traceSnap =
    state.tool === 'trace' && hover ? snapVia(state.vias, side, hover, scale, viewScale) : null;
  const pendingEnd = state.tool === 'trace' ? (traceSnap?.[side] ?? hover) : null;
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
  const pkg = SMD_PACKAGES[state.packageIndex];
  const packagePreview =
    placingPackage && hover ? packagePads(pkg, hover, scale, state.packageRotated) : [];

  const sizePreview = (() => {
    if (!hover) return null;
    if (placingPackage) {
      return {
        kind: 'package' as const,
        radius: 0,
        text: `${pkg.name}${state.packageRotated ? ' ↕' : ' ↔'}`,
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
            <button type="button" onClick={() => onAlign(side)}>
              {image.corners ? 'Re-align' : 'Align'}
            </button>
          )}
        </div>
      </div>
      {!image ? (
        <ImageUploader side={side} image={image} onLoad={onLoadImage} />
      ) : (
        <>
          <ImageUploader side={side} image={image} onLoad={onLoadImage} />
          <div className="board-canvas-wrap">
            <svg
              ref={svgRef}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              className={`board-canvas tool-${state.tool}`}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onDoubleClick={() => onCanvasDoubleClick(side)}
              onMouseDown={handlePointerDown}
              onMouseUp={handlePointerUp}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <image href={image.src} x={0} y={0} width={image.width} height={image.height} />

              {/* Pads sit under the traces so the two read as one copper shape. */}
              {pads.map((pad) => {
                const className =
                  'pad-shape' +
                  (pad.ground ? ' ground' : '') +
                  (state.selection?.kind === 'pad' && state.selection.id === pad.id
                    ? ' selected'
                    : '');
                const fill = pad.ground ? GROUND_COLOR : pad.color;
                const select = (e: MouseEvent<SVGElement>) => {
                  e.stopPropagation();
                  onSelectPad(pad.id);
                };
                // A round pad is the circle inscribed in its bounding box.
                return pad.shape === 'round' ? (
                  <circle
                    key={pad.id}
                    cx={pad.x + pad.width / 2}
                    cy={pad.y + pad.height / 2}
                    r={pad.width / 2}
                    fill={fill}
                    className={className}
                    onClick={select}
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
                    onClick={select}
                  />
                );
              })}

              {traces.map((t) => (
                <path
                  key={t.id}
                  d={pointsToPath(t.points)}
                  stroke={t.color}
                  strokeWidth={traceWidthPx(t.width)}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={
                    state.selection?.kind === 'trace' && state.selection.id === t.id
                      ? 'selected'
                      : ''
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTrace(t.id);
                  }}
                />
              ))}

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

              {state.vias.map((v) => {
                const p = v[side];
                if (!p) return null;
                const linked = Boolean(v.front && v.back);
                const r = viaRadiusPx(v.diameter);
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
                        : '')
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectVia(v.id);
                    }}
                  />
                );
              })}

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

              {/* The SMD footprint that would be dropped here. */}
              {packagePreview.map((r, i) => (
                <rect
                  key={i}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  className="size-preview-mark"
                  strokeWidth={Math.max(1, image.width * 0.002) * viewScale}
                  pointerEvents="none"
                />
              ))}

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
