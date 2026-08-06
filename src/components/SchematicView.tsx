import { useEffect, useState } from 'react';
import type { BoardState } from '../types';
import { renderSchematic, downloadSchematic } from '../lib/schematic';

interface Props {
  state: BoardState;
  onClose: () => void;
}

/**
 * A generated (not hand-drawn) schematic laid out from the board's netlist.
 * Follows AlignOverlay's `.modal-backdrop` convention. Owns its own layout
 * state — this is derived, throwaway view state, not board data, same rule
 * `overlayOpacity` follows.
 */
export function SchematicView({ state, onClose }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    renderSchematic(state)
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  function handleDownload() {
    downloadSchematic(state, state.boardName).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="schematic-view">
        <header className="schematic-view-header">
          <h2>Schematic</h2>
          <p className="align-hint">
            Auto-laid-out from the netlist — not a hand-drawn schematic. Pin sides are cosmetic
            only: pads carry no electrical direction, so left/right placement doesn't mean
            input/output.
          </p>
        </header>

        {error && <div className="export-error">{error}</div>}

        <div className="schematic-view-body">
          {!svg && !error && <p className="align-hint">Laying out…</p>}
          {svg && <div className="schematic-render" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>

        <footer className="align-overlay-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" disabled={!svg} onClick={handleDownload}>
            Download SVG
          </button>
        </footer>
      </div>
    </div>
  );
}
