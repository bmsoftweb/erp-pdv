import { Router } from 'express';
import { zipSync, strToU8 } from 'fflate';
import { pool } from './db.js';
import { empresaDa, grupoDa } from './auth.js';
import { emitenteDe, falha, mensagemDe, postar, rota, versaoPaf } from './notas.js';
import { dataHoraSql } from '../lib/dataHora.js';
import { digitos, PAF } from '../lib/fiscal.js';
import { estornarCancelados } from './estoque.js';

/**
 * Menu Fiscal do PAF-NFC-e (Requisito VI): identificação, Registros do PAF-NFC-e (Arquivo I, assinado como o
 * Requisito XII manda), Controle dos DAV, Requisições Externas e exportação dos XML. PAF único (decisão de 23/11/2026):
 * o erp-vendas e a tela do erp-nfe emitem pelo mesmo PAF, então tudo aqui consolida todos os DF-e do emitente
 * (Requisito VI, § 6º). Mesas e combustível não se aplicam.
 */

/**
 * Notas deste PAF: todas as do emitente. O erp-nfe identifica com o PAF todo DF-e de emitente de SC, inclusive o
 * digitado na tela dele (RICMS/SC Anexo 11, arts. 94, § 8º, e 95-B: um só emissor no varejo)
 */
const DO_PAF = '1 = 1';
/**
 * DF-e emitido (J1/J2/N1/N2, exportação XML e abertura do dia): inclusive cancelado e denegado, e a contingência
 * recusada à espera de ser gerada de novo (o DANFE já saiu; 6.8.2: "01/01/99")
 */
const EMITIDA = "(situacao IN ('autorizada', 'cancelada', 'contingencia', 'denegada') OR (situacao = 'rejeitada' AND SUBSTRING(chave, 35, 1) = '9'))";
/** Venda que vale no A2: nota autorizada ou em contingência (também a recusada, à espera de ser gerada de novo) */
const noA2 = (n: string) => `(${n}.situacao IN ('autorizada', 'contingencia') OR (${n}.situacao = 'rejeitada' AND SUBSTRING(${n}.chave, 35, 1) = '9'))`;
const NO_A2 = noA2('n');
/**
 * Tentativa normal da NFC-e que foi autorizada e depois cancelada pelo art. 105 do Anexo 11 (ou, fora do prazo, a
 * estornar), a denegada e a que ficou 'falhou' mas foi autorizada na SEFAZ (normal.autorizada, gravada pelo erp-nfe):
 * só existe no dados.normal da linha da contingência (resolverNormais do erp-nfe)
 */
const NORMAL = (campo: string) => `JSON_UNQUOTE(JSON_EXTRACT(dados, '$.normal.${campo}'))`;
const NORMAL_EMITIDA = `modelo = '65' AND (${NORMAL('resolvida')} IN ('cancelada', 'estornar', 'denegada') OR ${NORMAL('autorizada')} = 'true')`;
/** Forma de pagamento do erp-vendas → tPag (cópia do TPAG do lib/parcelas.ts do erp-vendas: mudar lá também) */
const TPAG_VENDAS: Record<string, string> = {
  Boleto: '15', PIX: '17', 'Cartão de crédito': '03', 'Cartão de débito': '04', Transferência: '18', Dinheiro: '01', Cheque: '02',
  'Cartão da loja': '05', 'Vale alimentação': '10', 'Vale refeição': '11', 'Vale presente': '12', 'Vale combustível': '13',
  'Depósito bancário': '16', 'Fidelidade / cashback': '19', 'PIX estático': '20', 'Crédito em loja': '21',
  'Pagamento eletrônico': '22', Outros: '99', 'Sem pagamento': '90',
};

const ascii = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ');
/** Alfanumérico: à esquerda, completado com brancos */
const X = (v: unknown, n: number) => ascii(v).slice(0, n).padEnd(n, ' ');
/** Numérico: só dígitos, à direita, completado com zeros */
const N = (v: unknown, n: number) => digitos(v).slice(-n).padStart(n, '0');
/** Valor com casas decimais implícitas */
const V = (v: unknown, n: number, casas = 2) => N(Math.round(Math.abs(Number(v) || 0) * 10 ** casas), n);
/** Data AAAAMMDD a partir de 'AAAA-MM-DD…' */
const D = (sql: unknown) => digitos(String(sql ?? '').slice(0, 10)).padEnd(8, '0');

/** Ordem do arquivo: crescente pelo código ASCII (localeCompare ignora caixa e pontuação) */
const ascendente = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * P2/D5: CST do ICMS (campo N de 2, tabela nacional — o CSOSN de 3 dígitos não cabe), CST do IBS/CBS e cClassTrib
 * são obrigatórios no cadastro (Requisito VII, VII e § 4º). Sem eles o arquivo não sai: "00"/"000" seria um CST falso
 */
