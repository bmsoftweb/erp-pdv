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
export async function imprimirDanfe(chave: string, janela?: Window | null) {
  try {
    const r = await fetch('/api/nfce/danfe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave }),
    });
    if (!r.ok) throw new Error(await erroDe(r));
    const url = URL.createObjectURL(await r.blob());
    if (janela && !janela.closed) janela.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    janela?.close();
    throw e;
  }
}
