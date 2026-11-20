import { Router } from 'express';
import { zipSync, strToU8 } from 'fflate';
import { pool } from './db.js';
import { empresaDa, grupoDa } from './auth.js';
import { emitenteDe, falha, mensagemDe, postar, rota } from './notas.js';
import { dataHoraSql } from '../lib/dataHora.js';
import { digitos, PAF } from '../lib/fiscal.js';

/**
 * Menu Fiscal do PAF-NFC-e (Requisito VI): identificação, Registros do PAF-NFC-e (Arquivo I, assinado como o
 * Requisito XII manda) e exportação dos XML. Só o que este PDV tem: DAV, RE, mesas e combustível não se aplicam.
 */

const ascii = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ');
/** Alfanumérico: à esquerda, completado com brancos */
const X = (v: unknown, n: number) => ascii(v).slice(0, n).padEnd(n, ' ');
/** Numérico: só dígitos, à direita, completado com zeros */
const N = (v: unknown, n: number) => digitos(v).slice(-n).padStart(n, '0');
/** Valor com casas decimais implícitas */
const V = (v: unknown, n: number, casas = 2) => N(Math.round(Math.abs(Number(v) || 0) * 10 ** casas), n);
/** Data AAAAMMDD a partir de 'AAAA-MM-DD…' */
const D = (sql: unknown) => digitos(String(sql ?? '').slice(0, 10)).padEnd(8, '0');

const dataValida = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : null);

/** Código da mercadoria na Tabela de Mercadorias: o mesmo cProd que vai no DF-e */
const codigoMercadoria = (p: any) => String(p.sku || p.id);

function arquitetura() {
  return {
    arqBD: process.env.PAF_ARQ_BD || 'Banco de dados na nuvem',
    arqSist: process.env.PAF_ARQ_SIST || 'PAF-NFC-e Nuvem',
  };
}