function exigirTributacao(linhas: any[], nome: (l: any) => string) {
  const faltam = [...new Set(linhas.filter((l) => !digitos(l.cst_icms) || !digitos(l.cst_ibscbs) || !digitos(l.cclass_trib)).map(nome))];
  if (faltam.length)
    falha(`Tributação incompleta (CST do ICMS, CST do IBS/CBS ou cClassTrib) em ${faltam.length} produto(s): ${faltam.slice(0, 10).join('; ')}` +
      `${faltam.length > 10 ? '; …' : ''}. Complete o grupo tributário no erp-estoque (Requisito VII, § 4º).`);
}

const dataValida = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : null);

/** Código da mercadoria na Tabela de Mercadorias: o mesmo cProd que vai no DF-e (EAN do cadastro ou, sem ele, o id) */
const codigoMercadoria = (p: any) => digitos(p.codigo_barras) || String(p.id);
/** O mesmo código em SQL (D5/D6) */
const CODIGO_SQL = "COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(p.codigo_barras, ''), '[^0-9]', ''), ''), p.id)";

/** Empresa desenvolvedora e arquitetura (tabela sys_paf, uma linha para todo o ERP; script extras/2026-11-20_sys_paf.sql) */
async function dadosPaf() {
  const [[p]]: any = await pool.query("SELECT *, DATE_FORMAT(atualizado_em, '%d/%m/%Y') AS atualizado FROM sys_paf WHERE id = 1");
  if (!p) falha('Dados do PAF-NFC-e não cadastrados (tabela sys_paf).');
  return p;
}

/** Ambiente em uso no erp-nfe (1 produção, 2 homologação): os arquivos não misturam notas dos dois */
async function ambienteDe(emitId: number): Promise<number> {
  const [[c]]: any = await pool.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(dados, '$.webservice.ambiente')) AS ambiente FROM nfe_config WHERE empresa_id = ?", [emitId]);
  return Number(c?.ambiente) || 2;
}

/** Registros 1 a 3, iguais em todos os arquivos (U, D, W): estabelecimento, desenvolvedora e o PAF-NFC-e */
async function cabecalho(letra: 'U' | 'D' | 'W', emit: any, empresa: number) {
  const [[se]]: any = await pool.query('SELECT inscricao_municipal FROM sys_empresas WHERE id = ?', [empresa]);
  const paf = await dadosPaf();
  return [
    `${letra}1` + N(emit.cnpj, 14) + X(digitos(emit.inscricao_estadual), 14) + X(digitos(se?.inscricao_municipal), 14) + X(String(emit.razao_social).toUpperCase(), 50),
    `${letra}2` + N(paf.desenvolvedor_cnpj, 14) + X(digitos(paf.desenvolvedor_ie), 14) + X(digitos(paf.desenvolvedor_im), 14) + X(String(paf.desenvolvedor_razao).toUpperCase(), 50),
    `${letra}3` + X(PAF.nome.toUpperCase(), 50) + X(await versaoPaf(), 10),
  ];
}

