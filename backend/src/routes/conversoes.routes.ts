import type { Express } from 'express';
import {
  atualizarConversaoManual,
  criarConversaoManual,
  excluirConversaoManual,
  listarConversoes,
  listarOrigensDisponiveisParaConversao,
} from '../repositorio.js';

export function registerConversoesRoutes(app: Express) {
  app.get('/api/conversoes', async (_req, res) => res.json(await listarConversoes()));

  app.get('/api/conversoes/origens', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ origens: await listarOrigensDisponiveisParaConversao() });
  });

  app.post('/api/conversoes', async (req, res) => {
    try {
      res.status(201).json(await criarConversaoManual(req.body || {}));
    } catch (error) {
      res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao criar conversão.' });
    }
  });

  app.put('/api/conversoes/:id', async (req, res) => {
    try {
      const atualizada = await atualizarConversaoManual(req.params.id, req.body || {});
      if (!atualizada) return res.status(404).json({ sucesso: false, mensagem: 'Conversão não encontrada.' });
      res.json(atualizada);
    } catch (error) {
      res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao atualizar conversão.' });
    }
  });

  app.delete('/api/conversoes/:id', async (req, res) => {
    const removida = await excluirConversaoManual(req.params.id);
    if (!removida) return res.status(404).json({ sucesso: false, mensagem: 'Conversão não encontrada.' });
    res.json({ sucesso: true });
  });
}
