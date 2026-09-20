import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { sv } from "@/lib/i18n";
const sans = localFont({ src: "../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2", variable: "--font-dm", display: "swap" });
const serif = localFont({ src: [
  { path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2", style: "normal" },
  { path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2", style: "italic" },
], variable: "--font-news", display: "swap" });
export const metadata: Metadata = { title: `${sv.name} — ${sv.tagline}`, description: "Samla, organisera och redigera din kunskap. Anteckningar och CSV-tabeller med lokala utkast och GitHub.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="sv" className={`${sans.variable} ${serif.variable}`}><body>{children}</body></html>; }
