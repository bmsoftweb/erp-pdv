import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { empresaDa, grupoDa } from './auth.js';
import type { SessionData } from './session.js';
import { dataHoraSql } from '../lib/dataHora.js';
import { centavos, cnpjValido, cpfValido, digitos, MEIOS_PAGAMENTO, modeloDoDocumento, PAF, ratear, totalDoItem } from '../lib/fiscal.js';

/**
 * Emissão do cupom pelo concentrador do erp-nfe (POST /api/emitir), como o erp-vendas faz:
 * o erp-nfe numera, calcula os impostos pelo grupo tributário, assina, transmite e, na NFC-e,
 * sai em contingência offline (tpEmis 9) quando a SEFAZ não responde. Referência PDV-<id_app>:
 * repetir a chamada nunca gera outra nota.
 *
 * Autenticação: token de sessão do erp-nfe (HMAC-SHA256 com o SESSION_SECRET dele, aqui NFE_SECRET),
 * gerado para o usuário logado. A nota sai em nome de quem vendeu.
 */

export class ErroHttp extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}
export function falha(mensagem: string, status = 400): never {
  throw new ErroHttp(status, mensagem);
}

/** Handler async com erro virando JSON { error } (o Express 4 não captura promessa rejeitada) */
export const rota = (fn: (req: Request, res: Response, s: SessionData) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const r = await fn(req, res, res.locals.sessao as SessionData);
      if (!res.headersSent) res.json(r ?? { success: true });
    } catch (e: any) {
      if (e?.code === 'ER_NO_SUCH_TABLE' || e?.code === 'ER_BAD_FIELD_ERROR') {
        console.error(e);
        return void res.status(500).json({ error: `Falta preparar o banco para o PAF-NFC-e: rode o extras/2026-11-20_paf_nfce.sql (${e.sqlMessage}).` });
      }
      if (!(e instanceof ErroHttp)) console.error(e);
      res.status(e instanceof ErroHttp ? e.status : 500).json({ error: e?.message || String(e) });
    }
  };

