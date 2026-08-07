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
import { computeNets, netLabelsByMember } from './netlist';
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

/** `data-net`, present only when this id belongs to a computed net. */
function netAttr(id: string, netForMember: Map<string, string>): string {
  const net = netForMember.get(id);
  return net ? ` data-net="${escapeXml(net)}"` : '';
}

function renderTrace(
  t: Trace,
  widthUnits: number,
  scale: number,
  netForMember: Map<string, string>,
): string {
  const d = pointsToPath(t.points);
  const strokeWidth = Math.max(1, widthUnits * scale);
  // A trace has no id of its own in the net map — it inherits whichever net
  // the pad/via at either end belongs to (they're all the same net, by
  // construction: computeNets unions everything a trace connects).
  const net = [...t.connectsPad, ...t.connectsVia].map((id) => netForMember.get(id)).find(Boolean);
  const netAttrStr = net ? ` data-net="${escapeXml(net)}"` : '';
  return `<path id="${t.id}" class="trace" data-side="${t.side}"${labelAttr(t.label)}${connectsAttr([...t.connectsVia, ...t.connectsPad])}${netAttrStr} data-width="${num(widthUnits)}" d="${d}" stroke="${t.color}" stroke-width="${num(strokeWidth)}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderVia(v: Via, side: Side, scale: number, netForMember: Map<string, string>): string {
  const p = v[side];
  if (!p) return '';
  const radius = Math.max(1, (v.diameter / 2) * scale);
  // A hole is drawn as an open ring; a via as a filled plated dot.
  const isHole = v.kind === 'hole';
  const fill = v.ground ? GROUND_COLOR : isHole ? '#1a1a1a' : '#c0c0c0';
  const strokeWidth = Math.max(1, radius * (isHole ? 0.35 : 0.2));
  return `<circle id="${v.id}-${side}" class="via via--${v.kind}" data-via-id="${v.id}" data-kind="${v.kind}" data-side="${side}"${labelAttr(v.label)}${groundAttrs(v.ground)}${netAttr(v.id, netForMember)} data-diameter="${num(v.diameter)}" cx="${p.x}" cy="${p.y}" r="${num(radius)}" fill="${fill}" stroke="${isHole ? '#c0c0c0' : '#333'}" stroke-width="${num(strokeWidth)}" />`;
}

/** `data-ground`, present only on copper flagged as part of the ground net. */
function groundAttrs(ground: boolean | undefined): string {
  return ground ? ' data-ground="true"' : '';
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
  return `<path id="${plane.id}" class="ground-plane" data-side="${plane.side}"${labelAttr(plane.label)}${groundAttrs(true)} data-net="GND" d="${d}" fill="${GROUND_COLOR}" fill-rule="nonzero" />`;
}

function renderPad(pad: Pad, scale: number, netForMember: Map<string, string>): string {
  const fill = pad.ground ? GROUND_COLOR : pad.color;
  const common = `class="pad pad--${pad.shape}" data-side="${pad.side}" data-shape="${pad.shape}"${labelAttr(pad.label)}${connectsAttr([...pad.connectsTrace, ...pad.connectsVia])}${groundAttrs(pad.ground)}${netAttr(pad.id, netForMember)}`;

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
  netForMember: Map<string, string>,
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
  const pads = state.pads
    .filter((p) => p.side === side)
    .map((p) => renderPad(p, scale, netForMember));
  const traces = state.traces
    .filter((t) => t.side === side)
    .map((t) => renderTrace(t, t.width ?? state.defaultTraceWidth, scale, netForMember));
  const vias = state.vias.map((v) => renderVia(v, side, scale, netForMember)).filter(Boolean);
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

/**
 * Escapes a `]]>` that would otherwise prematurely close the CDATA section,
 * using the standard XML trick of splitting it across two adjacent sections.
 */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/**
 * XML comments may not contain "--" or end in "-". Belt-and-suspenders for
 * SCHEMA_DOC below (already written to avoid it) so a future edit that slips
 * one in produces valid-but-slightly-odd output instead of a malformed file.
 */
function xmlCommentSafe(text: string): string {
  return text.replace(/-(?=-)/g, '‑').replace(/-$/, '‑');
}

/**
 * Plain-language documentation of this file's own schema, written to stand on
 * its own — the point is that this SVG can be handed to an LLM (or a person)
 * with no other context and be understood. Kept in sync with the "Exported
 * SVG schema" section of README.md; if one changes, so should the other.
 *
 * Free of "--" so it stays a legal XML comment.
 */
const SCHEMA_DOC = `
circuit-tracer SVG export — https://github.com/georgestephanis/circuit-tracer

This file documents a traced PCB. It has two <g data-side="front"|"back">
groups, each that side's photo plus its copper, laid out side by side. Each
group scales independently — see its own data-px-per-unit, described below.

