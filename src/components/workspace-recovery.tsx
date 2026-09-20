"use client";
export function WorkspaceRecovery({ loading, error, onRetry, onChoose }: { loading: boolean; error: string; onRetry: () => void; onChoose: () => void }) {
  return <main className="empty-document"><h1>Din senaste arbetsyta</h1>{loading ? <p role="status">Öppnar din senaste arbetsyta…</p> : <><p role="alert">{error}</p><p>Dina lokala utkast behålls.</p><div className="dialog-actions"><button onClick={onRetry}>Försök öppna igen</button><button onClick={onChoose}>Välj annan arbetsyta</button></div></>}</main>;
}
