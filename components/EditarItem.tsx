import React, { useState } from 'react';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Janela';
import { NumberField } from './NumberField';
import { INPUT_CLASS, LABEL_CLASS } from './campos';
import { centavos, totalDoItem } from '@/lib/fiscal';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/**
 * Altera o valor de um item do cupom (Requisito VIII, III): pelo unitário ou pelo total.
 * A diferença para o preço da tabela vira desconto ou acréscimo no item; o preço de referência não muda.
 */
export function EditarItem({ nome, quantidade, precoTabela, iat, valorTotal, onSalvar, onFechar }: {
  nome: string;
  quantidade: number;
  precoTabela: number;
  iat?: string | null;
  valorTotal: number;
  onSalvar: (total: number | null) => void;
  onFechar: () => void;
}) {
  const bruto = totalDoItem(quantidade, precoTabela, iat);
  const [total, setTotal] = useState(String(valorTotal));
  const [unitario, setUnitario] = useState(String(centavos(valorTotal / quantidade)));
  const t = Number(total) || 0;
  const diferenca = centavos(t - bruto);

  const salvar = () => onSalvar(t > 0 && diferenca !== 0 ? t : null);

  return (
    <Janela
      titulo="Valor do item"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => onSalvar(null)}>Voltar ao preço da tabela</button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={!(t > 0)} onClick={salvar}>Aplicar</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm">
          <p className="font-bold text-stone-800">{nome}</p>
          <p className="text-stone-500">
            {quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} × {brl(precoTabela)} = {brl(bruto)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Valor unitário</label>
            <NumberField
              scale={2}
              value={unitario}
              className={INPUT_CLASS}
              required
              onChange={(v) => {
                setUnitario(v);
                setTotal(String(totalDoItem(quantidade, Number(v) || 0, iat)));
              }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Valor total do item</label>
            <NumberField
              scale={2}
              value={total}
              className={INPUT_CLASS}
              required
              onChange={(v) => {
                setTotal(v);
                setUnitario(String(centavos((Number(v) || 0) / quantidade)));
              }}
            />
          </div>
        </div>
        <p className={`text-sm font-semibold ${diferenca < 0 ? 'text-rose-600' : diferenca > 0 ? 'text-blue-700' : 'text-stone-400'}`}>
          {diferenca < 0 ? `Desconto de ${brl(-diferenca)}` : diferenca > 0 ? `Acréscimo de ${brl(diferenca)}` : 'Sem desconto nem acréscimo'}
        </p>
      </div>
    </Janela>
  );
}
