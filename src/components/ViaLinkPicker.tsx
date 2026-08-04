import type { Side, Via } from '../types';

interface Props {
  side: Side;
  vias: Via[];
  onChoose: (viaId: string | null) => void;
  onCancel: () => void;
}

export function ViaLinkPicker({ side, vias, onChoose, onCancel }: Props) {
  const otherSide: Side = side === 'front' ? 'back' : 'front';
  const candidates = vias.filter((v) => v[otherSide] && !v[side]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Place via on {side}</h3>
        <p>Create a new via, or link this hole to an existing via on the other side.</p>
        <button type="button" className="via-picker-new" onClick={() => onChoose(null)}>
          + New via
        </button>
        {candidates.length > 0 && (
          <>
            <div className="via-picker-divider">or link to existing</div>
            <ul className="via-picker-list">
              {candidates.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => onChoose(v.id)}>
                    {v.id}
                    {v.label ? ` — ${v.label}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="via-picker-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
