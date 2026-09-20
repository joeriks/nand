"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

export function ActionMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        event.preventDefault(); ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details className="action-menu" ref={ref}>
    <summary className="icon-button" aria-label="Fler alternativ" title="Fler alternativ"><Ellipsis size={21} /></summary>
    <div className="action-menu-panel" onClick={event => {
      if ((event.target as Element).closest("button:not(:disabled), a") && ref.current) {
        ref.current.open = false; ref.current.querySelector("summary")?.focus();
      }
    }}>{children}</div>
  </details>;
}
