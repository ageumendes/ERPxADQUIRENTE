export type ChecklistImportacaoDiaria = {
  grupo: string;
  item: string;
  layout_esperado: string;
  termos: string[];
};

export const checklistImportacoesDiarias: ChecklistImportacaoDiaria[] = [
  { grupo: 'CIELO', item: 'CIELO layout 03', layout_esperado: '03', termos: ['CIELO03', 'CIELO_03', 'CIELO 03', 'CIELO_LAYOUT_15_15_CIELO03'] },
  { grupo: 'CIELO', item: 'CIELO layout 04', layout_esperado: '04', termos: ['CIELO04', 'CIELO_04', 'CIELO 04', 'CIELO_LAYOUT_15_15_CIELO04'] },
  { grupo: 'CIELO', item: 'CIELO layout 16', layout_esperado: '16', termos: ['CIELO16', 'CIELO_16', 'CIELO 16', 'CIELO_LAYOUT_15_15_CIELO16'] },
  { grupo: 'SICREDI', item: 'SICREDI layout S', layout_esperado: 'S', termos: ['SICREDI', 'FISERV_LAYOUT_7_4_S', 'SICREDI_FISERV_LAYOUT_7_4_S'] },
  { grupo: 'SICREDI', item: 'SICREDI layout P', layout_esperado: 'P', termos: ['SICREDI', 'FISERV_LAYOUT_7_4_P', 'SICREDI_FISERV_LAYOUT_7_4_P'] },
  { grupo: 'SICREDI', item: 'SICREDI layout R', layout_esperado: 'R', termos: ['SICREDI', 'FISERV_LAYOUT_7_4_R', 'SICREDI_FISERV_LAYOUT_7_4_R'] },
  { grupo: 'SIPAG', item: 'SIPAG layout 7.6 S', layout_esperado: '7.6 S', termos: ['SIPAG_FISERV_LAYOUT_7_6_S', 'FISERV_LAYOUT_7_6_S'] },
  { grupo: 'SIPAG', item: 'SIPAG layout 7.6 P', layout_esperado: '7.6 P', termos: ['SIPAG_FISERV_LAYOUT_7_6_P', 'FISERV_LAYOUT_7_6_P'] },
  { grupo: 'SIPAG', item: 'SIPAG layout 2.0 S', layout_esperado: '2.0 S', termos: ['SIPAG_LAYOUT_2_0_S', 'LAYOUT_2_0_S'] },
  { grupo: 'SIPAG', item: 'SIPAG layout 2.0 P', layout_esperado: '2.0 P', termos: ['SIPAG_LAYOUT_2_0_P', 'LAYOUT_2_0_P'] },
  { grupo: 'SIPAG', item: 'SIPAG layout 2.0 R', layout_esperado: '2.0 R', termos: ['SIPAG_LAYOUT_2_0_R', 'LAYOUT_2_0_R'] },
  { grupo: 'CONVCARD', item: 'CONVCARD', layout_esperado: 'v2.03', termos: ['CONVCARD', 'CONVCARD_LAYOUT_2_0_3'] },
  { grupo: 'COOPCERTO', item: 'Vendas realizadas', layout_esperado: 'COOPCERTO Vendas realizadas CSV', termos: ['COOPCERTO_CABAL_VENDAS_CSV'] },
  { grupo: 'COOPCERTO', item: 'Extrato vendas a receber', layout_esperado: 'COOPCERTO EXTRATO', termos: ['COOPCERTO_EXTRATO_VENDAS_A_RECEBER'] },
  { grupo: 'COOPCERTO', item: 'Extrato vendas recebidas', layout_esperado: 'COOPCERTO EXTRATO', termos: ['COOPCERTO_EXTRATO_VENDAS_RECEBIDAS'] },
  { grupo: 'SICOOB', item: 'SICOOB PIX QR-CODE', layout_esperado: 'PIX QR-CODE', termos: ['SICOOB_LAYOUT_PSP_PIX', 'SICOOB_PSP_PIX', 'PSP_PIX', 'PIX QR'] },
  { grupo: 'VR', item: 'VR Benefícios', layout_esperado: '16AP', termos: ['VR_LAYOUT_16AP', 'VR BENEFICIOS'] },
  { grupo: 'ALELO', item: 'ALELO Vendas', layout_esperado: 'Manual Alelo 2.1_3', termos: ['ALELO', 'ALELO_LAYOUT'] },
  { grupo: 'PLUXEE', item: 'PLUXEE Vendas', layout_esperado: 'SDX/SDXP', termos: ['PLUXEE', 'PLUXEE_LAYOUT', 'SDX', 'SDXP'] },
  { grupo: 'TICKET', item: 'TICKET Vendas', layout_esperado: 'CE ADM40', termos: ['TICKET', 'CEADM40', 'CE_ADM40'] },
  { grupo: 'ERP', item: 'ERP INTERDATA', layout_esperado: 'INTERDATA', termos: ['ERP_INTERDATA', 'INTERDATA'] },
];
