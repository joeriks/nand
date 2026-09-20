import { describe, expect, it } from "vitest";
import { compareCsvValues, csvValueValid, inferCsvType, parseCsv, writeCsv } from "@/lib/csv";
import { pathSchema, wikiPathSchema } from "@/lib/validation";

describe("CSV data and conservative column types", () => {
  it.each([
    [["1", "-20", ""], "integer"], [["1", "2.75"], "decimal"], [["2024-02-29", "2026-09-20"], "date"], [["true", "FALSE"], "boolean"],
    [[""], "text"], [["00123", "00456"], "text"], [["1", "ok"], "text"], [["1,234", "2,345"], "text"], [["03/04/2026"], "text"], [["2025-02-29"], "text"], [["12345678901234567"], "text"], [[" 2", "3"], "text"],
  ] as const)("infers %j as %s without changing values", (values, type) => { expect(inferCsvType([...values])).toBe(type); });
  it("round-trips semicolon files, BOM, CRLF, quotes, multiline fields, formulas and leading zeroes", () => {
    const text = '\ufeffID;Namn;Text\r\n00123;"Åsa;Öberg";"rad 1\r\nrad ""två"""\r\n00456;=SUM(A1);\r\n';
    const document = parseCsv(text);
    expect(document.delimiter).toBe(";"); expect(document.newline).toBe("\r\n");
    expect(document.rows[1]).toEqual(["00123", "Åsa;Öberg", 'rad 1\r\nrad "två"']);
    const rows = document.rows.map(row => [...row]); rows[1][1] = "Ny, text";
    const saved = writeCsv(document, rows);
    expect(saved.startsWith("\ufeff")).toBe(true); expect(saved.endsWith("\r\n")).toBe(true);
    expect(parseCsv(saved).rows).toEqual(rows); expect(rows[2][1]).toBe("=SUM(A1)");
  });
  it("preserves ragged rows, blank rows and a file without trailing newline", () => {
    const doc = parseCsv('a,b,c\n1,2\n\n"x,y",z,3,4');
    expect(parseCsv(writeCsv(doc, doc.rows)).rows).toEqual(doc.rows);
    expect(writeCsv(doc, doc.rows).endsWith("\n")).toBe(false);
  });
  it("allows single-column files and headerless data", () => {
    expect(parseCsv("001\n002\n").rows).toEqual([["001"], ["002"]]);
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
  });
  it("keeps final empty single-column records separate from a trailing newline", () => {
    for (const text of ["Namn\nÅsa", "Namn\nÅsa\n", ""]) {
      const document = parseCsv(text);
      const rows = [...document.rows, [""]];
      expect(parseCsv(writeCsv(document, rows)).rows).toEqual(rows);
      expect(parseCsv(writeCsv(document, [])).rows).toEqual([]);
    }
  });
  it("rejects malformed quotes without repairing or dropping data", () => { expect(() => parseCsv('a,b\n"unterminated,2')).toThrow("citattecken"); });
  it.each([
    ["42", "integer", true], ["1.5", "integer", false], ["001", "integer", true], ["1,25", "decimal", true], ["1.25", "decimal", true], ["1,2,3", "decimal", false],
    ["2024-02-29", "date", true], ["2023-02-29", "date", false], ["2026-13-01", "date", false], ["20/09/2026", "date", false], ["", "date", true], ["what?", "text", true],
  ] as const)("validates %s against manual %s: %s", (value, type, valid) => { expect(csvValueValid(value, type)).toBe(valid); });
  it("sorts numeric strings exactly without floating point truncation", () => {
    expect(compareCsvValues("2", "10", "integer")).toBeLessThan(0);
    expect(compareCsvValues("9007199254740993", "9007199254740992", "integer")).toBeGreaterThan(0);
    expect(compareCsvValues("1.00000000000000001", "1.00000000000000002", "decimal")).toBeLessThan(0);
    expect(compareCsvValues("-2,5", "-2,05", "decimal")).toBeLessThan(0);
    expect(compareCsvValues("001", "+1.00", "decimal")).toBe(0);
  });
  it("allows CSV in repository paths but keeps Wiki restricted to Markdown", () => {
    expect(pathSchema.safeParse("Data/Priser.csv").success).toBe(true);
    expect(wikiPathSchema.safeParse("Priser.csv").success).toBe(false);
    expect(pathSchema.safeParse("../Priser.csv").success).toBe(false);
  });
});
