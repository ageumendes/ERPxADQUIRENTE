export type PeriodoConciliacao = { dataInicial: string; dataFinal: string };
export function periodoUltimosSeteDias(agora = new Date()): PeriodoConciliacao {
  const partes = new Intl.DateTimeFormat('en-CA', {timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(agora);
  const obter=(tipo:string)=>partes.find(p=>p.type===tipo)!.value;
  const dataFinal=`${obter('year')}-${obter('month')}-${obter('day')}`;
  const inicio=new Date(dataFinal+'T12:00:00Z'); inicio.setUTCDate(inicio.getUTCDate()-6);
  return {dataInicial:inicio.toISOString().slice(0,10),dataFinal};
}
export function resolverPeriodoConciliacao(inicial?: unknown, final?: unknown, agora = new Date()): PeriodoConciliacao {
  if (inicial===undefined && final===undefined) return periodoUltimosSeteDias(agora);
  const validar=(data:unknown)=>typeof data==='string' && /^\d{4}-\d{2}-\d{2}$/.test(data) && Number.isFinite(Date.parse(data+'T12:00:00Z')) && new Date(data+'T12:00:00Z').toISOString().slice(0,10)===data;
  if(!validar(inicial)||!validar(final))throw new Error('Informe datas inicial e final válidas no formato AAAA-MM-DD.');
  if(String(inicial)>String(final))throw new Error('A data inicial não pode ser posterior à data final.');
  return {dataInicial:String(inicial),dataFinal:String(final)};
}

export function deslocarData(data:string,dias:number):string {
  const d=new Date(data+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+dias);return d.toISOString().slice(0,10);
}
export function planejarLotesSemanais(inicial:string,final:string):PeriodoConciliacao[] {
  const periodo=resolverPeriodoConciliacao(inicial,final);
  const lotes:PeriodoConciliacao[]=[];
  let fim=periodo.dataFinal;
  while(true){
    const inicio=deslocarData(fim,-6)<periodo.dataInicial?periodo.dataInicial:deslocarData(fim,-6);
    lotes.push({dataInicial:inicio,dataFinal:fim});
    if(inicio===periodo.dataInicial)break;
    fim=inicio;
  }
  return lotes;
}