/** Arquivo I (texto) — exportado para a conferência */
export async function arquivoI(emit: any, empresa: number, grupo: number, f: { inicio?: string | null; fim?: string | null; estoque: 'total' | 'parcial'; produtos?: string[] }) {
  const inicio = f.inicio || '1900-01-01';
  const fim = f.fim || '2999-12-31';
  const linhas = await cabecalho('U', emit, empresa);
  const ambiente = await ambienteDe(emit.id);
  let dados = 0;

  // ----- A2: total diário por meio de pagamento × intermediador × tipo de documento (sem os cancelados) -----
  const [caixa]: any = await pool.query(
    `SELECT DATE_FORMAT(p.data, '%Y-%m-%d') AS data, i.codigo, p.tpag, p.modelo, SUM(p.valor) AS valor
       FROM mov_nfce_pagamentos p
       JOIN cad_intermediadores i ON i.id = p.intermediador_id
       JOIN mov_nfce n ON n.id_app = p.mov_nfce_id_app
       -- a nota dá a situação: cancelada aqui ou na tela do erp-nfe sai do A2; nota do outro ambiente também
       JOIN nfe_documentos d ON d.empresa_id = ? AND d.referencia = CONCAT('PDV-', p.mov_nfce_id_app) AND d.ambiente = ?
      WHERE p.empresa_id = ? AND p.data BETWEEN ? AND ? AND n.cancelado <> 'S' AND ${noA2('d')}
      GROUP BY p.data, i.codigo, p.tpag, p.modelo`,
    [emit.id, ambiente, empresa, inicio, fim],
  );
  // erp-vendas: parcelas das vendas com nota no dia da emissão, uma a uma (o troco sai por venda)
  const [vendas]: any = await pool.query(
    `SELECT v.id AS venda, v.valor_total AS total, DATE_FORMAT(n.data_emissao, '%Y-%m-%d') AS data, i.codigo, p.forma_pagamento, n.modelo, p.valor
       FROM nfe_documentos n
       JOIN ven_vendas v ON v.id = CAST(SUBSTRING(n.referencia, 7) AS UNSIGNED)
       JOIN ven_venda_parcelas p ON p.venda_id = v.id
       LEFT JOIN cad_intermediadores i ON i.id = p.intermediador_id
      WHERE n.empresa_id = ? AND n.ambiente = ? AND n.referencia LIKE 'VENDA-%' AND n.chave IS NOT NULL AND ${NO_A2}
        AND n.data_emissao >= ? AND n.data_emissao < DATE_ADD(?, INTERVAL 1 DAY)`,
    [emit.id, ambiente, inicio, fim],
  );
  // Notas digitadas na tela do erp-nfe (sem referência): os pagamentos estão no JSON da nota (DocumentoNFe.pagamentos/troco)
  const [digitadas]: any = await pool.query(
    `SELECT DATE_FORMAT(n.data_emissao, '%Y-%m-%d') AS data, n.modelo, n.valor_total AS total,
            JSON_EXTRACT(n.dados, '$.pagamentos') AS pagamentos, JSON_EXTRACT(n.dados, '$.troco') AS troco
       FROM nfe_documentos n
      WHERE n.empresa_id = ? AND n.ambiente = ? AND n.referencia IS NULL AND ${DO_PAF} AND n.chave IS NOT NULL AND ${NO_A2}
        AND n.data_emissao >= ? AND n.data_emissao < DATE_ADD(?, INTERVAL 1 DAY)`,
    [emit.id, ambiente, inicio, fim],
  );
  // Intermediador do pagamento pelo CNPJ (o da credenciadora no cartão; sem ele, o do próprio estabelecimento, como no caixa)
  const [inters]: any = digitadas.length
    ? await pool.query("SELECT codigo, cnpj FROM cad_intermediadores WHERE empresa_id = ? AND tipo = 'P' ORDER BY codigo", [empresa])
    : [[]];
  const codigoInter = new Map<string, string>();
  for (const i of inters) if (!codigoInter.has(digitos(i.cnpj))) codigoInter.set(digitos(i.cnpj), i.codigo);
  const json = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);
  /** Tira o troco do Dinheiro: parcela e vPag levam o valor entregue; o A2 soma o que ficou, igual ao total do J1/N1 */
  const semTroco = (pags: any[], troco: number) => {
    let resta = Math.max(0, Math.round(troco * 100));
    return pags.map((p) => {
      const t = p.tpag === '01' ? Math.min(resta, Math.round(Number(p.valor) * 100)) : 0;
      resta -= t;
      return { ...p, valor: (Math.round(Number(p.valor) * 100) - t) / 100 };
    });
  };
  const pagamentos: any[] = [...caixa];
  const porVenda = new Map<number, any[]>();
  for (const v of vendas) porVenda.set(v.venda, [...(porVenda.get(v.venda) ?? []), { ...v, tpag: TPAG_VENDAS[v.forma_pagamento] ?? '99' }]);
  // Sem pagamento (90): a parcela leva o valor da venda, mas a nota sai com vPag 0
  for (const ps of porVenda.values()) for (const p of ps) if (p.tpag === '90') p.valor = 0;
  for (const ps of porVenda.values()) pagamentos.push(...semTroco(ps, ps.reduce((s, p) => s + Number(p.valor), 0) - Number(ps[0].total)));
  for (const n of digitadas) {
    const ps = (json(n.pagamentos) ?? []).map((p: any) => ({
      data: n.data, modelo: n.modelo, tpag: p.forma, valor: p.forma === '90' ? 0 : p.valor ?? n.total, // sem valor, o pagamento cobre a nota
      codigo: codigoInter.get(digitos(p.cartao?.cnpj || emit.cnpj)),
    }));
    pagamentos.push(...semTroco(ps, Number(json(n.troco)) || 0));
  }
  const a2 = new Map<string, number>();
  for (const r of pagamentos) {
    const tipo = r.modelo === '65' ? '1' : r.modelo === '55' ? '2' : '3';
    const chave = D(r.data) + N(r.tpag, 2) + tipo + X(r.codigo, 10);
    a2.set(chave, (a2.get(chave) ?? 0) + Number(r.valor));
  }
  // Total zerado (Sem pagamento, 90) não vira A2
  const a2Validos = [...a2].filter(([, valor]) => Math.round(valor * 100) !== 0);
  for (const [k, valor] of a2Validos.sort(([a], [b]) => ascendente(a, b)))
    linhas.push('A2' + k.slice(0, 8) + k.slice(11) + k.slice(8, 11) + V(valor, 12));
  dados += a2Validos.length;

  // ----- P2: Tabela de Mercadorias -----
  const [p2]: any = await pool.query(
    `SELECT p.id, p.codigo_barras, p.nome, p.ncm, p.cest, p.preco_venda, p.iat, p.ippt, u.sigla AS unidade,
            g.cst_icms, g.aliquota_icms, g.cst_ibscbs, g.cclass_trib
       FROM cad_produtos p
       LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
       LEFT JOIN fis_grupos_tributarios g ON g.id = p.grupo_tributario_id AND g.grupo_id = p.grupo_id
      WHERE p.grupo_id = ?`, // todo produto cadastrado, inclusive o inativo (6.5.1 do Arquivo I)
    [grupo],
  );
  exigirTributacao(p2, (p) => `${codigoMercadoria(p)} ${p.nome}`);
  p2.sort((a: any, b: any) => ascendente(codigoMercadoria(a), codigoMercadoria(b)));
  for (const p of p2) {
    linhas.push(
      'P2' + X(codigoMercadoria(p), 14) + X(digitos(p.cest), 7) + X(digitos(p.ncm), 8) + X(p.nome, 100) + X(p.unidade || 'UN', 6) +
        X(p.iat || 'A', 1) + X(p.ippt || 'T', 1) + N(p.cst_icms, 2) + V(aliquotaPaf(p), 4) +
        N(p.cst_ibscbs, 3) + N(p.cclass_trib, 6) + V(ibsUf(p), 4) + V(0, 4) + V(p.preco_venda, 14),
    );
  }
  dados += p2.length;

  // ----- E2: estoque na abertura do dia (antes do primeiro DF-e da data) -----
  const hoje = dataHoraSql().slice(0, 10);
  const [[abertura]]: any = await pool.query(
    `SELECT DATE_FORMAT(MIN(data_emissao), '%Y-%m-%d %H:%i:%s') AS inicio FROM nfe_documentos WHERE empresa_id = ? AND ambiente = ? AND chave IS NOT NULL AND ${EMITIDA} AND data_emissao >= ?`,
    [emit.id, ambiente, hoje],
  );
  const corte = abertura?.inicio || dataHoraSql();
  const termos = (f.produtos ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (f.estoque === 'parcial' && !termos.length) falha('Informe ao menos um código ou descrição para o ESTOQUE PARCIAL.');
  // Só as mercadorias informadas (Requisito VI, II, b, 2): número = o código do arquivo (EAN ou id) ou parte da descrição; texto = parte da descrição
  const soDigitos = (t: string) => /^\d+$/.test(t);
  const filtro = f.estoque === 'parcial'
    ? 'AND (' + termos.map((t) => (soDigitos(t) ? `(${CODIGO_SQL} = ? OR p.id = ? OR p.nome LIKE ?)` : 'p.nome LIKE ?')).join(' OR ') + ')'
    : '';
  const [e2]: any = await pool.query(
    `SELECT p.id, p.codigo_barras, p.nome, u.sigla AS unidade,
            COALESCE((SELECT SUM(s.quantidade) FROM est_estoque_saldo s
                        JOIN cad_produtos_lotes l ON l.id = s.lote_id
                        JOIN cad_produtos_localizacoes lc ON lc.id = s.localizacao_id
                       WHERE l.produto_id = p.id AND lc.empresa_id = ?), 0)
          - COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('entrada','ajuste_positivo','producao_entrada') THEN m.quantidade
                                      WHEN m.tipo IN ('saida','ajuste_negativo','perda','producao_saida') THEN -m.quantidade ELSE 0 END)
                        FROM est_estoque_movimentacoes m JOIN cad_produtos_lotes l ON l.id = m.lote_id
                       WHERE l.produto_id = p.id AND m.empresa_id = ? AND m.date_insert >= ?), 0) AS estoque
       FROM cad_produtos p
       LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
      WHERE p.grupo_id = ? ${filtro}`,
    [empresa, empresa, corte, grupo, ...termos.flatMap((t) => (soDigitos(t) ? [t, t, `%${t}%`] : [`%${t}%`]))],
  );
  e2.sort((a: any, b: any) => ascendente(codigoMercadoria(a), codigoMercadoria(b)));
  for (const p of e2) {
    const q = Number(p.estoque) || 0;
    linhas.push('E2' + X(codigoMercadoria(p), 14) + X(p.nome, 100) + X(p.unidade || 'UN', 6) + (q < 0 ? '-' : '+') + V(q, 12, 3) + D(hoje) + D(corte));
  }
  dados += e2.length;

  // ----- J1/J2 (NFC-e) e N1/N2 (NF-e) emitidas por este PAF, inclusive canceladas -----
  const [docs]: any = await pool.query(
    `SELECT modelo, serie, numero, chave, valor_total, destinatario_documento,
            DATE_FORMAT(data_emissao, '%Y-%m-%d') AS emissao,
            REGEXP_SUBSTR(xml_protocolo, '<dhRecbto>[0-9-]{10}') AS recebimento
       FROM nfe_documentos
      WHERE empresa_id = ? AND ambiente = ? AND ${DO_PAF} AND chave IS NOT NULL AND ${EMITIDA}
        AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)
     UNION ALL
     -- normal cancelada (art. 105): J1 com o número e a chave dela e a data, o valor e o CPF da venda; tpEmis 1, sem J2
     SELECT modelo, serie, ${NORMAL('numero')}, ${NORMAL('chave')}, valor_total, destinatario_documento,
            DATE_FORMAT(data_emissao, '%Y-%m-%d'), NULL
       FROM nfe_documentos
      WHERE empresa_id = ? AND ambiente = ? AND ${DO_PAF} AND ${NORMAL_EMITIDA}
        AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)`,
    [emit.id, ambiente, inicio, fim, emit.id, ambiente, inicio, fim],
  );
  // Classificação do arquivo (5.1): data, tipo, série (campo X, à esquerda: "10 " antes de "2  ") e número, como no texto
  const ordem = (d: any) => D(d.emissao) + d.modelo + X(String(d.serie), 3) + N(d.numero, 10);
  docs.sort((a: any, b: any) => ascendente(ordem(a), ordem(b)));
  const grupos: Record<string, string[]> = { J1: [], J2: [], N1: [], N2: [] };
  for (const d of docs) {
    const contingencia = String(d.chave).charAt(34) !== '1';
    const autorizada = d.recebimento ? D(String(d.recebimento).replace('<dhRecbto>', '')) : '01/01/99';
    const valor = V(d.valor_total, 14);
    const numero = N(d.numero, 10);
    const serie = X(String(d.serie), 3);
    if (d.modelo === '65') {
      const cpf = N(digitos(d.destinatario_documento).length === 11 ? d.destinatario_documento : '', 11);
      // J1 para toda NFC-e emitida (6.7.1); a de contingência também no J2 (6.8.1)
      grupos.J1.push('J1' + D(d.emissao) + valor + N(d.chave, 44) + numero + serie + cpf);
      if (contingencia) grupos.J2.push('J2' + D(d.emissao) + autorizada + valor + N(d.chave, 44) + numero + serie + cpf);
    } else {
      const doc = N(d.destinatario_documento, 14);
      grupos.N1.push('N1' + D(d.emissao) + valor + String(d.chave).charAt(34) + N(d.chave, 44) + numero + serie + doc);
      if (contingencia) grupos.N2.push('N2' + D(d.emissao) + autorizada + valor + N(d.chave, 44) + numero + serie + doc);
    }
  }
  linhas.push(...grupos.J1, ...grupos.J2, ...grupos.N1, ...grupos.N2);
  dados += grupos.J1.length + grupos.J2.length + grupos.N1.length + grupos.N2.length;

  return dados ? linhas.join('\r\n') + '\r\n' : null;
}

