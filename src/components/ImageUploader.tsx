import { useRef, type ChangeEvent, type DragEvent } from 'react';
import type { RawImage, Side } from '../types';

interface Props {
  side: Side;
  onLoad: (side: Side, image: RawImage) => void;
}

function readImageFile(file: File): Promise<RawImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

// Always renders the "nothing uploaded yet" state: BoardPanel only mounts this
// before a side has its first shot, and VisibilityPanel's "add a shot" flow is
// inherently a fresh upload too — neither wants a "replace" mode.
export function ImageUploader({ side, onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const raw = await readImageFile(file);
    onLoad(side, raw);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    void handleFile(e.target.files?.[0]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    void handleFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div
      className="uploader"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <p>Drop or click to upload the {side} image</p>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
    </div>
  );
}
