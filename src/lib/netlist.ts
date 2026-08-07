import type { BoardState, ComponentType } from '../types';
import { downloadFile, safeFileName } from './download';

/** One electrically-connected group of pads/vias, with the name it should export under. */
export interface Net {
  label: string;
  padIds: string[];
  viaIds: string[];
}

/** One row of a netlist: which pin of which component lands on which net. */
export interface NetlistRow {
  component: string;
  pin: string;
  net: string;
  /** The pin's assigned role (e.g. "Anode"), if the component set one. */
  role?: string;
}

/** BOM-ish summary of one Component, alongside the netlist rows. */
export interface NetlistComponent {
  id: string;
  label: string;
  refDes: string;
  componentType: ComponentType;
  value: string;
  notes: string;
}

// Union-find over "pad:<id>" / "via:<id>" keys, so pads and vias share one
// structure without their ids needing to be distinguishable on their own.
class UnionFind {
  private parent = new Map<string, string>();

  private find(key: string): string {
    let root = this.parent.get(key) ?? key;
    if (root !== key) {
      root = this.find(root);
      this.parent.set(key, root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  groupOf(key: string): string {
    return this.find(key);
  }
}

/**
 * Every electrical net on the board, derived from trace/via connectivity plus
 * the ground flag — mirrors how the app already treats ground as one implicit
 * net (see `GROUND_COLOR`) rather than a set of pairwise connections.
 */
export function computeNets(state: BoardState): Net[] {
  const uf = new UnionFind();
  const padKey = (id: string) => `pad:${id}`;
  const viaKey = (id: string) => `via:${id}`;

  // A trace is one wire: everything it touches is one net.
  for (const t of state.traces) {
    const members = [...t.connectsPad.map(padKey), ...t.connectsVia.map(viaKey)];
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }
  // A pad directly covering a via ties the two together even with no trace.
  for (const p of state.pads) {
    for (const viaId of p.connectsVia) uf.union(padKey(p.id), viaKey(viaId));
  }
  // Ground is one net regardless of the above — every grounded pad/via is tied
  // together implicitly, the same rule the canvas already draws them by.
  const groundKeys = [
    ...state.pads.filter((p) => p.ground).map((p) => padKey(p.id)),
    ...state.vias.filter((v) => v.ground).map((v) => viaKey(v.id)),
  ];
  for (let i = 1; i < groundKeys.length; i++) uf.union(groundKeys[0], groundKeys[i]);

  const groups = new Map<string, { padIds: string[]; viaIds: string[] }>();
  for (const p of state.pads) {
    const root = uf.groupOf(padKey(p.id));
    if (!groups.has(root)) groups.set(root, { padIds: [], viaIds: [] });
    groups.get(root)!.padIds.push(p.id);
  }
  for (const v of state.vias) {
    const root = uf.groupOf(viaKey(v.id));
    if (!groups.has(root)) groups.set(root, { padIds: [], viaIds: [] });
    groups.get(root)!.viaIds.push(v.id);
  }

  let anon = 0;
  return Array.from(groups.values()).map((g) => {
    const grounded =
      g.padIds.some((id) => state.pads.find((p) => p.id === id)?.ground) ||
      g.viaIds.some((id) => state.vias.find((v) => v.id === id)?.ground);
    const traceLabel = state.traces.find(
      (t) =>
        t.label.trim() &&
        (t.connectsPad.some((id) => g.padIds.includes(id)) ||
          t.connectsVia.some((id) => g.viaIds.includes(id))),
    )?.label;
    const label = grounded ? 'GND' : traceLabel || `NET${++anon}`;
    return { label, padIds: g.padIds, viaIds: g.viaIds };
  });
}

/** Every pad/via id in `nets`, mapped to the net label it belongs to. */
export function netLabelsByMember(nets: Net[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const net of nets) {
    for (const padId of net.padIds) map.set(padId, net.label);
    for (const viaId of net.viaIds) map.set(viaId, net.label);
  }
  return map;
}

/**
 * Component → pin → net, for every pad or via/hole grouped into a Component.
 * Ungrouped pads/vias have no "pin" identity in this model, so they aren't
 * rows here.
 */
export function buildNetlist(state: BoardState): NetlistRow[] {
  const nets = computeNets(state);
  const netForMember = netLabelsByMember(nets);

  const rows: NetlistRow[] = [];
  for (const c of state.components) {
    const name = c.refDes || c.label || c.id;
    for (const memberId of [...c.padIds, ...c.viaIds]) {
      const role = c.roles[memberId];
      rows.push({
        component: name,
        pin: memberId,
        net: netForMember.get(memberId) ?? 'NC',
        ...(role ? { role } : {}),
      });
    }
  }
  return rows;
}

/** One BOM-ish row per Component — the type/value/notes a netlist row alone can't carry. */
export function buildComponentSummary(state: BoardState): NetlistComponent[] {
  return state.components.map((c) => ({
    id: c.id,
    label: c.label,
    refDes: c.refDes,
    componentType: c.componentType,
    value: c.value,
    notes: c.notes,
  }));
}

export function downloadNetlist(state: BoardState, boardName: string): void {
  const rows = buildNetlist(state);
  const components = buildComponentSummary(state);
  const json = JSON.stringify(
    { boardName, generated: new Date().toISOString(), components, rows },
    null,
    2,
  );
  downloadFile(json, `${safeFileName(boardName)}.netlist.json`, 'application/json');
}