// ===================== Arquivo III (Controle dos DAV) e Arquivo II (Requisições Externas), do erp-vendas =====================

/** Hora HHMMSS a partir de 'AAAA-MM-DD HH:MM:SS' */
const H = (sql: unknown) => digitos(String(sql ?? '').slice(11, 19)).padEnd(6, '0');
/** Número do DAV: 10 dígitos, no campo de 13 posições */
const NUM = (n: unknown) => X(String(n).padStart(10, '0'), 13);
/** Casas decimais usadas no Arquivo III (campos 19/20 do D5 e 10/11 do D6) */
const CASAS_QTD = 4;
const CASAS_UNIT = 2;
/** Alíquota do IBS da UF no período de teste: só no CST 000 (tributação integral); os demais saem zerados, como nas notas (decisão de 23/11/2026) */
const IBS_UF = 0.1;
const ibsUf = (g: any) => (String(g.cst_ibscbs ?? '') === '000' ? IBS_UF : 0);
/** Alíquota do ICMS no P2/D5: a legal do grupo, também no Simples Nacional; zerada nos não tributados (Ato DIAT 54/2026, 6.5.5 do P2 e 6.5.3 do D5) */
const aliquotaPaf = (g: any) => (['40', '41', '50', '60'].includes(String(g.cst_icms ?? '')) ? 0 : g.aliquota_icms);

