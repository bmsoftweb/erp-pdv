import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, QrCode } from 'lucide-react';
import { Janela, BOTAO_SECUNDARIO } from './Janela';
import { LABEL_CLASS } from './campos';
import { usePixNoCliente } from '@/lib/telaCliente';

/** PIX recebido: vai para a NFC-e como pagamento integrado (tpIntegra 1) */
export interface ResultadoPix {
  txid: string;
  /** Identificador fim a fim do Bacen: vai no código de autorização (cAut) */
  endToEndId: string;
  /** CNPJ da instituição que recebeu (vai no grupo de cartão da NFC-e) */
  cnpj: string;
}

interface Cobranca {
  txid: string;
  status: string;
  pixCopiaECola?: string;
  endToEndId?: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const CONSULTA_MS = 2500;

async function api(url: string, corpo?: unknown) {
  const r = await fetch(url, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
  return d;
}

/**
 * Cobrança PIX no banco (BMBancos): cria a cobrança, mostra o QR Code e consulta até o pagamento cair.
 * Cancelar tira a cobrança do ar; se o cliente pagou nesse meio tempo, vale o pagamento.
 */
export function PixBanco({ valor, referencia, onFim }: {
  valor: number;
  referencia: string;
  onFim: (resultado: ResultadoPix | null, erro?: string) => void;
}) {
  const [cob, setCob] = useState<(Cobranca & { contaId: number; cnpj: string }) | null>(null);
  const [qr, setQr] = useState('');
  const [mensagem, setMensagem] = useState('Gerando a cobrança no banco…');
  const [cancelando, setCancelando] = useState(false);
  const iniciou = useRef(false); // StrictMode roda o efeito duas vezes: uma cobrança só
  const acabou = useRef(false);
  const cancelar = useRef(false);
  const cobRef = useRef(cob);
  cobRef.current = cob;
  const fim = useRef(onFim);
  fim.current = onFim;
  usePixNoCliente(cob?.pixCopiaECola, valor); // o QR também na tela do cliente

  const terminar = (c: Cobranca | null, erro?: string) => {
    if (acabou.current) return;
    acabou.current = true;
    if (c?.status === 'CONCLUIDA') fim.current({ txid: c.txid, endToEndId: c.endToEndId || '', cnpj: cobRef.current?.cnpj || '' });
    else fim.current(null, erro);
  };

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      let atual: Cobranca & { contaId: number; cnpj: string };
      try {
        const d = await api('/api/pix/cobrar', { valor, referencia });
        atual = { ...d.cobranca, contaId: d.contaId, cnpj: String(d.cnpj || '') };
        if (!atual.pixCopiaECola) throw new Error('O banco não devolveu o QR Code.');
        setQr(await QRCode.toDataURL(atual.pixCopiaECola, { margin: 1, width: 260 }));
        setCob(atual);
        cobRef.current = atual; // o cancelamento logo abaixo não espera a renderização
        setMensagem('Aguardando o pagamento…');
      } catch (e: any) {
        return terminar(null, e?.message || String(e));
      }
      // Cancelado enquanto a cobrança era criada: tira do ar agora
      if (cancelar.current) return void cancelarCobranca();
      while (!acabou.current && !cancelar.current) {
        await new Promise((ok) => setTimeout(ok, CONSULTA_MS));
        if (acabou.current || cancelar.current) break;
        try {
          const d = await api(`/api/pix/${atual.contaId}/${atual.txid}`);
          if (d.cobranca.status === 'CONCLUIDA') return terminar(d.cobranca);
          if (d.cobranca.status !== 'ATIVA') return terminar(null, 'A cobrança PIX expirou ou foi removida no banco.');
          setMensagem('Aguardando o pagamento…');
        } catch (e: any) {
          // Falha passageira: segue consultando
          setMensagem(`Sem resposta do banco, tentando de novo… (${e?.message || e})`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelarCobranca = async () => {
    const c = cobRef.current;
    if (!c) return; // ainda criando: o efeito cancela quando a cobrança existir
    try {
      const d = await api(`/api/pix/${c.contaId}/${c.txid}/cancelar`, {});
      terminar(d.cobranca, 'Cobrança PIX cancelada.');
    } catch (e: any) {
      // ponytail: sem o cancelamento a cobrança expira sozinha (10 min); um PIX pago nesse intervalo fica só no extrato
      terminar(null, `Não foi possível cancelar a cobrança PIX (${e?.message || e}). Se o cliente pagar, o valor aparece no extrato do banco (txid ${c.txid}).`);
    }
  };

  const pedirCancelamento = () => {
    if (cancelar.current) return;
    cancelar.current = true;
    setCancelando(true);
    setMensagem('Cancelando a cobrança…');
    void cancelarCobranca();
  };

  return (
    <Janela
      titulo={<><QrCode size={18} className="text-blue-600" /> PIX</>}
      onFechar={pedirCancelamento}
      largura="max-w-sm"
      rodape={<button type="button" className={BOTAO_SECUNDARIO} onClick={pedirCancelamento} disabled={cancelando}>Cancelar (Esc)</button>}
    >
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Valor</p>
          <p className="text-3xl font-mono font-black text-blue-700">{brl(valor)}</p>
        </div>
        {qr && <img src={qr} alt="QR Code do PIX" className="mx-auto w-[260px] h-[260px]" />}
        <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 min-h-[52px] flex items-center justify-center gap-2 text-sm font-semibold text-stone-800 text-center">
          <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />
          <span>{mensagem}</span>
        </div>
        {cob?.pixCopiaECola && (
          <div>
            <p className={LABEL_CLASS}>PIX copia e cola</p>
            <p className="text-[11px] font-mono break-all text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-2 select-all">{cob.pixCopiaECola}</p>
          </div>
        )}
      </div>
    </Janela>
  );
}
