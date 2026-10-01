import { useEffect, useState, type RefObject } from 'react';

export function useTamanhoPaginaResponsivo(
  containerRef: React.RefObject<HTMLElement | null>,
  espacoFixoFallback = 285,
  alturaLinha = 28,
  alturaCabecalho = 36,
) {
  const RESERVA_INFERIOR = 22;
  const calcular = () => {
    const tabela = containerRef.current?.querySelector('table');
    if (!tabela) {
      return Math.max(5, Math.min(100, Math.floor((window.innerHeight - espacoFixoFallback) / alturaLinha)));
    }
    const topoTabela = tabela.getBoundingClientRect().top;
    const alturaDisponivel = window.innerHeight - topoTabela - alturaCabecalho - RESERVA_INFERIOR;
    return Math.max(5, Math.min(100, Math.floor(alturaDisponivel / alturaLinha)));
  };
  const [tamanho, setTamanho] = useState(() => Math.max(5, Math.min(100, Math.floor((window.innerHeight - espacoFixoFallback) / alturaLinha))));
  useEffect(() => {
    let frame = 0;
    let frameConexao = 0;
    const recalcular = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTamanho((atual) => {
        const proximo = calcular();
        return atual === proximo ? atual : proximo;
      }));
    };
    const observer = new ResizeObserver(recalcular);
    const conectarAoContainer = () => {
      if (containerRef.current) {
        observer.observe(containerRef.current);
        recalcular();
        return;
      }
      frameConexao = requestAnimationFrame(conectarAoContainer);
    };
    conectarAoContainer();
    window.addEventListener('resize', recalcular);
    recalcular();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(frameConexao);
      observer.disconnect();
      window.removeEventListener('resize', recalcular);
    };
  }, [containerRef, espacoFixoFallback, alturaLinha, alturaCabecalho]);
  return tamanho;
}

