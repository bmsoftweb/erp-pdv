/**
 * Balança de checkout na porta serial (ou USB-serial, que o Windows mostra como COM), lida pelo próprio navegador
 * com o Web Serial (Chrome/Edge): o servidor do PDV fica na nuvem e não enxerga a balança.
 * Protocolo ENQ → STX peso ETX (Toledo, Filizola, Elgin e compatíveis): o PDV manda ENQ (0x05) e a balança responde
 * com o peso em 5 dígitos, 3 casas (01250 = 1,250 kg), ou IIIII (instável), NNNNN (negativo), SSSSS (sobrecarga).
 * Liga, velocidade e formato vêm do cadastro do caixa (pdv_caixas.balanca*); a porta COM é escolhida uma vez neste
 * computador (Mais → Configurar balança) e o navegador guarda a permissão.
 */

export interface ConfigBalanca {
  velocidade: number;
  /** Bits de dados, paridade (N/E/O) e bits de parada: 8N1, 7E1… */
  formato: string;
}

const CHAVE = 'pdv_balanca';
const ENQ = 0x05;
const STX = 0x02;
const ETX = 0x03;

/** Configuração do caixa, guardada para valer sem conexão (null = caixa sem balança) */
export function balancaDoCaixa(): ConfigBalanca | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || 'null');
  } catch {
    return null;
  }
}

/** Lê do cadastro do caixa deste computador; sem conexão vale a última guardada */
export function atualizarBalanca() {
  fetch('/api/caixa-local')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.caixa) return;
      try {
        localStorage.setItem(CHAVE, JSON.stringify(d.caixa.balanca ?? null));
      } catch {
        /* sem armazenamento */
      }
    })
    .catch(() => {});
}

const serial = () => (navigator as any).serial;
export const temWebSerial = () => typeof navigator !== 'undefined' && !!serial();

/** Escolha da porta COM (precisa de clique do operador): o navegador guarda a permissão para os próximos dias */
export async function escolherPorta() {
  if (!temWebSerial()) throw new Error('Este navegador não lê a balança: use o Chrome ou o Edge.');
  await fechar();
  await serial().requestPort(); // cancelado pelo operador: erro NotFoundError
}

let porta: any = null;

async function abrir(cfg: ConfigBalanca) {
  if (porta?.readable) return porta;
  if (!temWebSerial()) throw new Error('Este navegador não lê a balança: use o Chrome ou o Edge.');
  const [p] = await serial().getPorts();
  if (!p) throw new Error('Balança sem porta escolhida neste computador: Mais → Configurar balança.');
  const f = cfg.formato.toUpperCase();
  await p.open({
    baudRate: cfg.velocidade,
    dataBits: f[0] === '7' ? 7 : 8,
    parity: ({ E: 'even', O: 'odd' } as Record<string, string>)[f[1]] ?? 'none',
    stopBits: f[2] === '2' ? 2 : 1,
  });
  porta = p;
  return p;
}

async function fechar() {
  try {
    await porta?.close();
  } catch {
    /* já fechada */
  }
  porta = null;
}

/**
 * Resposta da balança → peso em kg. Aceita com ou sem STX/ETX e o peso com vírgula/ponto (algumas mandam "1.250").
 * Erro com a mensagem para o operador quando instável, negativo ou acima da capacidade.
 */
export function interpretar(bytes: Uint8Array): number | 'instavel' {
  let s = String.fromCharCode(...bytes);
  const ini = s.indexOf(String.fromCharCode(STX));
  if (ini >= 0) s = s.slice(ini + 1);
  s = s.split(String.fromCharCode(ETX))[0].trim();
  if (/I/i.test(s)) return 'instavel';
  if (/N/i.test(s)) throw new Error('Peso negativo: confira a tara da balança.');
  if (/S/i.test(s)) throw new Error('Peso acima da capacidade da balança.');
  const m = s.match(/\d+(?:[.,]\d+)?/);
  if (!m) throw new Error('Resposta da balança não reconhecida.');
  return /[.,]/.test(m[0]) ? Number(m[0].replace(',', '.')) : Number(m[0]) / 1000;
}

/** Uma leitura: manda ENQ e junta a resposta até o ETX (ou fim de linha), com limite de tempo */
async function umaLeitura(p: any, ms: number): Promise<Uint8Array> {
  const w = p.writable.getWriter();
  await w.write(new Uint8Array([ENQ]));
  w.releaseLock();
  const r = p.readable.getReader();
  const tempo = setTimeout(() => r.cancel().catch(() => {}), ms);
  const lido: number[] = [];
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      lido.push(...value);
      if (value.includes(ETX) || (lido.some((b) => b >= 0x30) && (value.includes(0x0d) || value.includes(0x0a)))) break;
    }
  } finally {
    clearTimeout(tempo);
    r.releaseLock();
  }
  if (!lido.length) throw new Error('A balança não respondeu: confira o cabo, a porta e a velocidade no cadastro do caixa.');
  return new Uint8Array(lido);
}

let fila: Promise<unknown> = Promise.resolve();

/** Peso em kg. Instável: tenta de novo por até 3 s (o cliente ainda mexendo na sacola) */
export function lerPeso(cfg: ConfigBalanca): Promise<number> {
  const leitura = fila.then(async () => {
    const fim = Date.now() + 3000;
    for (;;) {
      let p;
      try {
        p = await abrir(cfg);
        const peso = interpretar(await umaLeitura(p, 800));
        if (peso !== 'instavel') return peso;
      } catch (e: any) {
        // Porta caiu (cabo solto, outro programa): fecha para reabrir na próxima
        if (e?.name === 'NetworkError' || e?.name === 'InvalidStateError') await fechar();
        throw e;
      }
      if (Date.now() > fim) throw new Error('Peso instável: espere a balança parar e leia de novo.');
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  fila = leitura.catch(() => {});
  return leitura;
}
