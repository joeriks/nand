"use client";
import { useState } from "react";
import type { Draft } from "@/lib/types";
import { mergeText } from "@/lib/drafts";
import { Dialog } from "./dialog";
export function ConflictDialog({ draft, onResolve, onClose, location = "GitHub" }: { draft: Draft; onResolve: (text: string) => void; onClose: () => void; location?: string }) {
  const conflict = draft.conflict!;
  const merged = mergeText(conflict.base, draft.text, conflict.remote.text);
  const [text, setText] = useState(merged ?? draft.text);
  return <Dialog title="Två versioner behöver jämföras" onClose={onClose} wide>
    <p className="muted">{conflict.remote.sha === null ? `Filen saknas i ${location}. Du kan skapa den igen med ditt utkast.` : `Det finns en annan version i ${location}.`} Inget skrivs över automatiskt.</p>
    <div className="conflict-columns"><section><h3>Gemensam grund</h3><pre>{conflict.base || "(tom)"}</pre></section><section><h3>Ditt utkast</h3><pre>{draft.text || "(tomt)"}</pre></section><section><h3>Version i {location}</h3><pre>{conflict.remote.text || "(tom eller raderad)"}</pre></section></div>
    <p className="hint">{merged !== null ? "Ändringarna överlappar inte. Ett sammanslaget förslag finns nedan." : "Ändringarna överlappar. Redigera resultatet nedan eller välj en version."}</p>
    <div className="button-row"><button onClick={() => setText(draft.text)}>Använd mitt utkast</button><button onClick={() => setText(conflict.remote.text)}>{location === "GitHub" ? "Använd GitHub-versionen" : "Använd filversionen"}</button></div>
    <label>Resultat att granska<textarea className="merge-editor" value={text} onChange={event => setText(event.target.value)} rows={9} /></label>
    <div className="dialog-actions"><span className="hint">Det granskade resultatet köas för sparning till {location}.</span><button className="primary" onClick={() => onResolve(text)}>Använd resultatet</button></div>
  </Dialog>;
}
