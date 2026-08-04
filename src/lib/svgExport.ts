import { GROUND_COLOR, type BoardState, type Pad, type Side, type Trace, type Via } from '../types';
import { pointsToPath } from './geometry';
import { UNIT_LABELS, pxPerUnit } from './scale';

const GAP = 40;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v: number): string {
  return String(Number(v.toFixed(4)));
}

function connectsAttr(ids: string[]): string {
  return ids.length ? ` data-connects="${escapeXml(ids.join(' '))}"` : '';
}

function labelAttr(label: string): string {
  return label ? ` data-label="${escapeXml(label)}"` : '';
}

function renderTrace(t: Trace, widthUnits: number, scale: number): string {
  const d = pointsToPath(t.points);
  const strokeWidth = Math.max(1, widthUnits * scale);
  return `<path id="${t.id}" class="trace" data-side="${t.side}"${labelAttr(t.label)}${connectsAttr([...t.connectsVia, ...t.connectsPad])} data-width="${num(widthUnits)}" d="${d}" stroke="${t.color}" stroke-width="${num(strokeWidth)}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderVia(v: Via, side: Side, scale: number): string {
  const p = v[side];
  if (!p) return '';
  const radius = Math.max(1, (v.diameter / 2) * scale);
  // A hole is drawn as an open ring; a via as a filled plated dot.
  const isHole = v.kind === 'hole';
  const fill = v.ground ? GROUND_COLOR : isHole ? '#1a1a1a' : '#c0c0c0';
  const strokeWidth = Math.max(1, radius * (isHole ? 0.35 : 0.2));
  return `<circle id="${v.id}-${side}" class="via via--${v.kind}" data-via-id="${v.id}" data-kind="${v.kind}" data-side="${side}"${labelAttr(v.label)}${groundAttrs(v.ground)} data-diameter="${num(v.diameter)}" cx="${p.x}" cy="${p.y}" r="${num(radius)}" fill="${fill}" stroke="${isHole ? '#c0c0c0' : '#333'}" stroke-width="${num(strokeWidth)}" />`;
}

/** `data-ground` and the GND net name, present only on grounded copper. */
function groundAttrs(ground: boolean | undefined): string {
  return ground ? ' data-ground="true" data-net="GND"' : '';
}

function renderPad(pad: Pad, scale: number): string {
  const fill = pad.ground ? GROUND_COLOR : pad.color;
  const common = `class="pad pad--${pad.shape}" data-side="${pad.side}" data-shape="${pad.shape}"${labelAttr(pad.label)}${connectsAttr([...pad.connectsTrace, ...pad.connectsVia])}${groundAttrs(pad.ground)}`;

  // A round pad is the circle inscribed in its bounding box, so it exports as a
  // <circle> with a diameter rather than a width and height.
  if (pad.shape === 'round') {
    const r = pad.width / 2;
    return `<circle id="${pad.id}" ${common} data-diameter="${num(pad.width / scale)}" cx="${num(pad.x + r)}" cy="${num(pad.y + pad.height / 2)}" r="${num(r)}" fill="${fill}" />`;
  }
  return `<rect id="${pad.id}" ${common} data-width="${num(pad.width / scale)}" data-height="${num(pad.height / scale)}" x="${pad.x}" y="${pad.y}" width="${pad.width}" height="${pad.height}" fill="${fill}" />`;
}

function renderSideGroup(state: BoardState, side: Side, offsetX: number): string {
  const image = state.images[side];
  if (!image) return '';
  const scale = pxPerUnit(image, state.boardSize, state.unit);

  // Pads are emitted before traces so that a trace running into a pad renders
  // as one continuous copper shape.
  const pads = state.pads.filter((p) => p.side === side).map((p) => renderPad(p, scale));
  const traces = state.traces
    .filter((t) => t.side === side)
    .map((t) => renderTrace(t, t.width ?? state.defaultTraceWidth, scale));
  const vias = state.vias.map((v) => renderVia(v, side, scale)).filter(Boolean);

  return `<g data-side="${side}" data-px-per-unit="${num(scale)}" transform="translate(${offsetX}, 0)">
    <image href="${image.src}" x="0" y="0" width="${image.width}" height="${image.height}" />
    ${[...pads, ...traces, ...vias].join('\n    ')}
  </g>`;
}

export function buildCombinedSvg(state: BoardState, boardName: string): string {
  const front = state.images.front;
  const back = state.images.back;
  if (!front || !back) {
    throw new Error('Both front and back images must be uploaded before exporting.');
  }

  const totalWidth = front.width + GAP + back.width;
  const totalHeight = Math.max(front.height, back.height);
  const backOffsetX = front.width + GAP;

  const frontGroup = renderSideGroup(state, 'front', 0);
  const backGroup = renderSideGroup(state, 'back', backOffsetX);

  const timestamp = new Date().toISOString();
  const size = state.boardSize;
  const sizeAttrs =
    size && size.width > 0 && size.height > 0
      ? ` data-board-width="${num(size.width)}" data-board-height="${num(size.height)}"`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <title>${escapeXml(boardName)}</title>
  <metadata data-board-name="${escapeXml(boardName)}" data-generated="${timestamp}" data-generator="circuit-tracer" data-unit="${UNIT_LABELS[state.unit]}"${sizeAttrs}></metadata>
  ${frontGroup}
  ${backGroup}
</svg>
`;
}

export function downloadSvg(svgSource: string, boardName: string): void {
  const safeName = boardName.trim() ? boardName.trim().replace(/[^a-z0-9-_]+/gi, '-') : 'circuit-board';
  const blob = new Blob([svgSource], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
