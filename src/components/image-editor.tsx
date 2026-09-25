"use client";
import { useEffect, useRef, useState } from "react";
import { Crop, Download } from "lucide-react";

export default function ImageEditor({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly: boolean }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [format, setFormat] = useState("image/png");
  const [crop, setCrop] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const [busy, setBusy] = useState(false);
  const sourceFormat = value.match(/^data:([^;]+)/)?.[1] || "image/png";
  useEffect(() => { setFormat(sourceFormat === "image/jpg" ? "image/jpeg" : sourceFormat); }, [sourceFormat]);
  async function transform() {
    const image = imageRef.current; if (!image || readOnly) return;
    setBusy(true);
    try {
      await new Promise<void>((resolve, reject) => { if (image.complete) resolve(); else { image.onload = () => resolve(); image.onerror = () => reject(new Error("Bilden kunde inte öppnas.")); } });
      const canvas = document.createElement("canvas");
      const sx = Math.round(image.naturalWidth * crop.left / 100), sy = Math.round(image.naturalHeight * crop.top / 100);
      const sw = Math.max(1, Math.round(image.naturalWidth * crop.width / 100)), sh = Math.max(1, Math.round(image.naturalHeight * crop.height / 100));
      canvas.width = sw; canvas.height = sh; canvas.getContext("2d")!.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      onChange(canvas.toDataURL(format, format === "image/jpeg" ? .92 : undefined));
    } finally { setBusy(false); }
  }
  const field = (name: keyof typeof crop, label: string) => <label className="image-crop-field">{label}<input type="number" min={0} max={100} value={crop[name]} disabled={readOnly} onChange={event => setCrop(current => ({ ...current, [name]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} /></label>;
  return <section className="image-editor" aria-label="Bildredigerare">
    <div className="image-toolbar"><span>Bild</span><div className="image-crop-fields">{field("left", "Vänster %")}{field("top", "Överst %")}{field("width", "Bredd %")}{field("height", "Höjd %")}</div><label>Filformat<select value={format} disabled={readOnly} onChange={event => setFormat(event.target.value)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label><button onClick={() => void transform()} disabled={readOnly || busy}><Crop size={16} /> Beskär och spara</button></div>
    <div className="image-canvas"><img ref={imageRef} src={value} alt="Förhandsvisning av lokal bild" /></div>
    <p className="image-hint"><Download size={14} /> Beskärningen och formatbytet sparas till samma fil. För att byta filändelse, använd Exportera efteråt.</p>
  </section>;
}