const SITUACOES_DAV = { aberto: 'A', df: 'E', baixado: 'B', todos: null } as const;
/**
 * DAV que teve DF-e (direto ou pelo pedido gerado do orçamento), mesmo cancelado ou denegado depois = E (o erp-vendas
 * trava esse DAV); baixado ou recusado = B; o resto = A
 */
const notaDav = (a: string) => `EXISTS(SELECT 1 FROM ven_dav_itens di JOIN ven_venda_itens vi ON vi.dav_item_id = di.id
                    JOIN ven_vendas vn ON vn.id = vi.venda_id WHERE di.dav_id = ${a}.id AND (vn.status = 'faturada' OR vn.nfe_documento_id IS NOT NULL OR vn.nfs_nota_id IS NOT NULL
                      OR EXISTS(SELECT 1 FROM nfe_documentos nd WHERE nd.referencia = CONCAT('VENDA-', vn.id) AND nd.chave IS NOT NULL
                                  AND nd.situacao IN ('autorizada', 'cancelada', 'contingencia', 'denegada'))))`;
const SITUACAO_DAV = `CASE
    WHEN ${notaDav('d')} OR EXISTS(SELECT 1 FROM ven_davs pd WHERE pd.orcamento_id = d.id AND ${notaDav('pd')}) THEN 'E'
    WHEN d.status IN ('baixado', 'recusado') OR EXISTS(SELECT 1 FROM ven_davs pd WHERE pd.orcamento_id = d.id AND pd.status = 'baixado') THEN 'B'
    ELSE 'A' END`;

