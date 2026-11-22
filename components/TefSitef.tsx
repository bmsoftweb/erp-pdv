import React, { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { NumberField } from './NumberField';
import { usePixNoCliente } from '@/lib/telaCliente';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { CONTINUA, ConfigSitef, DocumentoTef, continuar, erroSitef, iniciar } from '@/lib/sitef';

/** Dados da transação aprovada que vão para a NFC-e e para a impressão */
export interface ResultadoTef {
  /** tBand da NFC-e (campo 951) */
  bandeira?: string;
  /** cAut da NFC-e (campo 952; sem ele, o código de autorização 135) */
  autorizacao?: string;
  /** CNPJ da credenciadora para a NFC-e (campo 950) */
  cnpjCredenciadora?: string;
  nsu?: string;
  /** Vias do comprovante (campos 121 e 122) */
  comprovantes: string[];
}

type Pedido =
  | { tipo: 'simnao'; texto: string }
  | { tipo: 'tecla'; texto: string }
  | { tipo: 'menu'; texto: string; opcoes: [string, string][] }
  | { tipo: 'campo'; texto: string; comando: number; min: number; max: number };

type Resposta = { data: string; continua: 0 | 1 | -1 };

/** Menu da CliSiTef: "1:Débito;2:Crédito;" */
const opcoesDoMenu = (s: string): [string, string][] =>
  s.split(';').filter((x) => x.includes(':')).map((x) => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)]);

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Transação TEF no SiTEF pelo Agente CliSiTef: inicia, conduz a coleta iterativa (mensagens, menus, campos) e
 * devolve o resultado em onFim. Não confirma: a confirmação (ou o desfazimento) é na conclusão da venda.
 */
