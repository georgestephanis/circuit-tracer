import { useState } from 'react';
import type { Component, ComponentType, Pad, Via } from '../types';
import { COMPONENT_TYPES, COMPONENT_TYPE_LABELS, VALUED_COMPONENT_TYPES } from '../types';

interface Props {
  components: Component[];
  pads: Pad[];
  vias: Via[];
  selectedId: string | null;
  /** Pads shift-clicked on the canvas, waiting to be grouped. */
  padPick: string[];
  /** Vias/holes shift-clicked on the canvas, waiting to be grouped. */
  viaPick: string[];
  onSelect: (id: string) => void;
  onGroup: (
    label: string,
    refDes: string,
    notes: string,
    componentType: ComponentType,
    value: string,
  ) => void;
  onClearPick: () => void;
  onRename: (id: string, label: string) => void;
  onSetRefDes: (id: string, refDes: string) => void;
  onSetNotes: (id: string, notes: string) => void;
  onSetType: (id: string, componentType: ComponentType) => void;
  onSetValue: (id: string, value: string) => void;
  onSetRole: (id: string, memberId: string, role: string) => void;
}

export function ComponentList({
  components,
  pads,
  vias,
  selectedId,
  padPick,
  viaPick,
  onSelect,
  onGroup,
  onClearPick,
  onRename,
  onSetRefDes,
  onSetNotes,
  onSetType,
  onSetValue,
  onSetRole,
}: Props) {
  const [label, setLabel] = useState('');
  const [refDes, setRefDes] = useState('');
  const [notes, setNotes] = useState('');
  const [componentType, setComponentType] = useState<ComponentType>('other');
  const [value, setValue] = useState('');

  const pickCount = padPick.length + viaPick.length;

  if (pickCount > 0) {
    return (
      <div className="scale-panel">
        <p className="list-empty">
          {pickCount} member{pickCount === 1 ? '' : 's'} picked ({padPick.length} pad
          {padPick.length === 1 ? '' : 's'}, {viaPick.length} via/hole
          {viaPick.length === 1 ? '' : 's'}) — shift-click more on the board, then group them.
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
        <div className="field-row">
          <label className="field">
            Type
            <select
              value={componentType}
              onChange={(e) => setComponentType(e.target.value as ComponentType)}
            >
              {COMPONENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPONENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {VALUED_COMPONENT_TYPES.has(componentType) && (
            <label className="field">
              Value
              <input
                type="text"
                placeholder="e.g. 10kΩ"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          )}
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
            disabled={pickCount < 2}
            onClick={() => {
              onGroup(label, refDes, notes, componentType, value);
              setLabel('');
              setRefDes('');
              setNotes('');
              setComponentType('other');
              setValue('');
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
    return (
      <p className="list-empty">Shift-click 2+ pads or vias/holes on the board to group a component.</p>
    );
  }

  return (
    <ul className="item-list">
      {components.map((c) => {
        const memberIds = [...c.padIds, ...c.viaIds];
        return (
          <li key={c.id} id={`sel-component-${c.id}`} className={selectedId === c.id ? 'selected' : ''}>
            <span className="item-id" onClick={() => onSelect(c.id)}>
              {c.id} ({c.padIds.length} pad{c.padIds.length === 1 ? '' : 's'}
              {c.viaIds.length > 0
                ? `, ${c.viaIds.length} via/hole${c.viaIds.length === 1 ? '' : 's'}`
                : ''}
              )
            </span>
            <div className="field-row">
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
            </div>
            <div className="field-row">
              <select
                value={c.componentType}
                onChange={(e) => onSetType(c.id, e.target.value as ComponentType)}
              >
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPONENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {VALUED_COMPONENT_TYPES.has(c.componentType) && (
                <input
                  type="text"
                  placeholder="value, e.g. 10kΩ"
                  value={c.value}
                  onChange={(e) => onSetValue(c.id, e.target.value)}
                />
              )}
            </div>
            <input
              type="text"
              placeholder="notes"
              value={c.notes}
              onChange={(e) => onSetNotes(c.id, e.target.value)}
            />
            {memberIds.length > 0 && (
              <div className="field-row component-roles">
                {memberIds.map((mid) => {
                  const pad = pads.find((p) => p.id === mid);
                  const via = vias.find((v) => v.id === mid);
                  const memberLabel = pad?.label || via?.label || mid;
                  return (
                    <label key={mid} className="field">
                      {memberLabel}
                      <input
                        type="text"
                        placeholder="role, e.g. Anode"
                        value={c.roles[mid] ?? ''}
                        onChange={(e) => onSetRole(c.id, mid, e.target.value)}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
