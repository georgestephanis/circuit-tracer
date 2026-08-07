import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { BoardState, ComponentType } from '../types';
import { computeNets } from './netlist';
import { downloadFile, safeFileName } from './download';

// Cosmetic only: pads carry no electrical direction, so which side of a box
// a pin lands on means nothing beyond "left half of the pins" vs "right
// half". Don't read WEST/EAST as input/output anywhere downstream. Which
// *order* pins land in along a side is left to ELK's crossing minimizer
// (`FIXED_SIDE`, not `FIXED_POS`) — pinning exact positions ourselves was
// the main cause of tangled layouts, since it defeated ELK's ability to
// reorder pins to reduce edge crossings.
const PIN_PITCH = 24;
const NODE_MARGIN = 16;
const NODE_MIN_WIDTH = 90;
const STUB_LENGTH = 40;

const STROKE = '#334155';
const TEXT = '#1f2430';
const MUTED = '#6b7280';
const ACCENT = '#38bdf8';
const BG = '#ffffff';

interface PinRef {
  componentId: string;
  /** A pad or via/hole id — components group both, see `Component.viaIds`. */
  memberId: string;
}

/** Rough width estimate — no real text measurement available at layout time. */
function labelWidth(label: string): number {
  return Math.max(NODE_MIN_WIDTH, label.length * 7 + 24);
}

function componentTitle(state: BoardState, componentId: string): string {
  const c = state.components.find((x) => x.id === componentId);
  if (!c) return componentId;
  const name = c.refDes || c.label || componentId;
  return c.value ? `${name} (${c.value})` : name;
}

/**
 * A standard 2-terminal device symbol, drawn instead of the generic labeled
 * box. Only applies to exactly-2-pad-or-lead components; 3+-pin parts
 * (transistors, ICs) keep the generic box, since a real symbol for those
 * needs bespoke pin geometry this doesn't attempt.
 *
 * Symbol shapes below are inspired by the per-device glyphs in
 * netlist-viewer (https://github.com/f18m/netlist-viewer, by Francesco
 * Montorsi, GPL-2.0) — hand-drawn standard schematic symbols, not ported
 * code.
 */
type DeviceKind = 'resistor' | 'capacitor' | 'inductor' | 'diode';

/** `ComponentType` values with a matching schematic glyph. */
const DEVICE_KIND_BY_COMPONENT_TYPE: Partial<Record<ComponentType, DeviceKind>> = {
  resistor: 'resistor',
  capacitor: 'capacitor',
  inductor: 'inductor',
  diode: 'diode',
};

/**
 * Prefers the component's own stored `componentType` — set by the user, not
 * guessed — and only falls back to the old refDes-prefix heuristic (the same
 * R/C/L/D convention SPICE netlists and netlist-viewer's own parser key
 * their device types off) when the type is unset or has no glyph of its own
 * (`other`, or a type like `led`/`ic` this renderer doesn't draw). A
 * component named "R7" that isn't actually a resistor just gets a resistor
 * glyph in that fallback case — a rendering choice, not a modeling claim, so
 * it's fine for it to be wrong sometimes.
 */
function inferDeviceKind(
  componentType: ComponentType,
  refDes: string,
  memberCount: number,
): DeviceKind | null {
  if (memberCount !== 2) return null;
  const fromType = DEVICE_KIND_BY_COMPONENT_TYPE[componentType];
  if (fromType) return fromType;
  const prefix = /^([A-Za-z]+)/.exec(refDes.trim())?.[1]?.toUpperCase();
  switch (prefix) {
    case 'R':
      return 'resistor';
    case 'C':
      return 'capacitor';
    case 'L':
      return 'inductor';
    case 'D':
      return 'diode';
    default:
      return null;
  }
}

