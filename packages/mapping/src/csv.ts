export type CsvResult = { ok: true; header: string[]; rows: string[][] } | { ok: false; message: string };
export type CsvLimits = { maxBytes: number; maxRows: number };

const DEFAULT_LIMITS: CsvLimits = { maxBytes: 10 * 1024 * 1024, maxRows: 20_000 };

/**
 * A small strict CSV reader. It never evaluates anything: a cell that starts with = + - or @ comes back as
 * the same plain text. Handles quoted cells with commas, line breaks and doubled quotes, a byte order mark,
 * and Windows line endings. Blank lines are skipped. Row limit counts data rows, not the header.
 */
export function parseCsv(input: string, limits: CsvLimits = DEFAULT_LIMITS): CsvResult {
  if (Buffer.byteLength(input) > limits.maxBytes) {
    return { ok: false, message: `That file is too big. The limit is ${Math.round(limits.maxBytes / 1024 / 1024)} MB.` };
  }
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let touched = false; // the current row has any content, so a blank line is not a row

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    if (touched || row.length > 0) {
      endCell();
      if (row.some((c) => c !== "")) records.push(row);
    }
    row = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      touched = true;
    } else if (ch === ",") {
      endCell();
      touched = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (inQuotes) return { ok: false, message: "The file has a quote that is never closed. Export it again from Shopify." };
  endRow();

  const [header, ...rows] = records;
  if (!header) return { ok: false, message: "That file is empty." };
  if (rows.length > limits.maxRows) {
    return { ok: false, message: `That file has too many rows. The limit is ${limits.maxRows.toLocaleString("en")}.` };
  }
  return { ok: true, header, rows };
}
