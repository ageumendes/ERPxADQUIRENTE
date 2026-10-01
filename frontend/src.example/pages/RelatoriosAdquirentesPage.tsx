import React, { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Maximize2, Minimize2, Pause, Play, Printer } from 'lucide-react';
import { formatarMoedaBrasil } from '../lib/formatters';
import { adquirenteLogoMap, bandeiraLogoMap } from '../lib/payment-logos';
import { rotuloBandeiraFiltro } from '../components/FiltrosVendas';
import { RenderAdquirenteLogo, RenderBandeiraLogo, normalizarChaveLogo } from '../components/PaymentLogos';
import { useRelatorioFinanceiro } from '../hooks/useRelatorioFinanceiro';
import type { FiltrosRelatorio, LinhaRelatorioFinanceiro, RelatorioAdquirentes, RelatorioGrupo } from '../types/relatorios';

function formatarDataInputLocal(data: Date) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function formatarDataBrRelatorio(dataIso: string) {
  const match = String(dataIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dataIso || '-';
}

function filtrosPadraoPeriodoAtual(): FiltrosRelatorio {
  const hoje = new Date();
  const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  return {
    busca: '',
    data_inicio: formatarDataInputLocal(primeiroDiaMes),
    data_fim: formatarDataInputLocal(hoje),
    estabelecimento: '',
    adquirente: '',
    forma_pagamento: '',
    modalidade: '',
    bandeira: '',
    status: '',
  };
}

function numeroRelatorio(valor: unknown) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function nomeBandeiraRelatorio(valor: unknown) {
  const texto = String(valor ?? '').trim();
  const chave = normalizarChaveLogo(texto);
  if (!chave || /^\d+$/.test(texto) || ['NAO INFORMADO', 'OUTRA', 'OUTRAS'].includes(chave)) return 'Outras';
  return texto;
}

function formatarPercentual(valor: unknown) {
  const numero = numeroRelatorio(valor);
  return `${numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function escaparHtmlRelatorio(valor: unknown) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function montarLinhasRelatorioFinanceiro(relatorio: RelatorioAdquirentes): LinhaRelatorioFinanceiro[] {
  const taxaPercentual = (taxa: number, bruto: number) => bruto > 0 ? (taxa / bruto) * 100 : 0;
  const linhas: LinhaRelatorioFinanceiro[] = [];
  const analises = [...relatorio.analise_adquirentes].sort((a, b) => a.adquirente.localeCompare(b.adquirente, 'pt-BR'));

  for (const analise of analises) {
    const totalAdquirente = analise.modalidades.reduce((total, modalidade) => ({
      quantidade: total.quantidade + modalidade.quantidade,
      bruto: total.bruto + modalidade.bruto,
      taxa: total.taxa + modalidade.taxa,
      liquido: total.liquido + modalidade.liquido,
    }), { quantidade: 0, bruto: 0, taxa: 0, liquido: 0 });
    linhas.push({ nivel: 'ADQUIRENTE', adquirente: analise.adquirente, forma_pagamento: '', modalidade: '', bandeira: '', ...totalAdquirente, taxa_percentual: taxaPercentual(totalAdquirente.taxa, totalAdquirente.bruto) });

    const formas = new Map<string, typeof analise.modalidades>();
    for (const modalidade of analise.modalidades) {
      const forma = normalizarChaveLogo(modalidade.nome) === 'CARTEIRA DIGITAL' ? 'CARTEIRA DIGITAL' : 'CARTÃO';
      formas.set(forma, [...(formas.get(forma) || []), modalidade]);
    }

    for (const [forma, modalidades] of formas) {
      const totalForma = modalidades.reduce((total, modalidade) => ({
        quantidade: total.quantidade + modalidade.quantidade,
        bruto: total.bruto + modalidade.bruto,
        taxa: total.taxa + modalidade.taxa,
        liquido: total.liquido + modalidade.liquido,
      }), { quantidade: 0, bruto: 0, taxa: 0, liquido: 0 });
      linhas.push({ nivel: 'FORMA', adquirente: analise.adquirente, forma_pagamento: forma, modalidade: '', bandeira: '', ...totalForma, taxa_percentual: taxaPercentual(totalForma.taxa, totalForma.bruto) });

      for (const modalidade of [...modalidades].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
        linhas.push({ nivel: 'MODALIDADE', adquirente: analise.adquirente, forma_pagamento: forma, modalidade: modalidade.nome, bandeira: '', quantidade: modalidade.quantidade, bruto: modalidade.bruto, taxa: modalidade.taxa, liquido: modalidade.liquido, taxa_percentual: taxaPercentual(modalidade.taxa, modalidade.bruto) });
        for (const bandeira of [...modalidade.bandeiras].sort((a, b) => a.bandeira.localeCompare(b.bandeira, 'pt-BR'))) {
          linhas.push({ nivel: 'BANDEIRA', adquirente: analise.adquirente, forma_pagamento: forma, modalidade: modalidade.nome, bandeira: bandeira.bandeira, quantidade: bandeira.quantidade, bruto: bandeira.bruto, taxa: bandeira.taxa, liquido: bandeira.liquido, taxa_percentual: taxaPercentual(bandeira.taxa, bandeira.bruto) });
        }
      }
    }
  }
  return linhas;
}

function RelatorioResumoCard({
  label,
  value,
  type = 'money',
}: {
  label: string;
  value: unknown;
  type?: 'money' | 'number' | 'percent';
}) {
  const texto =
    type === 'money'
      ? formatarMoedaBrasil(value)
      : type === 'percent'
        ? formatarPercentual(value)
        : numeroRelatorio(value).toLocaleString('pt-BR');

  return (
    <div className="card">
      <span>{label}</span>
      <strong>{texto}</strong>
    </div>
  );
}

function RelatorioTabela({
  titulo,
  linhas,
  label = 'Grupo',
}: {
  titulo: string;
  linhas: RelatorioGrupo[];
  label?: string;
}) {
  return (
    <div className="panel report-panel">
      <h2>{titulo}</h2>

      <div className="table-wrap report-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{label}</th>
              <th>Qtd.</th>
              <th>Bruto</th>
              <th>Taxa</th>
              <th>Líquido</th>
              <th>Ticket médio</th>
              <th>Taxa média</th>
            </tr>
          </thead>

          <tbody>
            {linhas.map((linha) => (
              <tr key={`${titulo}-${linha.chave}`}>
                <td>{linha.data || linha.data_pagamento || linha.chave}</td>
                <td>{numeroRelatorio(linha.quantidade).toLocaleString('pt-BR')}</td>
                <td>{formatarMoedaBrasil(linha.bruto)}</td>
                <td>{formatarMoedaBrasil(linha.taxa)}</td>
                <td>{formatarMoedaBrasil(linha.liquido)}</td>
                <td>{formatarMoedaBrasil(linha.ticket_medio)}</td>
                <td>{formatarPercentual(linha.taxa_media_percentual)}</td>
              </tr>
            ))}

            {linhas.length === 0 && (
              <tr>
                <td colSpan={7}>Sem dados para os filtros selecionados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RelatorioBarras({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: RelatorioGrupo[];
}) {
  const maximo = Math.max(...linhas.map((linha) => numeroRelatorio(linha.bruto)), 1);

  return (
    <div className="panel report-panel">
      <h2>{titulo}</h2>

      <div className="report-bars">
        {linhas.slice(0, 8).map((linha) => {
          const percentual = Math.max(2, (numeroRelatorio(linha.bruto) / maximo) * 100);

          return (
            <div className="report-bar-row" key={`${titulo}-${linha.chave}`}>
              <span title={linha.chave}>{linha.chave}</span>

              <div className="report-bar-track">
                <div
                  className="report-bar-fill"
                  style={{ width: `${percentual}%` }}
                />
              </div>

              <strong>{formatarMoedaBrasil(linha.bruto)}</strong>
            </div>
          );
        })}
        
        {linhas.length === 0 && (
          <p className="muted-report">Sem dados para exibir.</p>
        )}
      </div>
    </div>
  );
}

function AnaliseFinanceiraAdquirentes({ analises }: { analises: RelatorioAdquirentes['analise_adquirentes'] }) {
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [hover, setHover] = useState(false);
  const [cardTelaCheia, setCardTelaCheia] = useState<'bandeiras' | 'matriz' | null>(null);
  const duracao = 30000;
  const principais = ['SIPAG', 'SICREDI', 'CIELO'];
  const chaveAdquirente = (valor: string) => normalizarChaveLogo(valor);
  const agregarAnalises = (itens: typeof analises, adquirente: string) => {
    const modalidadesMap = new Map<string, { nome: string; bruto: number; taxa: number; liquido: number; quantidade: number; bandeiras: Map<string, { bandeira: string; bruto: number; taxa: number; liquido: number; quantidade: number }> }>();
    const bandeirasHistoricas = new Set<string>();

    itens.forEach((analise) => {
      analise.bandeiras_historicas?.filter(Boolean).forEach((bandeira) => bandeirasHistoricas.add(nomeBandeiraRelatorio(bandeira)));
      analise.modalidades.forEach((modalidade) => {
        const chave = normalizarChaveLogo(modalidade.nome);
        const acumulada = modalidadesMap.get(chave) || { nome: modalidade.nome, bruto: 0, taxa: 0, liquido: 0, quantidade: 0, bandeiras: new Map() };
        acumulada.bruto += modalidade.bruto;
        acumulada.taxa += modalidade.taxa;
        acumulada.liquido += modalidade.liquido;
        acumulada.quantidade += modalidade.quantidade;
        modalidade.bandeiras.forEach((bandeira) => {
          const nomeBandeira = nomeBandeiraRelatorio(bandeira.bandeira);
          bandeirasHistoricas.add(nomeBandeira);
          const chaveBandeira = normalizarChaveLogo(nomeBandeira);
          const acumuladaBandeira = acumulada.bandeiras.get(chaveBandeira) || { bandeira: nomeBandeira, bruto: 0, taxa: 0, liquido: 0, quantidade: 0 };
          acumuladaBandeira.bruto += bandeira.bruto;
          acumuladaBandeira.taxa += bandeira.taxa;
          acumuladaBandeira.liquido += bandeira.liquido;
          acumuladaBandeira.quantidade += bandeira.quantidade;
          acumulada.bandeiras.set(chaveBandeira, acumuladaBandeira);
        });
        modalidadesMap.set(chave, acumulada);
      });
    });

    return {
      adquirente,
      adquirentes: itens.map((item) => item.adquirente),
      bandeiras_historicas: Array.from(bandeirasHistoricas),
      modalidades: Array.from(modalidadesMap.values()).map(({ bandeiras, ...modalidade }) => ({ ...modalidade, bandeiras: Array.from(bandeiras.values()) })),
    };
  };
  const etapas = principais
    .map((nome) => analises.find((item) => chaveAdquirente(item.adquirente) === nome))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => agregarAnalises([item], item.adquirente));
  const secundarias = analises.filter((item) => !principais.includes(chaveAdquirente(item.adquirente)));
  if (secundarias.length) etapas.push(agregarAnalises(secundarias, 'OUTRAS ADQUIRENTES'));
  const atual = etapas[indice];

  useEffect(() => { setIndice(0); }, [analises]);
  useEffect(() => {
    if (pausado || hover || cardTelaCheia || etapas.length < 2) return;
    const timer = window.setTimeout(() => setIndice((valor) => (valor + 1) % etapas.length), duracao);
    return () => window.clearTimeout(timer);
  }, [indice, pausado, hover, cardTelaCheia, etapas.length]);
  useEffect(() => {
    if (!cardTelaCheia) return;
    const sairComEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCardTelaCheia(null);
    };
    window.addEventListener('keydown', sairComEsc);
    return () => window.removeEventListener('keydown', sairComEsc);
  }, [cardTelaCheia]);

  if (!atual) return <div className="panel acquirer-analysis-empty">Sem vendas para os filtros selecionados.</div>;

  const bandeirasCandidatas = (atual.bandeiras_historicas?.length
    ? atual.bandeiras_historicas
    : Array.from(new Set(atual.modalidades.flatMap((item) => item.bandeiras.map((b) => b.bandeira)))))
    .filter(Boolean)
    .map(nomeBandeiraRelatorio);
  const modalidadesHistoricas = atual.modalidades.map((item) => item.nome);
  const modalidades = Array.from(new Set(['DEBITO', 'CREDITO', 'VOUCHER', 'CARTEIRA DIGITAL', ...modalidadesHistoricas]));
  const agregadoBandeira = Array.from(new Set(bandeirasCandidatas)).map((nome) => {
    const itens = atual.modalidades.flatMap((modalidade) => modalidade.bandeiras).filter((item) => nomeBandeiraRelatorio(item.bandeira) === nome);
    return { nome, bruto: itens.reduce((s, i) => s + i.bruto, 0), taxa: itens.reduce((s, i) => s + i.taxa, 0), liquido: itens.reduce((s, i) => s + i.liquido, 0) };
  }).filter((item) => Math.abs(item.bruto) + Math.abs(item.taxa) + Math.abs(item.liquido) > 0);
  const bandeiras = agregadoBandeira.map((item) => item.nome);
  const totais = agregadoBandeira.reduce((acc, item) => ({ bruto: acc.bruto + item.bruto, taxa: acc.taxa + item.taxa, liquido: acc.liquido + item.liquido }), { bruto: 0, taxa: 0, liquido: 0 });
  const taxaMedia = (taxa: number, bruto: number) => bruto > 0 ? (taxa / bruto) * 100 : null;
  const resumoCelula = (valores?: { bruto: number; taxa: number; liquido: number }) => {
    const bruto = valores?.bruto || 0;
    const taxa = valores?.taxa || 0;
    const liquido = valores?.liquido || 0;
    const percentual = taxaMedia(taxa, bruto);

  return (
    <div className={`matrix-financial-cell${bruto === 0 ? ' zero' : ''}`}>
      <span><strong>{formatarMoedaBrasil(bruto)}</strong></span>
      <span className="matrix-rate">
        <strong>{percentual === null ? '—' : formatarPercentual(percentual)}</strong>
      </span>
      <span><strong>{formatarMoedaBrasil(liquido)}</strong></span>
    </div>
  );
  };
  const mover = (passo: number) => setIndice((valor) => (valor + passo + etapas.length) % etapas.length);
  const cabecalhoAdquirentes = (compacto = false) => atual.adquirentes.length === 1
    ? <RenderAdquirenteLogo valor={atual.adquirentes[0]} />
    : <div className={`acquirer-logo-cluster${compacto ? ' compact' : ''}`}>{atual.adquirentes.map((nome) => <span key={nome}><RenderAdquirenteLogo valor={nome} /></span>)}</div>;

  return (
    <section className="acquirer-analysis-section">
      {/*<div className="acquirer-analysis-heading"><div><h2>Análise financeira por adquirente</h2><p>Detalhamento sincronizado por bandeira e modalidade.</p></div></div>*/}
      <div className="acquirer-carousel" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <article className={`panel acquirer-story-card${cardTelaCheia === 'bandeiras' ? ' report-card-fullscreen' : ''}`}>
          <div key={`${indice}-${pausado}-${hover}`} className={`acquirer-progress ${pausado || hover ? 'paused' : ''}`} style={{ animationDuration: `${duracao}ms` }} />
          <header className="acquirer-story-header">
            <button className="icon-button secondary" onClick={() => mover(-1)} aria-label="Adquirente anterior"><ChevronLeft size={18}/></button>
            <div>{cabecalhoAdquirentes()}{/*<strong>{atual.adquirente}</strong>*/}<small>{indice + 1} de {etapas.length}</small></div>
            <button className="icon-button secondary" onClick={() => mover(1)} aria-label="Próxima adquirente"><ChevronRight size={18}/></button>
            <button className="icon-button secondary acquirer-fullscreen-button" onClick={() => setCardTelaCheia((atual) => atual === 'bandeiras' ? null : 'bandeiras')} title={cardTelaCheia === 'bandeiras' ? 'Sair do modo tela cheia' : 'Abrir em tela cheia'} aria-label={cardTelaCheia === 'bandeiras' ? 'Sair do modo tela cheia' : 'Abrir em tela cheia'}>{cardTelaCheia === 'bandeiras' ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
          </header>
          <div className="brand-financial-table table-wrap">
            <table><thead><tr><th>Bandeira</th><th>Bruto</th><th>Taxas</th><th>% taxa</th><th>Líquido</th></tr></thead>
              <tbody>{agregadoBandeira.map((item) => <tr className={item.bruto === 0 ? 'zero-row' : ''} key={item.nome}>
                <td><RenderBandeiraLogo  valor={item.nome}  />{item.bruto === 0 && <small>Sem vendas no período</small>}</td>
                <td>{formatarMoedaBrasil(item.bruto)}</td><td>{formatarMoedaBrasil(item.taxa)}</td><td className="rate-cell">{taxaMedia(item.taxa, item.bruto) === null ? '—' : formatarPercentual(taxaMedia(item.taxa, item.bruto))}</td><td>{formatarMoedaBrasil(item.liquido)}</td>
              </tr>)}</tbody>
              <tfoot><tr><th>Total</th><th>{formatarMoedaBrasil(totais.bruto)}</th><th>{formatarMoedaBrasil(totais.taxa)}</th><th className="rate-cell">{taxaMedia(totais.taxa, totais.bruto) === null ? '—' : formatarPercentual(taxaMedia(totais.taxa, totais.bruto))}</th><th>{formatarMoedaBrasil(totais.liquido)}</th></tr></tfoot>
            </table>
          </div>
          <div className="acquirer-carousel-controls">
            <button className="icon-button secondary" onClick={() => setPausado((valor) => !valor)} aria-label={pausado ? 'Continuar rotação' : 'Pausar rotação'}>{pausado ? <Play size={16}/> : <Pause size={16}/>}</button>
            <div className="acquirer-dots">{etapas.map((item, posicao) => <button key={item.adquirente} className={posicao === indice ? 'active' : ''} onClick={() => setIndice(posicao)} title={item.adquirente} aria-label={`Exibir ${item.adquirente}`}/>)}</div>
          </div>
        </article>

        <article className={`panel acquirer-matrix-card${cardTelaCheia === 'matriz' ? ' report-card-fullscreen' : ''}`}>
          <header><div>{cabecalhoAdquirentes(true)}<strong></strong></div><div className="acquirer-matrix-actions"><span>{atual.adquirente}</span><button className="icon-button secondary acquirer-fullscreen-button" onClick={() => setCardTelaCheia((atual) => atual === 'matriz' ? null : 'matriz')} title={cardTelaCheia === 'matriz' ? 'Sair do modo tela cheia' : 'Abrir em tela cheia'} aria-label={cardTelaCheia === 'matriz' ? 'Sair do modo tela cheia' : 'Abrir em tela cheia'}>{cardTelaCheia === 'matriz' ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button></div></header>

        <div className="table-wrap acquirer-matrix-wrap">
          <table>
            <thead>
              <tr>
                <th>Modalidade</th>
                <th className="matrix-type-header">Tipo</th>

                {bandeiras.map((nome) => (
                  <th key={nome}>
                    <RenderBandeiraLogo valor={nome}/>
                  </th>
                ))}

                <th>Total</th>
              </tr>
            </thead>

            <tbody>
              {modalidades.map((nomeModalidade) => {
                const modalidade = atual.modalidades.find(
                  (item) => item.nome === nomeModalidade
                );

                return (
                  <tr key={nomeModalidade}>
                    <th>{nomeModalidade}</th>

                    <th className="matrix-financial-labels">
                      <span>Bruto</span>
                      <span>Taxa</span>
                      <span>Líquido</span>
                    </th>

                    {bandeiras.map((nomeBandeira) => (
                      <td key={nomeBandeira}>
                        {resumoCelula(
                          modalidade?.bandeiras.find(
                            (item) => item.bandeira === nomeBandeira
                          )
                        )}
                      </td>
                    ))}

                    <th>{resumoCelula(modalidade)}</th>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <th>Total</th>

                <th className="matrix-financial-labels">
                  <span>Bruto</span>
                  <span>Taxa</span>
                  <span>Líquido</span>
                </th>

                {agregadoBandeira.map((item) => (
                  <th key={item.nome}>
                    {resumoCelula(item)}
                  </th>
                ))}

                <th>{resumoCelula(totais)}</th>
              </tr>
            </tfoot>
          </table>
        </div>


        </article>
      </div>
    </section>
  );
}

function TotalizadoresDetalhados({ relatorio }: { relatorio: RelatorioAdquirentes }) {
  const [aba, setAba] = useState<'adquirente' | 'modalidade' | 'bandeira' | 'status'>('adquirente');
  const configuracoes = {
    adquirente: { titulo: 'Adquirente', linhas: relatorio.por_adquirente },
    modalidade: { titulo: 'Modalidade', linhas: relatorio.por_modalidade },
    bandeira: { titulo: 'Bandeira', linhas: relatorio.por_bandeira },
  };
  const selecionada = aba === 'status' ? null : configuracoes[aba];
  const status = [
    ['Autorizadas', relatorio.resumo.autorizadas],
    ['Canceladas', relatorio.resumo.canceladas],
    ['Negadas', relatorio.resumo.negadas],
    ['Estornadas/desfeitas', relatorio.resumo.estornadas],
  ] as Array<[string, number]>;

  return <section className="panel detailed-totals-card">
    <header><div><h2>Totalizadores detalhados do período</h2><p>Consolidado fixo de todas as vendas que atendem aos filtros aplicados.</p></div>
      <div className="detailed-total-tabs">
        {(['adquirente', 'modalidade', 'bandeira', 'status'] as const).map((item) => <button className={aba === item ? 'active' : 'secondary'} onClick={() => setAba(item)} key={item}>{item === 'status' ? 'Status' : `Por ${item}`}</button>)}
      </div>
    </header>
    {selecionada ? <div className="table-wrap report-table-wrap"><table><thead><tr><th>{selecionada.titulo}</th><th>Transações</th><th>Bruto</th><th>Taxas</th><th>Taxa efetiva</th><th>Líquido</th><th>Ticket médio</th></tr></thead>
      <tbody>{selecionada.linhas.map((linha) => <tr key={`${aba}-${linha.chave}`}><td>{linha.chave}</td><td>{numeroRelatorio(linha.quantidade).toLocaleString('pt-BR')}</td><td>{formatarMoedaBrasil(linha.bruto)}</td><td>{formatarMoedaBrasil(linha.taxa)}</td><td className="rate-cell">{formatarPercentual(linha.taxa_media_percentual)}</td><td>{formatarMoedaBrasil(linha.liquido)}</td><td>{formatarMoedaBrasil(linha.ticket_medio)}</td></tr>)}</tbody>
    </table></div> : <div className="detailed-status-grid">{status.map(([nome, quantidade]) => <div key={nome}><span>{nome}</span><strong>{numeroRelatorio(quantidade).toLocaleString('pt-BR')}</strong></div>)}<div><span>Percentual de aprovação</span><strong>{formatarPercentual(relatorio.resumo.quantidade_transacoes ? (relatorio.resumo.autorizadas / relatorio.resumo.quantidade_transacoes) * 100 : 0)}</strong></div></div>}
  </section>;
}

export function RelatoriosAdquirentesPage() {
  const { relatorio, message, setMessage, loading, filtros, setFiltros, filtrosAplicados, carregarRelatorio } = useRelatorioFinanceiro(filtrosPadraoPeriodoAtual);

  function atualizarFiltro(chave: keyof FiltrosRelatorio, valor: string) {
    setFiltros((atual) => {
      const proximos: FiltrosRelatorio = {
        ...atual,
        [chave]: valor,
      };

      if (chave === 'adquirente') {
        proximos.forma_pagamento = '';
        proximos.modalidade = '';
        proximos.bandeira = '';
      }

      if (chave === 'forma_pagamento') {
        proximos.modalidade = valor === 'CARTEIRA DIGITAL' ? 'CARTEIRA DIGITAL' : '';
        proximos.bandeira = '';
      }

      if (chave === 'modalidade') {
        proximos.bandeira = '';
      }

      return proximos;
    });
  }

  function limparFiltros() {
    const padrao = filtrosPadraoPeriodoAtual();
    setFiltros(padrao);
    carregarRelatorio(padrao);
  }

  function aplicarPeriodo(tipo: 'ONTEM' | '7_DIAS' | 'MES_ATUAL' | 'MES_ANTERIOR') {
    const hoje = new Date();
    let inicio = new Date(hoje);
    let fim = new Date(hoje);
    if (tipo === 'ONTEM') inicio = fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    if (tipo === '7_DIAS') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6);
    if (tipo === 'MES_ATUAL') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    if (tipo === 'MES_ANTERIOR') {
      inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    }
    const proximosFiltros = {
      ...filtros,
      data_inicio: formatarDataInputLocal(inicio),
      data_fim: formatarDataInputLocal(fim),
    };
    setFiltros(proximosFiltros);
    void carregarRelatorio(proximosFiltros);
  }

  function baixarArquivo(conteudo: string, nome: string, tipo: string) {
    const blob = new Blob(['\ufeff', conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
  }

  const nomeBaseRelatorio = `relatorio-financeiro-${filtrosAplicados.data_inicio || 'inicio'}-${filtrosAplicados.data_fim || 'fim'}`;
  const linhasFinanceiras = montarLinhasRelatorioFinanceiro(relatorio);
  const periodoRelatorio = `${formatarDataBrRelatorio(filtrosAplicados.data_inicio)} a ${formatarDataBrRelatorio(filtrosAplicados.data_fim)}`;
  const filtrosRelatorio = [
    ['Busca', filtrosAplicados.busca], ['Loja', filtrosAplicados.estabelecimento], ['Adquirente', filtrosAplicados.adquirente], ['F. Pagamento', filtrosAplicados.forma_pagamento],
    ['Modalidade', filtrosAplicados.modalidade], ['Bandeira', filtrosAplicados.bandeira], ['Status', filtrosAplicados.status],
  ].filter(([, valor]) => valor).map(([nome, valor]) => `${nome}: ${valor}`).join(' | ') || 'Todos os registros do período';

  function exportarCsv() {
    const resumo = [
      ['RELATÓRIO FINANCEIRO DE VENDAS POR ADQUIRENTE'],
      ['Período', periodoRelatorio], ['Filtros', filtrosRelatorio], ['Emitido em', new Date().toLocaleString('pt-BR')], [],
      ['RESUMO EXECUTIVO'],
      ['Transações', 'Valor bruto', 'Valor das taxas', 'Taxa efetiva (%)', 'Valor líquido', 'Ticket médio'],
      [relatorio.resumo.quantidade_transacoes, relatorio.resumo.total_bruto, relatorio.resumo.total_taxas, relatorio.resumo.taxa_media_percentual, relatorio.resumo.total_liquido, relatorio.resumo.ticket_medio], [],
      ['DETALHAMENTO POR ADQUIRENTE / FORMA / MODALIDADE / BANDEIRA'],
      ['Adquirente', 'Forma de pagamento', 'Modalidade', 'Bandeira', 'Transações', 'Valor bruto', 'Valor das taxas', 'Taxa efetiva (%)', 'Valor líquido'],
      ...linhasFinanceiras.map((linha) => [linha.adquirente, linha.forma_pagamento, linha.modalidade, linha.bandeira, linha.quantidade, linha.bruto, linha.taxa, linha.taxa_percentual, linha.liquido]), [],
      ['EVOLUÇÃO DIÁRIA'],
      ['Data', 'Transações', 'Valor bruto', 'Valor das taxas', 'Taxa efetiva (%)', 'Valor líquido'],
      ...relatorio.por_dia.map((linha) => [linha.data || linha.chave, linha.quantidade, linha.bruto, linha.taxa, linha.taxa_media_percentual, linha.liquido]),
    ];
    const csv = resumo.map((linha) => linha.map((valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    baixarArquivo(csv, `${nomeBaseRelatorio}.csv`, 'text/csv;charset=utf-8');
  }

  function corpoTabelaFinanceira() {
    return linhasFinanceiras.map((linha) => {
      const descricao = linha.nivel === 'ADQUIRENTE' ? linha.adquirente : linha.nivel === 'FORMA' ? linha.forma_pagamento : linha.nivel === 'MODALIDADE' ? linha.modalidade : linha.bandeira;
      const logo = linha.nivel === 'ADQUIRENTE'
        ? adquirenteLogoMap[normalizarChaveLogo(descricao)]
        : linha.nivel === 'BANDEIRA'
          ? bandeiraLogoMap[normalizarChaveLogo(descricao)]
          : undefined;
      const descricaoComLogo = logo
        ? `<span class="report-name"><img src="${escaparHtmlRelatorio(logo)}" alt=""><span>${escaparHtmlRelatorio(descricao)}</span></span>`
        : escaparHtmlRelatorio(descricao);
      return `<tr class="nivel-${linha.nivel.toLowerCase()}"><td>${descricaoComLogo}</td><td>${linha.quantidade.toLocaleString('pt-BR')}</td><td>${formatarMoedaBrasil(linha.bruto)}</td><td>${formatarMoedaBrasil(linha.taxa)}</td><td>${formatarPercentual(linha.taxa_percentual)}</td><td>${formatarMoedaBrasil(linha.liquido)}</td></tr>`;
    }).join('');
  }

  function htmlRelatorioFinanceiro(modoImpressao = false) {
    const status = [['Autorizadas', relatorio.resumo.autorizadas], ['Canceladas', relatorio.resumo.canceladas], ['Negadas', relatorio.resumo.negadas], ['Estornadas/desfeitas', relatorio.resumo.estornadas]];
    const evolucao = relatorio.por_dia.map((linha) => `<tr><td>${escaparHtmlRelatorio(linha.data || linha.chave)}</td><td>${numeroRelatorio(linha.quantidade).toLocaleString('pt-BR')}</td><td>${formatarMoedaBrasil(linha.bruto)}</td><td>${formatarMoedaBrasil(linha.taxa)}</td><td>${formatarPercentual(linha.taxa_media_percentual)}</td><td>${formatarMoedaBrasil(linha.liquido)}</td></tr>`).join('');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório financeiro - ${escaparHtmlRelatorio(periodoRelatorio)}</title><style>
      @page{size:A4 portrait;margin:12mm 9mm 14mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{font-family:Arial,sans-serif;color:#18212b;margin:24px auto 48px;padding:0 28px;max-width:1180px;font-size:10px;background:#fff}h1{margin:0;color:#17212b;font-size:22px}h2{font-size:14px;margin:18px 0 7px;border-left:5px solid #f5b400;padding-left:8px}.report-toolbar{position:sticky;top:0;z-index:10;display:flex;justify-content:flex-end;padding:10px 0;background:rgba(255,255,255,.96)}.print-button{border:0;border-radius:6px;background:#25313d;color:#fff;font-weight:bold;padding:9px 14px;cursor:pointer}.header{border-bottom:3px solid #f5b400;padding-bottom:9px;margin-bottom:12px;display:flex;justify-content:space-between;gap:20px}.header p{margin:3px 0;color:#52606d}.stamp{text-align:right;white-space:nowrap}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.metric{border:1px solid #cbd4dd;border-radius:5px;padding:8px;background:#eef2f5}.metric span{display:block;color:#607080;font-size:8px;text-transform:uppercase;font-weight:bold}.metric strong{display:block;margin-top:4px;font-size:13px}.status{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0;color:#52606d}.status b{color:#18212b}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{background:#25313d!important;color:#fff!important;text-align:left;padding:5px 4px;border:1px solid #25313d;font-size:8px}td{padding:4px;border:1px solid #d3dae1;text-align:right;font-size:8.5px}td:first-child{text-align:left}.nivel-adquirente td{background:#dfe5ea!important;font-weight:bold;border-top:2px solid #657381}.nivel-forma td{background:#edf0f3!important;font-weight:bold}.nivel-modalidade td:first-child{padding-left:18px;font-weight:bold}.nivel-bandeira td:first-child{padding-left:34px;color:#52606d}.report-name{display:inline-flex;align-items:center;gap:7px;min-width:0}.report-name img{display:block;width:34px;height:16px;object-fit:contain;object-position:left center}.nivel-adquirente .report-name img{width:44px;height:18px}.footer{position:fixed;bottom:-9mm;left:0;right:0;border-top:1px solid #cdd5dd;padding-top:3px;color:#72808e;font-size:8px;display:flex;justify-content:space-between}.page-number:after{content:'Página ' counter(page)}.section{break-before:auto}.daily{break-before:page;page-break-before:always;margin:0 0 14px}.daily h2{margin-top:0}@media print{body{margin:0;padding:0;max-width:none;font-size:9px}.report-toolbar{display:none!important}.summary{grid-template-columns:repeat(3,1fr)}h1{font-size:18px}h2{font-size:12px;margin-top:12px}.metric{padding:6px}.metric strong{font-size:11px}th{padding:4px 3px;font-size:7.5px}td{padding:3px;font-size:7.5px}.report-name img{width:28px;height:13px}.nivel-adquirente .report-name img{width:36px;height:15px}}${modoImpressao ? '' : '.footer{display:none}'}</style></head><body>
      ${modoImpressao ? '<div class="report-toolbar"><button class="print-button" onclick="window.print()">Imprimir / Salvar PDF</button></div>' : ''}
      <header class="header"><div><h1>Relatório financeiro de vendas</h1><p><b>Período:</b> ${escaparHtmlRelatorio(periodoRelatorio)}</p><p><b>Filtros:</b> ${escaparHtmlRelatorio(filtrosRelatorio)}</p></div><div class="stamp"><b>ERPxADQUIRENTE</b><p>Emitido em ${new Date().toLocaleString('pt-BR')}</p></div></header>
      <section class="summary"><div class="metric"><span>Total bruto vendido</span><strong>${formatarMoedaBrasil(relatorio.resumo.total_bruto)}</strong></div><div class="metric"><span>Total de taxas</span><strong>${formatarMoedaBrasil(relatorio.resumo.total_taxas)}</strong></div><div class="metric"><span>Total líquido</span><strong>${formatarMoedaBrasil(relatorio.resumo.total_liquido)}</strong></div><div class="metric"><span>Transações</span><strong>${relatorio.resumo.quantidade_transacoes.toLocaleString('pt-BR')}</strong></div><div class="metric"><span>Ticket médio</span><strong>${formatarMoedaBrasil(relatorio.resumo.ticket_medio)}</strong></div><div class="metric"><span>Taxa efetiva</span><strong>${formatarPercentual(relatorio.resumo.taxa_media_percentual)}</strong></div></section>
      <div class="status">${status.map(([nome, valor]) => `<span>${nome}: <b>${Number(valor).toLocaleString('pt-BR')}</b></span>`).join('')}</div>
      <section class="section"><h2>Detalhamento por adquirente</h2><table><thead><tr><th style="width:30%">Adquirente / Forma / Modalidade / Bandeira</th><th style="width:10%">Transações</th><th style="width:15%">Valor bruto</th><th style="width:15%">Valor das taxas</th><th style="width:13%">Taxa efetiva</th><th style="width:17%">Valor líquido</th></tr></thead><tbody>${corpoTabelaFinanceira() || '<tr><td colspan="6">Sem dados para os filtros selecionados.</td></tr>'}</tbody></table></section>
      <section class="section daily"><h2>Evolução diária</h2><table><thead><tr><th>Data</th><th>Transações</th><th>Valor bruto</th><th>Valor das taxas</th><th>Taxa efetiva</th><th>Valor líquido</th></tr></thead><tbody>${evolucao || '<tr><td colspan="6">Sem dados para os filtros selecionados.</td></tr>'}</tbody></table></section>
      <footer class="footer"><span>Fonte: tabela vendas_adquirentes · Valores conforme filtros aplicados</span><span class="page-number"></span></footer></body></html>`;
  }

  function exportarExcel() {
    baixarArquivo(htmlRelatorioFinanceiro(false), `${nomeBaseRelatorio}.xls`, 'application/vnd.ms-excel;charset=utf-8');
  }

  function imprimirRelatorio() {
    const janela = window.open('', '_blank');
    if (!janela) { setMessage('O navegador bloqueou a abertura do relatório. Libere pop-ups para imprimir.'); return; }
    janela.opener = null;
    janela.document.open();
    janela.document.write(htmlRelatorioFinanceiro(true));
    janela.document.close();
    janela.focus();
    setMessage('Relatório aberto em uma nova aba. Revise e use “Imprimir / Salvar PDF” quando desejar.');
  }

  const modalidadesDisponiveis = relatorio.opcoes.modalidades.filter((item) => {
    const modalidade = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'CARTEIRA DIGITAL') return modalidade === 'CARTEIRA DIGITAL';
    if (filtros.forma_pagamento === 'CARTAO') return modalidade !== 'CARTEIRA DIGITAL';
    return true;
  });
  const modalidadeBloqueada = filtros.forma_pagamento === 'CARTEIRA DIGITAL';

  return (
    <section className="reports-page">
      <div className="report-heading">
        <div><h1>Relatórios financeiros</h1><p>Visão das vendas realizadas, baseada exclusivamente nos dados das adquirentes.</p></div>
        <div className="report-export-actions">
          <button className="secondary" onClick={exportarCsv} disabled={loading}><Download size={16}/> CSV</button>
          <button className="secondary" onClick={exportarExcel} disabled={loading}><FileSpreadsheet size={16}/> Excel</button>
          <button className="secondary" onClick={imprimirRelatorio} disabled={loading}><Printer size={16}/> Imprimir</button>
        </div>
      </div>
      <div className="report-period-shortcuts">
        <CalendarDays size={17}/><span>Período rápido:</span>
        <button onClick={() => aplicarPeriodo('ONTEM')}>Ontem</button>
        <button onClick={() => aplicarPeriodo('7_DIAS')}>Últimos 7 dias</button><button onClick={() => aplicarPeriodo('MES_ATUAL')}>Mês atual</button>
        <button onClick={() => aplicarPeriodo('MES_ANTERIOR')}>Mês anterior</button>
      </div>
      <div className="panel report-filters">
        <div className="vendas-search-field">
          <label>Busca</label>
          <input
            type="search"
            value={filtros.busca}
            placeholder="Valor, NSU, autorização, terminal, ID ou valores"
            onChange={(event) => atualizarFiltro('busca', event.target.value)}
          />
        </div>

        <div>
          <label>Data inicial</label>
          <input
            type="date"
            value={filtros.data_inicio}
            onChange={(event) => atualizarFiltro('data_inicio', event.target.value)}
          />
        </div>

        <div>
          <label>Data final</label>
          <input
            type="date"
            value={filtros.data_fim}
            onChange={(event) => atualizarFiltro('data_fim', event.target.value)}
          />
        </div>

        <div>
          <label>Loja</label>
          <select value={filtros.estabelecimento} onChange={(event) => atualizarFiltro('estabelecimento', event.target.value)}>
            <option value="">Todos</option>
            {relatorio.opcoes.estabelecimentos.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div>
          <label>Adquirente</label>
          <select
            value={filtros.adquirente}
            onChange={(event) => atualizarFiltro('adquirente', event.target.value)}
          >
            <option value="">Todas</option>
            {relatorio.opcoes.adquirentes.map((item) => (
              <option key={item} value={item}>
                {rotuloBandeiraFiltro(item)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>F. Pagamento</label>
          <select
            value={filtros.forma_pagamento}
            onChange={(event) => atualizarFiltro('forma_pagamento', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="CARTAO">CARTÃO</option>
            <option value="CARTEIRA DIGITAL">CARTEIRA DIGITAL</option>
          </select>
        </div>

        <div>
          <label>Modalidade</label>
          <select
            value={filtros.modalidade}
            onChange={(event) => atualizarFiltro('modalidade', event.target.value)}
            disabled={modalidadeBloqueada}
          >
            <option value="">Todas</option>
            {modalidadesDisponiveis.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Bandeira</label>
          <select
            value={filtros.bandeira}
            onChange={(event) => atualizarFiltro('bandeira', event.target.value)}
          >
            <option value="">Todas</option>
            {relatorio.opcoes.bandeiras.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {/*<div>
          <label>Status</label>
          <select
            value={filtros.status}
            onChange={(event) => atualizarFiltro('status', event.target.value)}
          >
            <option value="">Todos</option>
            {relatorio.opcoes.status.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>*/}

        <div className="report-filter-actions">
          <button onClick={() => carregarRelatorio(filtros)} disabled={loading}>
            {loading ? 'Carregando...' : 'Aplicar filtros'}
          </button>

          <button className="secondary" onClick={limparFiltros} disabled={loading}>
            Limpar tudo
          </button>
        </div>
      </div>

      {message && <p className="message">{message}</p>}

      <div className="report-active-period">
        Período analisado: <strong>{formatarDataBrRelatorio(filtrosAplicados.data_inicio)}</strong> a <strong>{formatarDataBrRelatorio(filtrosAplicados.data_fim)}</strong>
      </div>

      <div className="cards report-summary-cards">
        <RelatorioResumoCard label="Total bruto vendido" value={relatorio.resumo.total_bruto} />
        <RelatorioResumoCard label="Total de taxas" value={relatorio.resumo.total_taxas} />
        <RelatorioResumoCard label="Total líquido" value={relatorio.resumo.total_liquido} />
        <RelatorioResumoCard label="Transações" value={relatorio.resumo.quantidade_transacoes} type="number" />
        <RelatorioResumoCard label="Ticket médio" value={relatorio.resumo.ticket_medio} />
        <RelatorioResumoCard label="Taxa média" value={relatorio.resumo.taxa_media_percentual} type="percent" />
        <RelatorioResumoCard label="Autorizadas" value={relatorio.resumo.autorizadas} type="number" />
        <RelatorioResumoCard label="Canceladas" value={relatorio.resumo.canceladas} type="number" />
        <RelatorioResumoCard label="Negadas" value={relatorio.resumo.negadas} type="number" />
        <RelatorioResumoCard label="Estornadas/desfeitas" value={relatorio.resumo.estornadas} type="number" />
      </div>

      <AnaliseFinanceiraAdquirentes analises={relatorio.analise_adquirentes || []} />

      <TotalizadoresDetalhados relatorio={relatorio} />

      <div className="report-grid-barras">
        <RelatorioBarras titulo="Evolução diária" linhas={relatorio.por_dia} />
        <RelatorioBarras titulo="Vendas por adquirente" linhas={relatorio.por_adquirente} />
        <RelatorioBarras titulo="Vendas por forma de pagamento" linhas={relatorio.por_forma_pagamento} />
        <RelatorioBarras titulo="Vendas por modalidade" linhas={relatorio.por_modalidade} />
      </div>

      <RelatorioTabela titulo="Resumo diário" linhas={relatorio.por_dia} label="Data" />
    </section>
  );
}
