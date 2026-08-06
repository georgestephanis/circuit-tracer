import { useState } from 'react';
import type { RawImage, Side, SidePhotos } from '../types';
import { ImageUploader } from './ImageUploader';

export interface LayerVisibility {
  pads: boolean;
  traces: boolean;
  vias: boolean;
  components: boolean;
}

interface Props {
  images: Record<Side, SidePhotos | null>;
  showBackground: Record<Side, boolean>;
  onSetShowBackground: (side: Side, visible: boolean) => void;
  layerVisibility: LayerVisibility;
  onSetLayerVisibility: (layer: keyof LayerVisibility, visible: boolean) => void;
  onSetActiveShot: (side: Side, shotId: string) => void;
  onDeleteShot: (side: Side, shotId: string) => void;
  onAlignShot: (side: Side, shotId: string) => void;
  onAddShot: (side: Side, raw: RawImage) => void;
}

const SIDES: Side[] = ['front', 'back'];
const LAYERS: { key: keyof LayerVisibility; label: string }[] = [
  { key: 'pads', label: 'Pads' },
  { key: 'traces', label: 'Traces' },
  { key: 'vias', label: 'Vias' },
  { key: 'components', label: 'Components' },
];

/**
 * Header popover for view controls that never touch board state: which
 * photo is showing per side, which SVG layers are drawn, and each side's
 * collection of shots (upload/activate/re-align/delete). Presentational
 * only — every change is reported upward, nothing is dispatched here.
 */
export function VisibilityPanel({
  images,
  showBackground,
  onSetShowBackground,
  layerVisibility,
  onSetLayerVisibility,
  onSetActiveShot,
  onDeleteShot,
  onAlignShot,
  onAddShot,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="visibility-panel-wrap">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Visibility ▾
      </button>
      {open && (
        <div className="visibility-panel">
          <section>
            <h4>Photos</h4>
            {SIDES.map((side) => (
              <label key={side} className="visibility-panel-row">
                <input
                  type="checkbox"
                  checked={showBackground[side]}
                  onChange={(e) => onSetShowBackground(side, e.target.checked)}
                />
                Show {side} photo
              </label>
            ))}
          </section>

          <section>
            <h4>Layers</h4>
            {LAYERS.map(({ key, label }) => (
              <label key={key} className="visibility-panel-row">
                <input
                  type="checkbox"
                  checked={layerVisibility[key]}
                  onChange={(e) => onSetLayerVisibility(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </section>

          {SIDES.map((side) => {
            const photos = images[side];
            return (
              <section key={side}>
                <h4>{side[0].toUpperCase() + side.slice(1)} shots</h4>
                {photos && Object.keys(photos.shots).length > 0 ? (
                  <ul className="visibility-panel-shots">
                    {Object.values(photos.shots).map((shot) => (
                      <li key={shot.id} className="visibility-panel-row">
                        <span className={shot.id === photos.activeShotId ? 'shot-active' : ''}>
                          {shot.name}
                          {shot.id === photos.activeShotId ? ' (active)' : ''}
                        </span>
                        <button
                          type="button"
                          disabled={shot.id === photos.activeShotId}
                          onClick={() => onSetActiveShot(side, shot.id)}
                        >
                          Use
                        </button>
                        <button type="button" onClick={() => onAlignShot(side, shot.id)}>
                          Align
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete the "${shot.name}" shot of the ${side}?`)) {
                              onDeleteShot(side, shot.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="visibility-panel-empty">No shots uploaded yet.</p>
                )}
                <ImageUploader side={side} onLoad={onAddShot} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