export function TefSitef({ config, documento, funcao, valor, operador, titulo, onFim }: {
  config: ConfigSitef;
  documento: DocumentoTef;
  funcao: number;
  valor: number;
  operador: string;
  titulo: string;
  onFim: (resultado: ResultadoTef | null, erro?: string) => void;
}) {
  const [mensagem, setMensagem] = useState('Iniciando o TEF…');
  const [cabecalho, setCabecalho] = useState('');
  const [qr, setQr] = useState('');
  usePixNoCliente(qr, valor); // PIX pelo TEF: o QR também na tela do cliente
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [digitado, setDigitado] = useState('');
  const responder = useRef<((r: Resposta) => void) | null>(null);
  const cancelar = useRef(false);
  const iniciou = useRef(false); // StrictMode roda o efeito duas vezes: uma transação só
  const fim = useRef(onFim);
  fim.current = onFim;

  const perguntar = (p: Pedido) =>
    new Promise<Resposta>((resolve) => {
      setDigitado('');
      setPedido(p);
      responder.current = (r) => {
        responder.current = null;
        setPedido(null);
        resolve(r);
      };
    });

  const pedirCancelamento = () => {
    cancelar.current = true;
    setMensagem('Cancelando a transação…');
    responder.current?.({ data: '', continua: -1 });
  };

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      const campos: Record<number, string> = {};
      try {
        let r = await iniciar(config, documento, funcao, valor, operador);
        const sessao = r.sessionId || '';
        let tituloMenu = '';
        let resp: Resposta = { data: '', continua: 0 };
        while (r.clisitefStatus === CONTINUA) {
          r = await continuar(sessao, resp.data, resp.continua);
          if (r.clisitefStatus !== CONTINUA) break;
          // Sem coleta, segue; com cancelamento pedido, encerra no próximo passo
          resp = { data: '', continua: cancelar.current ? -1 : 0 };
          const texto = (r.data || '').trim();
          const coleta = !cancelar.current;
          switch (r.commandId) {
            case 0: // valor para a automação guardar (comprovantes, bandeira, NSU...)
              campos[r.fieldId!] = r.data || '';
              break;
            case 1: case 2: case 3: case 52: // mensagens do operador/cliente
              if (texto) setMensagem(texto);
              break;
            case 4: tituloMenu = texto; break;
            case 14: tituloMenu = ''; break;
            case 15: setCabecalho(texto); break;
            case 16: setCabecalho(''); break;
            case 20: if (coleta) resp = await perguntar({ tipo: 'simnao', texto }); break;
            case 21: if (coleta) resp = await perguntar({ tipo: 'menu', texto: tituloMenu || 'Escolha uma opção', opcoes: opcoesDoMenu(r.data || '') }); break;
            case 22: if (coleta) resp = await perguntar({ tipo: 'tecla', texto: texto || 'Pressione Enter para continuar' }); break;
            case 30: case 31: case 34: case 35: case 41: // campo a digitar (41 = mascarado, 34 = valor)
              if (coleta) resp = await perguntar({ tipo: 'campo', texto: texto || 'Informe o dado', comando: r.commandId, min: r.fieldMinLength || 0, max: r.fieldMaxLength || 0 });
              break;
            case 50: setQr(texto); break;
            case 51: setQr(''); break;
            // 11 a 13 (limpar mensagens), 23 (aguardando o PinPad) e 29 (sem coleta): só seguir
          }
        }
        if (r.clisitefStatus !== 0) throw new Error(erroSitef(r.clisitefStatus));
        fim.current({
          bandeira: campos[951] || undefined,
          autorizacao: campos[952] || campos[135] || undefined,
          cnpjCredenciadora: campos[950] || undefined,
          nsu: campos[134] || undefined,
          comprovantes: [campos[121], campos[122]].filter(Boolean),
        });
      } catch (e: any) {
        fim.current(null, e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviar = (data: string) => responder.current?.({ data, continua: 0 });

  return (
    <Janela
      titulo={<><CreditCard size={18} className="text-blue-600" /> {titulo}</>}
      onFechar={pedirCancelamento}
      largura="max-w-md"
      rodape={<button type="button" className={BOTAO_SECUNDARIO} onClick={pedirCancelamento} disabled={cancelar.current}>Cancelar (Esc)</button>}
    >
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Valor</p>
          <p className="text-3xl font-mono font-black text-blue-700">{brl(valor)}</p>
        </div>
        {cabecalho && <p className="text-xs text-stone-500 text-center whitespace-pre-line">{cabecalho}</p>}
        <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 min-h-[52px] flex items-center justify-center gap-2 text-sm font-semibold text-stone-800 text-center whitespace-pre-line">
          {!pedido && <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />}
          <span>{mensagem}</span>
        </div>
        {qr && (
          <div>
            <p className={LABEL_CLASS}>PIX copia e cola</p>
            <p className="text-[11px] font-mono break-all text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-2 select-all">{qr}</p>
          </div>
        )}

        {pedido?.tipo === 'simnao' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-800 text-center whitespace-pre-line">{pedido.texto}</p>
            <div className="flex justify-center gap-2.5">
              <button type="button" autoFocus className={BOTAO_PRIMARIO} onClick={() => enviar('0')}>Sim</button>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => enviar('1')}>Não</button>
            </div>
          </div>
        )}

        {pedido?.tipo === 'tecla' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-stone-800 whitespace-pre-line">{pedido.texto}</p>
            <button type="button" autoFocus className={BOTAO_PRIMARIO} onClick={() => enviar('')}>OK (Enter)</button>
          </div>
        )}

        {pedido?.tipo === 'menu' && (
          <div
            className="space-y-1.5"
            onKeyDown={(e) => {
              const op = pedido.opcoes.find(([c]) => c === e.key);
              if (op) {
                e.preventDefault();
                enviar(op[0]);
              }
            }}
          >
            <p className={LABEL_CLASS}>{pedido.texto}</p>
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-200 overflow-hidden max-h-64 overflow-y-auto">
              {pedido.opcoes.map(([codigo, nome], i) => (
                <button
                  key={codigo}
                  type="button"
                  autoFocus={i === 0}
                  onClick={() => enviar(codigo)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-xs font-semibold text-stone-700 bg-white hover:bg-stone-100 focus:bg-blue-50 focus:outline-none cursor-pointer"
                >
                  <span className="w-5 text-stone-400 font-mono">{codigo}</span>
                  <span>{nome}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {pedido?.tipo === 'campo' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (digitado.length < pedido.min) return;
              enviar(pedido.comando === 34 ? Number(digitado || 0).toFixed(2).replace('.', ',') : digitado);
            }}
          >
            <div>
              <label className={LABEL_CLASS}>{pedido.texto}</label>
              {pedido.comando === 34 ? (
                <NumberField scale={2} value={digitado} onChange={setDigitado} className={INPUT_CLASS} />
              ) : (
                <input
                  autoFocus
                  required={pedido.min > 0}
                  type={pedido.comando === 41 ? 'password' : 'text'}
                  inputMode={pedido.comando === 30 || pedido.comando === 41 ? undefined : 'numeric'}
                  maxLength={pedido.max || undefined}
                  className={`${INPUT_CLASS} font-mono`}
                  value={digitado}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setDigitado(e.target.value)}
                />
              )}
            </div>
            <div className="flex justify-end">
              <button type="submit" className={BOTAO_PRIMARIO} disabled={digitado.length < pedido.min}>OK (Enter)</button>
            </div>
          </form>
        )}
      </div>
    </Janela>
  );
}
