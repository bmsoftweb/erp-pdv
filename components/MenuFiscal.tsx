import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Menu, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { DateField } from './DateField';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { baixar, erroDe } from '@/lib/arquivos';
import { PAF } from '@/lib/fiscal';

type Funcao = 'identificacao' | 'registros' | 'xml';

/**
 * Menu Fiscal (Requisito VI) na tela principal de vendas, sem senha.
 * Só as funções que este PAF tem: sem DAV, Requisições Externas, mesas nem combustível (§ 2º).
 */
export function MenuFiscal() {
  const [aberto, setAberto] = useState(false);
  const [funcao, setFuncao] = useState<Funcao | null>(null);
  const itens: [Funcao, string][] = [
    ['identificacao', 'Identificação do PAF-NFC-e'],
    ['registros', 'Registros do PAF-NFC-e'],
    ['xml', 'Exportação de arquivos XML'],
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className={`flex items-center gap-2 px-4 py-2 ${aberto ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-200'} border font-medium text-xs rounded-xl transition-colors active:scale-95 shadow-sm cursor-pointer`}
      >
        <Menu size={18} />
        MENU FISCAL
        {aberto ? <ChevronDown size={14} className="ml-1 opacity-70" /> : <ChevronUp size={14} className="ml-1 opacity-70" />}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute bottom-full right-0 mb-3 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50 p-2 space-y-1">
            {itens.map(([f, nome]) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setAberto(false);
                  setFuncao(f);
                }}
                className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-sm font-semibold text-gray-700 cursor-pointer"
              >
                <FileText size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <span>{nome}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {funcao === 'identificacao' && <Identificacao onFechar={() => setFuncao(null)} />}
      {funcao === 'registros' && <Registros onFechar={() => setFuncao(null)} />}
      {funcao === 'xml' && <ExportarXml onFechar={() => setFuncao(null)} />}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 text-sm">
      <span className="text-gray-500">{rotulo}</span>
      <span className="font-semibold text-gray-800 text-right">{valor || '—'}</span>
    </div>
  );
}

const formatarCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function Identificacao({ onFechar }: { onFechar: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch('/api/menu-fiscal/identificacao')
      .then(async (r) => (r.ok ? setD(await r.json()) : Promise.reject(new Error(await erroDe(r)))))
      .catch((e) => toast.error(e.message));
  }, []);
  return (
    <Janela titulo="Identificação do PAF-NFC-e" onFechar={onFechar} rodape={<button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>}>
      {!d ? (
        <p className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Carregando…</p>
      ) : (
        <div className="space-y-5">
          <section>
            <h4 className="text-xs font-black text-blue-700 uppercase tracking-wider mb-1">Empresa desenvolvedora</h4>
            <Linha rotulo="CNPJ" valor={formatarCnpj(d.desenvolvedor.cnpj)} />
            <Linha rotulo="Razão social" valor={d.desenvolvedor.razaoSocial} />
            <Linha rotulo="Endereço" valor={d.desenvolvedor.endereco} />
            <Linha rotulo="Telefone" valor={d.desenvolvedor.telefone} />
            <Linha rotulo="Responsável técnico" valor={d.desenvolvedor.responsavel} />
          </section>
          <section>
            <h4 className="text-xs font-black text-blue-700 uppercase tracking-wider mb-1">Programa aplicativo</h4>
            <Linha rotulo="Nome comercial" valor={PAF.nome} />
            <Linha rotulo="Versão" valor={PAF.versao} />
            <Linha rotulo="Última atualização instalada" valor={PAF.atualizadoEm} />
          </section>
          <section>
            <h4 className="text-xs font-black text-blue-700 uppercase tracking-wider mb-1">Arquitetura</h4>
            <Linha rotulo="Banco de dados" valor={d.arqBD} />
            <Linha rotulo="Execução" valor={d.arqSist} />
          </section>
        </div>
      )}
    </Janela>
  );
}

function Periodo({ inicio, fim, onInicio, onFim }: { inicio: string; fim: string; onInicio: (v: string) => void; onFim: (v: string) => void }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>De</label>
          <DateField value={inicio} onChange={onInicio} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Até</label>
          <DateField value={fim} onChange={onFim} />
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">Sem datas, considera todo o período do banco de dados.</p>
    </div>
  );
}

async function gerar(url: string, corpo: unknown, nome: string, setGerando: (v: boolean) => void) {
  setGerando(true);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    await baixar(r, nome);
    toast.success('Arquivo gerado.');
  } catch (e: any) {
    toast.error(e?.message || String(e));
  } finally {
    setGerando(false);
  }
}

function Registros({ onFechar }: { onFechar: () => void }) {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [estoque, setEstoque] = useState<'total' | 'parcial'>('total');
  const [produtos, setProdutos] = useState('');
  const [gerando, setGerando] = useState(false);
  return (
    <Janela
      titulo="Registros do PAF-NFC-e"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button
            type="button"
            className={BOTAO_PRIMARIO}
            disabled={gerando}
            onClick={() => gerar('/api/menu-fiscal/registros', { inicio, fim, estoque, produtos: produtos.split('\n') }, 'registros-paf.xml', setGerando)}
          >
            {gerando ? 'Gerando…' : 'Gerar e assinar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Periodo inicio={inicio} fim={fim} onInicio={setInicio} onFim={setFim} />
        <div>
          <label className={LABEL_CLASS}>Estoque</label>
          <select className={INPUT_CLASS} value={estoque} onChange={(e) => setEstoque(e.target.value as 'total' | 'parcial')} required>
            <option value="total">ESTOQUE TOTAL</option>
            <option value="parcial">ESTOQUE PARCIAL</option>
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Posição na abertura do dia (antes do primeiro documento fiscal da data).</p>
        </div>
        {estoque === 'parcial' && (
          <div>
            <label className={LABEL_CLASS}>Mercadorias (código ou descrição, uma por linha)</label>
            <textarea className={`${INPUT_CLASS} h-28 font-mono`} value={produtos} onChange={(e) => setProdutos(e.target.value)} required />
          </div>
        )}
      </div>
    </Janela>
  );
}

function ExportarXml({ onFechar }: { onFechar: () => void }) {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [modelo, setModelo] = useState<'65' | '55'>('65');
  const [gerando, setGerando] = useState(false);
  return (
    <Janela
      titulo="Exportação de arquivos XML"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={gerando} onClick={() => gerar('/api/menu-fiscal/xml', { inicio, fim, modelo }, 'xml.zip', setGerando)}>
            {gerando ? 'Exportando…' : 'Exportar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Periodo inicio={inicio} fim={fim} onInicio={setInicio} onFim={setFim} />
        <div>
          <label className={LABEL_CLASS}>Modelo</label>
          <select className={INPUT_CLASS} value={modelo} onChange={(e) => setModelo(e.target.value as '65' | '55')} required>
            <option value="65">NFC-e</option>
            <option value="55">NF-e</option>
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Inclui as emitidas em contingência.</p>
        </div>
      </div>
    </Janela>
  );
}

/** Aviso exigido nas telas sem o Menu Fiscal (Requisito VI, § 1º) */
export const MenuFiscalInacessivel = () => (
  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">MENU FISCAL INACESSÍVEL NESTA TELA</span>
);
