/** CSV writer: UTF-8 with BOM so Excel opens Korean text correctly. */

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined | { toString(): string };
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection in user-entered text.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
