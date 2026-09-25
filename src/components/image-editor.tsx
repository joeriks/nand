"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Undo2 } from "lucide-react";
import "./image-editor.css";

type Format = "image/png" | "image/jpeg" | "image/webp";
type Rect = { x: number; y: number; width: number; height: number };
type Stage = { url: string; width: number; height: number };
const FULL: Rect = { x: 0, y: 0, width: 1, height: 1 };
const MAX_PIXELS = 40_000_000;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const formatName = (format: Format) => format === "image/jpeg" ? "JPEG" : format === "image/webp" ? "WebP" : "PNG";

export default function ImageEditor({ value, fileName, onChange, onExport, readOnly }: {
  value: string; fileName: string; onChange: (value: string) => void; onExport: (dataUrl: string) => Promise<boolean>; readOnly: boolean;
}) {
  const sourceFormat = value.match(/^data:(image\/[a-z]+);base64,/)?.[1] || "";
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "draw" | "move"; x: number; y: number; rect: Rect } | null>(null);
  const history = useRef<string[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [stage, setStage] = useState<Stage | null>(null);
  const [rect, setRect] = useState<Rect>(FULL);
  const [aspect, setAspect] = useState("free");
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [format, setFormat] = useState<Format>(() => sourceFormat === "image/jpeg" || sourceFormat === "image/webp" ? sourceFormat : "image/png");
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(100);
  const [drawing, setDrawing] = useState(false);
  const [result, setResult] = useState<{ data: string; version: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const originalFormat: Format | null = /\.jpe?g$/i.test(fileName) ? "image/jpeg" : /\.webp$/i.test(fileName) ? "image/webp" : /\.png$/i.test(fileName) ? "image/png" : null;
  const pixelRect = stage && {
    x: Math.floor(rect.x * stage.width), y: Math.floor(rect.y * stage.height),
    width: Math.max(1, Math.round(rect.width * stage.width)), height: Math.max(1, Math.round(rect.height * stage.height)),
  };
  const output = pixelRect && { width: Math.max(1, Math.round(pixelRect.width * scale / 100)), height: Math.max(1, Math.round(pixelRect.height * scale / 100)) };
  const changed = rect.x > 0 || rect.y > 0 || rect.width < 1 || rect.height < 1 || rotation !== 0 || flipH || flipV || scale !== 100 || (format !== "image/png" && quality !== 90);
  const canRender = !!stage && !!pixelRect && !!output && output.width * output.height <= MAX_PIXELS;
  const previewVersion = JSON.stringify([rect, rotation, flipH, flipV, format, quality, scale]);
  const preview = result?.version === previewVersion && result.source === value ? result.data : null;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_PIXELS) { setError("Bilden är för stor för redigering (högst 40 miljoner pixlar)."); return; }
      const sideways = rotation % 180 !== 0;
      const canvas = document.createElement("canvas");
      canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
      canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) { setError("Bildredigering stöds inte på den här datorn."); return; }
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
      canvas.toBlob(blob => {
        if (cancelled || !blob) return;
        setStage({ url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
      }, "image/png");
    };
    image.onerror = () => { if (!cancelled) setError("Bilden kunde inte avkodas."); };
    image.src = value;
    return () => { cancelled = true; image.src = ""; };
  }, [value, rotation, flipH, flipV]);
  useEffect(() => () => { if (stage) URL.revokeObjectURL(stage.url); }, [stage]);

  function resetCrop() { setRect(FULL); setScale(100); setDrawing(false); }
  function changeAspect(next: string) {
    setAspect(next);
    if (!stage || next === "free") return;
    const ratio = next === "original" ? stage.width / stage.height : next === "square" ? 1 : next === "4:3" ? 4 / 3 : 16 / 9;
    const width = Math.min(1, ratio * stage.height / stage.width);
    const height = Math.min(1, stage.width / (ratio * stage.height));
    setRect({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
  }
  function selection(anchor: { x: number; y: number }, point: { x: number; y: number }): Rect {
    if (!stage) return FULL;
    let x = Math.min(anchor.x, point.x), y = Math.min(anchor.y, point.y);
    let width = Math.max(1 / stage.width, Math.abs(point.x - anchor.x));
    let height = Math.max(1 / stage.height, Math.abs(point.y - anchor.y));
    if (aspect !== "free") {
      const ratio = aspect === "original" ? stage.width / stage.height : aspect === "square" ? 1 : aspect === "4:3" ? 4 / 3 : 16 / 9;
      height = width * stage.width / (ratio * stage.height);
      if (height > 1 - y) { height = 1 - y; width = height * ratio * stage.height / stage.width; }
    }
    x = clamp(x, 0, 1 - width); y = clamp(y, 0, 1 - height);
    return { x, y, width, height };
  }
  function pointerPoint(event: PointerEvent<HTMLDivElement>) {
    const bounds = frame.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!stage || readOnly || preview) return;
    const position = pointerPoint(event);
    drag.current = { mode: drawing || (event.target as HTMLElement).dataset.handle !== "move" ? "draw" : "move", ...position, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (drag.current.mode === "draw") setRect(selection(position, position));
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const position = pointerPoint(event), start = drag.current;
    if (start.mode === "draw") setRect(selection(start, position));
    else setRect({ ...start.rect, x: clamp(start.rect.x + position.x - start.x, 0, 1 - start.rect.width), y: clamp(start.rect.y + position.y - start.y, 0, 1 - start.rect.height) });
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) { drag.current = null; setDrawing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  async function renderOutput(): Promise<string> {
    if (!stage || !pixelRect || !output || !canRender) throw new Error("Kontrollera bildens storlek och beskärning.");
    const image = new Image(); image.src = stage.url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = output.width; canvas.height = output.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Bilden kunde inte redigeras.");
    if (format === "image/jpeg") { context.fillStyle = "white"; context.fillRect(0, 0, output.width, output.height); }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height, 0, 0, output.width, output.height);
    const data = canvas.toDataURL(format, quality / 100);
    if (!data.startsWith(`data:${format};base64,`)) throw new Error(`${formatName(format)} kunde inte skapas på den här datorn.`);
    if (Math.ceil((data.length - data.indexOf(",") - 1) * 3 / 4) > 16 * 1024 * 1024) throw new Error("Resultatet är större än 16 MiB. Minska storleken eller kvaliteten.");
    return data;
  }
  async function run(action: "preview" | "save" | "export") {
    if (busy || !canRender) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await renderOutput();
      if (action === "preview") setResult({ data, version: previewVersion, source: value });
      else if (action === "export") { if (await onExport(data)) setNotice(`Bilden exporterades som ${formatName(format)}.`); }
      else {
        if (format !== originalFormat) throw new Error("Välj originalformatet eller använd Spara som.");
        history.current.push(value); setHistoryCount(history.current.length); onChange(data);
        setRotation(0); setFlipH(false); setFlipV(false); resetCrop();
        setNotice("Ändringen sparas till originalfilen.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bilden kunde inte sparas."); }
    finally { setBusy(false); }
  }
  function undo() {
    const previous = history.current.pop(); if (!previous || readOnly) return;
    setHistoryCount(history.current.length);
    onChange(previous); setRotation(0); setFlipH(false); setFlipV(false); resetCrop();
    setNotice("Föregående bildversion återställdes.");
  }
  return <section className="image-editor" aria-label="Bildredigerare">
    <div className="image-editor-actions"><strong>Bildredigering</strong><span>{stage ? `${stage.width} × ${stage.height} px` : "Läser bilden…"}</span>
      <button type="button" onClick={() => setDrawing(true)} disabled={readOnly || busy}><Crop size={16} /> Markera utsnitt</button>
      <button type="button" onClick={resetCrop} disabled={readOnly || busy}>Hela bilden</button>
      <button type="button" onClick={undo} disabled={readOnly || busy || !historyCount}><Undo2 size={16} /> Ångra</button>
    </div>
    <div className="image-workspace"><div className="image-canvas">
      {stage && <div ref={frame} className={`image-stage ${drawing ? "drawing" : ""}`} style={{ width: preview ? output?.width : stage.width, aspectRatio: preview ? `${output?.width} / ${output?.height}` : `${stage.width} / ${stage.height}` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        {/* Native image dimensions are needed for accurate crop coordinates. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview || stage.url} alt={preview ? "Förhandsvisning av resultatet" : "Bild med beskärningsram"} draggable={false} />
        {!preview && <div className="image-selection" data-handle="move" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} tabIndex={readOnly ? -1 : 0} role="group" aria-label="Beskärningsram. Piltangenter flyttar ramen." onKeyDown={event => {
          if (readOnly) return;
          const stepX = (event.shiftKey ? 10 : 1) / stage.width, stepY = (event.shiftKey ? 10 : 1) / stage.height;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); setRect(current => ({ ...current, x: clamp(current.x + (event.key === "ArrowLeft" ? -stepX : event.key === "ArrowRight" ? stepX : 0), 0, 1 - current.width), y: clamp(current.y + (event.key === "ArrowUp" ? -stepY : event.key === "ArrowDown" ? stepY : 0), 0, 1 - current.height) })); }
        }}><span className="image-grid" /></div>}
      </div>}
    </div><aside className="image-controls">
      <fieldset disabled={readOnly || busy}><legend>Beskärning</legend><label>Bildförhållande<select value={aspect} onChange={event => changeAspect(event.target.value)}><option value="free">Fritt</option><option value="original">Original</option><option value="square">1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option></select></label>
        <p className="hint">Dra på bilden för att markera. Dra inom ramen för att flytta den.</p>
        <div className="image-control-grid"><label>X px<input type="number" min={0} max={stage?.width || 0} value={pixelRect?.x ?? 0} onChange={event => setRect(current => ({ ...current, x: clamp(Number(event.target.value) / (stage?.width || 1), 0, 1 - current.width) }))} /></label><label>Y px<input type="number" min={0} max={stage?.height || 0} value={pixelRect?.y ?? 0} onChange={event => setRect(current => ({ ...current, y: clamp(Number(event.target.value) / (stage?.height || 1), 0, 1 - current.height) }))} /></label><label>Bredd px<input type="number" min={1} max={stage?.width || 1} value={pixelRect?.width ?? 1} onChange={event => setRect(current => ({ ...current, width: clamp(Number(event.target.value) / (stage?.width || 1), 1 / (stage?.width || 1), 1 - current.x) }))} /></label><label>Höjd px<input type="number" min={1} max={stage?.height || 1} value={pixelRect?.height ?? 1} onChange={event => setRect(current => ({ ...current, height: clamp(Number(event.target.value) / (stage?.height || 1), 1 / (stage?.height || 1), 1 - current.y) }))} /></label></div>
      </fieldset>
      <fieldset disabled={readOnly || busy}><legend>Orientering</legend><div className="image-button-row"><button type="button" aria-label="Rotera vänster" title="Rotera vänster" onClick={() => setRotation(current => (current + 270) % 360)}><RotateCcw size={17} /></button><button type="button" aria-label="Rotera höger" title="Rotera höger" onClick={() => setRotation(current => (current + 90) % 360)}><RotateCw size={17} /></button><button type="button" aria-label="Vänd vågrätt" title="Vänd vågrätt" onClick={() => setFlipH(value => !value)}><FlipHorizontal2 size={17} /></button><button type="button" aria-label="Vänd lodrätt" title="Vänd lodrätt" onClick={() => setFlipV(value => !value)}><FlipVertical2 size={17} /></button></div></fieldset>
      <fieldset disabled={readOnly || busy}><legend>Storlek och format</legend><label>Storlek {scale} % · {output?.width || 0} × {output?.height || 0} px<input type="range" min={10} max={200} step={5} value={scale} onChange={event => setScale(Number(event.target.value))} /></label><label>Filformat<select value={format} onChange={event => setFormat(event.target.value as Format)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>{format !== "image/png" && <label>Kvalitet {quality} %<input type="range" min={50} max={100} value={quality} onChange={event => setQuality(Number(event.target.value))} /></label>}</fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="hint" role="status">{notice}</p>}
      <button type="button" onClick={() => preview ? setResult(null) : void run("preview")} disabled={busy || !canRender}>{preview ? "Tillbaka till redigering" : "Förhandsvisa resultat"}</button>
      <button type="button" className="primary" onClick={() => void run("save")} disabled={readOnly || busy || !canRender || format !== originalFormat || !changed}>Spara till originalfil</button>
      <button type="button" onClick={() => void run("export")} disabled={readOnly || busy || !canRender}>Spara som {formatName(format)}…</button>
      {format !== originalFormat && <p className="hint">Formatbyte skapar en ny fil med rätt ändelse. Originalfilen finns kvar.</p>}
    </aside></div>
  </section>;
}