/** Draws a device symbol centered in the node's box, leads reaching its edges. */
function deviceSymbolSvg(kind: DeviceKind, x: number, y: number, w: number, h: number): string {
  const cy = y + h / 2;
  const left = x;
  const right = x + w;
  const bodyW = Math.min(w * 0.5, 46);
  const bodyLeft = x + (w - bodyW) / 2;
  const bodyRight = bodyLeft + bodyW;
  const lead = (x1: number, x2: number) =>
    `<path d="M ${x1} ${cy} L ${x2} ${cy}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`;

  switch (kind) {
    case 'resistor': {
      const zigH = 8;
      const steps = 6;
      const stepW = bodyW / steps;
      let d = `M ${bodyLeft} ${cy}`;
      for (let i = 1; i < steps; i++) {
        const px = bodyLeft + i * stepW;
        const py = cy + (i % 2 === 1 ? -zigH : zigH);
        d += ` L ${px} ${py}`;
      }
      d += ` L ${bodyRight} ${cy}`;
      return [
        lead(left, bodyLeft),
        lead(bodyRight, right),
        `<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`,
      ].join('');
    }
    case 'capacitor': {
      const gap = 8;
      const plateH = 20;
      const p1 = cy - plateH / 2;
      const p2 = cy + plateH / 2;
      const xa = bodyLeft + bodyW / 2 - gap / 2;
      const xb = bodyLeft + bodyW / 2 + gap / 2;
      return [
        lead(left, xa),
        lead(xb, right),
        `<path d="M ${xa} ${p1} L ${xa} ${p2}" fill="none" stroke="${STROKE}" stroke-width="2" />`,
        `<path d="M ${xb} ${p1} L ${xb} ${p2}" fill="none" stroke="${STROKE}" stroke-width="2" />`,
      ].join('');
    }
    case 'inductor': {
      const bumps = 4;
      const r = bodyW / (bumps * 2);
      let d = `M ${bodyLeft} ${cy}`;
      for (let i = 0; i < bumps; i++) {
        const cx = bodyLeft + r + i * r * 2;
        d += ` A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
      }
      return [
        lead(left, bodyLeft),
        lead(bodyRight, right),
        `<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`,
      ].join('');
    }
    case 'diode': {
      const triH = 16;
      const barX = bodyLeft + bodyW * 0.6;
      return [
        lead(left, bodyLeft),
        lead(barX, right),
        `<path d="M ${bodyLeft} ${cy - triH / 2} L ${bodyLeft} ${cy + triH / 2} L ${barX} ${cy} Z" fill="${STROKE}" stroke="${STROKE}" stroke-width="1" />`,
        `<path d="M ${barX} ${cy - triH / 2} L ${barX} ${cy + triH / 2}" fill="none" stroke="${STROKE}" stroke-width="2" />`,
      ].join('');
    }
  }
}

/** Standard 3-bar earth-ground glyph, drawn at a GND net's dangling stub end. */
function groundSymbolSvg(x: number, y: number): string {
  const bars = [
    { w: 16, dy: 0 },
    { w: 10, dy: 5 },
    { w: 4, dy: 10 },
  ];
  return bars
    .map(
      (b) =>
        `<path d="M ${x - b.w / 2} ${y + b.dy} L ${x + b.w / 2} ${y + b.dy}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`,
    )
    .join('');
}

/**
 * Builds an ELK graph from the board's components and nets, runs layout, and
 * renders the result as a standalone SVG string. Nets that don't touch any
 * component pin are omitted, same rule `buildNetlist` already applies —
 * ungrouped pads have no pin identity in this model.
 */
export async function renderSchematic(state: BoardState): Promise<string> {
  const nets = computeNets(state);
  const memberOwner = new Map<string, PinRef>();
  for (const c of state.components) {
    for (const memberId of [...c.padIds, ...c.viaIds]) {
      memberOwner.set(memberId, { componentId: c.id, memberId });
    }
  }

  const deviceKinds = new Map<string, DeviceKind>();

  const elkNodes: ElkNode[] = state.components.map((c) => {
    // Pads and vias/holes are both pins — a through-hole part's leads are
    // vias, not pads (see AGENTS.md "A Component is a grouping relationship").
    const members = [...c.padIds, ...c.viaIds];
    const west = members.filter((_, i) => i % 2 === 0);
    const east = members.filter((_, i) => i % 2 === 1);
    const height = PIN_PITCH * Math.max(west.length, east.length, 1) + NODE_MARGIN;
    const width = labelWidth(c.refDes || c.label || c.id);

    const kind = inferDeviceKind(c.componentType, c.refDes || c.label || '', members.length);
    if (kind) deviceKinds.set(c.id, kind);

    const ports = [
      ...west.map((memberId) => ({
        id: `port:${memberId}`,
        width: 1,
        height: 1,
        layoutOptions: { 'org.eclipse.elk.port.side': 'WEST' },
      })),
      ...east.map((memberId) => ({
        id: `port:${memberId}`,
        width: 1,
        height: 1,
        layoutOptions: { 'org.eclipse.elk.port.side': 'EAST' },
      })),
    ];
    return {
      id: c.id,
      width,
      height,
      ports,
      // FIXED_SIDE (not FIXED_POS): side is cosmetic and fixed above, but
      // ELK is free to reorder pins within a side to reduce crossings.
      layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_SIDE' },
    };
  });

  const elkEdges: ElkExtendedEdge[] = [];
  const junctionNodes: ElkNode[] = [];
  const stubNodes: ElkNode[] = [];
  const edgeLabels = new Map<string, string>();
  const groundStubs = new Set<string>();
  let junctionCount = 0;
  let stubCount = 0;

  for (const net of nets) {
    const pins = [...net.padIds, ...net.viaIds]
      .map((id) => memberOwner.get(id))
      .filter((p): p is PinRef => !!p);
    if (pins.length === 0) continue;

    if (pins.length === 1) {
      const stubId = `stub:${stubCount++}`;
      stubNodes.push({ id: stubId, width: 1, height: 1 });
      if (net.label === 'GND') groundStubs.add(stubId);
      const edgeId = `edge:${net.label}:0`;
      elkEdges.push({
        id: edgeId,
        sources: [`port:${pins[0].memberId}`],
        targets: [stubId],
      });
      edgeLabels.set(edgeId, net.label);
    } else if (pins.length === 2) {
      const edgeId = `edge:${net.label}:0`;
      elkEdges.push({
        id: edgeId,
        sources: [`port:${pins[0].memberId}`],
        targets: [`port:${pins[1].memberId}`],
      });
      edgeLabels.set(edgeId, net.label);
    } else {
      const junctionId = `junction:${junctionCount++}`;
      junctionNodes.push({ id: junctionId, width: 1, height: 1 });
      pins.forEach((pin, i) => {
        const edgeId = `edge:${net.label}:${i}`;
        elkEdges.push({ id: edgeId, sources: [`port:${pin.memberId}`], targets: [junctionId] });
        if (i === 0) edgeLabels.set(edgeId, net.label);
      });
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.spacing.nodeNode': '40',
      // Crossing minimization only has room to work because ports above are
      // FIXED_SIDE rather than FIXED_POS — these just push it to try harder
      // and keep the resulting wires tidy.
      'elk.layered.thoroughness': '30',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.unnecessaryBendpoints': 'false',
      'elk.spacing.edgeEdge': '15',
      'elk.spacing.edgeNode': '15',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
    },
    children: [...elkNodes, ...junctionNodes, ...stubNodes],
    edges: elkEdges,
  };

  const elk = new ELK();
  const layout = await elk.layout(graph);

  return renderSvg(state, layout, edgeLabels, junctionNodes, stubNodes, deviceKinds, groundStubs);
}

function renderSvg(
  state: BoardState,
  layout: ElkNode,
  edgeLabels: Map<string, string>,
  junctionNodes: ElkNode[],
  stubNodes: ElkNode[],
  deviceKinds: Map<string, DeviceKind>,
  groundStubs: Set<string>,
): string {
  const junctionIds = new Set(junctionNodes.map((n) => n.id));
  const stubIds = new Set(stubNodes.map((n) => n.id));

  let maxX = 0;
  let maxY = 0;
  const parts: string[] = [];

  for (const node of layout.children ?? []) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);

    if (junctionIds.has(node.id)) {
      parts.push(`<circle cx="${x}" cy="${y}" r="3" fill="${ACCENT}" />`);
      continue;
    }
    if (stubIds.has(node.id)) {
      if (groundStubs.has(node.id)) parts.push(groundSymbolSvg(x, y));
      continue; // otherwise a synthetic endpoint only, not drawn
    }

    const kind = deviceKinds.get(node.id);
    if (kind) {
      parts.push(deviceSymbolSvg(kind, x, y, w, h));
    } else {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BG}" stroke="${STROKE}" stroke-width="1.5" rx="3" />`,
      );
    }
    const title = componentTitle(state, node.id);
    const titleY = kind ? y - 6 : y + h / 2;
    parts.push(
      `<text x="${x + w / 2}" y="${titleY}" fill="${TEXT}" font-size="12" text-anchor="middle" dominant-baseline="${kind ? 'auto' : 'middle'}" font-weight="600">${escapeXml(title)}</text>`,
    );
    for (const port of node.ports ?? []) {
      const padId = port.id.replace(/^port:/, '');
      const px = x + (port.x ?? 0);
      const py = y + (port.y ?? 0);
      const side = (port.layoutOptions?.['org.eclipse.elk.port.side'] ?? 'WEST') as string;
      const labelX = side === 'WEST' ? px + 4 : px - 4;
      const anchor = side === 'WEST' ? 'start' : 'end';
      parts.push(
        `<text x="${labelX}" y="${py - 4}" fill="${MUTED}" font-size="9" text-anchor="${anchor}">${escapeXml(padId)}</text>`,
      );
    }
  }

  for (const edge of layout.edges ?? []) {
    for (const section of edge.sections ?? []) {
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      for (const p of points) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      parts.push(`<path d="${pathD}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`);

      const label = edgeLabels.get(edge.id);
      if (label) {
        const mid = points[Math.floor(points.length / 2)];
        parts.push(
          `<text x="${mid.x}" y="${mid.y - 6}" fill="${MUTED}" font-size="9" text-anchor="middle">${escapeXml(label)}</text>`,
        );
      }
    }
  }

  const pad = STUB_LENGTH;
  const width = maxX + pad * 2;
  const height = maxY + pad * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${width} ${height}" width="${width}" height="${height}">`,
    `<rect x="${-pad}" y="${-pad}" width="${width}" height="${height}" fill="${BG}" />`,
    ...parts,
    `</svg>`,
  ].join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function downloadSchematic(state: BoardState, boardName: string): Promise<void> {
  const svg = await renderSchematic(state);
  downloadFile(svg, `${safeFileName(boardName)}.schematic.svg`, 'image/svg+xml');
}