/** Texto do Arquivo III (D1 a D6); null quando não há DAV no filtro */
export async function arquivoIII(emit: any, empresa: number, f: { inicio?: string | null; fim?: string | null; situacao: keyof typeof SITUACOES_DAV }) {
  const [davs]: any = await pool.query(
    `SELECT * FROM (
       SELECT d.id, d.numero, d.tipo, d.prevenda_senha, d.data_emissao, d.valor_produtos, d.valor_frete, d.valor_total,
              p.nome AS cliente, p.cpf_cnpj, ${SITUACAO_DAV} AS situacao
         FROM ven_davs d LEFT JOIN cad_pessoas p ON p.id = d.pessoa_id
        WHERE d.empresa_id = ? AND d.data_emissao BETWEEN ? AND ?) x
      WHERE ? IS NULL OR situacao = ?
      ORDER BY numero`,
    [empresa, f.inicio || '1900-01-01', f.fim || '2999-12-31', SITUACOES_DAV[f.situacao], SITUACOES_DAV[f.situacao]],
  );
  if (!davs.length) return null;
  const linhas = await cabecalho('D', emit, empresa);

  const ids = davs.map((d: any) => d.id);
  // D5: um por item, com a tributação do grupo do produto (mesmos campos do P2). Item removido do DAV fica com
  // ven_dav_itens.cancelado = 1 (campo 18 "S"); enquanto a coluna não existir no banco, sai "N"
  const sqlItens = (cancelado: string) =>
    `SELECT d.numero, i.item, i.descricao, i.unidade, i.quantidade, i.preco_unitario, i.valor_desconto, i.valor_total,
            DATE_FORMAT(i.incluido_em, '%Y-%m-%d') AS incluido_em, ${CODIGO_SQL} AS codigo, ${cancelado} AS cancelado,
            g.cst_icms, g.aliquota_icms, g.cst_ibscbs, g.cclass_trib
       FROM ven_dav_itens i JOIN ven_davs d ON d.id = i.dav_id
       JOIN cad_produtos p ON p.id = i.produto_id
       LEFT JOIN fis_grupos_tributarios g ON g.id = p.grupo_tributario_id AND g.grupo_id = p.grupo_id
      WHERE i.dav_id IN (?)
      ORDER BY d.numero, i.item`;
  const [itens]: any = await pool
    .query(sqlItens('i.cancelado'), [ids])
    .catch((e: any) => (e?.code === 'ER_BAD_FIELD_ERROR' ? pool.query(sqlItens('0'), [ids]) : Promise.reject(e)));
  exigirTributacao(itens, (i) => `${i.codigo} ${i.descricao}`);

  // D4: um por DAV. Subtotal (06) = soma dos valores líquidos dos itens não cancelados do D5 (6.4.2); 07 = o que não é de
  // item (frete, desconto no total: 6.4.3), a diferença até o total (08), para fechar 06 ± 07 = 08
  const subtotal = new Map<number, number>();
  for (const i of itens)
    if (Number(i.cancelado) !== 1) subtotal.set(i.numero, (subtotal.get(i.numero) ?? 0) + Math.round(Number(i.valor_total) * 100));
  for (const d of davs) {
    const sub = subtotal.get(d.numero) ?? 0;
    linhas.push(
      'D4' + NUM(d.numero) + D(d.data_emissao) + X(d.prevenda_senha ? 'PRE-VENDA' : d.tipo === 'pedido' ? 'PEDIDO' : 'ORCAMENTO', 30) + (d.prevenda_senha ? X(d.prevenda_senha, 20) : '0'.repeat(20)) +
        V(sub / 100, 14) + V((Math.round(Number(d.valor_total) * 100) - sub) / 100, 14) + V(d.valor_total, 14) + X(d.cliente, 40) + N(d.cpf_cnpj, 14) + d.situacao,
    );
  }

  for (const i of itens) {
    const bruto = Number(i.valor_total) + Number(i.valor_desconto);
    linhas.push(
      'D5' + NUM(i.numero) + D(i.incluido_em) + N(i.item, 3) + X(i.codigo, 14) + X(i.descricao, 100) + V(i.quantidade, 14, CASAS_QTD) +
        X(i.unidade, 3) + V(bruto, 14) + V(i.valor_desconto, 14) + V(Number(i.valor_total) / Number(i.quantidade), 14, CASAS_UNIT) +
        N(i.cst_icms, 2) + V(aliquotaPaf(i), 4) + N(i.cst_ibscbs, 3) + N(i.cclass_trib, 6) + V(ibsUf(i), 4) + V(0, 4) +
        (Number(i.cancelado) === 1 ? 'S' : 'N') + CASAS_QTD + CASAS_UNIT,
    );
  }

  // D6: log de alteração de itens, por DAV, data e hora
  const [log]: any = await pool.query(
    `SELECT d.numero, l.tipo, l.descricao, l.unidade, l.quantidade, l.preco_unitario,
            DATE_FORMAT(l.alterado_em, '%Y-%m-%d %H:%i:%s') AS quando, ${CODIGO_SQL} AS codigo
       FROM ven_dav_itens_log l JOIN ven_davs d ON d.id = l.dav_id
       JOIN cad_produtos p ON p.id = l.produto_id
      WHERE l.dav_id IN (?)
      ORDER BY d.numero, l.alterado_em, l.id`,
    [ids],
  );
  for (const l of log) {
    linhas.push(
      'D6' + NUM(l.numero) + D(l.quando) + H(l.quando) + X(l.codigo, 14) + X(l.descricao, 100) + V(l.quantidade, 14, CASAS_QTD) +
        X(l.unidade, 3) + V(l.preco_unitario, 14, CASAS_UNIT) + CASAS_QTD + CASAS_UNIT + l.tipo,
    );
  }
  return linhas.join('\r\n') + '\r\n';
}

