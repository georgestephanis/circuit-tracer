import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { BoardImage, BoardState, Point, Side } from '../types';
import { pointsToPath, rectFromCorners } from '../lib/geometry';
import { pxPerUnit } from '../lib/scale';
import { ImageUploader } from './ImageUploader';

/** Multiplicative size change per scroll-wheel notch. */
const WHEEL_STEP = 1.08;

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
  onScaleDefaultVia: (factor: number) => void;
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
  onScaleDefaultVia,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const image = state.images[side];

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
      let hitId: string | null = null;
      let hitDist = Infinity;
      for (const v of state.vias) {
        const c = v[side];
        if (!c) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d <= Math.max((v.diameter / 2) * scale, 8) && d < hitDist) {
          hitDist = d;
          hitId = v.id;
        }
      }

      // Sizing a via is one physical hole, so it applies to both sides at once.
      if (hitId) {
        e.preventDefault();
        onScaleVia(hitId, factor);
      } else if (state.tool === 'via') {
        e.preventDefault();
        onScaleDefaultVia(factor);
      }
    }

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [state.vias, state.tool, side, scale, onScaleVia, onScaleDefaultVia]);

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    const p = toImagePoint(e.clientX, e.clientY);
    if (p) onCanvasClick(side, p);
  }

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    if (!state.draftPad || state.draftPad.side !== side) {
      if (hover) setHover(null);
      return;
    }
    setHover(toImagePoint(e.clientX, e.clientY));
  }

  const traces = state.traces.filter((t) => t.side === side);
  const pads = state.pads.filter((p) => p.side === side);
  const draft = state.draftTrace && state.draftTrace.side === side ? state.draftTrace : null;
  const padDraft = state.draftPad && state.draftPad.side === side ? state.draftPad : null;
  const padPreview = padDraft && hover ? rectFromCorners(padDraft.start, hover) : null;

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
              onMouseLeave={() => setHover(null)}
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
                return (
                  <circle
                    key={v.id}
                    cx={p.x}
                    cy={p.y}
                    r={viaRadiusPx(v.diameter)}
                    className={
                      'via-marker' +
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
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
