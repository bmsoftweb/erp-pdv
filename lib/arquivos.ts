/** Lê o erro JSON de uma resposta da API (ou o status) */
export async function erroDe(r: Response): Promise<string> {
  const d = await r.json().catch(() => ({}));
  return d?.error || `Erro ${r.status}`;
}

/** Baixa o corpo da resposta como arquivo, com o nome que o servidor mandou */
export async function baixar(r: Response, nomePadrao: string) {
  if (!r.ok) throw new Error(await erroDe(r));
  const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || nomePadrao;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * DANFE (NFC-e ou NF-e) gerado pelo erp-nfe, aberto para imprimir. `janela` é uma aba aberta antes,
 * ainda no clique/tecla do caixa: aberta depois da emissão (que demora) o navegador bloquearia o pop-up.
 */
export async function imprimirDanfe(chave: string, janela?: Window | null, via?: 'estabelecimento') {
  try {
    const r = await fetch('/api/nfce/danfe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, ...(via && { via }) }),
    });
    if (!r.ok) throw new Error(await erroDe(r));
    const url = URL.createObjectURL(await r.blob());
    if (janela && !janela.closed) janela.location.href = url;
    else if (!window.open(url, '_blank')) throw new Error('O navegador bloqueou a janela do DANFE: libere os pop-ups deste site.');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    janela?.close();
    throw e;
  }
}

/** NFC-e emitida em contingência offline: tpEmis 9 no 35º dígito da chave */
export const emContingencia = (chave?: string | null, situacao?: string) => situacao === 'contingencia' || chave?.[34] === '9';

/** Chaves com a pergunta de reimpressão na tela: a próxima rodada da fila não pergunta de novo */
const emPergunta = new Set<string>();

/**
 * Contingências regeradas que a SEFAZ autorizou (Anexo 11, art. 104, § 4º, III): o DANFE entregue tinha outra
 * chave, então pergunta e reimprime o da nota autorizada. O erp-nfe devolve as mesmas até o aviso de reimpressas
 * (/api/nfce/reimpresso): recusada a pergunta, ela volta na próxima rodada.
 */
export async function reimprimirAutorizadas(autorizadas: { chave: string; referencia?: string }[] | undefined, confirmar: (m: string) => Promise<boolean>) {
  const novas = (autorizadas ?? []).filter((a) => a?.chave && !emPergunta.has(a.chave));
  if (!novas.length) return;
  novas.forEach((a) => emPergunta.add(a.chave));
  try {
    const n = novas.length;
    if (!(await confirmar(`Reimprimir o DANFE ${n > 1 ? `das ${n} NFC-e regeradas que a SEFAZ autorizou` : 'da NFC-e regerada que a SEFAZ autorizou'}? Entregue ao cliente.`))) return;
    for (const a of novas) await imprimirDanfe(a.chave);
    const r = await fetch('/api/nfce/reimpresso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chaves: novas.map((a) => a.chave) }),
    });
    if (!r.ok) throw new Error(`DANFE reimpresso, mas o aviso ao erp-nfe falhou (a pergunta volta): ${await erroDe(r)}`);
  } finally {
    novas.forEach((a) => emPergunta.delete(a.chave));
  }
}
