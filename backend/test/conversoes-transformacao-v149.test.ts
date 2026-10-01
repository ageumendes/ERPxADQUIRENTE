import test from 'node:test';
import assert from 'node:assert/strict';
import { transformarDataPorFormato } from '../src/repositories/repositorio.js';

test('v0.1.149 transforma DDMMYYYY em YYYY-MM-DD', () => {
  assert.equal(transformarDataPorFormato('20082026', 'DDMMYYYY', 'YYYY-MM-DD'), '2026-08-20');
  assert.equal(transformarDataPorFormato('01012027', 'DDMMYYYY', 'YYYY-MM-DD'), '2027-01-01');
});

test('v0.1.149 rejeita data inválida e formato incompatível', () => {
  assert.equal(transformarDataPorFormato('31022026', 'DDMMYYYY', 'YYYY-MM-DD'), null);
  assert.equal(transformarDataPorFormato('2026-08-20', 'DDMMYYYY', 'YYYY-MM-DD'), null);
  assert.equal(transformarDataPorFormato('', 'DDMMYYYY', 'YYYY-MM-DD'), null);
});
