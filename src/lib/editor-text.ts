export type TextChange = { from: number; to: number; insert: string };
/** CodeMirror uses LF offsets. Preserve untouched source bytes, even with mixed line endings. */
export function applyEditorChanges(original: string, changes: TextChange[]): string {
  const crlf: number[] = [];
  for (const match of original.matchAll(/\r\n/g)) crlf.push(match.index - crlf.length);
  function rawOffset(offset: number) {
    let low = 0, high = crlf.length;
    while (low < high) { const mid = (low + high) >>> 1; if (crlf[mid] < offset) low = mid + 1; else high = mid; }
    return offset + low;
  }
  const separator = original.match(/\r\n|\r|\n/)?.[0] || "\n";
  const pieces: string[] = [];
  let cursor = 0;
  for (const change of changes) {
    const start = rawOffset(change.from), end = rawOffset(change.to);
    pieces.push(original.slice(cursor, start), change.insert.replace(/\n/g, separator)); cursor = end;
  }
  pieces.push(original.slice(cursor));
  return pieces.join("");
}
