import {
  GROUND_COLOR,
  type BoardState,
  type Component,
  type GroundPlane,
  type Pad,
  type Side,
  type Trace,
  type Via,
} from '../types';
import { componentBoundingRect, pointsToPath } from './geometry';
import { buildGroundPlanePath } from './groundPlane';
import { UNIT_LABELS, pxPerUnit } from './scale';
import { downloadFile, safeFileName } from './download';

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

function renderGroundPlane(
  plane: GroundPlane,
  pads: Pad[],
  vias: Via[],
  traces: Trace[],
  scale: number,
  defaultTraceWidth: number,
): string {
  const d = buildGroundPlanePath(plane, pads, vias, traces, scale, defaultTraceWidth);
  return `<path id="${plane.id}" class="ground-plane" data-side="${plane.side}"${labelAttr(plane.label)}${groundAttrs(true)} d="${d}" fill="${GROUND_COLOR}" fill-rule="nonzero" />`;
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

/**
 * A Component's outline, as a non-interactive group carrying the fields a
 * downstream tool (or a human) would want when re-deriving a schematic or
 * BOM: label, ref-des, type, value, notes, and which pads/vias it groups,
 * with per-member roles. Additive attributes only, so an SVG parser that
 * predates Components — or predates type/value/roles — is unaffected.
 */
function renderComponent(c: Component, pads: Pad[], vias: Via[], scale: number): string {
  const viaRects = vias
    .filter((v) => c.viaIds.includes(v.id) && v[c.side])
    .map((v) => {
      const p = v[c.side]!;
      const r = Math.max(1, (v.diameter / 2) * scale);
      return { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 };
    });
  const rect = componentBoundingRect(
    pads.filter((p) => p.side === c.side),
    c.padIds,
    viaRects,
  );
  if (!rect) return '';
  const padAttr = ` data-pad-count="${c.padIds.length}"`;
  const refDesAttr = c.refDes ? ` data-ref-des="${escapeXml(c.refDes)}"` : '';
  const typeAttr = ` data-component-type="${c.componentType}"`;
  const valueAttr = c.value ? ` data-value="${escapeXml(c.value)}"` : '';
  const notesAttr = c.notes ? ` data-notes="${escapeXml(c.notes)}"` : '';
  const padsAttr = c.padIds.length ? ` data-pads="${escapeXml(c.padIds.join(' '))}"` : '';
  const viasAttr = c.viaIds.length ? ` data-vias="${escapeXml(c.viaIds.join(' '))}"` : '';
  // One `id:role` token per member that actually has a role set — most
  // components have none, so this is absent far more often than present.
  const roleEntries = Object.entries(c.roles).filter(([, role]) => role.trim());
  const rolesAttr = roleEntries.length
    ? ` data-roles="${escapeXml(roleEntries.map(([id, role]) => `${id}:${role}`).join(' '))}"`
    : '';
  return `<g id="${c.id}" class="component" data-component-id="${c.id}"${labelAttr(c.label)}${refDesAttr}${typeAttr}${valueAttr}${notesAttr}${padAttr}${padsAttr}${viasAttr}${rolesAttr}>
    <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 3" />
  </g>`;
}

/** The shot currently displayed/exported for a side — export never offers a per-shot picker. */
function activeShotOf(images: BoardState['images'], side: Side) {
  const photos = images[side];
  if (!photos) return null;
  return photos.shots[photos.activeShotId] ?? null;
}

export interface SvgExportOptions {
  /** When false, omit each side's embedded photo — annotations only. Defaults to true. */
  includeImages?: boolean;
}

function renderSideGroup(
  state: BoardState,
  side: Side,
  offsetX: number,
  options: SvgExportOptions,
): string {
  const shot = activeShotOf(state.images, side);
  if (!shot) return '';
  const scale = pxPerUnit(shot, state.boardSize, state.unit);

  // Ground planes are emitted before everything else so the pour sits
  // beneath all copper, same as the live canvas.
  const groundPlanes = state.groundPlanes
    .filter((plane) => plane.side === side)
    .map((plane) =>
      renderGroundPlane(plane, state.pads, state.vias, state.traces, scale, state.defaultTraceWidth),
    );

  // Pads are emitted before traces so that a trace running into a pad renders
  // as one continuous copper shape.
  const pads = state.pads.filter((p) => p.side === side).map((p) => renderPad(p, scale));
  const traces = state.traces
    .filter((t) => t.side === side)
    .map((t) => renderTrace(t, t.width ?? state.defaultTraceWidth, scale));
  const vias = state.vias.map((v) => renderVia(v, side, scale)).filter(Boolean);
  const components = state.components
    .filter((c) => c.side === side)
    .map((c) => renderComponent(c, state.pads, state.vias, scale))
    .filter(Boolean);

  const image =
    options.includeImages === false
      ? ''
      : `<image href="${shot.src}" x="0" y="0" width="${shot.width}" height="${shot.height}" />
    `;

  return `<g data-side="${side}" data-px-per-unit="${num(scale)}" transform="translate(${offsetX}, 0)">
    ${image}${[...groundPlanes, ...pads, ...traces, ...vias, ...components].join('\n    ')}
  </g>`;
}

export function buildCombinedSvg(
  state: BoardState,
  boardName: string,
  options: SvgExportOptions = {},
): string {
  const front = activeShotOf(state.images, 'front');
  const back = activeShotOf(state.images, 'back');
  if (!front || !back) {
    throw new Error('Both front and back images must be uploaded before exporting.');
  }

  const totalWidth = front.width + GAP + back.width;
  const totalHeight = Math.max(front.height, back.height);
  const backOffsetX = front.width + GAP;

  const frontGroup = renderSideGroup(state, 'front', 0, options);
  const backGroup = renderSideGroup(state, 'back', backOffsetX, options);

  const timestamp = new Date().toISOString();
  const size = state.boardSize;
  const sizeAttrs =
    size && size.width > 0 && size.height > 0
      ? ` data-board-width="${num(size.width)}" data-board-height="${num(size.height)}"`
      : '';

  const notes = state.notes.trim();
  const descBlock = notes ? `\n  <desc>${escapeXml(notes)}</desc>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <title>${escapeXml(boardName)}</title>
  <metadata data-board-name="${escapeXml(boardName)}" data-generated="${timestamp}" data-generator="circuit-tracer" data-unit="${UNIT_LABELS[state.unit]}"${sizeAttrs}></metadata>${descBlock}
  ${frontGroup}
  ${backGroup}
</svg>
`;
}

export function downloadSvg(svgSource: string, boardName: string): void {
  downloadFile(svgSource, `${safeFileName(boardName)}.svg`, 'image/svg+xml');
}
