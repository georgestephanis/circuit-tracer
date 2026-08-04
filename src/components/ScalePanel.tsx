import type { HoleKind, LengthUnit, PhysicalSize } from '../types';
import { ASSUMED_BOARD_WIDTH_MM, UNIT_LABELS, convertLength, formatLength } from '../lib/scale';
import { NumberField } from './NumberField';

const UNITS: LengthUnit[] = ['mm', 'mil', 'in'];

interface Props {
  unit: LengthUnit;
  boardSize: PhysicalSize | null;
  defaultTraceWidth: number;
  defaultViaDiameter: number;
  defaultHoleDiameter: number;
  onSetUnit: (unit: LengthUnit) => void;
  onSetBoardSize: (size: PhysicalSize | null) => void;
  onSetDefaultTraceWidth: (width: number) => void;
  onSetDefaultDiameter: (kind: HoleKind, diameter: number) => void;
}

export function ScalePanel({
  unit,
  boardSize,
  defaultTraceWidth,
  defaultViaDiameter,
  defaultHoleDiameter,
  onSetUnit,
  onSetBoardSize,
  onSetDefaultTraceWidth,
  onSetDefaultDiameter,
}: Props) {
  function setDimension(which: 'width' | 'height', value: number | undefined) {
    const current = boardSize ?? { width: 0, height: 0 };
    const next = { ...current, [which]: value ?? 0 };
    onSetBoardSize(next.width > 0 || next.height > 0 ? next : null);
  }

  const assumed = convertLength(ASSUMED_BOARD_WIDTH_MM, 'mm', unit);

  return (
    <div className="scale-panel">
      <label className="field">
        <span>Units</span>
        <select value={unit} onChange={(e) => onSetUnit(e.target.value as LengthUnit)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Board width</span>
          <NumberField
            value={boardSize?.width}
            allowEmpty
            placeholder="—"
            onCommit={(v) => setDimension('width', v)}
          />
        </label>
        <label className="field">
          <span>Board height</span>
          <NumberField
            value={boardSize?.height}
            allowEmpty
            placeholder="—"
            onCommit={(v) => setDimension('height', v)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Default trace width</span>
          <NumberField
            value={defaultTraceWidth}
            onCommit={(v) => v !== undefined && onSetDefaultTraceWidth(v)}
          />
        </label>
        <label className="field">
          <span>Default via ⌀</span>
          <NumberField
            value={defaultViaDiameter}
            onCommit={(v) => v !== undefined && onSetDefaultDiameter('via', v)}
          />
        </label>
        <label className="field">
          <span>Default hole ⌀</span>
          <NumberField
            value={defaultHoleDiameter}
            onCommit={(v) => v !== undefined && onSetDefaultDiameter('hole', v)}
          />
        </label>
      </div>

      <p className="list-empty">
        {boardSize && boardSize.width > 0 && boardSize.height > 0
          ? `Widths and via sizes are drawn at true scale for a ${formatLength(boardSize.width, unit)} × ${formatLength(boardSize.height, unit)} ${UNIT_LABELS[unit]} board.`
          : `No board dimensions set — drawing as if the board were ${formatLength(assumed, unit)} ${UNIT_LABELS[unit]} wide. Enter the real size to scale accurately.`}
      </p>
      <p className="list-empty">
        Scroll the wheel over a via or hole to resize it, or over bare board in Via/Hole mode to
        change that tool's default.
      </p>
    </div>
  );
}
