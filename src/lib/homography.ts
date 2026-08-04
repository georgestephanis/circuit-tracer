import type { Point } from '../types';

/**
 * Solve a dense linear system A·x = b by Gaussian elimination with partial
 * pivoting. `a` is n×n (row-major), `b` is length n. Returns null if singular.
 */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on copies so callers keep their inputs.
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }
    const pv = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  return m.map((row) => row[n]);
}

/**
 * Compute the 3x3 homography (row-major, 9 numbers, h22 fixed at 1) mapping the
 * four `src` points to the four `dst` points, via the standard 4-point DLT.
 * Point order must correspond between the two arrays.
 */
export function computeHomography(src: Point[], dst: Point[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;

  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solve(a, b);
  if (!h) return null;
  return [...h, 1];
}

/** Apply a 3x3 row-major homography to a point. */
function applyHomography(h: number[], x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

function edgeLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Derive a sensible axis-aligned output size for a clicked quad: width is the
 * average of the top and bottom edges, height the average of the left and
 * right edges. `corners` is clockwise from top-left.
 */
export function quadOutputSize(corners: Point[]): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  const width = Math.round((edgeLength(tl, tr) + edgeLength(bl, br)) / 2);
  const height = Math.round((edgeLength(tl, bl) + edgeLength(tr, br)) / 2);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Perspective-correct `image` so that the quad given by `corners` (clockwise
 * from top-left, in the image's natural pixel space) fills an
 * `outWidth`×`outHeight` rectangle. Returns a PNG data URL.
 *
 * Implemented as an inverse-mapped, bilinearly-sampled warp on a 2D canvas —
 * no WebGL, no external dependency.
 */
export function warpPerspective(
  image: HTMLImageElement,
  corners: Point[],
  outWidth: number,
  outHeight: number,
): string {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = image.naturalWidth;
  srcCanvas.height = image.naturalHeight;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) throw new Error('Could not get a 2D canvas context for the source image.');
  srcCtx.drawImage(image, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];
  // Inverse mapping: for each destination pixel, find where it came from.
  const h = computeHomography(dst, corners);
  if (!h) throw new Error('Those corner points are degenerate — try picking them again.');

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Could not get a 2D canvas context for the output image.');
  const outData = outCtx.createImageData(outWidth, outHeight);

  const sw = srcData.width;
  const sh = srcData.height;
  const sp = srcData.data;
  const op = outData.data;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const s = applyHomography(h, x + 0.5, y + 0.5);
      const o = (y * outWidth + x) * 4;

      const fx = s.x - 0.5;
      const fy = s.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);

      if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) {
        // Outside the source image — leave transparent.
        op[o + 3] = 0;
        continue;
      }

      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;

      for (let c = 0; c < 4; c++) {
        op[o + c] = sp[i00 + c] * w00 + sp[i10 + c] * w10 + sp[i01 + c] * w01 + sp[i11 + c] * w11;
      }
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas.toDataURL('image/png');
}

/** Load a data URL / URL into an `HTMLImageElement`. */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image for alignment.'));
    img.src = src;
  });
}
