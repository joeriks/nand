"use client";
import { useEffect, useState } from "react";
import { listWorkspaces } from "@/lib/drafts";
import type { CachedWorkspace, User } from "@/lib/types";
import type { OpenWorkspace } from "./workspace-picker";
export function OfflineWorkspaces({ user, onOpen }: { user: User; onOpen: (opened: OpenWorkspace) => void }) {
  const [items, setItems] = useState<CachedWorkspace[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    listWorkspaces(String(user.id)).then(items => { if (!disposed) setItems(items); }).catch(() => { if (!disposed) setError("Kunde inte läsa hämtade arbetsytor."); });
    return () => { disposed = true; };
  }, [user.id]);
  return <div className="cached-workspaces"><p>Lokala arbetsytor för @{user.login}. Du kan öppna dem även när inloggningen har gått ut.</p>{items.map(item => <button key={item.key} onClick={() => onOpen({ id: "", workspace: item.workspace, notes: item.notes })}>{item.workspace.repository.fullName} · {item.workspace.mode === "wiki" ? "Wiki" : `${item.workspace.branch}/${item.workspace.root}`} · {item.notes.length} anteckningar</button>)}{error && <p role="alert">{error}</p>}</div>;
}
