import { GROUND_COLOR, type HoleKind, type LengthUnit, type Selection, type Via } from '../types';
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
  onToggleGround: (id: string) => void;
}

export function ViaList({
  vias,
  kind,
  selection,
  unit,
  onSelect,
  onRename,
  onSetDiameter,
  onToggleGround,
}: Props) {
  const noun = kind === 'hole' ? 'hole' : 'via';
  if (vias.length === 0) return <p className="list-empty">No {noun}s yet.</p>;
  return (
    <ul className="item-list">
      {vias.map((v) => {
        const linked = Boolean(v.front && v.back);
        return (
          <li
            key={v.id}
            id={`sel-via-${v.id}`}
            className={selection?.kind === 'via' && selection.id === v.id ? 'selected' : ''}
          >
            <span
              className={`swatch via-swatch via-swatch--${v.kind} ${linked ? 'linked' : 'unlinked'}`}
              style={v.ground ? { background: GROUND_COLOR, color: GROUND_COLOR } : undefined}
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
              title={`Diameter in ${UNIT_LABELS[unit]}`}
              value={v.diameter}
              onCommit={(d) => d !== undefined && onSetDiameter(v.id, d)}
            />
            <label className="ground-toggle" title={`Tie this ${noun} to the ground net`}>
              <input
                type="checkbox"
                checked={Boolean(v.ground)}
                onChange={() => onToggleGround(v.id)}
              />
              GND
            </label>
          </li>
        );
      })}
    </ul>
  );
}
