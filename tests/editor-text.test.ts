import { describe, expect, it } from "vitest";
import { applyEditorChanges } from "@/lib/editor-text";
describe("Markdown source preservation", () => {
  it("preserves untouched mixed line endings, BOM and unknown syntax", () => {
    const text = "\ufeff---\r\nx: y\n---\r\n[[unknown^block]]";
    const normalized = text.replace(/\r\n?/g, "\n");
    expect(applyEditorChanges(text, [{ from: normalized.length, to: normalized.length, insert: "!" }])).toBe(text + "!");
  });
  it("uses the source newline convention for inserted lines", () => {
    expect(applyEditorChanges("a\r\nb", [{ from: 3, to: 3, insert: "\nc" }])).toBe("a\r\nb\r\nc");
  });
  it("deletes a normalized line break including both CRLF bytes", () => {
    expect(applyEditorChanges("a\r\nb", [{ from: 1, to: 2, insert: "" }])).toBe("ab");
  });
  it("applies multiple source-coordinate changes without shifting later offsets", () => {
    expect(applyEditorChanges("a\r\nb\r\nc", [{ from: 0, to: 1, insert: "AAA" }, { from: 4, to: 5, insert: "C" }])).toBe("AAA\r\nb\r\nC");
  });
});
