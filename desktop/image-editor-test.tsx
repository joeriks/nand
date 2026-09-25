import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ImageEditor from "@/components/image-editor";
import "@/app/globals.css";
import "./style.css";

declare global { interface Window { __imageTest?: { initial: string; current: string; exported: string | null } } }

function sourceImage() {
  const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 200;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "red"; ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = "green"; ctx.fillRect(200, 0, 200, 200);
  return canvas.toDataURL("image/png");
}
function Harness() {
  const [initial] = useState(sourceImage);
  const [value, setValue] = useState(initial);
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => { window.__imageTest = { initial, current: value, exported }; }, [initial, value, exported]);
  return <ImageEditor fileName="Färg å.png" value={value} onChange={setValue} onExport={async dataUrl => { setExported(dataUrl); return true; }} readOnly={false} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
