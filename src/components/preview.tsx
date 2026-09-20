"use client";
import { memo, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => href?.startsWith("https://") || href?.startsWith("http://") || href?.startsWith("mailto:")
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span className="unresolved-link" title="Interna länkar kommer i nästa etapp">{children}</span>,
    img: ({ alt }) => <span className="image-placeholder">Bild: {alt || "bilaga"} · bilagor kommer i en senare etapp</span>,
  }}>{text}</ReactMarkdown>;
});
export function Preview({ text }: { text: string }) {
  const deferredText = useDeferredValue(text);
  return <article className="markdown-preview" aria-label="Förhandsvisning"><Markdown text={deferredText} /></article>;
}
