"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { applyEditorChanges, type TextChange } from "@/lib/editor-text";

export default function Editor({ value, onChange, onSave, readOnly, dark, label, format = "markdown" }: {
  value: string; onChange: (value: string) => void; onSave: () => void; readOnly: boolean; dark: boolean; format?: "markdown" | "text"; label?: string;
}) {
  const original = useRef(value);
  useLayoutEffect(() => { original.current = value; }, [value]);
  const extensions = useMemo(() => [...(format === "markdown" ? [markdown()] : []), EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ "aria-label": label || (format === "markdown" ? "Anteckningens innehåll" : "CSV-filens innehåll"), spellcheck: format === "markdown" ? "true" : "false" }),
    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } }]),
    EditorView.theme({
      "&": { backgroundColor: "transparent", fontSize: "15px", height: "100%" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.85", overflow: "auto" },
      ".cm-content": { padding: "30px 34px 120px", minHeight: "100%", caretColor: "var(--accent)" },
      ".cm-gutters": { background: "transparent", color: "var(--muted)", border: "none" },
      ".cm-activeLine": { background: "transparent" },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--selection)" },
    }),
  ], [onSave, readOnly, format, label]);
  return <CodeMirror value={value.replace(/\r\n?/g, "\n")} readOnly={readOnly} editable={!readOnly} onChange={(_, update) => {
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => { changes.push({ from, to, insert: inserted.toString() }); });
    original.current = applyEditorChanges(original.current, changes);
    onChange(original.current);
  }} extensions={extensions} theme={dark ? "dark" : "light"}
    basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }} />;
}
