import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { entradaDir, erroDir, desconhecidosDir, processandoDir, processadosDir, logsDir, remoteEdiDir, keysDir } from './paths.js';
import { EXTENSOES_BLOQUEADAS, EXTENSOES_PERMITIDAS } from './types.js';

export async function garantirPastas(): Promise<void> {
  await Promise.all([
    entradaDir,
    processandoDir,
    processadosDir,
    erroDir,
    path.join(erroDir, 'duplicidades'),
    path.join(erroDir, 'layout_desconhecido'),
    path.join(erroDir, 'falha_importacao'),
    path.join(erroDir, 'extensao_bloqueada'),
    desconhecidosDir,
    logsDir,
    keysDir,
    path.join(remoteEdiDir, 'cielo', 'pulled'),
    path.join(remoteEdiDir, 'sipag', 'pulled'),
    path.join(remoteEdiDir, 'sicredi', 'pulled'),
    path.join(remoteEdiDir, 'convcard', 'pulled'),
    path.join(remoteEdiDir, 'alelo', 'pulled'),
    path.join(remoteEdiDir, 'pluxee', 'pulled'),
    path.join(remoteEdiDir, 'sicoob', 'pulled'),
    path.join(remoteEdiDir, 'ticket', 'pulled'),
    path.join(remoteEdiDir, 'vr', 'pulled'),
  ].map((dir) => fsp.mkdir(dir, { recursive: true })));
}

export function validarExtensao(nomeArquivo: string): void {
  const ext = path.extname(nomeArquivo).toLowerCase();
  if (EXTENSOES_BLOQUEADAS.has(ext) || !EXTENSOES_PERMITIDAS.has(ext)) {
    throw new Error(`Extensão de arquivo não permitida: ${ext || 'sem extensão'}.`);
  }
}

export function calcularHashArquivo(caminhoArquivo: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(caminhoArquivo);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function normalizarTexto(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function jsonSeguro(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));
}
