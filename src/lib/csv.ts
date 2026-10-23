/** Exportação CSV segura para abrir em planilhas (sem executar fórmulas vindas de clientes). */
export function csvCell(value: string | number): string {
  const raw = String(value)
  // Escapa conteúdo que Excel/LibreOffice poderiam interpretar como fórmula.
  const safe = /^[\s\u0000-\u001f]*[=+@\-]/.test(raw) && typeof value === 'string' ? "'" + raw : raw
  return '"' + safe.replace(/"/g, '""') + '"'
}

export function buildCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
}
