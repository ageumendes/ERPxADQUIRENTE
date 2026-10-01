import React from 'react';
import { adquirenteLogoMap, bandeiraLogoMap, erpLogoMap } from '../lib/payment-logos';
import { valorTabela } from '../lib/formatters';

export function normalizarChaveLogo(valor: unknown) {
  return valorTabela(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

export function RenderAdquirenteLogo({ valor }: { valor: unknown }) {
  const texto = valorTabela(valor);
  const chave = normalizarChaveLogo(texto);
  const logo = adquirenteLogoMap[chave];
  if (!logo || texto === '-') return <span title={texto}>{texto}</span>;
  return (
    <span className="logo-value logo-value-adquirente" title={texto}>
      <img src={logo} alt={texto} />
    </span>
  );
}

export function RenderBandeiraLogo({ valor }: { valor: unknown }) {
  const textoOriginal = valorTabela(valor);
  const texto = /^\d+$/.test(textoOriginal.trim()) || textoOriginal.toUpperCase() === 'OUTRAS' ? 'Outras' : textoOriginal;
  const chave = normalizarChaveLogo(texto);
  const logo = bandeiraLogoMap[chave];
  if (!logo || texto === '-') return <span title={texto}>{texto}</span>;
  return (
    <span className="logo-value logo-value-bandeira" title={texto}>
      <img src={logo} alt={texto} />
    </span>
  );
}

export function RenderErpLogo({ valor = 'INTERDATA' }: { valor?: unknown }) {
  const texto = valorTabela(valor);
  const chave = normalizarChaveLogo(texto);
  const logo = erpLogoMap[chave];
  if (!logo || texto === '-') return <span title={texto}>{texto}</span>;
  return (
    <span className="logo-value logo-value-adquirente" title={texto}>
      <img src={logo} alt={texto} />
    </span>
  );
}

