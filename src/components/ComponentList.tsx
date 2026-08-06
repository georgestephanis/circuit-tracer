import { useState } from 'react';
import type { Component } from '../types';

interface Props {
  components: Component[];
  selectedId: string | null;
  /** Pads shift-clicked on the canvas, waiting to be grouped. */
  padPick: string[];
  onSelect: (id: string) => void;
  onGroup: (label: string, refDes: string, notes: string) => void;
  onClearPick: () => void;
  onRename: (id: string, label: string) => void;
  onSetRefDes: (id: string, refDes: string) => void;
  onSetNotes: (id: string, notes: string) => void;
}

export function ComponentList({
  components,
  selectedId,
  padPick,
  onSelect,
  onGroup,
  onClearPick,
  onRename,
  onSetRefDes,
  onSetNotes,
}: Props) {
  const [label, setLabel] = useState('');
  const [refDes, setRefDes] = useState('');
  const [notes, setNotes] = useState('');

  if (padPick.length > 0) {
    return (
      <div className="scale-panel">
        <p className="list-empty">
          {padPick.length} pad{padPick.length === 1 ? '' : 's'} picked — shift-click more on the
          board, then group them.
        </p>
        <div className="field-row">
          <label className="field">
            Label
            <input
              type="text"
              placeholder="e.g. R1"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            Ref. designator
            <input
              type="text"
              placeholder="e.g. R1"
              value={refDes}
              onChange={(e) => setRefDes(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          Notes
          <input
            type="text"
            placeholder="part number, value, datasheet…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="field-row">
          <button
            type="button"
            disabled={padPick.length < 2}
            onClick={() => {
              onGroup(label, refDes, notes);
              setLabel('');
              setRefDes('');
              setNotes('');
            }}
          >
            Group
          </button>
          <button type="button" onClick={onClearPick}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  if (components.length === 0) {
    return <p className="list-empty">Shift-click 2+ pads on the board to group a component.</p>;
  }

  return (
    <ul className="item-list">
      {components.map((c) => (
        <li key={c.id} id={`sel-component-${c.id}`} className={selectedId === c.id ? 'selected' : ''}>
          <span className="item-id" onClick={() => onSelect(c.id)}>
            {c.id} ({c.padIds.length} pads)
          </span>
          <input
            type="text"
            placeholder="label"
            value={c.label}
            onChange={(e) => onRename(c.id, e.target.value)}
          />
          <input
            type="text"
            placeholder="ref. designator"
            value={c.refDes}
            onChange={(e) => onSetRefDes(c.id, e.target.value)}
          />
          <input
            type="text"
            placeholder="notes"
            value={c.notes}
            onChange={(e) => onSetNotes(c.id, e.target.value)}
          />
        </li>
      ))}
    </ul>
  );
}
