"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="error-page"><h1>Något gick fel.</h1><p>Bekräftat sparade lokala utkast finns kvar i webbläsaren.</p><button className="primary" onClick={reset}>Försök igen</button></main>; }
