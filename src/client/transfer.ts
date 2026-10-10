/**
 * Browser-side file helpers for export/import.
 *
 * Kept free of Node APIs (this module is bundled for the browser) and free of
 * HTTP details, so the panel decides where the text comes from.
 */

/** Trigger a download of a text file. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  // Must be in the document for the click to count in some browsers.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Read a chosen file as text.
 * @param file - the file from an `<input type="file">`.
 * @returns The file contents.
 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

