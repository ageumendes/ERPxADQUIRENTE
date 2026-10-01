import { useEffect, useState } from 'react';

/**
 * Calcula quantas linhas realmente cabem no viewport interno da tabela.
 *
 * v0.1.235: em vez de estimar pela altura da janela, mede o .db-data-table,
 * o thead e uma linha real renderizada. Assim a paginação acompanha tanto
 * a resolução quanto a escala responsiva aplicada na raiz do app.
 */
export function useTamanhoPaginaResponsivo(
  containerRef: React.RefObject<HTMLElement | null>,
  espacoFixoFallback = 285,
  alturaLinhaFallback = 22,
  alturaCabecalhoFallback = 28,
) {
  const MINIMO = 5;
  const MAXIMO = 100;
  const FOLGA = 2;

  const limitar = (valor: number) => Math.max(MINIMO, Math.min(MAXIMO, valor));

  const calcular = () => {
    const container = containerRef.current;
    const viewport = container?.querySelector<HTMLElement>('.db-data-table');

    if (!viewport || viewport.clientHeight <= 0) {
      return limitar(Math.floor((window.innerHeight - espacoFixoFallback) / alturaLinhaFallback));
    }

    const thead = viewport.querySelector<HTMLElement>('thead');
    const primeiraLinha = viewport.querySelector<HTMLElement>('tbody tr');
    const alturaCabecalho = thead?.getBoundingClientRect().height || alturaCabecalhoFallback;
    const alturaLinhaMedida = primeiraLinha?.getBoundingClientRect().height || alturaLinhaFallback;
    const alturaLinha = Math.max(1, alturaLinhaMedida);
    const alturaUtil = Math.max(0, viewport.clientHeight - alturaCabecalho - FOLGA);

    return limitar(Math.floor(alturaUtil / alturaLinha));
  };

  const [tamanho, setTamanho] = useState(() =>
    limitar(Math.floor((window.innerHeight - espacoFixoFallback) / alturaLinhaFallback)),
  );

  useEffect(() => {
    let frame = 0;
    let frameConexao = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const recalcular = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const proximo = calcular();
        setTamanho((atual) => (atual === proximo ? atual : proximo));
      });
    };

    const conectar = () => {
      const container = containerRef.current;
      const viewport = container?.querySelector<HTMLElement>('.db-data-table');
      if (!container || !viewport) {
        frameConexao = requestAnimationFrame(conectar);
        return;
      }

      resizeObserver = new ResizeObserver(recalcular);
      resizeObserver.observe(container);
      resizeObserver.observe(viewport);

      // As primeiras linhas chegam depois da requisição. Quando o tbody muda,
      // medimos a altura real da linha e refinamos o limite sem breakpoint.
      mutationObserver = new MutationObserver(recalcular);
      const tbody = viewport.querySelector('tbody');
      if (tbody) mutationObserver.observe(tbody, { childList: true });

      recalcular();
    };

    conectar();
    window.addEventListener('resize', recalcular);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(frameConexao);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', recalcular);
    };
  }, [containerRef, espacoFixoFallback, alturaLinhaFallback, alturaCabecalhoFallback]);

  return tamanho;
}
