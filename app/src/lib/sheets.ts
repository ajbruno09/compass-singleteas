// Excel templates and uploads. exceljs is loaded only when a file is needed, so the app stays light.
export interface Col { label: string; width?: number; list?: string[]; note?: string; required?: boolean }
export interface SheetDef { name: string; cols: Col[]; rows?: (string | number | null)[][]; help?: string }

const colLetter = (n: number) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };

export async function downloadWorkbook(filename: string, title: string, steps: string[], sheets: SheetDef[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet('Read me');
  info.getColumn(1).width = 110;
  info.addRow([title]).font = { bold: true, size: 16 };
  info.addRow([]);
  steps.forEach((s, i) => { const r = info.addRow([`${i + 1}. ${s}`]); r.alignment = { wrapText: true, vertical: 'top' }; });
  const lists = wb.addWorksheet('Lists', { state: 'hidden' });
  let listCol = 0;
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    ws.views = [{ state: 'frozen', ySplit: sh.help ? 2 : 1 }];
    if (sh.help) { ws.addRow([sh.help]); ws.getRow(1).font = { italic: true, color: { argb: 'FF545D6B' } }; ws.mergeCells(1, 1, 1, Math.min(sh.cols.length, 8)); ws.getRow(1).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(1).height = 42; }
    const hr = ws.addRow(sh.cols.map((c) => c.label + (c.required ? ' *' : '')));
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.height = 34; hr.alignment = { wrapText: true, vertical: 'middle' };
    hr.eachCell((cell, i) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sh.cols[i - 1].required ? 'FF0F4D2A' : 'FF5B6B60' } }; if (sh.cols[i - 1].note) cell.note = sh.cols[i - 1].note!; });
    sh.cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 16; });
    (sh.rows ?? []).forEach((r) => ws.addRow(r));
    const first = (sh.help ? 3 : 2); const last = Math.max(first + (sh.rows?.length ?? 0) + 400, 500);
    sh.cols.forEach((c, i) => {
      if (!c.list || c.list.length === 0) return;
      listCol += 1;
      c.list.forEach((v, k) => { lists.getCell(k + 1, listCol).value = v; });
      const ref = `Lists!$${colLetter(listCol)}$1:$${colLetter(listCol)}$${c.list.length}`;
      for (let r = first; r <= last; r++) ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: false };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const cellText = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.result != null) return String(o.result).trim();
    if (o.text != null) return String(o.text).trim();
    return '';
  }
  return String(v).trim();
};

// Reads one sheet into objects keyed by the header text (the " *" for required columns is ignored).
export async function readSheet(file: File, sheetName: string, firstHeader: string): Promise<{ rows: Record<string, string>[]; line: number[] } | null> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return null;
  let headerRow = 1;
  let found = false;
  for (let r = 1; r <= 6; r++) { const v = cellText(ws.getRow(r).getCell(1).value).replace(/\s*\*$/, '').trim(); if (v.toLowerCase() === firstHeader.toLowerCase()) { headerRow = r; found = true; break; } }
  if (!found) return null;
  const heads: string[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (c, i) => { heads[i] = cellText(c.value).replace(/\s*\*$/, '').trim(); });
  const rows: Record<string, string>[] = []; const line: number[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRow) return;
    const o: Record<string, string> = {}; let any = false;
    heads.forEach((h, i) => { if (!h) return; const t = cellText(row.getCell(i).value); if (t) any = true; o[h] = t; });
    if (any) { rows.push(o); line.push(n); }
  });
  return { rows, line };
}

export const num = (s: string | undefined): number | null => { if (s == null || s.trim() === '') return null; const n = Number(String(s).replace(/[₹,%\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
