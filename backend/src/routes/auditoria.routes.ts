import type { Express } from 'express';
import {
  desmarcarDuplicidadeItem,
  desfazerConversaoItem,
  listarAuditoriaConversoes,
  listarAuditoriaDuplicidades,
} from '../repositorio.js';

export function registerAuditoriaRoutes(app: Express) {
  app.get('/api/auditoria/duplicidades', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ itens: await listarAuditoriaDuplicidades(Number(req.query.limite || 1000)) });
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao listar duplicidades marcadas.' });
    }
  });

  app.post('/api/auditoria/duplicidades/desmarcar', async (req, res) => {
    try {
      res.json(await desmarcarDuplicidadeItem(String(req.body?.tabela || ''), String(req.body?.row_id || '')));
    } catch (error) {
      res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao desmarcar duplicidade.' });
    }
  });

  app.get('/api/auditoria/conversoes', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ itens: await listarAuditoriaConversoes(Number(req.query.limite || 1000)) });
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao listar conversões aplicadas.' });
    }
  });

  app.post('/api/auditoria/conversoes/:id/desfazer', async (req, res) => {
    try {
      res.json(await desfazerConversaoItem(req.params.id));
    } catch (error) {
      res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao desfazer conversão.' });
    }
  });
}
