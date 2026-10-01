import type { Express } from 'express';

/**
 * Mantém uma resposta explícita para clientes antigos sem conservar qualquer
 * código de autenticação, certificado ou consulta à API PIX Sicoob.
 */
export function registerDeprecatedSicoobApiRoutes(app: Express) {
  app.use('/api/sicoob/psp-pix', (_req, res) => {
    res.status(410).json({
      sucesso: false,
      mensagem: 'Integração direta com a API PIX Sicoob removida. Utilize a coleta SFTP SICOOB.',
    });
  });
}
