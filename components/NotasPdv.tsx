import React, { useEffect, useRef, useState } from 'react';
import { Ban, FileText, HandCoins, Mail, Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { MenuFiscalInacessivel } from './MenuFiscal';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { baixar, erroDe, imprimirDanfe } from '@/lib/arquivos';
import { ESTORNO_NFCE, limiteCancelamento } from '@/lib/fiscal';

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
  /** dhRecbto do protocolo: conta os 30 min para cancelar a NFC-e */
  autorizacao: string | null;
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
/** null = sem prazo (NF-e); senão o horário limite e se já passou */
const prazo = (n: Nota) => {
  const limite = limiteCancelamento(n.modelo, n.autorizacao);
  return limite == null ? null : { ate: hora(limite), vencido: Date.now() > limite };
};

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
  const [enviando, setEnviando] = useState<Nota | null>(null);
  /** Nota escolhida pelas setas (ou pelo clique) */
  const [sel, setSel] = useState(0);

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
  // Redesenha a cada 15 s: o prazo de cancelar da NFC-e vence com a tela aberta
  const [, tique] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tique((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const cancelar = (n: Nota) => (prazo(n)?.vencido ? toast.warning(ESTORNO_NFCE) : setCancelando(n));

  const imprimir = (n: Nota) => imprimirDanfe(n.chave).catch((e) => toast.error(e.message));

  const econf = async (n: Nota) => {
    if (!(await confirmar(`Enviar a conciliação financeira (EConf) dos pagamentos da ${n.modelo === '65' ? 'NFC-e' : 'NF-e'} ${n.numero}?`))) return;
    const r = await fetch('/api/nfce/econf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: n.chave }) });
    if (!r.ok) return toast.error(await erroDe(r));
    toast.success(`EConf registrado: ${(await r.json()).motivo}`);
  };

  // Teclado: ↑ ↓ escolhem a nota, 1 imprime, 2 EConf, 3 cancela (Esc fecha, pela tela de venda).
  // Com o diálogo de cancelar ou a confirmação aberta, as teclas são deles.
  const teclas = useRef<(e: KeyboardEvent) => void>(() => {});
  teclas.current = (e) => {
    if (document.querySelector('[role="dialog"]') || !notas.length) return;
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'BUTTON') return; // Enter num botão é do botão
    const n = notas[Math.min(sel, notas.length - 1)];
    const autorizada = n.situacao === 'autorizada';
    if (e.key === 'ArrowDown') setSel(Math.min(sel + 1, notas.length - 1));
    else if (e.key === 'ArrowUp') setSel(Math.max(sel - 1, 0));
    else if (e.key === 'PageDown') setSel(Math.min(sel + 10, notas.length - 1));
    else if (e.key === 'PageUp') setSel(Math.max(sel - 10, 0));
    else if (e.key === 'Home') setSel(0);
    else if (e.key === 'End') setSel(notas.length - 1);
    else if (e.key === '1' || e.key === 'Enter') imprimir(n);
    else if (e.key === '2') { if (autorizada) econf(n); }
    else if (e.key === '3') { if (autorizada) cancelar(n); }
    else if (e.key === '4') { if (autorizada) setEnviando(n); }
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const ouvir = (e: KeyboardEvent) => teclas.current(e);
    window.addEventListener('keydown', ouvir);
    return () => window.removeEventListener('keydown', ouvir);
  }, []);

  const ICONE = 'p-1.5 rounded-lg cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed';
  return (
    <div className="flex-1 bg-white overflow-hidden flex flex-col min-h-0">
      <div className="flex justify-between items-center px-5 py-3 border-b border-stone-200 shrink-0 gap-3 flex-wrap">
        <h3 className="text-base font-bold flex items-center gap-2 text-stone-900">
          <FileText size={18} className="text-blue-600" />
          Notas emitidas
        </h3>
        <div className="flex flex-col items-center gap-0.5">
          <MenuFiscalInacessivel />
          <span className="text-[11px] text-stone-400">↑ ↓ escolhe · 1 ou Enter imprimir · 2 EConf · 3 cancelar · 4 XML ao cliente · Esc fecha</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={carregar} disabled={carregando} className={BOTAO_SECUNDARIO}>
            <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Fechar (Esc)</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        <table className="w-full text-sm border border-stone-200">
          <thead className="bg-stone-50 text-xs text-stone-500 sticky top-0">
            <tr>
              <th className="border border-stone-200 px-2 py-1.5">Emissão</th>
              <th className="border border-stone-200 px-2 py-1.5 text-left">Documento</th>
              <th className="border border-stone-200 px-2 py-1.5 text-right">Número</th>
              <th className="border border-stone-200 px-2 py-1.5 text-left">Situação</th>
              <th className="border border-stone-200 px-2 py-1.5 text-left">Consumidor</th>
              <th className="border border-stone-200 px-2 py-1.5 text-right">Valor</th>
              <th className="border border-stone-200 px-2 py-1.5 w-[120px]">Ações</th>
            </tr>
          </thead>
          <tbody>
            {notas.map((n, i, todas) => (
              <tr
                key={n.chave}
                ref={i === Math.min(sel, todas.length - 1) ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onClickCapture={() => setSel(i)}
                className={i === Math.min(sel, todas.length - 1) ? 'bg-blue-100/70 outline-2 -outline-offset-2 outline-blue-500' : 'hover:bg-blue-50/40'}
              >
                <td className="border border-stone-200 px-2 py-1.5 text-center font-mono whitespace-nowrap">{dataBr(n.data_emissao)}</td>
                <td className="border border-stone-200 px-2 py-1.5">{n.modelo === '65' ? 'NFC-e' : 'NF-e'} série {n.serie}</td>
                <td className="border border-stone-200 px-2 py-1.5 text-right font-mono">{n.numero}</td>
                <td className="border border-stone-200 px-2 py-1.5">
                  <span title={n.motivo || undefined} className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold uppercase ${COR[n.situacao] || 'bg-stone-50 text-stone-600 border-stone-200'}`}>
                    {n.situacao === 'contingencia' ? 'contingência' : n.situacao}
                  </span>
                  {n.situacao === 'autorizada' && prazo(n) && (
                    <span className={`ml-2 text-[11px] ${prazo(n)!.vencido ? 'text-stone-400' : 'text-amber-700 font-semibold'}`}>
                      {prazo(n)!.vencido ? 'prazo de cancelar encerrado' : `cancela até ${prazo(n)!.ate}`}
                    </span>
                  )}
                </td>
                <td className="border border-stone-200 px-2 py-1.5 font-mono">{n.destinatario_documento || ''}</td>
                <td className="border border-stone-200 px-2 py-1.5 text-right font-mono">{brl(n.valor_total)}</td>
                <td className="border border-stone-200 px-2 py-1 text-center whitespace-nowrap">
                  <button type="button" className={`${ICONE} text-stone-600 hover:bg-stone-100`} title="Imprimir" data-dica-desc="Abre o DANFE para imprimir" onClick={() => imprimir(n)}>
                    <Printer size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${ICONE} text-stone-600 hover:bg-stone-100`}
                    title="XML ao cliente"
                    data-dica-desc="Envia o XML e o DANFE por e-mail ou baixa o XML"
                    disabled={n.situacao !== 'autorizada'}
                    onClick={() => setEnviando(n)}
                  >
                    <Mail size={16} />
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
                    title={prazo(n)?.vencido ? 'Prazo de cancelar encerrado' : 'Cancelar'}
                    data-dica-desc={
                      n.situacao === 'contingencia'
                        ? 'Só depois que a SEFAZ autorizar a nota de contingência'
                        : prazo(n)?.vencido
                          ? 'Passaram os 30 min da autorização: corrija com NF-e de estorno (Anexo 11, art. 106)'
                          : prazo(n)
                            ? `Cancela a nota na SEFAZ até ${prazo(n)!.ate} (30 min da autorização)`
                            : 'Cancela a nota na SEFAZ'
                    }
                    disabled={n.situacao !== 'autorizada' || !!prazo(n)?.vencido}
                    onClick={() => cancelar(n)}
                  >
                    <Ban size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!notas.length && !carregando && (
              <tr>
                <td colSpan={7} className="px-2 py-10 text-center text-stone-400">Nenhuma nota emitida pelo PDV.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {enviando && <XmlCliente nota={enviando} onFechar={() => setEnviando(null)} />}
      {cancelando && <Cancelar nota={cancelando} onFechar={() => setCancelando(null)} onCancelada={() => { setCancelando(null); carregar(); }} />}
    </div>
  );
}

/** XML (e DANFE) ao cliente, quando ele pedir: por e-mail ou baixado (RICMS/SC Anexo 11, art. 103, § 5º) */
function XmlCliente({ nota, onFechar }: { nota: Nota; onFechar: () => void }) {
  const [email, setEmail] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pedir = (caminho: string, corpo: object) =>
    fetch(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: nota.chave, ...corpo }) });
  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    try {
      await acao();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };
  const enviar = () =>
    executar(async () => {
      const r = await pedir('/api/nfce/email', { email: email.trim() });
      if (!r.ok) throw new Error(await erroDe(r));
      toast.success(`XML e DANFE enviados para ${email.trim()}.`);
      onFechar();
    });
  const baixarXml = () => executar(async () => baixar(await pedir('/api/nfce/xml', {}), `${nota.chave}.xml`));
  return (
    <Janela
      titulo={`XML da ${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} ${nota.numero} ao cliente`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Voltar</button>
          <button type="button" className={BOTAO_SECUNDARIO} disabled={ocupado} onClick={baixarXml}>Baixar XML</button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={ocupado || !emailValido} onClick={enviar}>
            {ocupado ? 'Enviando…' : 'Enviar por e-mail'}
          </button>
        </>
      }
    >
      <p className="text-sm text-stone-600 mb-3">
        Vão o XML e o DANFE em PDF. Se o cliente concordar, o envio substitui a impressão do DANFE (art. 103, § 5º, do Anexo 11).
      </p>
      <label className={LABEL_CLASS}>E-mail do cliente</label>
      <input
        autoFocus
        type="email"
        className={INPUT_CLASS}
        value={email}
        maxLength={120}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && emailValido && !ocupado && enviar()}
        required
      />
    </Janela>
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
      <p className="text-sm text-stone-600 mb-3">
        O cancelamento é enviado à SEFAZ e não pode ser desfeito. Valor: <strong>{brl(nota.valor_total)}</strong>.
      </p>
      {prazo(nota) && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
          Só cancele se a mercadoria não saiu da loja. Prazo: até <strong>{prazo(nota)!.ate}</strong> (30 minutos da autorização).
        </p>
      )}
      <label className={LABEL_CLASS}>Justificativa (mínimo 15 caracteres)</label>
      <textarea autoFocus className={`${INPUT_CLASS} h-24`} maxLength={255} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} required />
    </Janela>
  );
}
