import { GROUND_COLOR, type LengthUnit, type Pad, type Selection } from '../types';
import { UNIT_LABELS, formatLength } from '../lib/scale';
import { NumberField } from './NumberField';

interface Props {
  pads: Pad[];
  selection: Selection | null;
  unit: LengthUnit;
  /** Image pixels per physical unit, per side, for showing pad dimensions. */
  scaleFor: (pad: Pad) => number;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onToggleGround: (id: string) => void;
  onSetDiameter: (id: string, diameter: number) => void;
}

export function PadList({
  pads,
  selection,
  unit,
  scaleFor,
  onSelect,
  onRename,
  onToggleGround,
  onSetDiameter,
}: Props) {
  if (pads.length === 0) return <p className="list-empty">No pads yet.</p>;
  return (
    <ul className="item-list">
      {pads.map((pad) => {
        const scale = scaleFor(pad);
        const connections = pad.connectsTrace.length + pad.connectsVia.length;
        const round = pad.shape === 'round';
        return (
          <li
            key={pad.id}
            id={`sel-pad-${pad.id}`}
            className={selection?.kind === 'pad' && selection.id === pad.id ? 'selected' : ''}
          >
            <span
              className={`swatch${round ? ' swatch--round' : ''}`}
              style={{ background: pad.ground ? GROUND_COLOR : pad.color }}
            />
            <span className="item-id" onClick={() => onSelect(pad.id)}>
              {pad.id} (
              {round
                ? `⌀ ${formatLength(pad.width / scale, unit)}`
                : `${formatLength(pad.width / scale, unit)} × ${formatLength(pad.height / scale, unit)}`}{' '}
              {UNIT_LABELS[unit]}
              {connections ? `, ${connections} linked` : ''})
            </span>
            <input
              type="text"
              placeholder="label"
              value={pad.label}
              onChange={(e) => onRename(pad.id, e.target.value)}
            />
            {/* Only round pads have a single dimension to type; rect pads are
                sized by where their corners were clicked. */}
            {round && (
              <NumberField
                className="width-input"
                title={`Diameter in ${UNIT_LABELS[unit]}`}
                value={pad.width / scale}
                onCommit={(d) => d !== undefined && onSetDiameter(pad.id, d)}
              />
            )}
            <label className="ground-toggle" title="Tie this pad to the ground net">
              <input
                type="checkbox"
                checked={Boolean(pad.ground)}
                onChange={() => onToggleGround(pad.id)}
              />
              GND
            </label>
          </li>
        );
      })}
    </ul>
  );
}
