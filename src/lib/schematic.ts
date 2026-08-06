import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { BoardState } from '../types';
import { computeNets } from './netlist';
import { downloadFile, safeFileName } from './download';

// Cosmetic only: pads carry no electrical direction, so which side of a box
// a pin lands on means nothing beyond "left half of the picks" vs "right
// half". Don't read WEST/EAST as input/output anywhere downstream.
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
  padId: string;
}

/** Rough width estimate — no real text measurement available at layout time. */
function labelWidth(label: string): number {
  return Math.max(NODE_MIN_WIDTH, label.length * 7 + 24);
}

function componentTitle(state: BoardState, componentId: string): string {
  const c = state.components.find((x) => x.id === componentId);
  return c?.refDes || c?.label || componentId;
}

/**
 * Builds an ELK graph from the board's components and nets, runs layout, and
 * renders the result as a standalone SVG string. Nets that don't touch any
 * component pin are omitted, same rule `buildNetlist` already applies —
 * ungrouped pads have no pin identity in this model.
 */
export async function renderSchematic(state: BoardState): Promise<string> {
  const nets = computeNets(state);
  const padOwner = new Map<string, PinRef>();
  for (const c of state.components) {
    for (const padId of c.padIds) padOwner.set(padId, { componentId: c.id, padId });
  }

  const elkNodes: ElkNode[] = state.components.map((c) => {
    const west = c.padIds.filter((_, i) => i % 2 === 0);
    const east = c.padIds.filter((_, i) => i % 2 === 1);
    const height = PIN_PITCH * Math.max(west.length, east.length, 1) + NODE_MARGIN;
    const width = labelWidth(c.refDes || c.label || c.id);
    const ports = [
      ...west.map((padId, i) => ({
        id: `port:${padId}`,
        width: 1,
        height: 1,
        x: 0,
        y: NODE_MARGIN / 2 + i * PIN_PITCH + PIN_PITCH / 2,
        layoutOptions: { 'org.eclipse.elk.port.side': 'WEST' },
      })),
      ...east.map((padId, i) => ({
        id: `port:${padId}`,
        width: 1,
        height: 1,
        x: width,
        y: NODE_MARGIN / 2 + i * PIN_PITCH + PIN_PITCH / 2,
        layoutOptions: { 'org.eclipse.elk.port.side': 'EAST' },
      })),
    ];
    return {
      id: c.id,
      width,
      height,
      ports,
      layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS' },
    };
  });

  const elkEdges: ElkExtendedEdge[] = [];
  const junctionNodes: ElkNode[] = [];
  const stubNodes: ElkNode[] = [];
  const edgeLabels = new Map<string, string>();
  let junctionCount = 0;
  let stubCount = 0;

  for (const net of nets) {
    const pins = net.padIds.map((id) => padOwner.get(id)).filter((p): p is PinRef => !!p);
    if (pins.length === 0) continue;

    if (pins.length === 1) {
      const stubId = `stub:${stubCount++}`;
      stubNodes.push({ id: stubId, width: 1, height: 1 });
      const edgeId = `edge:${net.label}:0`;
      elkEdges.push({
        id: edgeId,
        sources: [`port:${pins[0].padId}`],
        targets: [stubId],
      });
      edgeLabels.set(edgeId, net.label);
    } else if (pins.length === 2) {
      const edgeId = `edge:${net.label}:0`;
      elkEdges.push({
        id: edgeId,
        sources: [`port:${pins[0].padId}`],
        targets: [`port:${pins[1].padId}`],
      });
      edgeLabels.set(edgeId, net.label);
    } else {
      const junctionId = `junction:${junctionCount++}`;
      junctionNodes.push({ id: junctionId, width: 1, height: 1 });
      pins.forEach((pin, i) => {
        const edgeId = `edge:${net.label}:${i}`;
        elkEdges.push({ id: edgeId, sources: [`port:${pin.padId}`], targets: [junctionId] });
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
    },
    children: [...elkNodes, ...junctionNodes, ...stubNodes],
    edges: elkEdges,
  };

  const elk = new ELK();
  const layout = await elk.layout(graph);

  return renderSvg(state, layout, edgeLabels, junctionNodes, stubNodes);
}

function renderSvg(
  state: BoardState,
  layout: ElkNode,
  edgeLabels: Map<string, string>,
  junctionNodes: ElkNode[],
  stubNodes: ElkNode[],
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
    if (stubIds.has(node.id)) continue; // synthetic endpoint only, not drawn

    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BG}" stroke="${STROKE}" stroke-width="1.5" rx="3" />`,
    );
    const title = componentTitle(state, node.id);
    parts.push(
      `<text x="${x + w / 2}" y="${y + h / 2}" fill="${TEXT}" font-size="12" text-anchor="middle" dominant-baseline="middle" font-weight="600">${escapeXml(title)}</text>`,
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