const SITUACOES_RE = { recebida: 'recebida', atendida: 'atendida', denegada: 'denegada', todas: null } as const;
const LETRA_RE = { recebida: 'R', atendida: 'A', denegada: 'D' } as Record<string, string>;
/** Campos do W4 completados com zeros à esquerda (6.4.4), mesmo o alfanumérico do código do pedido */
const Z = (v: unknown, n: number) => ascii(v).slice(-n).padStart(n, '0');

/** Texto do Arquivo II (W1 a W4); null quando não há RE no filtro */
export async function arquivoII(emit: any, empresa: number, f: { inicio?: string | null; fim?: string | null; situacao: keyof typeof SITUACOES_RE }) {
  const [res]: any = await pool.query(
    `SELECT re.cre, re.origem, re.status, re.codigo_pedido, re.valor_total, d.numero AS dav
       FROM ven_requisicoes_externas re LEFT JOIN ven_davs d ON d.id = re.dav_id
      WHERE re.empresa_id = ? AND DATE(re.recebida_em) BETWEEN ? AND ? AND (? IS NULL OR re.status = ?)
      ORDER BY re.cre`,
    [empresa, f.inicio || '1900-01-01', f.fim || '2999-12-31', SITUACOES_RE[f.situacao], SITUACOES_RE[f.situacao]],
  );
  if (!res.length) return null;
  const linhas = await cabecalho('W', emit, empresa);
  for (const r of res) {
    linhas.push(
      'W4' + X(String(r.origem).toUpperCase(), 100) + LETRA_RE[r.status] + N(r.cre, 9) +
        (r.status === 'denegada' ? '0'.repeat(13 + 40 + 14) : Z(String(r.dav).padStart(10, '0'), 13) + Z(r.codigo_pedido, 40) + V(r.valor_total, 14)),
    );
  }
  return linhas.join('\r\n') + '\r\n';
}

/** DF-e da exportação XML (Requisito VI, IX): os mesmos do J1/J2/N1/N2, com a normal cancelada (XML assinado, sem protocolo) */
export async function documentosXml(emitId: number, ambiente: number, modelos: string[], inicio: string, fim: string) {
  const [docs]: any = await pool.query(
    `SELECT chave, modelo, COALESCE(xml_protocolo, xml) AS xml, data_emissao FROM nfe_documentos
      WHERE empresa_id = ? AND ambiente = ? AND ${DO_PAF} AND modelo IN (?) AND chave IS NOT NULL AND ${EMITIDA}
        AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)
     UNION ALL
     SELECT ${NORMAL('chave')}, modelo, ${NORMAL('xml')}, data_emissao FROM nfe_documentos
      WHERE empresa_id = ? AND ambiente = ? AND ${DO_PAF} AND modelo IN (?) AND ${NORMAL_EMITIDA}
        AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY data_emissao`,
    [emitId, ambiente, modelos, inicio, fim, emitId, ambiente, modelos, inicio, fim],
  );
  return docs as { chave: string; modelo: string; xml: string | null }[];
}

/** XML do Requisito XII com o arquivo em Base64, assinado no erp-nfe com o e-CNPJ do estabelecimento */
async function xmlAssinado(emit: any, uid: number, nroArquivo: string, texto: string | null) {
  const agora = dataHoraSql();
  const data = agora.slice(8, 10) + agora.slice(5, 7) + agora.slice(0, 4);
  const hora = agora.slice(11, 19).replace(/:/g, '');
  const conteudo = texto === null ? 'SEM INFORMACOES' : Buffer.from(texto, 'latin1').toString('base64');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const paf = await dadosPaf();
  const xml =
    `<menuFiscal xmlns="http://www.sef.sc.gov.br/nfce"><arquivo nroArquivo="${texto === null ? '0' : nroArquivo}" data="${data}" hora="${hora}" ` +
    `arqBD="${esc(paf.arq_bd)}" arqSist="${esc(paf.arq_sist)}"><![CDATA[${conteudo}]]></arquivo></menuFiscal>`;
  const r = await postar(emit.id, uid, '/api/assinar-menu-fiscal', { xml });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d?.xml) falha(mensagemDe(d, r.status));
  return { xml: d.xml as string, nome: `${data}${hora}` };
}

