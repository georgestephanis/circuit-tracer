import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { BoardImage, BoardState, HoleKind, Point, Side, Trace, Via } from '../types';
import {
  distanceToPolyline,
  padSeriesRects,
  pointsToPath,
  rectFromCorners,
  throughBoard,
} from '../lib/geometry';
import { UNIT_LABELS, clampLength, formatLength, pxPerUnit } from '../lib/scale';
import { ImageUploader } from './ImageUploader';

/** Multiplicative size change per scroll-wheel notch. */
const WHEEL_STEP = 1.08;
/** How long the size readout stays up after the last wheel notch. */
const HINT_LINGER_MS = 1200;

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
  onScaleVia: (id: string, factor: number) => void;
  onScaleTrace: (id: string, factor: number) => void;
  onScaleDefaultDiameter: (kind: HoleKind, factor: number) => void;
  onScaleDefaultTraceWidth: (factor: number) => void;
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
  onScaleVia,
  onScaleTrace,
  onScaleDefaultDiameter,
  onScaleDefaultTraceWidth,
  otherSideHover,
  onHoverPoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /** Transient readout of what the wheel is currently sizing. */
  const [sizeHint, setSizeHint] = useState<{ point: Point; text: string } | null>(null);
  const hintTimer = useRef<number | null>(null);
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

  /**
   * Show what the wheel just resized something to, at the cursor. `raw` is put
   * through the same clamp the reducer uses so the readout can't claim a size
   * the board won't actually accept.
   */
  const showSizeHint = useCallback(
    (point: Point, raw: number, kind: 'trace' | HoleKind, isDefault = false): void => {
      const value = clampLength(raw, unit);
      const size = `${formatLength(value, unit)} ${UNIT_LABELS[unit]}`;
      const measure = kind === 'trace' ? `${size} wide` : `⌀ ${size}`;
      setSizeHint({ point, text: isDefault ? `New ${kind}: ${measure}` : measure });

      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setSizeHint(null), HINT_LINGER_MS);
    },
    [unit],
  );

  useEffect(
    () => () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    },
    [],
  );

  // Scroll-wheel sizing. React's onWheel is passive, so preventDefault() there
  // wouldn't stop the page from scrolling — attach a non-passive listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    function onWheel(e: WheelEvent) {
      if (e.deltaY === 0) return;
      const p = toImagePoint(e.clientX, e.clientY);
      if (!p) return;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;

      // Grab the via under the cursor, testing against its own drawn radius
      // (with a floor so tiny vias stay grabbable).
      let hitVia: Via | null = null;
      let hitDist = Infinity;
      for (const v of state.vias) {
        const c = v[side];
        if (!c) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d <= Math.max((v.diameter / 2) * scale, 8) && d < hitDist) {
          hitDist = d;
          hitVia = v;
        }
      }

      // Sizing a via is one physical hole, so it applies to both sides at once.
      if (hitVia) {
        e.preventDefault();
        showSizeHint(p, hitVia.diameter * factor, hitVia.kind);
        onScaleVia(hitVia.id, factor);
        return;
      }

      // Otherwise the nearest trace under the cursor, within its own stroke.
      let hitTrace: Trace | null = null;
      let hitTraceDist = Infinity;
      for (const t of state.traces) {
        if (t.side !== side) continue;
        const d = distanceToPolyline(p, t.points);
        const reach = Math.max(((t.width ?? state.defaultTraceWidth) / 2) * scale, 6);
        if (d <= reach && d < hitTraceDist) {
          hitTraceDist = d;
          hitTrace = t;
        }
      }

      if (hitTrace) {
        e.preventDefault();
        showSizeHint(p, (hitTrace.width ?? state.defaultTraceWidth) * factor, 'trace');
        onScaleTrace(hitTrace.id, factor);
        return;
      }

      // Over bare board, the wheel sizes the default for the active tool.
      if (state.tool === 'via' || state.tool === 'hole') {
        e.preventDefault();
        const current =
          state.tool === 'hole' ? state.defaultHoleDiameter : state.defaultViaDiameter;
        showSizeHint(p, current * factor, state.tool, true);
        onScaleDefaultDiameter(state.tool, factor);
      } else if (state.tool === 'trace') {
        e.preventDefault();
        showSizeHint(p, state.defaultTraceWidth * factor, 'trace', true);
        onScaleDefaultTraceWidth(factor);
      }
    }

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [
    state.vias,
    state.traces,
    state.tool,
    state.defaultTraceWidth,
    state.defaultViaDiameter,
    state.defaultHoleDiameter,
    showSizeHint,
    side,
    scale,
    onScaleVia,
    onScaleTrace,
    onScaleDefaultDiameter,
    onScaleDefaultTraceWidth,
  ]);

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    const p = toImagePoint(e.clientX, e.clientY);
    if (p) onCanvasClick(side, p);
  }

  const placingHole = state.tool === 'via' || state.tool === 'hole';
  const arraySource = state.padArray
    ? (state.pads.find((p) => p.id === state.padArray?.sourceId) ?? null)
    : null;
  const armingArray = Boolean(arraySource && arraySource.side === side);

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    const drawingPad = Boolean(state.draftPad && state.draftPad.side === side);
    if (!drawingPad && !placingHole && !armingArray) {
      if (hover) setHover(null);
      onHoverPoint(side, null);
      return;
    }
    const p = toImagePoint(e.clientX, e.clientY);
    setHover(p);
    onHoverPoint(side, placingHole ? p : null);
  }

  function handleMouseLeave() {
    setHover(null);
    onHoverPoint(side, null);
  }

  const traces = state.traces.filter((t) => t.side === side);
  const pads = state.pads.filter((p) => p.side === side);
  const draft = state.draftTrace && state.draftTrace.side === side ? state.draftTrace : null;
  const padDraft = state.draftPad && state.draftPad.side === side ? state.draftPad : null;
  const padPreview = padDraft && hover ? rectFromCorners(padDraft.start, hover) : null;
  const seriesPreview =
    arraySource && armingArray && state.padArray && hover
      ? padSeriesRects(arraySource, hover, state.padArray.count)
      : [];

  return (
    <div className="board-panel">
      <div className="board-panel-header">
        <h2>{side === 'front' ? 'Front' : 'Back'}</h2>
        {image && (
          <button type="button" onClick={() => onAlign(side)}>
            {image.corners ? 'Re-align' : 'Align'}
          </button>
        )}
      </div>
      {!image ? (
        <ImageUploader side={side} image={image} onLoad={onLoadImage} />
      ) : (
        <>
          <ImageUploader side={side} image={image} onLoad={onLoadImage} />
          <div className="board-canvas-wrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${image.width} ${image.height}`}
              className={`board-canvas tool-${state.tool}`}
              onClick={handleClick}
              onDoubleClick={() => onCanvasDoubleClick(side)}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <image href={image.src} x={0} y={0} width={image.width} height={image.height} />

              {/* Pads sit under the traces so the two read as one copper shape. */}
              {pads.map((pad) => (
                <rect
                  key={pad.id}
                  x={pad.x}
                  y={pad.y}
                  width={pad.width}
                  height={pad.height}
                  fill={pad.color}
                  className={
                    'pad-shape' +
                    (state.selection?.kind === 'pad' && state.selection.id === pad.id
                      ? ' selected'
                      : '')
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPad(pad.id);
                  }}
                />
              ))}

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
                  r={Math.max(3, image.width * 0.004)}
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
                  strokeWidth={Math.max(1, image.width * 0.003)}
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
                  strokeWidth={Math.max(1, image.width * 0.002)}
                  strokeDasharray="5 3"
                  pointerEvents="none"
                />
              ))}

              {/* Where the hole being placed on the other side would come out here. */}
              {placingHole && otherSideHover && (
                <circle
                  cx={throughBoard(otherSideHover, image.width).x}
                  cy={throughBoard(otherSideHover, image.width).y}
                  r={viaRadiusPx(
                    state.tool === 'hole' ? state.defaultHoleDiameter : state.defaultViaDiameter,
                  )}
                  className="via-marker via-marker--ghost"
                  pointerEvents="none"
                />
              )}

              {/* What the wheel is sizing, right where the cursor is. */}
              {sizeHint &&
                (() => {
                  // Font size is in image pixels, so scale it to the photo to
                  // stay legible whatever the panel is displayed at.
                  const fs = image.width * 0.022;
                  const nearRightEdge = sizeHint.point.x > image.width * 0.7;
                  return (
                    <text
                      className="size-hint"
                      x={sizeHint.point.x + (nearRightEdge ? -fs * 0.7 : fs * 0.7)}
                      y={sizeHint.point.y - fs * 0.7}
                      textAnchor={nearRightEdge ? 'end' : 'start'}
                      fontSize={fs}
                      strokeWidth={fs * 0.22}
                      pointerEvents="none"
                    >
                      {sizeHint.text}
                    </text>
                  );
                })()}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