/** Mesmo formato do criarToken do erp-nfe: base64url({uid, emp, exp}).assinatura */
function tokenPara(segredo: string, uid: number, emp: number) {
  const corpo = Buffer.from(JSON.stringify({ uid, emp, exp: Date.now() + 5 * 60_000 })).toString('base64url');
  return `${corpo}.${crypto.createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

async function postar(emitente: number, uid: number, caminho: string, corpo?: unknown, metodo = 'POST') {
  const url = process.env.NFE_URL;
  const segredo = process.env.NFE_SECRET || '';
  if (!url || segredo.length < 32) falha('Integração com o erp-nfe não configurada (NFE_URL e NFE_SECRET no .env).', 503);
  try {
    return await fetch(`${url!.replace(/\/$/, '')}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPara(segredo, uid, emitente)}` },
      ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e: any) {
    throw new ErroHttp(504, `Sem resposta do erp-nfe (${e?.message ?? e}). Tente de novo: a mesma venda nunca gera duas notas.`);
  }
}

async function chamar(emitente: number, uid: number, caminho: string, corpo?: unknown, metodo = 'POST') {
  const r = await postar(emitente, uid, caminho, corpo, metodo);
  return { status: r.status, dados: (await r.json().catch(() => ({}))) as any };
}

const mensagemDe = (d: any, status: number) =>
  [d?.error || d?.motivo || `HTTP ${status}`, ...(Array.isArray(d?.errosSchema) ? d.errosSchema.map((e: any) => `• ${e?.mensagem ?? e}`) : [])].join('\n');

/** Emitente do erp-nfe para o usuário logado: o CNPJ da filial da sessão, que precisa ser a do usuário */
async function emitenteDe(uid: number, empresa: number) {
  const [[e]]: any = await pool.query(
    `SELECT e.* FROM sys_usuarios u
       JOIN sys_empresas se ON se.id = u.empresa_id
       JOIN nfe_empresas e ON e.cnpj = se.cnpj COLLATE utf8mb4_unicode_ci
      WHERE u.id = ? AND se.id = ? AND u.ativo = 1 AND se.ativo = 1 AND e.ativo = 1
      LIMIT 1`,
    [uid, empresa],
  );
  if (e) return e;
  const [[se]]: any = await pool.query('SELECT cnpj, nome_fantasia, razao_social FROM sys_empresas WHERE id = ?', [empresa]);
  const nome = se?.nome_fantasia || se?.razao_social || `empresa ${empresa}`;
  const [[em]]: any = await pool.query('SELECT ativo FROM nfe_empresas WHERE cnpj = ? COLLATE utf8mb4_unicode_ci LIMIT 1', [se?.cnpj ?? '']);
  if (!em) falha(`${nome} (CNPJ ${se?.cnpj || 'vazio'}) não está cadastrada como emitente no erp-nfe.`);
  if (!Number(em.ativo)) falha(`${nome} está inativa como emitente no erp-nfe.`);
  falha(`Seu usuário é de outra empresa, e o erp-nfe só emite pela empresa do próprio usuário. Entre com um usuário de ${nome}.`);
}

/** IBS/CBS de 2026, ano de teste da LC 214/2025 (os mesmos percentuais do erp-vendas) */
const IBS_UF = 0.1;
const CBS = 0.9;

function icmsDoItem(i: any, simples: boolean, rot: string) {
  const grupo = `o grupo tributário "${i.grupo_descricao}"`;
  const onde = 'Troque o grupo nos dados fiscais do produto (erp-estoque).';
  if (!Number(i.grupo_ativo)) falha(`${rot}: ${grupo} está inativo. ${onde}`);
  if (!simples) return i.cst_icms ? { cst: String(i.cst_icms) } : falha(`${rot}: ${grupo} não tem CST do ICMS, e a empresa não é do Simples Nacional. ${onde}`);
  if (!i.csosn) falha(`${rot}: ${grupo} não tem CSOSN, e a empresa é do Simples Nacional. ${onde}`);
  const credito = Number(i.aliquota_credito_sn) || 0;
  if (String(i.csosn) === '101' && !(credito > 0)) falha(`${rot}: ${grupo} é CSOSN 101 e está sem a alíquota de crédito do Simples.`);
  return { csosn: String(i.csosn), ...(credito > 0 && { aliquotaCredito: credito }) };
}

/** ICMS por substituição tributária: só nesses o CEST é obrigatório */
const CSOSN_ST = ['201', '202', '203', '500'];
const CST_ST = ['10', '30', '60', '70'];
export const comST = (i: any, simples: boolean) =>
  simples ? CSOSN_ST.includes(String(i.csosn ?? '')) : CST_ST.includes(String(i.cst_icms ?? ''));

async function serieAtiva(emitente: number, modelo: string): Promise<number> {
  const [[s]]: any = await pool.query('SELECT serie FROM nfe_series WHERE empresa_id = ? AND modelo = ? AND ativo = 1 ORDER BY serie LIMIT 1', [emitente, modelo]);
  return s?.serie ?? falha(`Nenhuma série ativa do modelo ${modelo} no erp-nfe (tela Séries).`);
}

interface ItemVenda { produtoId: number; quantidade: number; valorUnitario: number; valorTotal?: number }
interface PagamentoVenda { tPag: string; valor: number; intermediadorId: number; cnpjPagamento?: string; ufPagamento?: string; bandeira?: string; autorizacao?: string; integracao?: number }
interface Venda {
  idApp: string;
  itens: ItemVenda[];
  consumidor?: { documento?: string; nome?: string; ieProdutor?: string };
  pagamentos: PagamentoVenda[];
  /** Desconto (negativo) ou acréscimo (positivo) no total da venda */
  ajusteTotal?: number;
  /** false = emite pelo valor líquido, sem vDesc/vOutro (Requisito VIII, § 2º) */
  discriminarAjustes?: boolean;
  intermediadorTransacaoId?: number;
}

/** Monta o documento do POST /api/emitir do erp-nfe a partir da venda e do cadastro */
export async function montarDocumento(v: Venda, emit: any, grupo: number, empresa: number) {
  if (!Array.isArray(v.itens) || !v.itens.length) falha('A venda não tem itens.');
  if (!Array.isArray(v.pagamentos) || !v.pagamentos.length) falha('Informe o pagamento.');

  // ----- adquirente e modelo (Requisito IV) -----
  const doc = digitos(v.consumidor?.documento);
  if (doc && !(doc.length === 11 ? cpfValido(doc) : doc.length === 14 && cnpjValido(doc))) falha('CPF/CNPJ do consumidor inválido.');
  const modelo = modeloDoDocumento(doc, v.consumidor?.ieProdutor);
  let cliente: any = null;
  if (modelo === '55') {
    [[cliente]] = await pool.query(
      'SELECT * FROM cad_pessoas WHERE cpf_cnpj = ? AND grupo_id = ? AND ativo = 1 AND date_delete IS NULL LIMIT 1',
      [doc, grupo],
    ) as any;
    if (!cliente) falha(`${doc.length === 14 ? 'CNPJ' : 'CPF'} ${doc} não cadastrado no ERP. A venda para ${doc.length === 14 ? 'empresa' : 'produtor primário'} sai em NF-e, que exige o cadastro do cliente com endereço.`);
    if (digitos(cliente.cidade_ibge).length !== 7) falha('Cliente sem município (código IBGE) no endereço. Complete o cadastro.');
  }
  const nfce = modelo === '65';
  const simples = [1, 2, 4].includes(Number(emit.crt));
  const ieDest = String(v.consumidor?.ieProdutor || cliente?.ie || '').trim();
  const indIEDest = nfce ? 9 : ieDest ? (/ISENTO/i.test(ieDest) ? 2 : 1) : 9;
  const interestadual = !nfce && String(cliente.cidade_uf || '').toUpperCase() !== String(emit.uf).toUpperCase();

  // ----- itens (Requisitos VII e VIII) -----
  const ids = [...new Set(v.itens.map((i) => Number(i.produtoId)))];
  const [produtos]: any = await pool.query(
    `SELECT p.*, u.sigla AS unidade, g.descricao AS grupo_descricao, g.ativo AS grupo_ativo, g.origem, g.cfop_dentro_uf, g.cfop_fora_uf,
            g.csosn, g.aliquota_credito_sn, g.cst_icms, g.aliquota_icms, g.cst_pis, g.aliquota_pis, g.cst_cofins, g.aliquota_cofins,
            g.cst_ibscbs, g.cclass_trib, g.id AS grupo_trib_id
       FROM cad_produtos p
       LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
       LEFT JOIN fis_grupos_tributarios g ON g.id = p.grupo_tributario_id
      WHERE p.id IN (?) AND p.grupo_id = ?`,
    [ids, grupo],
  );
  const porId = new Map<number, any>(produtos.map((p: any) => [Number(p.id), p]));

  const discriminar = v.discriminarAjustes !== false;
  const linhas = v.itens.map((it, n) => {
    const p = porId.get(Number(it.produtoId));
    const rot = `Item ${n + 1}`;
    if (!p) falha(`${rot}: produto ${it.produtoId} não encontrado.`);
    const q = Number(it.quantidade);
    if (!(q > 0)) falha(`${rot} (${p.nome}): quantidade inválida.`);
    const referencia = Number(p.preco_venda);
    const iat = p.iat ?? 'A';
    const bruto = totalDoItem(q, referencia, iat);
    // Valor negociado no caixa (Requisito VIII, III): unitário alterado ou total digitado
    const liquido = it.valorTotal != null ? centavos(Number(it.valorTotal)) : totalDoItem(q, Number(it.valorUnitario ?? referencia), iat);
    if (!(liquido > 0)) falha(`${rot} (${p.nome}): valor inválido.`);
    return { p, q, referencia, bruto, liquido, rot };
  });

  // Ajuste no total da venda, rateado pelos itens
  const ajustes = ratear(Number(v.ajusteTotal) || 0, linhas.map((l) => l.liquido));
  const itens = linhas.map(({ p, q, referencia, bruto, liquido, rot }, k) => {
    const final = centavos(liquido + ajustes[k]);
    if (final <= 0) falha(`${rot} (${p.nome}): o desconto zera o item.`);
    if (digitos(p.ncm).length !== 8) falha(`${rot} (${p.nome}): produto sem NCM. Preencha nos dados fiscais do produto (erp-estoque).`);
    if (!p.grupo_trib_id) falha(`${rot} (${p.nome}): produto sem grupo tributário. Preencha nos dados fiscais do produto (erp-estoque).`);
    if (comST(p, simples) && digitos(p.cest).length !== 7) falha(`${rot} (${p.nome}): produto com substituição tributária sem CEST. Preencha nos dados fiscais do produto (erp-estoque).`);
    const cfop = interestadual ? p.cfop_fora_uf : p.cfop_dentro_uf;
    if (!cfop) falha(`${rot} (${p.nome}): o grupo tributário não tem CFOP ${interestadual ? 'interestadual' : 'estadual'}.`);
    const gtin = digitos(p.codigo_barras);
    const diferenca = centavos(final - bruto);
    return {
      codigo: p.sku || String(p.id),
      ...([8, 12, 13, 14].includes(gtin.length) && { ean: gtin }),
      descricao: p.nome,
      ncm: digitos(p.ncm),
      ...(p.cest && { cest: digitos(p.cest) }),
      cfop,
      unidade: p.unidade || 'UN',
      quantidade: q,
      ...(discriminar
        ? { valorUnitario: referencia, valorTotal: bruto, ...(diferenca < 0 && { valorDesconto: -diferenca }), ...(diferenca > 0 && { valorOutros: diferenca }) }
        : { valorUnitario: Math.round((final / q) * 1e10) / 1e10, valorTotal: final }),
      imposto: {
        origem: Number(p.origem ?? 0),
        ...icmsDoItem(p, simples, rot),
        aliquota: Number(p.aliquota_icms || 0),
        pis: { cst: p.cst_pis, aliquota: Number(p.aliquota_pis || 0) },
        cofins: { cst: p.cst_cofins, aliquota: Number(p.aliquota_cofins || 0) },
        ...(p.cst_ibscbs && { ibscbs: { cst: p.cst_ibscbs, classificacao: p.cclass_trib, aliquotaIBSUF: IBS_UF, aliquotaIBSMun: 0, aliquotaCBS: CBS } }),
      },
      final,
    };
  });
  const totalNota = centavos(itens.reduce((s, i) => s + i.final, 0));

  // ----- pagamentos e intermediadores (Requisitos X e XI) -----
  const idsInter = [...new Set([...v.pagamentos.map((p) => Number(p.intermediadorId)), Number(v.intermediadorTransacaoId) || 0].filter(Boolean))];
  const [inters]: any = idsInter.length
    ? await pool.query('SELECT * FROM cad_intermediadores WHERE id IN (?) AND empresa_id = ? AND ativo = 1', [idsInter, empresa])
    : [[]];
  const inter = new Map<number, any>(inters.map((i: any) => [Number(i.id), i]));
  const pagamentos = v.pagamentos.map((pg, n) => {
    const meio = MEIOS_PAGAMENTO.find((m) => m.codigo === String(pg.tPag));
    if (!meio) falha(`Pagamento ${n + 1}: meio de pagamento ${pg.tPag} fora da tabela da NF-e.`);
    if (!(Number(pg.valor) > 0)) falha(`Pagamento ${n + 1}: valor inválido.`);
    const i = inter.get(Number(pg.intermediadorId));
    if (!i) falha(`Pagamento ${n + 1} (${meio.nome}): informe o intermediador do pagamento (Requisito XI).`);
    const cnpjPag = digitos(pg.cnpjPagamento);
    if (cnpjPag && (!cnpjValido(cnpjPag) || !/^[A-Z]{2}$/i.test(pg.ufPagamento || ''))) falha(`Pagamento ${n + 1}: CNPJ transacional ou UF inválidos.`);
    return {
      forma: meio.codigo,
      valor: centavos(Number(pg.valor)),
      indPag: 0,
      ...(meio.codigo === '99' && { descricao: i.nome_fantasia }),
      ...(cnpjPag && { cnpjPagamento: cnpjPag, ufPagamento: String(pg.ufPagamento).toUpperCase() }),
      ...(meio.cartao && {
        cartao: {
          integracao: Number(pg.integracao) === 1 ? 1 : 2,
          ...(digitos(i.cnpj).length === 14 && { cnpj: digitos(i.cnpj) }),
          ...(pg.bandeira && { bandeira: String(pg.bandeira).padStart(2, '0') }),
          ...(pg.autorizacao && { autorizacao: String(pg.autorizacao) }),
        },
      }),
      intermediador: i,
    };
  });
  const pago = centavos(pagamentos.reduce((s, p) => s + p.valor, 0));
  if (pago + 0.005 < totalNota) falha(`Pagamentos (${pago.toFixed(2)}) menores que o total (${totalNota.toFixed(2)}).`);
  const troco = centavos(pago - totalNota);
  if (troco > 0 && !pagamentos.some((p) => p.forma === '01') && troco > 0.01) falha('Troco só em pagamento com dinheiro.');

  const transacao = v.intermediadorTransacaoId ? inter.get(Number(v.intermediadorTransacaoId)) : null;
  if (v.intermediadorTransacaoId && (!transacao || transacao.tipo !== 'T')) falha('Intermediador da transação não encontrado.');

  const documento = {
    ide: {
      modelo,
      naturezaOperacao: 'VENDA',
      serie: await serieAtiva(emit.id, modelo),
      tipoDocumento: 1,
      finalidade: 1,
      consumidorFinal: nfce || indIEDest === 9 ? 1 : 0,
      presencial: transacao ? 9 : 1,
      versaoProcesso: `${PAF.nome} ${PAF.versao}`,
      ...(transacao
        ? { intermediador: { cnpj: digitos(transacao.cnpj), identificador: transacao.identificacao } }
        : { indicadorIntermediador: 0 }),
    },
    ...(doc && {
      destinatario: nfce
        ? { cpf: doc, nome: String(v.consumidor?.nome || '').trim().slice(0, 60), indIEDest: 9 }
        : {
            ...(doc.length === 14 ? { cnpj: doc } : { cpf: doc }),
            nome: cliente.nome,
            indIEDest,
            ...(indIEDest === 1 && { inscricaoEstadual: digitos(ieDest) }),
            ...(cliente.email_nfe || cliente.email_principal ? { email: cliente.email_nfe || cliente.email_principal } : {}),
            endereco: {
              logradouro: cliente.logradouro || '', numero: cliente.numero || 'SN', ...(cliente.complemento && { complemento: cliente.complemento }),
              bairro: cliente.bairro || '', codigoMunicipio: digitos(cliente.cidade_ibge), municipio: cliente.cidade_nome || '',
              uf: String(cliente.cidade_uf || '').toUpperCase(), cep: digitos(cliente.cep),
              ...(digitos(cliente.fone_principal) && { fone: digitos(cliente.fone_principal) }),
            },
          },
    }),
    itens: itens.map(({ final, ...i }) => i),
    ...(!nfce && { transporte: { modalidadeFrete: 9 } }),
    pagamentos: pagamentos.map(({ intermediador, ...p }) => p),
    ...(troco > 0 && { troco }),
    informacoesAdicionais: { obsFisco: [{ campo: 'PAF', texto: PAF.nome }] },
  };
  return { documento, modelo, totalNota, pagamentos, itens, linhas, doc };
}

export function createNotasRouter() {
  const r = Router();

  /** Conclusão da venda (Requisito III): emite na hora; NFC-e sem SEFAZ sai em contingência */
  r.post('/nfce/emitir', rota(async (req, _res, s) => {
    const v = req.body as Venda;
    if (!/^\d{10,25}$/.test(String(v?.idApp || ''))) falha('Identificação da venda inválida.');
    const empresa = empresaDa(_res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const m = await montarDocumento(v, emit, grupoDa(_res), empresa);
    const referencia = `PDV-${v.idApp}`;

    const { status, dados } = await chamar(emit.id, uid, '/api/emitir', { referencia, documento: m.documento, sincrono: true, contingencia: m.modelo === '65' });
    if (status >= 400) falha(mensagemDe(dados, status), status === 409 ? 409 : 400);
    const situacao = String(dados?.situacao ?? (status === 202 ? 'enviada' : ''));

    if (['autorizada', 'contingencia'].includes(situacao)) {
      // Registro da venda no ERP: cupom, itens e pagamentos (o A2 do Arquivo I sai dos pagamentos)
      const agora = dataHoraSql();
      const con = await pool.getConnection();
      try {
        await con.beginTransaction();
        await con.query(
          `INSERT INTO mov_nfce (id_app, empresa_id, date_update, serie, numero, data, valor, cancelado)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'N')
           ON DUPLICATE KEY UPDATE date_update = VALUES(date_update), serie = VALUES(serie), numero = VALUES(numero), valor = VALUES(valor)`,
          [v.idApp, empresa, agora, String(dados.serie ?? ''), Number(dados.numero) || 0, agora.slice(0, 10), m.totalNota],
        );
        await con.query('DELETE FROM mov_nfce_produtos WHERE mov_nfce_id_app = ?', [v.idApp]);
        for (const [k, l] of m.linhas.entries()) {
          await con.query(
            `INSERT INTO mov_nfce_produtos (id_app, date_update, mov_nfce_id_app, produto_id, produto_ean, qtdade, valor_unit, valor_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [`${v.idApp.slice(0, 21)}${String(k + 1).padStart(4, '0')}`, agora, v.idApp, l.p.id, digitos(l.p.codigo_barras), l.q, l.referencia, m.itens[k].final],
          );
        }
        await con.query('DELETE FROM mov_nfce_pagamentos WHERE mov_nfce_id_app = ?', [v.idApp]);
        for (const p of m.pagamentos) {
          await con.query(
            `INSERT INTO mov_nfce_pagamentos (mov_nfce_id_app, empresa_id, data, modelo, tpag, valor, intermediador_id, cnpj_pag, uf_pag, bandeira, autorizacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.idApp, empresa, agora.slice(0, 10), m.modelo, p.forma, p.valor, p.intermediador.id, p.cnpjPagamento ?? null, p.ufPagamento ?? null,
              p.cartao?.bandeira ?? null, p.cartao?.autorizacao ?? null, agora],
          );
        }
        await con.commit();
      } catch (e) {
        await con.rollback();
        // A nota já saiu: o registro no ERP falhar não pode esconder isso do caixa
        console.error('Nota emitida, mas o registro da venda falhou:', e);
        return { ...resumo(dados, situacao, m.modelo), aviso: `Nota emitida, mas o registro da venda no ERP falhou: ${(e as any)?.sqlMessage || (e as any)?.message}` };
      } finally {
        con.release();
      }
    }
    if (['rejeitada', 'denegada'].includes(situacao)) falha(`${m.modelo === '65' ? 'NFC-e' : 'NF-e'} ${situacao}: ${dados?.cStat ?? ''} - ${dados?.motivo ?? ''}`, 422);
    return resumo(dados, situacao, m.modelo);
  }));

  /** DANFE (PDF) pela chave, gerado pelo erp-nfe */
  r.post('/nfce/danfe', rota(async (req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const chave = digitos(req.body?.chave);
    if (chave.length !== 44) falha('Chave inválida.');
    const resp = await postar(emit.id, uid, '/api/danfe', { chave });
    if (!resp.ok) falha(mensagemDe(await resp.json().catch(() => ({})), resp.status));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DANFE-${chave}.pdf"`);
    res.send(Buffer.from(await resp.arrayBuffer()));
  }));

  /** Cancelamento (110111). Em contingência não autorizada o erp-nfe recusa (Requisito III, III) */
  r.post('/nfce/cancelar', rota(async (req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const chave = digitos(req.body?.chave);
    const justificativa = String(req.body?.justificativa || '').trim();
    if (justificativa.length < 15) falha('A justificativa do cancelamento precisa ter ao menos 15 caracteres.');
    const [[d]]: any = await pool.query(
      "SELECT situacao, protocolo, referencia FROM nfe_documentos WHERE empresa_id = ? AND chave = ? AND referencia LIKE 'PDV-%' LIMIT 1",
      [emit.id, chave],
    );
    if (!d) falha('Nota não encontrada.', 404);
    if (d.situacao === 'contingencia') falha('Esta NFC-e foi emitida em contingência e ainda não foi autorizada. O cancelamento só é possível depois da autorização.');
    if (d.situacao !== 'autorizada') falha(`Nota ${d.situacao}: só nota autorizada pode ser cancelada.`);
    const { status, dados } = await chamar(emit.id, uid, '/api/evento', { chave, tipoEvento: '110111', protocolo: d.protocolo, justificativa });
    if (status >= 400 || !dados?.sucesso) falha(mensagemDe({ error: dados?.error || `${dados?.cStat ?? ''} - ${dados?.xMotivo ?? 'Cancelamento recusado'}` }, status));
    await pool.query("UPDATE mov_nfce SET cancelado = 'S', date_update = ? WHERE id_app = ? AND empresa_id = ?", [dataHoraSql(), String(d.referencia).slice(4), empresa]);
    return { success: true, motivo: `${dados.cStat} - ${dados.xMotivo}` };
  }));

  /** Conciliação financeira (EConf, 110750) dos pagamentos gravados da nota autorizada (Requisito XI, § 7º) */
  r.post('/nfce/econf', rota(async (req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const chave = digitos(req.body?.chave);
    const [[d]]: any = await pool.query(
      "SELECT situacao, referencia FROM nfe_documentos WHERE empresa_id = ? AND chave = ? AND referencia LIKE 'PDV-%' LIMIT 1",
      [emit.id, chave],
    );
    if (!d) falha('Nota não encontrada.', 404);
    if (d.situacao !== 'autorizada') falha('A conciliação financeira só vale para nota autorizada.');
    const [pags]: any = await pool.query(
      `SELECT p.tpag, p.valor, DATE_FORMAT(p.data, '%Y-%m-%d') AS data, p.cnpj_pag, p.uf_pag, p.bandeira, p.autorizacao, i.cnpj AS cnpj_inter
         FROM mov_nfce_pagamentos p JOIN cad_intermediadores i ON i.id = p.intermediador_id
        WHERE p.mov_nfce_id_app = ? AND p.empresa_id = ?`,
      [String(d.referencia).slice(4), empresa],
    );
    if (!pags.length) falha('Esta venda não tem pagamentos gravados no ERP.');
    const pagamentosEConf = pags.map((p: any) => ({
      indPag: 0,
      tPag: p.tpag,
      valor: Number(p.valor),
      data: p.data,
      ...(p.cnpj_pag && { cnpjPagamento: p.cnpj_pag, ufPagamento: p.uf_pag }),
      ...(digitos(p.cnpj_inter).length === 14 && MEIOS_PAGAMENTO.find((m) => m.codigo === p.tpag)?.cartao && { cnpjInstituicao: digitos(p.cnpj_inter) }),
      ...(p.bandeira && { bandeira: p.bandeira }),
      ...(p.autorizacao && { autorizacao: p.autorizacao }),
    }));
    const { status, dados } = await chamar(emit.id, uid, '/api/evento', { chave, tipoEvento: '110750', pagamentosEConf });
    if (status >= 400 || !dados?.sucesso) falha(mensagemDe({ error: dados?.error || `${dados?.cStat ?? ''} - ${dados?.xMotivo ?? 'EConf recusado'}` }, status));
    return { success: true, motivo: `${dados.cStat} - ${dados.xMotivo}` };
  }));

  /** Tabela de intermediadores (Requisito XI, § 2º) */
  r.get('/intermediadores', rota(async (_req, res) => {
    const [linhas] = await pool.query(
      'SELECT id, codigo, tipo, nome_fantasia, cnpj, identificacao, ativo FROM cad_intermediadores WHERE empresa_id = ? ORDER BY codigo',
      [empresaDa(res)],
    );
    return linhas;
  }));

  r.post('/intermediadores', rota(async (req, res) => {
    const empresa = empresaDa(res);
    const b = req.body ?? {};
    const tipo = b.tipo === 'T' ? 'T' : 'P';
    const nome = String(b.nome_fantasia || '').trim().slice(0, 60);
    const cnpj = digitos(b.cnpj);
    const identificacao = String(b.identificacao || '').trim().slice(0, 60);
    if (!nome) falha('Informe o nome fantasia.');
    if (!cnpjValido(cnpj)) falha('CNPJ inválido.');
    if (tipo === 'T' && !identificacao) falha('Informe a identificação do estabelecimento no intermediador.');
    const agora = dataHoraSql();
    if (b.id) {
      await pool.query(
        'UPDATE cad_intermediadores SET tipo = ?, nome_fantasia = ?, cnpj = ?, identificacao = ?, ativo = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
        [tipo, nome, cnpj, identificacao, b.ativo === false ? 0 : 1, agora, b.id, empresa],
      );
      return { success: true, id: b.id };
    }
    // Código sequencial de 3 dígitos por empresa; o índice único segura duas inclusões ao mesmo tempo
    const [[m]]: any = await pool.query('SELECT MAX(CAST(codigo AS UNSIGNED)) AS ultimo FROM cad_intermediadores WHERE empresa_id = ?', [empresa]);
    const codigo = String((Number(m?.ultimo) || 0) + 1).padStart(3, '0');
    if (codigo.length > 3) falha('A tabela de intermediadores chegou a 999 códigos.');
    const [ins]: any = await pool.query(
      'INSERT INTO cad_intermediadores (empresa_id, codigo, tipo, nome_fantasia, cnpj, identificacao, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      [empresa, codigo, tipo, nome, cnpj, identificacao, agora],
    );
    return { success: true, id: ins.insertId, codigo };
  }));

  /** Transmissão automática das NFC-e em contingência (Requisito III, II); o PDV chama a cada minuto */
  r.post('/nfce/contingencia', rota(async (_req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const { status, dados } = await chamar(emit.id, uid, '/api/emitir-contingencia', {});
    if (status >= 400) falha(mensagemDe(dados, status));
    return dados;
  }));

  /** Notas emitidas pelo PDV, mais recentes primeiro */
  r.get('/nfce/documentos', rota(async (req, res, s) => {
    const emit = await emitenteDe(Number(s.userId), empresaDa(res));
    const [linhas] = await pool.query(
      `SELECT chave, modelo, serie, numero, situacao, DATE_FORMAT(data_emissao, '%Y-%m-%d %H:%i:%s') AS data_emissao,
              valor_total, destinatario_documento, codigo_status, motivo, referencia
         FROM nfe_documentos
        WHERE empresa_id = ? AND referencia LIKE 'PDV-%'
        ORDER BY id DESC LIMIT ?`,
      [emit.id, Math.min(Number(req.query.limite) || 200, 1000)],
    );
    return linhas;
  }));

  return r;
}

function resumo(dados: any, situacao: string, modelo: string) {
  return {
    success: true,
    situacao,
    modelo,
    chave: dados?.chave ?? null,
    numero: dados?.numero ?? null,
    serie: dados?.serie ?? null,
    motivo: [dados?.cStat, dados?.motivo].filter(Boolean).join(' - ') || null,
  };
}

export { emitenteDe, chamar, postar, mensagemDe };