Elements, by class:
  .ground-plane <path>   A filled copper pour. Always net "GND".
  .pad <rect|circle>     A copper pad. shape="round" pads are drawn as a
                          <circle> with data-diameter; other shapes are a
                          <rect> with data-width/data-height. A round pad
                          with no component and no label is usually a test
                          point.
  .trace <path>          A length of copper.
  .via <circle>           A through-board opening: a plated via or a plain
                          hole, distinguished by data-kind ("via" or "hole",
                          also present as a class modifier — filter on
                          data-kind, it's simpler). Each physical opening
                          produces up to two of these elements, one per side,
                          sharing one data-via-id but with distinct,
                          side-suffixed ids ({id}-front / {id}-back). The two
                          are mirrored in x within their groups, not equal.
  .component <g>         A non-interactive outline around 2+ pads/vias that
                          are one physical part's footprint (e.g. both legs
                          of a resistor). Not copper itself — nothing to
                          route through it.

Connectivity: data-connects (on a pad or trace) and data-pads/data-vias (on a
component) are id references into this same document — match against the
"id" or "data-via-id" attribute elsewhere in the file. Linkage is
bidirectional: if a pad lists a trace, that trace lists the pad back.

Every piece of copper — pad, via, hole, trace, ground plane — also carries
data-net, naming the electrical net it belongs to, already fully resolved
(you should not need to re-derive nets from data-connects/data-ground
yourself). Grounded copper is always net "GND". A net with only one member
just means that piece of copper isn't connected to anything else recorded on
the board. The <script type="application/json"> below this comment restates
every net (as {label, padIds, viaIds}) and every component (as {id, label,
refDes, componentType, value, notes, padIds, viaIds, roles}) in one place,
for a consumer that would rather read structured data than walk the SVG.

Components: componentType is one of resistor/capacitor/inductor/diode/led/
transistor/ic/connector/crystal/switch/other ("other" if never set). value
is a free-text part value (e.g. "10k", "100nF"), meaningful mostly for
resistor/capacitor/inductor/crystal. roles maps a member (pad or via) id to
a free-text pin role (e.g. "Anode") for parts whose pins aren't
interchangeable — most components have none.

Units: data-unit on <metadata> names the physical unit (mm, mil, or in) that
every data-width/data-height/data-diameter is expressed in. On-screen
positions (x, y, cx, cy, and points in a path's "d") stay in source-image
pixels; each side's data-px-per-unit is the pixels-per-unit factor to
convert between the two. data-board-width/data-board-height on <metadata>
are the board's real dimensions, absent if the user never entered them.
`.trim();

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

  const nets = computeNets(state);
  const netForMember = netLabelsByMember(nets);

  const frontGroup = renderSideGroup(state, 'front', 0, options, netForMember);
  const backGroup = renderSideGroup(state, 'back', backOffsetX, options, netForMember);

  const timestamp = new Date().toISOString();
  const size = state.boardSize;
  const sizeAttrs =
    size && size.width > 0 && size.height > 0
      ? ` data-board-width="${num(size.width)}" data-board-height="${num(size.height)}"`
      : '';

  const notes = state.notes.trim();
  const descBlock = notes ? `\n  <desc>${escapeXml(notes)}</desc>` : '';

  // A structured restatement of nets + components, for a consumer that would
  // rather parse JSON than walk the SVG — see SCHEMA_DOC above.
  const dataPayload = {
    boardName,
    generated: timestamp,
    unit: UNIT_LABELS[state.unit],
    boardSize: size && size.width > 0 && size.height > 0 ? size : null,
    notes: notes || undefined,
    nets: nets.map((n) => ({ label: n.label, padIds: n.padIds, viaIds: n.viaIds })),
    components: state.components.map((c) => ({
      id: c.id,
      side: c.side,
      label: c.label,
      refDes: c.refDes,
      componentType: c.componentType,
      value: c.value,
      notes: c.notes,
      padIds: c.padIds,
      viaIds: c.viaIds,
      roles: c.roles,
    })),
  };
  const dataScript = `<script type="application/json" id="circuit-tracer-data">${cdata(JSON.stringify(dataPayload, null, 2))}</script>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <!--
${xmlCommentSafe(SCHEMA_DOC)}
  -->
  <title>${escapeXml(boardName)}</title>
  <metadata data-board-name="${escapeXml(boardName)}" data-generated="${timestamp}" data-generator="circuit-tracer" data-unit="${UNIT_LABELS[state.unit]}"${sizeAttrs}></metadata>${descBlock}
  ${dataScript}
  ${frontGroup}
  ${backGroup}
</svg>
`;
}

export function downloadSvg(svgSource: string, boardName: string): void {
  downloadFile(svgSource, `${safeFileName(boardName)}.svg`, 'image/svg+xml');
}
