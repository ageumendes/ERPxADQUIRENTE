'use strict';
const XLSX = require('xlsx');

try {
  const workbook = XLSX.readFile(process.argv[2], { cellDates: false, raw: false, dense: true });
  const sheetName = workbook.SheetNames && workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  const maxRows = Number(process.env.PARSER_MAX_ROWS || 200000);
  const maxCells = Number(process.env.PARSER_MAX_CELLS || 2000000);
  const matrizCompleta = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) : [];
  const sampleRows = Math.max(Number(process.env.PARSER_SAMPLE_ROWS || 0), 0);
  const matriz = sampleRows > 0 ? matrizCompleta.slice(0, sampleRows) : matrizCompleta;
  if (matrizCompleta.length > maxRows) throw new Error(`Planilha excede o limite de ${maxRows} linhas.`);
  let celulas = 0;
  for (const linha of matriz) {
    celulas += Array.isArray(linha) ? linha.length : 0;
    if (celulas > maxCells) throw new Error(`Planilha excede o limite de ${maxCells} células.`);
  }
  const quantidade = matrizCompleta.filter((linha) => Array.isArray(linha) && linha.some((valor) => String(valor ?? '').trim())).length;
  if (process.send) process.send({ sucesso: true, matriz, quantidade_registros: quantidade });
} catch (error) {
  if (process.send) process.send({ sucesso: false, erro: error instanceof Error ? error.message : 'Planilha inválida.' });
  else process.exitCode = 1;
}
