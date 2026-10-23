import { describe, expect, it } from 'vitest'
import { buildCsv, csvCell } from './csv'

describe('CSV financeiro', () => {
  it('usa separador brasileiro, aspas e BOM de UTF-8', () => {
    expect(buildCsv([['Descrição', 'Valor'], ['Corte; barba', '35,00']]))
      .toBe('\uFEFF"Descrição";"Valor"\r\n"Corte; barba";"35,00"\r\n')
  })
  it('escapa aspas e evita fórmula de planilha em dados de clientes', () => {
    expect(csvCell('Cliente "A"')).toBe('"Cliente ""A"""')
    expect(csvCell('=HYPERLINK("url")')).toBe('"\'=HYPERLINK(""url"")"')
    expect(csvCell(' +2+3')).toBe('"\' +2+3"')
    expect(csvCell('@algumaFuncao')).toBe('"\'@algumaFuncao"')
  })
  it('mantém números negativos como dados numéricos', () => {
    expect(csvCell(-350)).toBe('"-350,00"')
    expect(csvCell(35.5)).toBe('"35,50"')
  })
})
