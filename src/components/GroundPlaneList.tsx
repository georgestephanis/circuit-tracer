import type { GroundPlane, Selection } from '../types';

interface Props {
  groundPlanes: GroundPlane[];
  selection: Selection | null;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

export function GroundPlaneList({ groundPlanes, selection, onSelect, onRename }: Props) {
  if (groundPlanes.length === 0) return <p className="list-empty">No ground planes yet.</p>;
  return (
    <ul className="item-list">
      {groundPlanes.map((plane) => (
        <li
          key={plane.id}
          id={`sel-groundplane-${plane.id}`}
          className={selection?.kind === 'groundplane' && selection.id === plane.id ? 'selected' : ''}
        >
          <span className="item-id" onClick={() => onSelect(plane.id)}>
            {plane.id} ({plane.side})
          </span>
          <input
            type="text"
            placeholder="label"
            value={plane.label}
            onChange={(e) => onRename(plane.id, e.target.value)}
          />
        </li>
      ))}
    </ul>
  );
}
