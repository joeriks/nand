import Papa from "papaparse";

export type CsvType = "text" | "integer" | "decimal" | "date" | "boolean";
export const csvTypeLabels: Record<CsvType, string> = { text: "Text", integer: "Heltal", decimal: "Decimaltal", date: "Datum", boolean: "Boolesk" };
export type CsvDocument = { rows: string[][]; delimiter: string; newline: string; bom: string; trailingNewline: boolean };

export function parseCsv(text: string, delimiter = ""): CsvDocument {
  const bom = text.startsWith("\ufeff") ? "\ufeff" : "";
  const source = text.slice(bom.length);
  const parsed = Papa.parse<string[]>(source, { delimiter, delimitersToGuess: [",", ";", "\t", "|"], dynamicTyping: false, header: false, skipEmptyLines: false });
  const malformed = parsed.errors.find(error => error.code !== "UndetectableDelimiter");
  if (malformed) throw new Error(`CSV-filen kunde inte tolkas vid rad ${(malformed.row ?? 0) + 1}. Kontrollera avgränsare och citattecken i CSV-texten.`);
  const trailingNewline = /(?:\r\n|\r|\n)$/.test(source);
  const rows = source === "" ? [] : parsed.data;
  if (trailingNewline && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "") rows.pop();
  if (rows.length > 50000 || rows.some(row => row.length > 200)) throw new Error("Tabellvyn stöder högst 50 000 rader och 200 kolumner. CSV-texten och exporten finns fortfarande tillgängliga.");
  return { rows, delimiter: parsed.meta.delimiter || delimiter || ",", newline: parsed.meta.linebreak || "\r\n", bom, trailingNewline };
}

export function writeCsv(document: CsvDocument, rows: string[][]): string {
  // Cells remain strings. Never interpret formulas or coerce IDs, dates or numbers.
  // Quote empty cells so a final single empty field cannot be mistaken for the
  // document's trailing line terminator and silently lose a record on reopening.
  const csv = document.bom + Papa.unparse(rows, { delimiter: document.delimiter, newline: document.newline, quotes: value => value === "", header: false, skipEmptyLines: false, escapeFormulae: false }) + (rows.length && document.trailingNewline ? document.newline : "");
  if (new TextEncoder().encode(csv).length > 1024 * 1024) throw new Error("CSV-filen får vara högst 1 MiB. Ändringen kunde inte läggas till.");
  return csv;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isNumber(value: string): boolean {
  // Leading zeroes, exponents, locale separators and long identifiers are ambiguous.
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.replace(/[^0-9]/g, "").length <= 15 && Number.isFinite(Number(value));
}
export function inferCsvType(values: string[]): CsvType {
  const nonempty = values.filter(value => value !== "");
  if (!nonempty.length) return "text";
  if (nonempty.every(value => /^(true|false)$/i.test(value))) return "boolean";
  if (nonempty.every(isDate)) return "date";
  if (nonempty.every(isNumber)) return nonempty.every(value => !value.includes(".")) ? "integer" : "decimal";
  return "text";
}
export function csvValueValid(value: string, type: CsvType): boolean {
  if (value === "" || type === "text") return true;
  if (type === "date") return isDate(value);
  if (type === "boolean") return /^(true|false)$/i.test(value);
  if (type === "integer") return /^[+-]?\d+$/.test(value);
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(value);
}
function compareNumbers(a: string, b: string): number {
  const parts = (value: string) => {
    const [integer, fraction = ""] = value.replace(/^[+-]/, "").replace(",", ".").split(".");
    return { integer: integer.replace(/^0+/, "") || "0", fraction: fraction.replace(/0+$/, ""), negative: value.startsWith("-") && /[1-9]/.test(value) };
  };
  const first = parts(a), second = parts(b);
  if (first.negative !== second.negative) return first.negative ? -1 : 1;
  const width = Math.max(first.fraction.length, second.fraction.length);
  const lexical = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  return (first.integer.length - second.integer.length || lexical(first.integer, second.integer) || lexical(first.fraction.padEnd(width, "0"), second.fraction.padEnd(width, "0"))) * (first.negative ? -1 : 1);
}
export function compareCsvValues(a: string, b: string, type: CsvType): number {
  if (csvValueValid(a, type) && csvValueValid(b, type)) {
    if (type === "integer" || type === "decimal") return compareNumbers(a, b);
    if (type === "boolean") return Number(a.toLowerCase() === "true") - Number(b.toLowerCase() === "true");
  }
  return a.localeCompare(b, "sv");
}
export function csvHeaders(rows: string[][], header: boolean): string[] {
  const count = rows.reduce((count, row) => Math.max(count, row.length), 1);
  const names = Array.from({ length: count }, (_, index) => header && rows[0]?.[index] ? rows[0][index] : `Kolumn ${index + 1}`);
  return names.map((name, index) => names.filter(value => value === name).length > 1 ? `${name} (${index + 1})` : name);
}
