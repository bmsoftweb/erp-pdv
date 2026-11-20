import React, { useEffect, useState } from 'react';
import { Ban, FileText, HandCoins, Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { MenuFiscalInacessivel } from './MenuFiscal';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { erroDe, imprimirDanfe } from '@/lib/arquivos';

interface Nota {
  chave: string;
  modelo: string;
  serie: number;
  numero: number;
  situacao: string;
  data_emissao: string;
  valor_total: string;
  destinatario_documento: string | null;
  motivo: string | null;
}

const COR: Record<string, string> = {
  autorizada: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  contingencia: 'bg-amber-50 text-amber-700 border-amber-100',
  cancelada: 'bg-red-50 text-red-600 border-red-100',
};
const brl = (v: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const dataBr = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '');

/** Notas emitidas pelo PDV (do erp-nfe): imprimir, cancelar e conciliação financeira */
export function NotasPdv({ onFechar, confirmar }: { onFechar: () => void; confirmar: (mensagem: string) => Promise<boolean> }) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [cancelando, setCancelando] = useState<Nota | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      // Antes de listar, tenta transmitir as de contingência (o caixa vê a situação atualizada)
      await fetch('/api/nfce/contingencia', { method: 'POST' }).catch(() => {});
      const r = await fetch('/api/nfce/documentos');
      if (!r.ok) throw new Error(await erroDe(r));
      setNotas(await r.json());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => {
    carregar();
  }, []);

  const imprimir = (n: Nota) => imprimirDanfe(n.chave).catch((e) => toast.error(e.message));

  const econf = async (n: Nota) => {
    if (!(await confirmar(`Enviar a conciliação financeira (EConf) dos pagamentos da ${n.modelo === '65' ? 'NFC-e' : 'NF-e'} ${n.numero}?`))) return;
    const r = await fetch('/api/nfce/econf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: n.chave }) });
    if (!r.ok) return toast.error(await erroDe(r));
    toast.success(`EConf registrado: ${(await r.json()).motivo}`);
  };

  const ICONE = 'p-1.5 rounded-lg cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed';
  return (
    <div className="flex-1 bg-white shadow-xl rounded-2xl overflow-hidden flex flex-col border border-gray-100 min-h-0">
      <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50 shrink-0 gap-3 flex-wrap">
        <h3 className="text-2xl font-bold flex items-center gap-3 text-gray-800">
          <FileText size={28} className="text-blue-600" />
          Notas emitidas
        </h3>
        <MenuFiscalInacessivel />
        <div className="flex items-center gap-2">
          <button type="button" onClick={carregar} disabled={carregando} className={`${BOTAO_SECUNDARIO} flex items-center gap-2`}>
            <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button type="button" onClick={onFechar} className={`${BOTAO_SECUNDARIO} !bg-slate-800 !text-white`}>Fechar (Esc)</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        <table className="w-full text-sm border border-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
            <tr>
              <th className="border border-gray-200 px-2 py-1.5">Emissão</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left">Documento</th>
              <th className="border border-gray-200 px-2 py-1.5 text-right">Número</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left">Situação</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left">Consumidor</th>
              <th className="border border-gray-200 px-2 py-1.5 text-right">Valor</th>
              <th className="border border-gray-200 px-2 py-1.5 w-[120px]">Ações</th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n) => (
              <tr key={n.chave} className="hover:bg-blue-50/40">
                <td className="border border-gray-200 px-2 py-1.5 text-center font-mono whitespace-nowrap">{dataBr(n.data_emissao)}</td>
                <td className="border border-gray-200 px-2 py-1.5">{n.modelo === '65' ? 'NFC-e' : 'NF-e'} série {n.serie}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-right font-mono">{n.numero}</td>
                <td className="border border-gray-200 px-2 py-1.5">
                  <span title={n.motivo || undefined} className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold uppercase ${COR[n.situacao] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {n.situacao === 'contingencia' ? 'contingência' : n.situacao}
                  </span>
                </td>
                <td className="border border-gray-200 px-2 py-1.5 font-mono">{n.destinatario_documento || ''}</td>
                <td className="border border-gray-200 px-2 py-1.5 text-right font-mono">{brl(n.valor_total)}</td>
                <td className="border border-gray-200 px-2 py-1 text-center whitespace-nowrap">
                  <button type="button" className={`${ICONE} text-gray-600 hover:bg-gray-100`} title="Imprimir" data-dica-desc="Abre o DANFE para imprimir" onClick={() => imprimir(n)}>
                    <Printer size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${ICONE} text-blue-600 hover:bg-blue-50`}
                    title="Conciliação financeira (EConf)"
                    data-dica-desc="Informa à SEFAZ os pagamentos gravados desta venda"
                    disabled={n.situacao !== 'autorizada'}
                    onClick={() => econf(n)}
                  >
                    <HandCoins size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${ICONE} text-red-600 hover:bg-red-50`}
                    title="Cancelar"
                    data-dica-desc={n.situacao === 'contingencia' ? 'Só depois que a SEFAZ autorizar a nota de contingência' : 'Cancela a nota na SEFAZ'}
                    disabled={n.situacao !== 'autorizada'}
                    onClick={() => setCancelando(n)}
                  >
                    <Ban size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!notas.length && !carregando && (
              <tr>
                <td colSpan={7} className="px-2 py-10 text-center text-gray-400">Nenhuma nota emitida pelo PDV.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cancelando && <Cancelar nota={cancelando} onFechar={() => setCancelando(null)} onCancelada={() => { setCancelando(null); carregar(); }} />}
    </div>
  );
}

function Cancelar({ nota, onFechar, onCancelada }: { nota: Nota; onFechar: () => void; onCancelada: () => void }) {
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await fetch('/api/nfce/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: nota.chave, justificativa }),
      });
      if (!r.ok) throw new Error(await erroDe(r));
      toast.success(`Nota cancelada: ${(await r.json()).motivo}`);
      onCancelada();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Janela
      titulo={`Cancelar ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} ${nota.numero}`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Voltar</button>
          <button type="button" className={`${BOTAO_PRIMARIO} !bg-red-600 hover:!bg-red-700`} disabled={enviando || justificativa.trim().length < 15} onClick={enviar}>
            {enviando ? 'Cancelando…' : 'Cancelar a nota'}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600 mb-3">
        O cancelamento é enviado à SEFAZ e não pode ser desfeito. Valor: <strong>{brl(nota.valor_total)}</strong>.
      </p>
      <label className={LABEL_CLASS}>Justificativa (mínimo 15 caracteres)</label>
      <textarea autoFocus className={`${INPUT_CLASS} h-24`} maxLength={255} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} required />
    </Janela>
  );
}
