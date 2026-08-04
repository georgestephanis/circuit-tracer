import type { SavedSession } from '../lib/persistence';

interface Props {
  session: SavedSession;
  /** True while the saved alignments are being re-applied to the uploaded photos. */
  busy: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}

function describe(s: SavedSession): string {
  const parts: string[] = [];
  if (s.traces.length) parts.push(`${s.traces.length} trace${s.traces.length === 1 ? '' : 's'}`);
  if (s.pads.length) parts.push(`${s.pads.length} pad${s.pads.length === 1 ? '' : 's'}`);
  if (s.vias.length) parts.push(`${s.vias.length} via${s.vias.length === 1 ? '' : 's'}`);
  const aligned = Object.keys(s.alignment);
  if (aligned.length) parts.push(`${aligned.join(' + ')} alignment`);
  return parts.length ? parts.join(', ') : 'board settings';
}

export function RestoreBanner({ session, busy, onRestore, onDismiss }: Props) {
  const when = new Date(session.savedAt);
  const stamp = Number.isNaN(when.getTime()) ? 'earlier' : when.toLocaleString();

  return (
    <div className="restore-banner">
      <span>
        Found saved work for these images{session.boardName ? ` — “${session.boardName}”` : ''}:{' '}
        {describe(session)} (saved {stamp}).
      </span>
      <div className="restore-banner-actions">
        <button type="button" onClick={onRestore} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button type="button" onClick={onDismiss} disabled={busy}>
          Start fresh
        </button>
      </div>
    </div>
  );
}
