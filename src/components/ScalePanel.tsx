import type { FlipAxis, LengthUnit, PhysicalSize, RoundKind } from '../types';
import { ASSUMED_BOARD_WIDTH_MM, UNIT_LABELS, convertLength, formatLength } from '../lib/scale';
import { NumberField } from './NumberField';

const UNITS: LengthUnit[] = ['mm', 'mil', 'in'];

interface Props {
  unit: LengthUnit;
  boardSize: PhysicalSize | null;
  defaultTraceWidth: number;
  defaultViaDiameter: number;
  defaultHoleDiameter: number;
  defaultTestPointDiameter: number;
  backFlip: FlipAxis;
  onSetUnit: (unit: LengthUnit) => void;
  onSetBoardSize: (size: PhysicalSize | null) => void;
  onSetDefaultTraceWidth: (width: number) => void;
  onSetDefaultDiameter: (kind: RoundKind, diameter: number) => void;
  onSetBackFlip: (flip: FlipAxis) => void;
}

export function ScalePanel({
  unit,
  boardSize,
  defaultTraceWidth,
  defaultViaDiameter,
  defaultHoleDiameter,
  defaultTestPointDiameter,
  backFlip,
  onSetUnit,
  onSetBoardSize,
  onSetDefaultTraceWidth,
  onSetDefaultDiameter,
  onSetBackFlip,
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

      <label className="field">
        <span>Back photo taken by turning the board</span>
        <select value={backFlip} onChange={(e) => onSetBackFlip(e.target.value as FlipAxis)}>
          <option value="horizontal">Left-to-right (about the vertical axis)</option>
          <option value="vertical">End-over-end (about the horizontal axis)</option>
        </select>
      </label>

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
        <label className="field">
          <span>Test point ⌀</span>
          <NumberField
            value={defaultTestPointDiameter}
            onCommit={(v) => v !== undefined && onSetDefaultDiameter('testpoint', v)}
          />
        </label>
      </div>

      <p className="list-empty">
        {boardSize && boardSize.width > 0 && boardSize.height > 0
          ? `Widths and via sizes are drawn at true scale for a ${formatLength(boardSize.width, unit)} × ${formatLength(boardSize.height, unit)} ${UNIT_LABELS[unit]} board.`
          : `No board dimensions set — drawing as if the board were ${formatLength(assumed, unit)} ${UNIT_LABELS[unit]} wide. Enter the real size to scale accurately.`}
      </p>
      <p className="list-empty">
        These sizes are previewed at true scale under the cursor while the matching tool is
        active, so you can compare them against the board before placing anything.
      </p>
      <p className="list-empty">
        The flip setting decides where a via drilled on one side comes out on the other.
        Changing it moves every via already placed, so if the two sides don't line up, try the
        other option.
      </p>
    </div>
  );
}
