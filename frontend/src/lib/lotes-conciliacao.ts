export type LoteConciliacao={dataInicial:string;dataFinal:string};
export function planejarLotesConciliacao(dataInicial:string,dataFinal:string):LoteConciliacao[]{
  const lotes:LoteConciliacao[]=[];let fim=dataFinal;
  while(fim>=dataInicial){
    const d=new Date(fim+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-6);
    const inicio=d.toISOString().slice(0,10)<dataInicial?dataInicial:d.toISOString().slice(0,10);
    lotes.push({dataInicial:inicio,dataFinal:fim});
    if(inicio===dataInicial)break;fim=inicio;
  }
  return lotes;
}
