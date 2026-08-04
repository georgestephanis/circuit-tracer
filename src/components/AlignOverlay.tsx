import { useRef, useState, type MouseEvent } from 'react';
import type { Point, Side } from '../types';

const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

interface Props {
  side: Side;
  /** The image to pick corners on — always the untouched original. */
  src: string;
  width: number;
  height: number;
  /** Previously-picked corners, when re-aligning a side. */
  initialCorners?: Point[];
  /** Set once one side has been aligned; the other side must match it. */
  lockedSize: { width: number; height: number } | null;
  busy: boolean;
  error: string | null;
  onConfirm: (corners: Point[]) => void;
  onCancel: () => void;
}

export function AlignOverlay({
  side,
  src,
  width,
  height,
  initialCorners,
  lockedSize,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [corners, setCorners] = useState<Point[]>(initialCorners ?? []);

  const complete = corners.length === 4;
  const markerRadius = Math.max(6, Math.min(width, height) * 0.012);
  const strokeWidth = Math.max(2, width * 0.004);

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    if (complete || busy) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    setCorners([...corners, { x: Math.round(local.x), y: Math.round(local.y) }]);
  }

  return (
    <div className="modal-backdrop">
      <div className="align-overlay">
        <header className="align-overlay-header">
          <h2>Align {side === 'front' ? 'front' : 'back'}</h2>
          <p className="align-hint">
            {complete
              ? 'Confirm to straighten the board to a rectangle, or reset to re-pick.'
              : `Click the ${CORNER_LABELS[corners.length]} corner of the board (${corners.length + 1} of 4).`}
          </p>
          {lockedSize && (
            <p className="align-hint">
              Will be corrected to {lockedSize.width} × {lockedSize.height} px to match the other
              side.
            </p>
          )}
        </header>

        {error && <div className="export-error">{error}</div>}

        <div className="board-canvas-wrap">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className={`board-canvas${complete || busy ? '' : ' align-picking'}`}
            onClick={handleClick}
          >
            <image href={src} x={0} y={0} width={width} height={height} />

            {corners.length > 1 && (
              <polygon
                points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={strokeWidth}
                strokeDasharray={complete ? undefined : `${strokeWidth * 3} ${strokeWidth * 2}`}
                pointerEvents="none"
              />
            )}

            {corners.map((p, i) => (
              <g key={i} pointerEvents="none">
                <circle cx={p.x} cy={p.y} r={markerRadius} className="align-corner" />
                <text
                  x={p.x + markerRadius * 1.5}
                  y={p.y - markerRadius * 1.5}
                  className="align-corner-label"
                  fontSize={markerRadius * 2.5}
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <footer className="align-overlay-actions">
          <button type="button" onClick={() => setCorners([])} disabled={busy || !corners.length}>
            Reset corners
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(corners)} disabled={!complete || busy}>
            {busy ? 'Correcting…' : 'Confirm'}
          </button>
        </footer>
      </div>
    </div>
  );
}
