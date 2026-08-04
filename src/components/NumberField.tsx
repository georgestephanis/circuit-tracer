import { useState } from 'react';

interface Props {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  /** Whether clearing the field is meaningful (e.g. "fall back to the default"). */
  allowEmpty?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
}

/**
 * A number input that keeps what you typed while you type it.
 *
 * Committing on every keystroke means an intermediate "0" (on the way to "0.5")
 * gets clamped and rewrites the field out from under you. This holds the raw
 * string as a draft, commits only values that are actually usable, and drops
 * the draft on blur so the field re-syncs with the real state.
 */
export function NumberField({
  value,
  onCommit,
  allowEmpty = false,
  placeholder,
  title,
  className,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const shown = draft ?? (value === undefined ? '' : String(Number(value.toFixed(4))));

  function handleChange(raw: string) {
    setDraft(raw);
    if (raw.trim() === '') {
      if (allowEmpty) onCommit(undefined);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed);
  }

  return (
    <input
      type="number"
      min={0}
      step="any"
      className={className}
      title={title}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => setDraft(null)}
    />
  );
}
