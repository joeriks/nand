"use client";
import { FileText, Table2, Folder, ChevronRight, Image as ImageIcon } from "lucide-react";
type Node = { files: string[]; folders: Map<string, Node> };
export function FileTree({ paths, active, dirtyPaths, onOpen }: { paths: string[]; active?: string; dirtyPaths: Set<string>; onOpen: (path: string) => void }) {
  const root: Node = { files: [], folders: new Map() };
  for (const path of paths) {
    const parts = path.split("/"); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { files: [], folders: new Map() });
      node = node.folders.get(part)!;
    }
    node.files.push(path);
  }
  const render = (node: Node) => <>
    {[...node.folders].sort(([a], [b]) => a.localeCompare(b, "sv")).map(([name, child]) => <details key={name} open className="tree-folder"><summary><ChevronRight size={13} /><Folder size={16} />{name}</summary><div>{render(child)}</div></details>)}
    {node.files.map(path => <button key={path} className={`tree-file ${path === active ? "active" : ""}`} onClick={() => onOpen(path)} title={path} aria-current={path === active ? "page" : undefined}>
      {/\.csv$/i.test(path) ? <Table2 size={16} /> : /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ? <ImageIcon size={16} /> : <FileText size={16} />}<span>{path.split("/").pop()?.replace(/\.md$/i, "")}</span>{dirtyPaths.has(path) && <i className="draft-dot" aria-label="Osparat till GitHub" />}
    </button>)}
  </>;
  return <nav className="file-tree" aria-label="Filer">{render(root)}</nav>;
}
