import { createRoot } from "react-dom/client";
import { DesktopApp } from "./app";
import "@/app/globals.css";
import "./style.css";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
// External Markdown links never navigate a privileged application window.
document.addEventListener("click", event => {
  const link = (event.target as Element).closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  if (isTauri()) {
    event.preventDefault();
    if (["https:", "http:", "mailto:"].includes(new URL(link.href).protocol)) void openUrl(link.href).catch(() => {});
  }
});
createRoot(document.getElementById("root")!).render(<DesktopApp />);
