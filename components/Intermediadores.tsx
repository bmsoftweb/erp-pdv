import React, { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { Toggle } from './Toggle';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { erroDe } from '@/lib/arquivos';
import { cnpjValido, digitos } from '@/lib/fiscal';

export interface Intermediador {
  id: number;
  codigo: string;
  tipo: 'P' | 'T';
  nome_fantasia: string;
  cnpj: string;
  identificacao: string;
  ativo: number;
}

const NOVO = { id: 0, tipo: 'P' as 'P' | 'T', nome_fantasia: '', cnpj: '', identificacao: '', ativo: 1 };
const formatarCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/** Tabela de intermediadores de pagamento e de transação (Requisito XI, § 2º) */
export function Intermediadores({ onFechar }: { onFechar: () => void }) {
  const [lista, setLista] = useState<Intermediador[]>([]);
  const [edicao, setEdicao] = useState<typeof NOVO | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const r = await fetch('/api/intermediadores');
    if (!r.ok) return toast.error(await erroDe(r));
    setLista(await r.json());
  };
  useEffect(() => {
    carregar();
  }, []);

  const salvar = async () => {
    if (!edicao) return;
    if (!cnpjValido(edicao.cnpj)) return toast.error('CNPJ inválido.');
    setSalvando(true);
    try {
      const r = await fetch('/api/intermediadores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...edicao, cnpj: digitos(edicao.cnpj), ativo: !!edicao.ativo }),
      });
      if (!r.ok) throw new Error(await erroDe(r));
      setEdicao(null);
      await carregar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (edicao) {
    return (
      <Janela
        titulo={edicao.id ? 'Alterar intermediador' : 'Novo intermediador'}
        onFechar={() => setEdicao(null)}
        rodape={
          <>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setEdicao(null)}>Voltar</button>
            <button type="button" className={BOTAO_PRIMARIO} disabled={salvando} onClick={salvar}>Salvar</button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Tipo</label>
            <select className={INPUT_CLASS} value={edicao.tipo} onChange={(e) => setEdicao({ ...edicao, tipo: e.target.value as 'P' | 'T' })} required>
              <option value="P">Intermediador do pagamento (adquirente, carteira digital, banco…)</option>
              <option value="T">Intermediador da transação (marketplace, aplicativo de entrega…)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Nome fantasia</label>
            <input autoFocus className={INPUT_CLASS} value={edicao.nome_fantasia} maxLength={60} onFocus={(e) => e.target.select()} onChange={(e) => setEdicao({ ...edicao, nome_fantasia: e.target.value })} required />
          </div>
          <div>
            <label className={LABEL_CLASS}>CNPJ</label>
            <input className={`${INPUT_CLASS} font-mono`} inputMode="numeric" value={formatarCnpj(digitos(edicao.cnpj))} maxLength={18} onFocus={(e) => e.target.select()} onChange={(e) => setEdicao({ ...edicao, cnpj: digitos(e.target.value).slice(0, 14) })} required />
          </div>
          <div>
            <label className={LABEL_CLASS}>Identificação do estabelecimento no intermediador</label>
            <input className={INPUT_CLASS} value={edicao.identificacao} maxLength={60} onFocus={(e) => e.target.select()} onChange={(e) => setEdicao({ ...edicao, identificacao: e.target.value })} required={edicao.tipo === 'T'} />
          </div>
          {!!edicao.id && <Toggle checked={!!edicao.ativo} onChange={(v) => setEdicao({ ...edicao, ativo: v ? 1 : 0 })} label="Ativo" />}
        </div>
      </Janela>
    );
  }

  return (
    <Janela
      titulo="Intermediadores"
      largura="max-w-3xl"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button type="button" className={`${BOTAO_PRIMARIO} flex items-center gap-1.5`} onClick={() => setEdicao({ ...NOVO })}>
            <Plus size={16} /> Novo
          </button>
        </>
      }
    >
      <table className="w-full text-sm border border-gray-200">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Código</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Tipo</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Nome fantasia</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">CNPJ</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Identificação</th>
            <th className="border border-gray-200 px-2 py-1.5 w-[40px]">Ações</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((i) => (
            <tr key={i.id} className={i.ativo ? '' : 'text-gray-400'}>
              <td className="border border-gray-200 px-2 py-1.5 font-mono">{i.codigo}</td>
              <td className="border border-gray-200 px-2 py-1.5">{i.tipo === 'P' ? 'Pagamento' : 'Transação'}</td>
              <td className="border border-gray-200 px-2 py-1.5">{i.nome_fantasia}{!i.ativo && ' (inativo)'}</td>
              <td className="border border-gray-200 px-2 py-1.5 font-mono">{formatarCnpj(i.cnpj)}</td>
              <td className="border border-gray-200 px-2 py-1.5">{i.identificacao}</td>
              <td className="border border-gray-200 px-2 py-1.5 text-center">
                <button type="button" title="Editar" onClick={() => setEdicao({ ...i })} className="p-1 text-gray-500 hover:text-blue-600 cursor-pointer">
                  <Pencil size={15} />
                </button>
              </td>
            </tr>
          ))}
          {!lista.length && (
            <tr>
              <td colSpan={6} className="px-2 py-6 text-center text-gray-400">
                Nenhum intermediador. Cadastre ao menos o da própria loja (pagamento em dinheiro) e os das maquininhas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Janela>
  );
}