/** Arquivo I (texto) — exportado para a conferência */
export async function arquivoI(emit: any, empresa: number, grupo: number, f: { inicio?: string | null; fim?: string | null; estoque: 'total' | 'parcial'; produtos?: string[] }) {
  const inicio = f.inicio || '1900-01-01';
  const fim = f.fim || '2999-12-31';
  const linhas: string[] = [];

  // ----- U1, U2, U3 -----
  const [[se]]: any = await pool.query('SELECT inscricao_municipal FROM sys_empresas WHERE id = ?', [empresa]);
  linhas.push('U1' + N(emit.cnpj, 14) + X(digitos(emit.inscricao_estadual), 14) + X(digitos(se?.inscricao_municipal), 14) + X(String(emit.razao_social).toUpperCase(), 50));
  linhas.push('U2' + N(process.env.PAF_DESENVOLVEDOR_CNPJ, 14) + X(digitos(process.env.PAF_DESENVOLVEDOR_IE), 14) + X(digitos(process.env.PAF_DESENVOLVEDOR_IM), 14) + X(String(process.env.PAF_DESENVOLVEDOR_RAZAO || '').toUpperCase(), 50));
  linhas.push('U3' + X(PAF.nome.toUpperCase(), 50) + X(PAF.versao, 10));
  let dados = 0;

  // ----- A2: total diário por meio de pagamento × intermediador × tipo de documento (sem os cancelados) -----
  const [a2]: any = await pool.query(
    `SELECT DATE_FORMAT(p.data, '%Y-%m-%d') AS data, i.codigo, p.tpag, p.modelo, SUM(p.valor) AS valor
       FROM mov_nfce_pagamentos p
       JOIN cad_intermediadores i ON i.id = p.intermediador_id
       JOIN mov_nfce n ON n.id_app = p.mov_nfce_id_app
      WHERE p.empresa_id = ? AND p.data BETWEEN ? AND ? AND n.cancelado <> 'S'
      GROUP BY p.data, i.codigo, p.tpag, p.modelo
      ORDER BY p.data, p.tpag, p.modelo, i.codigo`,
    [empresa, inicio, fim],
  );
  for (const r of a2) linhas.push('A2' + D(r.data) + X(r.codigo, 10) + N(r.tpag, 2) + (r.modelo === '65' ? '1' : r.modelo === '55' ? '2' : '3') + V(r.valor, 12));
  dados += a2.length;

  // ----- P2: Tabela de Mercadorias -----
  const [p2]: any = await pool.query(
    `SELECT p.id, p.sku, p.nome, p.ncm, p.cest, p.preco_venda, p.iat, p.ippt, u.sigla AS unidade,
            g.cst_icms, g.aliquota_icms, g.cst_ibscbs, g.cclass_trib
       FROM cad_produtos p
       LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
       LEFT JOIN fis_grupos_tributarios g ON g.id = p.grupo_tributario_id
      WHERE p.grupo_id = ? AND p.ativo = 1`,
    [grupo],
  );
  p2.sort((a: any, b: any) => codigoMercadoria(a).localeCompare(codigoMercadoria(b)));
  for (const p of p2) {
    const ibs = !!p.cst_ibscbs;
    linhas.push(
      'P2' + X(codigoMercadoria(p), 14) + X(digitos(p.cest), 7) + X(digitos(p.ncm), 8) + X(p.nome, 100) + X(p.unidade || 'UN', 6) +
        X(p.iat || 'A', 1) + X(p.ippt || 'T', 1) + N(p.cst_icms, 2) + V(p.aliquota_icms, 4) +
        N(p.cst_ibscbs, 3) + N(p.cclass_trib, 6) + V(ibs ? 0.1 : 0, 4) + V(0, 4) + V(p.preco_venda, 14),
    );
  }
  dados += p2.length;

  // ----- E2: estoque na abertura do dia (antes do primeiro DF-e da data) -----
  const hoje = dataHoraSql().slice(0, 10);
  const [[abertura]]: any = await pool.query(
    "SELECT DATE_FORMAT(MIN(data_emissao), '%Y-%m-%d %H:%i:%s') AS inicio FROM nfe_documentos WHERE empresa_id = ? AND data_emissao >= ?",
    [emit.id, hoje],
  );
  const corte = abertura?.inicio || dataHoraSql();
  const termos = (f.produtos ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (f.estoque === 'parcial' && !termos.length) falha('Informe ao menos um código ou descrição para o ESTOQUE PARCIAL.');
  const filtro = f.estoque === 'parcial'
    ? 'AND (' + termos.map(() => '(p.sku = ? OR p.codigo_barras = ? OR CAST(p.id AS CHAR) = ? OR p.nome LIKE ?)').join(' OR ') + ')'
    : '';
  const [e2]: any = await pool.query(
    `SELECT p.id, p.sku, p.nome, u.sigla AS unidade,
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
      WHERE p.grupo_id = ? AND p.ativo = 1 ${filtro}`,
    [empresa, empresa, corte, grupo, ...termos.flatMap((t) => [t, t, t, `%${t}%`])],
  );
  e2.sort((a: any, b: any) => codigoMercadoria(a).localeCompare(codigoMercadoria(b)));
  for (const p of e2) {
    const q = Number(p.estoque) || 0;
    linhas.push('E2' + X(codigoMercadoria(p), 14) + X(p.nome, 100) + X(p.unidade || 'UN', 6) + (q < 0 ? '-' : '+') + V(q, 12, 3) + D(hoje) + D(corte));
  }
  dados += e2.length;

  // ----- J1/J2 (NFC-e) e N1/N2 (NF-e) emitidas por este PAF, inclusive canceladas -----
  const [docs]: any = await pool.query(
    `SELECT modelo, serie, numero, chave, situacao, valor_total, destinatario_documento,
            DATE_FORMAT(data_emissao, '%Y-%m-%d') AS emissao,
            REGEXP_SUBSTR(xml_protocolo, '<dhRecbto>[0-9-]{10}') AS recebimento
       FROM nfe_documentos
      WHERE empresa_id = ? AND referencia LIKE 'PDV-%' AND chave IS NOT NULL
        AND situacao IN ('autorizada', 'cancelada', 'contingencia', 'denegada')
        AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY data_emissao, modelo, serie, numero`,
    [emit.id, inicio, fim],
  );
  const grupos: Record<string, string[]> = { J1: [], J2: [], N1: [], N2: [] };
  for (const d of docs) {
    const contingencia = String(d.chave).charAt(34) !== '1';
    const autorizada = d.recebimento ? D(String(d.recebimento).replace('<dhRecbto>', '')) : '01/01/99';
    const valor = V(d.valor_total, 14);
    const numero = N(d.numero, 10);
    const serie = X(String(d.serie), 3);
    if (d.modelo === '65') {
      const cpf = N(digitos(d.destinatario_documento).length === 11 ? d.destinatario_documento : '', 11);
      if (contingencia) grupos.J2.push('J2' + D(d.emissao) + autorizada + valor + N(d.chave, 44) + numero + serie + cpf);
      else grupos.J1.push('J1' + D(d.emissao) + valor + N(d.chave, 44) + numero + serie + cpf);
    } else {
      const doc = N(d.destinatario_documento, 14);
      if (contingencia) grupos.N2.push('N2' + D(d.emissao) + autorizada + valor + N(d.chave, 44) + numero + serie + doc);
      else grupos.N1.push('N1' + D(d.emissao) + valor + String(d.chave).charAt(34) + N(d.chave, 44) + numero + serie + doc);
    }
  }
  linhas.push(...grupos.J1, ...grupos.J2, ...grupos.N1, ...grupos.N2);
  dados += docs.length;

  return dados ? linhas.join('\r\n') + '\r\n' : null;
}

/** XML do Requisito XII com o arquivo em Base64, assinado no erp-nfe com o e-CNPJ do estabelecimento */
async function xmlAssinado(emit: any, uid: number, nroArquivo: string, texto: string | null) {
  const agora = dataHoraSql();
  const data = agora.slice(8, 10) + agora.slice(5, 7) + agora.slice(0, 4);
  const hora = agora.slice(11, 19).replace(/:/g, '');
  const conteudo = texto === null ? 'SEM INFORMACOES' : Buffer.from(texto, 'latin1').toString('base64');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const { arqBD, arqSist } = arquitetura();
  const xml =
    `<menuFiscal xmlns="http://www.sef.sc.gov.br/nfce"><arquivo nroArquivo="${texto === null ? '0' : nroArquivo}" data="${data}" hora="${hora}" ` +
    `arqBD="${esc(arqBD)}" arqSist="${esc(arqSist)}"><![CDATA[${conteudo}]]></arquivo></menuFiscal>`;
  const r = await postar(emit.id, uid, '/api/assinar-menu-fiscal', { xml });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d?.xml) falha(mensagemDe(d, r.status));
  return { xml: d.xml as string, nome: `${data}${hora}` };
}

