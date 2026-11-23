import React, { useEffect, useState } from 'react';
import { useMenuTeclado, ITEM_MENU, NUMERO_MENU } from './menuTeclado';
import { ChevronDown, ChevronUp, FileText, Menu, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Janela, BOTAO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { DateField } from './DateField';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { erroDe } from '@/lib/arquivos';
import { PAF } from '@/lib/fiscal';

type Funcao = 'identificacao' | 'registros' | 'dav' | 're' | 'xml';

/**
 * Menu Fiscal (Requisito VI) na tela principal de vendas, sem senha.
 * PAF único com o erp-vendas (DAV e Requisições Externas vêm de lá); sem mesas nem combustível (§ 2º).
 */
export function MenuFiscal({ aberto, setAberto }: { aberto: boolean; setAberto: (v: boolean) => void }) {
  const [funcao, setFuncao] = useState<Funcao | null>(null);
  // Aberto pelo botão ou pelo código 88: escolhe com as setas
  const { lista, fechar, teclas } = useMenuTeclado(aberto, setAberto);
  const itens: [Funcao, string][] = [
    ['identificacao', 'Identificação do PAF-NFC-e'],
    ['registros', 'Registros do PAF-NFC-e'],
    ['dav', 'Controle dos DAV'],
    ['re', 'Requisições Externas (RE)'],
    ['xml', 'Exportação de arquivos XML'],
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className={`${BOTAO} border ${aberto ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-stone-600 border-stone-300 hover:bg-stone-100'}`}
      >
        <Menu size={16} />
        MENU FISCAL
        {aberto ? <ChevronDown size={14} className="ml-1 opacity-70" /> : <ChevronUp size={14} className="ml-1 opacity-70" />}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={fechar} />
          <div ref={lista} role="menu" onKeyDown={teclas} className="absolute bottom-full right-0 mb-2 w-80 py-1 bg-white rounded-lg shadow-xl border border-stone-200 overflow-hidden z-50">
            {itens.map(([f, nome], n) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setAberto(false);
                  setFuncao(f);
                }}
                role="menuitem"
                className={ITEM_MENU}
              >
                <span className={NUMERO_MENU}>{n + 1}</span>
                <FileText size={16} className="text-blue-600 shrink-0" />
                <span>{nome}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {funcao === 'identificacao' && <Identificacao onFechar={() => setFuncao(null)} />}
      {funcao === 'registros' && <Registros onFechar={() => setFuncao(null)} />}
      {funcao === 'dav' && <PorSituacao {...DAV} onFechar={() => setFuncao(null)} />}
      {funcao === 're' && <PorSituacao {...RE} onFechar={() => setFuncao(null)} />}
      {funcao === 'xml' && <ExportarXml onFechar={() => setFuncao(null)} />}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-stone-50 text-sm">
      <span className="text-stone-500">{rotulo}</span>
      <span className="font-semibold text-stone-800 text-right">{valor || '—'}</span>
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
    <Janela menuFiscal titulo="Identificação do PAF-NFC-e" onFechar={onFechar} rodape={<button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>}>
      {!d ? (
        <p className="text-sm text-stone-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Carregando…</p>
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
            <Linha rotulo="Versão" valor={d.versao} />
            <Linha rotulo="Última atualização instalada" valor={d.atualizadoEm} />
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
      <p className="text-[11px] text-stone-400 mt-1">Sem datas, considera todo o período do banco de dados.</p>
    </div>
  );
}

const salvar = (dados: Blob, nome: string) => {
  const url = URL.createObjectURL(dados);
  Object.assign(document.createElement('a'), { href: url, download: nome }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

/**
 * Gera e baixa o arquivo. O XML assinado do Requisito XII traz o arquivo texto em Base64; ele também é salvo solto
 * (.txt), e o aviso diz o nome e o local dos dois (roteiro do Ato DIAT 56/2026: "geração e localização").
 */
async function gerar(url: string, corpo: unknown, nomePadrao: string, setGerando: (v: boolean) => void) {
  setGerando(true);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error(await erroDe(r));
    const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || nomePadrao;
    const dados = await r.blob();
    salvar(dados, nome);
    const nomes = [nome];
    // nroArquivo "0" = "SEM INFORMACOES" (Requisito VI, § 8º): não há texto para salvar
    const m = nome.endsWith('.xml') ? /<arquivo nroArquivo="([^"]*)"[^>]*>(?:<!\[CDATA\[)?([A-Za-z0-9+/=\s]+)/.exec(await dados.text()) : null;
    const base64 = m && m[1] !== '0' ? m[2].replace(/\s/g, '') : undefined;
    if (base64) {
      // Base64 do texto em latin1: cada caractere do atob é um byte
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const txt = nome.replace(/\.xml$/, '.txt');
      salvar(new Blob([bytes], { type: 'text/plain' }), txt);
      nomes.push(txt);
    }
    toast.success(`Gerado${nomes.length > 1 ? 's' : ''} ${nomes.join(' e ')} na pasta Downloads do navegador.`, { duration: 15_000 });
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
    <Janela menuFiscal
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
          <p className="text-[11px] text-stone-400 mt-1">Posição na abertura do dia (antes do primeiro documento fiscal da data).</p>
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

const DAV = {
  titulo: 'Controle dos DAV', url: '/api/menu-fiscal/controle-dav', arquivo: 'controle-dav.xml',
  situacoes: [['todos', 'Totalidade dos DAV'], ['aberto', 'DAV em aberto'], ['df', 'DAV associados a um DF-e'], ['baixado', 'DAV baixados']],
};
const RE = {
  titulo: 'Requisições Externas (RE)', url: '/api/menu-fiscal/requisicoes-externas', arquivo: 'requisicoes-externas.xml',
  situacoes: [['todas', 'Totalidade das RE'], ['recebida', 'RE recebidas'], ['atendida', 'RE atendidas'], ['denegada', 'RE denegadas']],
};

/** Arquivo III (DAV) ou II (RE): período e situação (Requisito VI, III e IV) */
function PorSituacao({ titulo, url, arquivo, situacoes, onFechar }: typeof DAV & { onFechar: () => void }) {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [situacao, setSituacao] = useState(situacoes[0][0]);
  const [gerando, setGerando] = useState(false);
  return (
    <Janela menuFiscal
      titulo={titulo}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={gerando} onClick={() => gerar(url, { inicio, fim, situacao }, arquivo, setGerando)}>
            {gerando ? 'Gerando…' : 'Gerar e assinar'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Periodo inicio={inicio} fim={fim} onInicio={setInicio} onFim={setFim} />
        <div>
          <label className={LABEL_CLASS}>Situação</label>
          <select className={INPUT_CLASS} value={situacao} onChange={(e) => setSituacao(e.target.value)} required>
            {situacoes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
      </div>
    </Janela>
  );
}

function ExportarXml({ onFechar }: { onFechar: () => void }) {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [modelo, setModelo] = useState<'todos' | '65' | '55'>('todos');
  const [gerando, setGerando] = useState(false);
  return (
    <Janela menuFiscal
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
          <select className={INPUT_CLASS} value={modelo} onChange={(e) => setModelo(e.target.value as 'todos' | '65' | '55')} required>
            <option value="todos">Todos (NFC-e e NF-e)</option>
            <option value="65">NFC-e</option>
            <option value="55">NF-e</option>
          </select>
          <p className="text-[11px] text-stone-400 mt-1">Inclui as emitidas em contingência.</p>
        </div>
      </div>
    </Janela>
  );
}

/** Aviso exigido nas telas sem o Menu Fiscal (Requisito VI, § 1º) */
export const MenuFiscalInacessivel = () => (
  <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">MENU FISCAL INACESSÍVEL NESTA TELA</span>
);
