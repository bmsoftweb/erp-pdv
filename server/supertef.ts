import { Router } from 'express';

const TOKEN = 'Bearer 38784665c2a9c4d42558a7002107bd78cceacf90e198ff3cca2bfc93ea384b9a';

/** Resposta da SuperTEF repassada como { status, success, data } */
async function repassar(response: Response) {
  const status = response.status;
  let data;
  try {
    data = await response.json();
  } catch {
    data = { rawText: await response.text() };
  }
  return { status, success: response.ok, data };
}

export function createSupertefRouter() {
  const r = Router();

  r.post('/supertef', async (req, res) => {
    try {
      const { amount } = req.body ?? {};
      if (amount === undefined || isNaN(Number(amount))) {
        return void res.status(400).json({ error: 'Valor do pagamento é obrigatório e deve ser numérico' });
      }

      const payload = {
        cliente_chave: 'mpr8nkrbroogihrqj5j',
        pos_id: null,
        transaction_type: '2',
        installment_count: 1,
        installment_type: 1,
        amount: Number(amount),
        order_id: 'teste',
        description: 'Pagamento PDV POSTMAN',
        print_receipt: true,
      };

      const response = await fetch('https://api.supertef.com.br/api/pagamentos', {
        method: 'POST',
        headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      res.json(await repassar(response));
    } catch (err) {
      console.error('Erro na API SuperTEF:', err);
      res.status(500).json({
        error: 'Erro ao se conectar com a API SuperTEF',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  r.get('/supertef/status', async (req, res) => {
    try {
      const uniqueId = req.query.uniqueid as string | undefined;
      if (!uniqueId) return void res.status(400).json({ error: 'O parâmetro uniqueid é obrigatório' });

      const response = await fetch(`https://api.supertef.com.br/api/pagamentos/by-uniqueid/${uniqueId}?payment_uniqueid=${uniqueId}`, {
        method: 'GET',
        headers: { Authorization: TOKEN },
      });
      res.json(await repassar(response));
    } catch (err) {
      console.error('Erro na API SuperTEF (GET status):', err);
      res.status(500).json({
        error: 'Erro ao consultar status na API SuperTEF',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return r;
}
