import type { OverlapGroup } from '../lib/overlaps';

interface Props {
  group: OverlapGroup;
  index: number;
  total: number;
  onMerge: () => void;
  onSkip: () => void;
  onClose: () => void;
}

function describe(g: OverlapGroup): string {
  const parts: string[] = [];
  if (g.traceIds.length) parts.push(`${g.traceIds.length} trace${g.traceIds.length === 1 ? '' : 's'}`);
  if (g.padIds.length) parts.push(`${g.padIds.length} pad${g.padIds.length === 1 ? '' : 's'}`);
  if (g.viaIds.length) parts.push(`${g.viaIds.length} via/hole${g.viaIds.length === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export function OverlapBanner({ group, index, total, onMerge, onSkip, onClose }: Props) {
  return (
    <div className="restore-banner">
      <span>
        Overlap {index + 1} of {total}: {describe(group)} touch but aren’t wired into the same
        net — highlighted on the board.
      </span>
      <div className="restore-banner-actions">
        <button type="button" onClick={onMerge}>
          Merge into one net
        </button>
        <button type="button" onClick={onSkip}>
          Skip
        </button>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
