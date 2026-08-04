import type { HoleKind, LengthUnit, Selection, Via } from '../types';
import { UNIT_LABELS } from '../lib/scale';
import { NumberField } from './NumberField';

interface Props {
  vias: Via[];
  /** Which kind this list is showing — only affects wording. */
  kind: HoleKind;
  selection: Selection | null;
  unit: LengthUnit;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onSetDiameter: (id: string, diameter: number) => void;
}

export function ViaList({ vias, kind, selection, unit, onSelect, onRename, onSetDiameter }: Props) {
  const noun = kind === 'hole' ? 'hole' : 'via';
  if (vias.length === 0) return <p className="list-empty">No {noun}s yet.</p>;
  return (
    <ul className="item-list">
      {vias.map((v) => {
        const linked = Boolean(v.front && v.back);
        return (
          <li
            key={v.id}
            className={selection?.kind === 'via' && selection.id === v.id ? 'selected' : ''}
          >
            <span
              className={`swatch via-swatch via-swatch--${v.kind} ${linked ? 'linked' : 'unlinked'}`}
            />
            <span className="item-id" onClick={() => onSelect(v.id)}>
              {v.id} {linked ? '(both sides)' : '(one side)'}
            </span>
            <input
              type="text"
              placeholder="label"
              value={v.label}
              onChange={(e) => onRename(v.id, e.target.value)}
            />
            <NumberField
              className="width-input"
              title={`Diameter in ${UNIT_LABELS[unit]} — or scroll the wheel over the ${noun}`}
              value={v.diameter}
              onCommit={(d) => d !== undefined && onSetDiameter(v.id, d)}
            />
          </li>
        );
      })}
    </ul>
  );
}
