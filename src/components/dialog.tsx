"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({ title, onClose, children, wide = false, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? "dialog wide" : "dialog"} aria-label={title} onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" disabled={!dismissible} onClick={onClose} aria-label="Stäng"><X size={20} /></button></div>
    {children}
  </dialog>;
}
