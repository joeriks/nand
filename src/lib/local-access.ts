import type { User } from "./types";

// This is local profile access, never evidence of GitHub authentication/authorization.
// A tombstone survives failed/offline logout so an old cookie cannot silently reopen data.
const KEY = "gitbsidian-local-access-v1";
type Access = { user: User | null; generation: string; blocked?: boolean };
export function localAccess(): Access | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!value || typeof value.generation !== "string") return null;
    if (value.user && (!Number.isSafeInteger(value.user.id) || typeof value.user.login !== "string")) return null;
    return value;
  } catch { return null; }
}
export function acceptAccount(user: User, explicit = false): boolean {
  const current = localAccess();
  if (current?.blocked && !explicit) return false;
  if (current?.user?.id === user.id) return true;
  localStorage.setItem(KEY, JSON.stringify({ user, generation: crypto.randomUUID() }));
  announce();
  return true;
}
export function revokeLocalAccess() {
  localStorage.setItem(KEY, JSON.stringify({ user: null, blocked: true, generation: crypto.randomUUID() }));
  announce();
}
function announce() {
  window.dispatchEvent(new Event("gitbsidian-access"));
  const channel = new BroadcastChannel("gitbsidian-account");
  channel.postMessage({ changed: true }); channel.close();
}
export function watchAccess(listener: () => void) {
  const channel = new BroadcastChannel("gitbsidian-account");
  channel.onmessage = listener;
  window.addEventListener("storage", listener);
  window.addEventListener("gitbsidian-access", listener);
  return () => { channel.close(); window.removeEventListener("storage", listener); window.removeEventListener("gitbsidian-access", listener); };
}
