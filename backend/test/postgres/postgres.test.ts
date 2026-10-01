import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

test('PostgreSQL de teste aceita transacao e rollback', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL é obrigatória.');
  const nomeBanco = new URL(url).pathname.toLowerCase();
  assert.match(nomeBanco, /(test|teste)/, 'O nome do banco deve conter test ou teste para impedir uso acidental da produção.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE erpxadquirente_transacao_teste (id INTEGER PRIMARY KEY) ON COMMIT DROP');
    await client.query('INSERT INTO erpxadquirente_transacao_teste (id) VALUES (1)');
    const resultado = await client.query('SELECT COUNT(*)::int AS total FROM erpxadquirente_transacao_teste');
    assert.equal(resultado.rows[0].total, 1);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
