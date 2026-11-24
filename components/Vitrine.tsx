import { useEffect, useState } from 'react';
import { isoDeHoje } from './DateField';

/** Imagem ativa da filial que ainda não venceu (pdv_imagens, cadastrada no BM-Master) */
interface Imagem {
  id: number;
  titulo: string | null;
  versao: string;
  inicio: string | null; // aaaa-mm-dd
  fim: string | null;
}

interface Exibida {
  id: number;
  titulo: string | null;
  src: string;
}

const TROCA_MS = 8_000;
const RECARGA_MS = 10 * 60_000;
const urlDe = (i: Imagem) => `/api/imagens/${i.id}?v=${i.versao}`;
const doDia = (l: Imagem[]) => {
  const hoje = isoDeHoje();
  return l.filter((i) => (!i.inicio || i.inicio <= hoje) && (!i.fim || i.fim >= hoje));
};

/** Baixa as imagens novas e só depois troca a lista: a lista guardada nunca aponta para imagem que não está lá */
async function atualizarCache(CACHE: string, LISTA: string) {
  const c = await caches.open(CACHE);
  const r = await fetch(LISTA);
  if (!r.ok) return; // sem sessão ou servidor fora: fica o que está guardado
  const urls = ((await r.clone().json()) as Imagem[]).map((i) => new URL(urlDe(i), location.href).href);
  for (const u of urls) if (!(await c.match(u))) await c.add(u);
  await c.put(LISTA, r);
  for (const k of await c.keys()) if (!k.url.endsWith(LISTA) && !urls.includes(k.url)) await c.delete(k);
}

// URL local (blob:) de cada imagem guardada, reaproveitada entre recargas e entre aberturas da vitrine
const blobs = new Map<string, string>();

async function lerCache(CACHE: string, LISTA: string): Promise<Exibida[]> {
  const c = await caches.open(CACHE);
  const r = await c.match(LISTA);
  if (!r) return [];
  const saida: Exibida[] = [];
  for (const i of doDia(await r.json())) {
    const u = urlDe(i);
    if (!blobs.has(u)) {
      const b = await c.match(u);
      if (!b) continue;
      blobs.set(u, URL.createObjectURL(await b.blob()));
    }
    saida.push({ id: i.id, titulo: i.titulo, src: blobs.get(u)! });
  }
  for (const [u, src] of blobs)
    if (!saida.some((e) => e.src === src)) {
      URL.revokeObjectURL(src);
      blobs.delete(u);
    }
  return saida;
}

/**
 * Vitrine da tela de venda: promoções e datas comemorativas revezando a cada 8 s no espaço livre do painel esquerdo.
 * Lista e imagens ficam no Cache Storage do navegador ('pdv-vitrine'), então a vitrine funciona sem internet, até
 * com o caixa aberto já sem conexão; a cada 10 min atualiza o cache (se der) e refiltra pelo dia. Sem imagem do
 * dia, não ocupa nada. Fora de contexto seguro (http em IP da rede) não há Cache Storage: só online, como antes.
 */
export function Vitrine({ className = 'mt-4 flex-1 min-h-[180px] rounded-lg border border-stone-200', tela = 'caixa' }: { className?: string; tela?: 'caixa' | 'cliente' }) {
  // Cada tela tem o seu cache: a do cliente roda em outra janela, com as imagens verticais
  const CACHE = tela === 'cliente' ? 'pdv-vitrine-cliente' : 'pdv-vitrine';
  const LISTA = tela === 'cliente' ? '/api/imagens?tela=cliente' : '/api/imagens';
  const [imagens, setImagens] = useState<Exibida[]>([]);
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      let l: Exibida[] | null;
      if (typeof caches !== 'undefined') {
        await atualizarCache(CACHE, LISTA).catch(() => {});
        l = await lerCache(CACHE, LISTA).catch(() => null);
      } else {
        l = await fetch(LISTA)
          .then((r) => (r.ok ? r.json() : null))
          .then((x: Imagem[] | null) => x && doDia(x).map((i) => ({ id: i.id, titulo: i.titulo, src: urlDe(i) })))
          .catch(() => null);
      }
      if (vivo && l) setImagens(l); // null: fica com a lista que já tem
    };
    carregar();
    const t = setInterval(carregar, RECARGA_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (imagens.length < 2) return;
    const t = setInterval(() => setAtual((a) => (a + 1) % imagens.length), TROCA_MS);
    return () => clearInterval(t);
  }, [imagens.length]);

  if (!imagens.length) return null;
  const n = atual % imagens.length;

  return (
    <div className={`${className} relative overflow-hidden bg-stone-900`}>
      {imagens.map((img, i) => {
        const src = img.src;
        return (
          <div key={img.id} className={`absolute inset-0 transition-opacity duration-1000 ${i === n ? 'opacity-100' : 'opacity-0'}`}>
            {/* Fundo desfocado da própria imagem: a imagem inteira aparece (contain) sem faixas vazias */}
            <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-60" />
            <img src={src} alt={img.titulo || ''} className="absolute inset-0 w-full h-full object-contain" />
            {img.titulo && (
              <p className="absolute inset-x-0 bottom-0 px-5 pt-10 pb-4 bg-gradient-to-t from-black/75 to-transparent text-white text-2xl font-bold leading-tight drop-shadow">
                {img.titulo}
              </p>
            )}
          </div>
        );
      })}
      {imagens.length > 1 && (
        <div className="absolute top-2 right-2 flex gap-1">
          {imagens.map((img, i) => (
            <span key={img.id} className={`w-1.5 h-1.5 rounded-full ${i === n ? 'bg-white' : 'bg-white/40'}`} />
          ))}
        </div>
      )}
    </div>
  );
}