export function createMenuFiscalRouter() {
  const r = Router();

  /** Identificação do PAF-NFC-e (Requisito VI, I); versão e data da última atualização da sys_paf, o nome do front-end */
  r.get('/menu-fiscal/identificacao', rota(async () => {
    const paf = await dadosPaf();
    return {
      desenvolvedor: {
        cnpj: paf.desenvolvedor_cnpj,
        razaoSocial: paf.desenvolvedor_razao,
        endereco: paf.desenvolvedor_endereco,
        telefone: paf.desenvolvedor_telefone,
        responsavel: paf.desenvolvedor_responsavel,
      },
      versao: paf.versao,
      atualizadoEm: paf.atualizado ?? '',
      arqBD: paf.arq_bd,
      arqSist: paf.arq_sist,
    };
  }));

  /** Registros do PAF-NFC-e (Requisito VI, II): Arquivo I assinado */
  r.post('/menu-fiscal/registros', rota(async (req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const b = req.body ?? {};
    // E2: notas canceladas em qualquer lugar (caixa, erp-vendas, tela do erp-nfe) devolvem os itens antes da conta
    await estornarCancelados(empresa).catch((e) => console.error('Estorno de estoque:', e));
    const texto = await arquivoI(emit, empresa, grupoDa(res), {
      inicio: dataValida(b.inicio),
      fim: dataValida(b.fim),
      estoque: b.estoque === 'parcial' ? 'parcial' : 'total',
      produtos: Array.isArray(b.produtos) ? b.produtos : [],
    });
    const { xml, nome } = await xmlAssinado(emit, uid, 'I', texto);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="PAF-NFCe_Registros_${emit.cnpj}_${nome}.xml"`);
    res.send(xml);
  }));

  /** Controle dos DAV (Requisito VI, III) e Requisições Externas (IV): Arquivos III e II assinados */
  const situacoes = { III: SITUACOES_DAV, II: SITUACOES_RE } as const;
  for (const [rota_, nro, nome] of [['controle-dav', 'III', 'ControleDAV'], ['requisicoes-externas', 'II', 'RequisicoesExternas']] as const) {
    r.post(`/menu-fiscal/${rota_}`, rota(async (req, res, s) => {
      const empresa = empresaDa(res);
      const uid = Number(s.userId);
      const emit = await emitenteDe(uid, empresa);
      const b = req.body ?? {};
      if (!(b.situacao in situacoes[nro])) falha('Escolha a situação.');
      const f = { inicio: dataValida(b.inicio), fim: dataValida(b.fim), situacao: b.situacao };
      const texto = nro === 'III' ? await arquivoIII(emit, empresa, f) : await arquivoII(emit, empresa, f);
      const { xml, nome: quando } = await xmlAssinado(emit, uid, nro, texto);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="PAF-NFCe_${nome}_${emit.cnpj}_${quando}.xml"`);
      res.send(xml);
    }));
  }

  /** Exportação de arquivos XML (Requisito VI, IX): os DF-e do período e modelo (ou todos), normais e de contingência, em .zip */
  r.post('/menu-fiscal/xml', rota(async (req, res, s) => {
    const emit = await emitenteDe(Number(s.userId), empresaDa(res));
    const b = req.body ?? {};
    const modelos = b.modelo === '55' ? ['55'] : b.modelo === '65' ? ['65'] : ['65', '55'];
    const rotulo = modelos.length > 1 ? 'NFCe_NFe' : modelos[0] === '65' ? 'NFCe' : 'NFe';
    const docs = await documentosXml(emit.id, await ambienteDe(emit.id), modelos, dataValida(b.inicio) || '1900-01-01', dataValida(b.fim) || '2999-12-31');
    const arquivos = Object.fromEntries(docs.filter((d: any) => d.xml).map((d: any) => [`${d.chave}-${d.modelo === '65' ? 'nfce' : 'nfe'}.xml`, strToU8(d.xml)]));
    // Cancelamentos aceitos (normal e por substituição) vão junto, com o procEventoNFe
    const [eventos]: any = docs.length
      ? await pool.query(
          `SELECT chave, tipo_evento, sequencia, xml_retorno FROM nfe_eventos
            WHERE empresa_id = ? AND chave IN (?) AND tipo_evento IN ('110111', '110112') AND codigo_status IN (135, 136, 155)`,
          [emit.id, docs.map((d: any) => d.chave)],
        )
      : [[]];
    for (const e of eventos) if (e.xml_retorno) arquivos[`${e.chave}-${e.tipo_evento}-${e.sequencia}-proc-evento.xml`] = strToU8(e.xml_retorno);
    if (!Object.keys(arquivos).length) falha(`Nenhum DF-e (${rotulo.replace('_', ' ou ').replace('NFCe', 'NFC-e').replace('NFe', 'NF-e')}) no período.`, 404);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="XML_${rotulo}_${emit.cnpj}.zip"`);
    res.send(Buffer.from(zipSync(arquivos)));
  }));

  return r;
}
