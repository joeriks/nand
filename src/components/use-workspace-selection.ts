"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { localAccess, watchAccess } from "@/lib/local-access";
import { recentWorkspace, rememberWorkspace } from "@/lib/cached-workspaces";
import type { User } from "@/lib/types";
import type { OpenWorkspace } from "./workspace-picker";

export function useWorkspaceSelection(fallback: "local" | null) {
  const [opened, setOpened] = useState<OpenWorkspace | "local" | null>(null);
  const [localUser, setLocalUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const revision = useRef(0);
  const generation = useRef<string | undefined>(undefined);
  const restore = useCallback(async () => {
    const ticket = ++revision.current;
    const access = localAccess();
    generation.current = access?.generation;
    const user = access?.user || null;
    setLocalUser(user); setOpened(null); setRestoreError(""); setRestoring(true);
    const current = () => ticket === revision.current && localAccess()?.generation === access?.generation;
    try {
      const preferLocal = localStorage.getItem("nand-last-collection-kind") === "local";
      const cached = user && !preferLocal ? await recentWorkspace(user) : null;
      if (current()) setOpened(preferLocal ? "local" : cached || fallback);
    } catch (error) {
      if (current()) setRestoreError(error instanceof Error ? error.message : "Den förra arbetsytan kunde inte öppnas. Dina utkast finns kvar.");
    } finally { if (current()) setRestoring(false); }
  }, [fallback]);
  useEffect(() => {
    let disposed = false;
    const guard = revision;
    const unwatch = watchAccess(() => {
      // Theme, note and selection storage events must not reset the active workspace.
      if (generation.current !== localAccess()?.generation) void restore();
    });
    queueMicrotask(() => { if (!disposed) void restore(); });
    return () => { disposed = true; guard.current++; unwatch(); };
  }, [restore]);
  const open = useCallback(async (result: OpenWorkspace) => {
    const access = localAccess();
    if (!access?.user) return;
    const ticket = ++revision.current;
    const allowed = () => ticket === revision.current && localAccess()?.generation === access.generation;
    await rememberWorkspace(access.user, result, allowed);
    if (!allowed()) return;
    localStorage.setItem("nand-last-collection-kind", "remote");
    setOpened(result); setRestoring(false); setRestoreError("");
  }, []);
  const show = useCallback((value: "local" | null) => {
    if (value === "local") localStorage.setItem("nand-last-collection-kind", "local");
    revision.current++; setOpened(value); setRestoring(false); setRestoreError("");
  }, []);
  return { opened, localUser, restoring, restoreError, restore, open, show };
}
