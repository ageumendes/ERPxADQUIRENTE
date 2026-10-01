import type { RefObject } from 'react';

export type RespostaPaginadaVendas<T> = {
  linhas: T[];
  total_linhas: number;
  limite: number;
  offset: number;
};

export function extrairRespostaPaginada<T>(data: T[] | RespostaPaginadaVendas<T>, limitePadrao: number, offsetPadrao: number): RespostaPaginadaVendas<T> {
  if (Array.isArray(data)) {
    return {
      linhas: data,
      total_linhas: data.length,
      limite: limitePadrao,
      offset: offsetPadrao,
    };
  }

  return {
    linhas: Array.isArray(data.linhas) ? data.linhas : [],
    total_linhas: Number(data.total_linhas || 0),
    limite: Number(data.limite || limitePadrao),
    offset: Number(data.offset || offsetPadrao),
  };
}

export function rolarParaTopoElemento(ref: React.RefObject<HTMLElement>) {
  window.setTimeout(() => {
    const elemento = ref.current;
    if (!elemento) return;

    const areasRolagem = elemento.querySelectorAll<HTMLElement>('.db-data-table, .imports-table-wrap, .table-wrap');
    areasRolagem.forEach((area) => {
      area.scrollTop = 0;
      area.scrollLeft = 0;
    });

    window.requestAnimationFrame(() => {
      areasRolagem.forEach((area) => {
        area.scrollTop = 0;
        area.scrollLeft = 0;
      });
    });
  }, 0);
}



