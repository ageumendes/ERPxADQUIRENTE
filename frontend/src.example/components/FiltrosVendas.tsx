import React from 'react';

export type OpcoesFiltrosVendas = {
  estabelecimentos: string[];
  adquirentes: string[];
  modalidades: string[];
  bandeiras: string[];
  status: string[];
};

export type FiltrosListagemVendas = {
  busca: string;
  data_inicio: string;
  data_fim: string;
  estabelecimento: string;
  adquirente: string;
  forma_pagamento: string;
  modalidade: string;
  bandeira: string;
  status: string;
  conciliacao: string;
};

export const opcoesFiltrosVazias: OpcoesFiltrosVendas = {
  estabelecimentos: [],
  adquirentes: [],
  modalidades: [],
  bandeiras: [],
  status: [],
};

export function rotuloBandeiraFiltro(valor: string) {
  return valor.trim().toUpperCase() === 'OUTRAS' || /^\d+$/.test(valor.trim()) ? 'Outras' : valor;
}

export function criarFiltrosVendasPadrao(agora = new Date()): FiltrosListagemVendas {
  const formatar = (data: Date) => {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  };
  return {
    busca: '',
    data_inicio: formatar(new Date(agora.getFullYear(), agora.getMonth(), 1)),
    data_fim: formatar(agora),
    estabelecimento: '',
    adquirente: '',
    forma_pagamento: '',
    modalidade: '',
    bandeira: '',
    status: '',
    conciliacao: '',
  };
}

export function filtrosVendasDaUrl(params: URLSearchParams, padrao = criarFiltrosVendasPadrao()): FiltrosListagemVendas {
  const resultado = { ...padrao };
  for (const chave of Object.keys(resultado) as Array<keyof FiltrosListagemVendas>) {
    if (params.has(chave)) resultado[chave] = params.get(chave) || '';
  }
  return resultado;
}

export function paramsUrlDosFiltros(filtros: FiltrosListagemVendas) {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor) params.set(chave, valor);
  }
  return params;
}

export function montarParamsListagemVendas(filtros: FiltrosListagemVendas, limite: number, offset: number) {
  const params = new URLSearchParams();
  params.set('limite', String(limite));
  params.set('offset', String(offset));

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor) params.set(chave, valor);
  });

  return params;
}

export function ajustarFiltrosListagemVendas(atual: FiltrosListagemVendas, chave: keyof FiltrosListagemVendas, valor: string) {
  const proximos: FiltrosListagemVendas = {
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
}

export function FiltrosVendas({
  filtros,
  opcoes,
  loading,
  exibirAdquirente = false,
  exibirStatus = true,
  exibirConciliacao = false,
  onChange,
  onFiltrar,
  onLimpar,
}: {
  filtros: FiltrosListagemVendas;
  opcoes: OpcoesFiltrosVendas;
  loading: boolean;
  exibirAdquirente?: boolean;
  exibirStatus?: boolean;
  exibirConciliacao?: boolean;
  onChange: (chave: keyof FiltrosListagemVendas, valor: string) => void;
  onFiltrar: () => void;
  onLimpar: () => void;
}) {
  const modalidadesDisponiveis = opcoes.modalidades.filter((item) => {
    const modalidade = String(item || '').toUpperCase();
    if (filtros.forma_pagamento === 'CARTEIRA DIGITAL') return modalidade === 'CARTEIRA DIGITAL';
    if (filtros.forma_pagamento === 'CARTAO') return modalidade !== 'CARTEIRA DIGITAL';
    return true;
  });
  const modalidadeBloqueada = filtros.forma_pagamento === 'CARTEIRA DIGITAL';

  return (
    <div className={`panel report-filters vendas-filters${exibirAdquirente ? ' vendas-filters--adquirentes' : ''}`}>
      <div className="vendas-search-field">
        <label>Busca</label>
        <input
          type="search"
          value={filtros.busca}
          placeholder="Buscar em todas as colunas exibidas"
          onChange={(event) => onChange('busca', event.target.value)}
        />
      </div>
      <div>
        <label>Data inicial</label>
        <input
          type="date"
          value={filtros.data_inicio}
          onChange={(event) => onChange('data_inicio', event.target.value)}
        />
      </div>

      <div>
        <label>Data final</label>
        <input
          type="date"
          value={filtros.data_fim}
          onChange={(event) => onChange('data_fim', event.target.value)}
        />
      </div>

      <div>
        <label>Loja</label>
        <select value={filtros.estabelecimento} onChange={(event) => onChange('estabelecimento', event.target.value)}>
          <option value="">Todos</option>
          {opcoes.estabelecimentos.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      {exibirAdquirente && (
        <div>
          <label>Adquirente</label>
          <select
            value={filtros.adquirente}
            onChange={(event) => onChange('adquirente', event.target.value)}
          >
            <option value="">Todas</option>
            {opcoes.adquirentes.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label>F. Pagamento</label>
        <select
          value={filtros.forma_pagamento}
          onChange={(event) => onChange('forma_pagamento', event.target.value)}
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
          onChange={(event) => onChange('modalidade', event.target.value)}
          disabled={modalidadeBloqueada}
        >
          <option value="">Todas</option>
          {modalidadesDisponiveis.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div>
        <label>Bandeira</label>
        <select
          value={filtros.bandeira}
          onChange={(event) => onChange('bandeira', event.target.value)}
        >
          <option value="">Todas</option>
          {opcoes.bandeiras.map((item) => (
            <option key={item} value={item}>{rotuloBandeiraFiltro(item)}</option>
          ))}
        </select>
      </div>

      {exibirConciliacao && <div>
        <label>Conciliação</label>
        <select value={filtros.conciliacao} onChange={(event) => onChange('conciliacao', event.target.value)}>
          <option value="">Todos</option>
          <option value="CONCILIADO">Conciliados</option>
          <option value="NAO_CONCILIADO">Não conciliados</option>
        </select>
      </div>}

      {exibirStatus && <div>
        <label>Status</label>
        <select
          value={filtros.status}
          onChange={(event) => onChange('status', event.target.value)}
        >
          <option value="">Todos</option>
          {opcoes.status.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>}

      <div className="report-filter-actions">
        <button onClick={onFiltrar} disabled={loading}>{loading ? 'Carregando...' : 'Filtrar'}</button>
        <button className="secondary" onClick={onLimpar} disabled={loading}>Limpar</button>
      </div>
    </div>
  );
}