export function createMenuFiscalRouter() {
  const r = Router();

  /** Identificação do PAF-NFC-e (Requisito VI, I); nome, versão e data do build vêm do próprio front-end */
  r.get('/menu-fiscal/identificacao', rota(async () => ({
    desenvolvedor: {
      cnpj: process.env.PAF_DESENVOLVEDOR_CNPJ || '',
      razaoSocial: process.env.PAF_DESENVOLVEDOR_RAZAO || '',
      endereco: process.env.PAF_DESENVOLVEDOR_ENDERECO || '',
      telefone: process.env.PAF_DESENVOLVEDOR_TELEFONE || '',
      responsavel: process.env.PAF_DESENVOLVEDOR_RESPONSAVEL || '',
    },
    ...arquitetura(),
  })));

  /** Registros do PAF-NFC-e (Requisito VI, II): Arquivo I assinado */
  r.post('/menu-fiscal/registros', rota(async (req, res, s) => {
    const empresa = empresaDa(res);
    const uid = Number(s.userId);
    const emit = await emitenteDe(uid, empresa);
    const b = req.body ?? {};
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

  /** Exportação de arquivos XML (Requisito VI, IX): os DF-e do período e modelo, normais e de contingência, em .zip */
  r.post('/menu-fiscal/xml', rota(async (req, res, s) => {
    const emit = await emitenteDe(Number(s.userId), empresaDa(res));
    const b = req.body ?? {};
    const modelo = b.modelo === '55' ? '55' : '65';
    const [docs]: any = await pool.query(
      `SELECT chave, COALESCE(xml_protocolo, xml) AS xml FROM nfe_documentos
        WHERE empresa_id = ? AND referencia LIKE 'PDV-%' AND modelo = ? AND chave IS NOT NULL
          AND situacao IN ('autorizada', 'cancelada', 'contingencia', 'denegada')
          AND data_emissao >= ? AND data_emissao < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY data_emissao`,
      [emit.id, modelo, dataValida(b.inicio) || '1900-01-01', dataValida(b.fim) || '2999-12-31'],
    );
    const arquivos = Object.fromEntries(docs.filter((d: any) => d.xml).map((d: any) => [`${d.chave}-${modelo === '65' ? 'nfce' : 'nfe'}.xml`, strToU8(d.xml)]));
    // Cancelamentos aceitos (normal e por substituição) vão junto, com o procEventoNFe
    const [eventos]: any = docs.length
      ? await pool.query(
          `SELECT chave, tipo_evento, sequencia, xml_retorno FROM nfe_eventos
            WHERE empresa_id = ? AND chave IN (?) AND tipo_evento IN ('110111', '110112') AND codigo_status IN (135, 136, 155)`,
          [emit.id, docs.map((d: any) => d.chave)],
        )
      : [[]];
    for (const e of eventos) if (e.xml_retorno) arquivos[`${e.chave}-${e.tipo_evento}-${e.sequencia}-proc-evento.xml`] = strToU8(e.xml_retorno);
    if (!Object.keys(arquivos).length) falha(`Nenhuma ${modelo === '65' ? 'NFC-e' : 'NF-e'} no período.`, 404);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="XML_${modelo === '65' ? 'NFCe' : 'NFe'}_${emit.cnpj}.zip"`);
    res.send(Buffer.from(zipSync(arquivos)));
  }));

  return r;
}
