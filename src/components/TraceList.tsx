import type { LengthUnit, Selection, Trace } from '../types';
import { UNIT_LABELS } from '../lib/scale';
import { NumberField } from './NumberField';

interface Props {
  traces: Trace[];
  selection: Selection | null;
  unit: LengthUnit;
  defaultWidth: number;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onSetWidth: (id: string, width: number | undefined) => void;
}

export function TraceList({
  traces,
  selection,
  unit,
  defaultWidth,
  onSelect,
  onRename,
  onSetWidth,
}: Props) {
  if (traces.length === 0) return <p className="list-empty">No traces yet.</p>;
  return (
    <ul className="item-list">
      {traces.map((t) => (
        <li
          key={t.id}
          className={selection?.kind === 'trace' && selection.id === t.id ? 'selected' : ''}
        >
          <span className="swatch" style={{ background: t.color }} />
          <span className="item-id" onClick={() => onSelect(t.id)}>
            {t.id} ({t.side})
          </span>
          <input
            type="text"
            placeholder="label / net name"
            value={t.label}
            onChange={(e) => onRename(t.id, e.target.value)}
          />
          <NumberField
            className="width-input"
            allowEmpty
            title={`Width in ${UNIT_LABELS[unit]} — blank uses the default (${defaultWidth})`}
            placeholder={String(Number(defaultWidth.toFixed(4)))}
            value={t.width}
            onCommit={(v) => onSetWidth(t.id, v)}
          />
        </li>
      ))}
    </ul>
  );
}
