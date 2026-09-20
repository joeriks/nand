"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { compareCsvValues, csvHeaders, csvTypeLabels, csvValueValid, inferCsvType, parseCsv, writeCsv, type CsvType } from "@/lib/csv";

type Settings = { header: boolean; delimiter: string; types: Record<number, CsvType | "auto"> };
const PAGE_SIZE = 100;
function readSettings(key: string): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(`gitbsidian-csv-${key}`) || "null");
    if (saved && typeof saved.header === "boolean" && ["", ",", ";", "\t", "|"].includes(saved.delimiter)) return { ...saved, types: saved.types || {} };
  } catch { /* Table preferences must not block access to the original text. */ }
  return { header: true, delimiter: "", types: {} };
}
export default function CsvEditor({ value, onChange, readOnly, fileKey }: { value: string; onChange: (value: string) => void; readOnly: boolean; fileKey: string }) {
  const [settings, setSettings] = useState(() => readSettings(fileKey));
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [editingRow, setEditingRow] = useState<{ index: number; position: number } | null>(null);
  const [error, setError] = useState("");
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const parsed = useMemo(() => {
    try { return { document: parseCsv(value, settings.delimiter), error: "" }; }
    catch (error) { return { document: null, error: error instanceof Error ? error.message : "CSV-filen kunde inte öppnas." }; }
  }, [value, settings.delimiter]);
  const document = parsed.document;
  const headers = useMemo(() => csvHeaders(document?.rows || [], settings.header), [document, settings.header]);
  const offset = settings.header ? 1 : 0;
  const rows = useMemo(() => document?.rows.slice(offset).map((cells, index) => ({ cells, index: index + offset })) || [], [document, offset]);
  const types = useMemo(() => headers.map((_, column) => {
    const selected = settings.types[column];
    return selected && selected in csvTypeLabels ? selected as CsvType : inferCsvType(rows.map(row => row.cells[column] || ""));
  }), [headers, rows, settings.types]);
  const filtered = useMemo(() => {
    const matching = rows.filter(row => row.index === editingRow?.index || ((!search || row.cells.some(cell => cell.toLocaleLowerCase("sv").includes(search.toLocaleLowerCase("sv")))) && headers.every((_, index) => !filters[index] || (row.cells[index] || "").toLocaleLowerCase("sv").includes(filters[index].toLocaleLowerCase("sv")))));
    const ordered = !sort ? matching : matching.toSorted((a, b) => {
      const first = a.cells[sort.column] || "", second = b.cells[sort.column] || "";
      if (!first !== !second) return first ? -1 : 1;
      return compareCsvValues(first, second, types[sort.column]) * sort.direction || a.index - b.index;
    });
    // Keep the focused row on its current page while typing; apply its new sort
    // position on blur so keystrokes cannot disappear into an unmounted cell.
    if (editingRow) {
      const index = ordered.findIndex(row => row.index === editingRow.index);
      if (index >= 0) { const [row] = ordered.splice(index, 1); ordered.splice(Math.min(editingRow.position, ordered.length), 0, row); }
    }
    return ordered;
  }, [rows, search, headers, filters, sort, types, editingRow]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const invalidCount = rows.reduce((sum, row) => sum + headers.filter((_, column) => !csvValueValid(row.cells[column] || "", types[column])).length, 0);
  function configure(next: Settings) {
    setSettings(next); setPage(0);
    try { localStorage.setItem(`gitbsidian-csv-${fileKey}`, JSON.stringify(next)); }
    catch { setError("Tabellinställningarna kunde inte sparas. Filens innehåll påverkas inte."); }
  }
  function change(rows: string[][]) {
    if (!document || readOnly) return;
    try {
      const next = writeCsv(document, rows);
      if (next !== value) { setPast(previous => [...previous.slice(-19), value]); setFuture([]); onChange(next); }
      setError("");
    }
    catch (error) { setError(error instanceof Error ? error.message : "Ändringen kunde inte sparas."); }
  }
  function edit(row: number, column: number, text: string) {
    if (!document) return;
    const rows = document.rows.map(cells => [...cells]);
    while (rows[row].length <= column) rows[row].push("");
    rows[row][column] = text; change(rows);
  }
  return <section className="csv-editor" aria-label="CSV-redigerare">
    <div className="csv-toolbar">
      <label>Sök i tabellen<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Sök i alla kolumner…" /></label>
      <label>Avgränsare<select value={settings.delimiter} onChange={event => configure({ ...settings, delimiter: event.target.value })}><option value="">Automatisk</option><option value=",">Komma</option><option value=";">Semikolon</option><option value={"\t"}>Tabb</option><option value="|">Lodstreck</option></select></label>
      <label className="csv-header-option"><input type="checkbox" checked={settings.header} onChange={event => configure({ ...settings, header: event.target.checked, types: {} })} />Första raden är rubriker</label>
      <button disabled={!document || readOnly} onClick={() => { if (document) { change([...(settings.header && !document.rows.length ? [headers] : document.rows), headers.map(() => "")]); setSearch(""); setFilters({}); setSort(null); setPage(Math.floor(rows.length / PAGE_SIZE)); } }}><Plus size={15} />Lägg till rad</button>
      <button disabled={readOnly || !past.length} onClick={() => { const previous = past.at(-1)!; setPast(past.slice(0, -1)); setFuture([value, ...future]); onChange(previous); }}>Ångra</button>
      <button disabled={readOnly || !future.length} onClick={() => { setPast([...past, value]); setFuture(future.slice(1)); onChange(future[0]); }}>Gör om</button>
    </div>
    <p className="csv-hint">Osäkra eller blandade kolumner blir text. Datum: ÅÅÅÅ-MM-DD. Decimaltal: punkt eller komma. Tomma celler tillåts. Typval ändrar inte värden; sortering och filter ändrar bara vyn.</p>
    {invalidCount > 0 && <p className="csv-validation" role="status">{invalidCount} {invalidCount === 1 ? "cell stämmer" : "celler stämmer"} inte med vald datatyp. Felaktiga celler är markerade. Rätta värdet eller välj Text.</p>}
    {(parsed.error || error) && <p role="alert" className="error-message">{parsed.error || error}</p>}
    {document && <>
      <div className="csv-scroll"><table className="csv-grid"><caption className="sr-only">CSV-data med kolumntyper, filter och sortering</caption><thead><tr><th scope="col">Rad</th>{headers.map((name, column) => <th scope="col" key={column} aria-sort={sort?.column === column ? sort.direction === 1 ? "ascending" : "descending" : "none"}>
        <button className="csv-sort" title={`Sortera ${name}`} onClick={() => { setSort(sort?.column === column ? sort.direction === 1 ? { column, direction: -1 } : null : { column, direction: 1 }); setPage(0); }}>{name}{sort?.column === column ? sort.direction === 1 ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : <ArrowUpDown size={14} />}</button>
        <select aria-label={`Datatyp för ${name}`} value={settings.types[column] || "auto"} onChange={event => configure({ ...settings, types: { ...settings.types, [column]: event.target.value as CsvType | "auto" } })}><option value="auto">Auto · {csvTypeLabels[types[column]]}</option>{Object.entries(csvTypeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
        <input type="search" aria-label={`Filtrera ${name}`} placeholder="Filtrera…" value={filters[column] || ""} onChange={event => { setFilters({ ...filters, [column]: event.target.value }); setPage(0); }} />
      </th>)}<th scope="col"><span className="sr-only">Radåtgärder</span></th></tr></thead><tbody>{visible.map(row => <tr key={row.index}><th scope="row">{row.index - offset + 1}</th>{headers.map((name, column) => <td key={column}>
        <textarea rows={1} aria-label={`Rad ${row.index - offset + 1}, ${name}`} value={row.cells[column] || ""} readOnly={readOnly} aria-invalid={!csvValueValid(row.cells[column] || "", types[column])} title={csvValueValid(row.cells[column] || "", types[column]) ? undefined : `Värdet stämmer inte med ${csvTypeLabels[types[column]].toLowerCase()}. Behåll som text eller ändra värdet.`} onFocus={() => setEditingRow({ index: row.index, position: filtered.findIndex(value => value.index === row.index) })} onBlur={() => setEditingRow(null)} onChange={event => edit(row.index, column, event.target.value)} />
        {!csvValueValid(row.cells[column] || "", types[column]) && <span className="csv-cell-error">Fel format: {csvTypeLabels[types[column]].toLowerCase()}</span>}
      </td>)}<td><button className="icon-button" aria-label={`Ta bort rad ${row.index - offset + 1}`} disabled={readOnly} onClick={() => change(document.rows.filter((_, index) => index !== row.index))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
      <footer className="csv-footer"><span>{filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} av {filtered.length} rader · {rows.length} totalt · {headers.length} kolumner</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Föregående</button><button disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Nästa</button>{(search || Object.values(filters).some(Boolean) || sort) && <button onClick={() => { setSearch(""); setFilters({}); setSort(null); setPage(0); }}>Återställ vy</button>}</footer>
    </>}
  </section>;
}
