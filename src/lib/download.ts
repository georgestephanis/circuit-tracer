/** Turn `boardName` into a filesystem-safe stem, falling back when it's blank. */
export function safeFileName(boardName: string): string {
  return boardName.trim() ? boardName.trim().replace(/[^a-z0-9-_]+/gi, '-') : 'circuit-board';
}

/**
 * Trigger a browser download of `content` as `filename`. Shared by every
 * export format so the blob/anchor/click dance only lives in one place.
 */
export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
