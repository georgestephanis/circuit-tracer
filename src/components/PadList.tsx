import type { LengthUnit, Pad, Selection } from '../types';
import { UNIT_LABELS, formatLength } from '../lib/scale';

interface Props {
  pads: Pad[];
  selection: Selection | null;
  unit: LengthUnit;
  /** Image pixels per physical unit, per side, for showing pad dimensions. */
  scaleFor: (pad: Pad) => number;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

export function PadList({ pads, selection, unit, scaleFor, onSelect, onRename }: Props) {
  if (pads.length === 0) return <p className="list-empty">No pads yet.</p>;
  return (
    <ul className="item-list">
      {pads.map((pad) => {
        const scale = scaleFor(pad);
        const connections = pad.connectsTrace.length + pad.connectsVia.length;
        return (
          <li
            key={pad.id}
            className={selection?.kind === 'pad' && selection.id === pad.id ? 'selected' : ''}
          >
            <span className="swatch" style={{ background: pad.color }} />
            <span className="item-id" onClick={() => onSelect(pad.id)}>
              {pad.id} ({formatLength(pad.width / scale, unit)} ×{' '}
              {formatLength(pad.height / scale, unit)} {UNIT_LABELS[unit]}
              {connections ? `, ${connections} linked` : ''})
            </span>
            <input
              type="text"
              placeholder="label"
              value={pad.label}
              onChange={(e) => onRename(pad.id, e.target.value)}
            />
          </li>
        );
      })}
    </ul>
  );
}
