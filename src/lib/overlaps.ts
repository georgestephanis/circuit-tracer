import type { BoardState, Side } from '../types';
import {
  circleTouchesPad,
  circlesOverlap,
  distanceToPolyline,
  padsOverlap,
  polylineDistance,
  polylineTouchesPad,
} from './geometry';
import { pxPerUnit } from './scale';

/** A cluster of items that touch on the board but aren't wired into one net yet. */
export interface OverlapGroup {
  traceIds: string[];
  padIds: string[];
  viaIds: string[];
}

/** Minimal union-find over string keys, used both for existing nets and for merge groups. */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const traceKey = (id: string) => `trace:${id}`;
const padKey = (id: string) => `pad:${id}`;
const viaKey = (id: string) => `via:${id}`;

/** The net each trace/pad/via already belongs to, from the connections recorded on them. */
function buildNetUnionFind(state: BoardState): UnionFind {
  const uf = new UnionFind();
  for (const t of state.traces) {
    uf.find(traceKey(t.id));
    for (const id of t.connectsPad) uf.union(traceKey(t.id), padKey(id));
    for (const id of t.connectsVia) uf.union(traceKey(t.id), viaKey(id));
  }
  for (const p of state.pads) {
    uf.find(padKey(p.id));
    for (const id of p.connectsTrace) uf.union(padKey(p.id), traceKey(id));
    for (const id of p.connectsVia) uf.union(padKey(p.id), viaKey(id));
  }
  for (const v of state.vias) uf.find(viaKey(v.id));
  return uf;
}

/** A via's on-screen radius in image pixels, for one side — matches BoardPanel's own sizing. */
function viaRadiusPx(diameter: number, scale: number): number {
  return Math.max(2, (diameter / 2) * scale);
}

/**
 * A trace's on-screen half-width in image pixels — matches BoardPanel's own
 * sizing. A trace is drawn as a stroked line, not an infinitely thin one, so
 * its copper reaches this far past its centerline on either side; two things
 * "touch" once they're within their combined half-widths of each other, not
 * only when their bare centerlines literally cross.
 */
function traceHalfWidthPx(width: number | undefined, defaultWidth: number, scale: number): number {
  return Math.max(1, (width ?? defaultWidth) * scale) / 2;
}

/**
 * Every cluster of traces/pads/vias whose copper touches without being wired
 * into the same net — candidates for merging into one shared shape.
 *
 * Two passes: first, the nets that already exist from recorded connections;
 * second, which of those nets geometrically touch each other. A cluster is
 * only reported when it spans more than one existing net — copper that
 * already belongs to one net overlapping itself isn't news.
 */
export function findOverlapGroups(state: BoardState): OverlapGroup[] {
  const netUf = buildNetUnionFind(state);
  const netOf = (key: string) => netUf.find(key);
  const mergeUf = new UnionFind();

  for (const side of ['front', 'back'] as Side[]) {
    const scale = pxPerUnit(state.images[side], state.boardSize, state.unit);
    const traces = state.traces.filter((t) => t.side === side);
    const pads = state.pads.filter((p) => p.side === side);
    const vias = state.vias.filter((v) => v[side]);

    for (let i = 0; i < traces.length; i++) {
      const halfI = traceHalfWidthPx(traces[i].width, state.defaultTraceWidth, scale);
      for (let j = i + 1; j < traces.length; j++) {
        const halfJ = traceHalfWidthPx(traces[j].width, state.defaultTraceWidth, scale);
        if (polylineDistance(traces[i].points, traces[j].points) <= halfI + halfJ) {
          mergeUf.union(netOf(traceKey(traces[i].id)), netOf(traceKey(traces[j].id)));
        }
      }
    }

    for (const t of traces) {
      const half = traceHalfWidthPx(t.width, state.defaultTraceWidth, scale);
      for (const p of pads) {
        if (polylineTouchesPad(t.points, p, half)) {
          mergeUf.union(netOf(traceKey(t.id)), netOf(padKey(p.id)));
        }
      }
    }

    for (const t of traces) {
      const half = traceHalfWidthPx(t.width, state.defaultTraceWidth, scale);
      for (const v of vias) {
        const center = v[side]!;
        if (distanceToPolyline(center, t.points) <= viaRadiusPx(v.diameter, scale) + half) {
          mergeUf.union(netOf(traceKey(t.id)), netOf(viaKey(v.id)));
        }
      }
    }

    for (let i = 0; i < pads.length; i++) {
      for (let j = i + 1; j < pads.length; j++) {
        if (padsOverlap(pads[i], pads[j])) {
          mergeUf.union(netOf(padKey(pads[i].id)), netOf(padKey(pads[j].id)));
        }
      }
    }

    for (const p of pads) {
      for (const v of vias) {
        const center = v[side]!;
        if (circleTouchesPad(p, center, viaRadiusPx(v.diameter, scale))) {
          mergeUf.union(netOf(padKey(p.id)), netOf(viaKey(v.id)));
        }
      }
    }

    for (let i = 0; i < vias.length; i++) {
      for (let j = i + 1; j < vias.length; j++) {
        const a = vias[i];
        const b = vias[j];
        if (
          circlesOverlap(
            a[side]!,
            viaRadiusPx(a.diameter, scale),
            b[side]!,
            viaRadiusPx(b.diameter, scale),
          )
        ) {
          mergeUf.union(netOf(viaKey(a.id)), netOf(viaKey(b.id)));
        }
      }
    }
  }

  // Group every net root by the merge-cluster it landed in, then keep only
  // clusters spanning more than one original net.
  const rootsByCluster = new Map<string, Set<string>>();
  const allNetRoots = new Set<string>();
  for (const t of state.traces) allNetRoots.add(netOf(traceKey(t.id)));
  for (const p of state.pads) allNetRoots.add(netOf(padKey(p.id)));
  for (const v of state.vias) allNetRoots.add(netOf(viaKey(v.id)));

  for (const root of allNetRoots) {
    const cluster = mergeUf.find(root);
    const set = rootsByCluster.get(cluster) ?? new Set<string>();
    set.add(root);
    rootsByCluster.set(cluster, set);
  }

  const groups: OverlapGroup[] = [];
  for (const roots of rootsByCluster.values()) {
    if (roots.size < 2) continue;
    groups.push({
      traceIds: state.traces.filter((t) => roots.has(netOf(traceKey(t.id)))).map((t) => t.id),
      padIds: state.pads.filter((p) => roots.has(netOf(padKey(p.id)))).map((p) => p.id),
      viaIds: state.vias.filter((v) => roots.has(netOf(viaKey(v.id)))).map((v) => v.id),
    });
  }
  return groups;
}
