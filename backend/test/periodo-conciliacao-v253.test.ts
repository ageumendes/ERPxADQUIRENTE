import test from 'node:test';
import assert from 'node:assert/strict';
import { periodoUltimosSeteDias, resolverPeriodoConciliacao, planejarLotesSemanais } from '../src/services/periodo-conciliacao.js';
test('sete dias inclusivos seguem o dia de La Paz, não a data UTC',()=>{
  assert.deepEqual(periodoUltimosSeteDias(new Date('2026-10-09T03:59:59Z')),{dataInicial:'2026-10-02',dataFinal:'2026-10-08'});
  assert.deepEqual(periodoUltimosSeteDias(new Date('2026-10-09T04:00:00Z')),{dataInicial:'2026-10-03',dataFinal:'2026-10-09'});
  assert.deepEqual(periodoUltimosSeteDias(new Date('2026-01-03T12:00:00Z')),{dataInicial:'2025-12-28',dataFinal:'2026-01-03'});
});
test('período customizado admite um dia, valida calendário e exige ambos os limites',()=>{
  assert.deepEqual(resolverPeriodoConciliacao('2024-02-29','2024-02-29'),{dataInicial:'2024-02-29',dataFinal:'2024-02-29'});
  for(const [a,b] of [['2026-02-29','2026-03-01'],['2026-10-09','2026-10-08'],['',''],['2026-10-01',undefined],[undefined,'2026-10-08'],[1,2]])assert.throws(()=>resolverPeriodoConciliacao(a,b));
  assert.deepEqual(resolverPeriodoConciliacao(undefined,undefined,new Date('2026-10-08T12:00:00Z')),{dataInicial:'2026-10-02',dataFinal:'2026-10-08'});
});

test('lotes retrocedem seis dias, compartilham a fronteira e encerram exatamente no início',()=>{
  assert.deepEqual(planejarLotesSemanais('2026-09-12','2026-10-01'),[
    {dataInicial:'2026-09-25',dataFinal:'2026-10-01'},
    {dataInicial:'2026-09-19',dataFinal:'2026-09-25'},
    {dataInicial:'2026-09-13',dataFinal:'2026-09-19'},
    {dataInicial:'2026-09-12',dataFinal:'2026-09-13'},
  ]);
  assert.equal(planejarLotesSemanais('2026-10-01','2026-10-01').length,1);
  const lotes=planejarLotesSemanais('2026-01-01','2026-10-01');
  assert.equal(lotes[lotes.length-1].dataInicial,'2026-01-01');
  assert.ok(lotes.every((l,i)=>i===0||l.dataFinal===lotes[i-1].dataInicial));
});
