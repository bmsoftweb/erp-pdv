import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Delete, ShoppingCart, UserRound } from "lucide-react";
import { Vitrine } from "./Vitrine";
import {
  pedirEstado,
  responderCpf,
  useCanalCliente,
  type EstadoCliente,
} from "@/lib/telaCliente";
import { cpfValido } from "@/lib/fiscal";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Tela do cliente (/?tela=cliente), no monitor virado para o cliente: o cupom (itens e total), o troco na
 * finalização, o QR Code do PIX e, com o caixa livre, a vitrine de promoções. Só mostra, a não ser quando o caixa
 * pede o CPF: aí abre o teclado numérico (toque) para o próprio cliente digitar.
 */
export function TelaCliente() {
  const [estado, setEstado] = useState<EstadoCliente | null>(null);
  const [pix, setPix] = useState<{ qr: string; valor: number } | null>(null);
  const [pedindoCpf, setPedindoCpf] = useState(false);
  const [telaCheia, setTelaCheia] = useState(!!document.fullscreenElement);
  const fim = useRef<HTMLDivElement>(null);

  useCanalCliente((m) => {
    if (m.tipo === "estado") setEstado(m.estado);
    if (m.tipo === "pedirCpf") setPedindoCpf(true);
    if (m.tipo === "cancelarCpf") setPedindoCpf(false);
    if (m.tipo === "pix") {
      if (!m.copiaECola) return setPix(null);
      QRCode.toDataURL(m.copiaECola, { margin: 1, width: 420 }).then((qr) =>
        setPix({ qr, valor: m.valor }),
      );
    }
  });

  useEffect(() => {
    document.title = "PDV - Tela do cliente";
    pedirEstado(); // o caixa já aberto manda o cupom atual
    const mudou = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", mudou);
    return () => document.removeEventListener("fullscreenchange", mudou);
  }, []);

  // Item novo sempre à vista (o último lançado fica embaixo)
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [estado?.itens.length]);

  const itens = estado?.itens ?? [];

  return (
    // Tela cheia precisa de um gesto nesta janela: um toque/clique em qualquer lugar
    <div
      className="relative h-dvh w-screen bg-stone-100 text-stone-900 flex flex-col overflow-hidden select-none cursor-default"
      onClick={() =>
        !telaCheia &&
        document.documentElement.requestFullscreen().catch(() => {})
      }
    >
      {/* Tela do cliente não tem o Menu Fiscal (Requisito VI, § 1º): o aviso fica por cima de tudo, inclusive do CAIXA LIVRE */}
      <p className="fixed bottom-1 inset-x-0 z-[300] flex justify-center pointer-events-none">
        <span className="px-2 py-0.5 rounded bg-stone-900/60 text-[10px] font-black tracking-widest text-white">MENU FISCAL INACESSÍVEL NESTA TELA</span>
      </p>
      <header className="bg-[#3c60a3] text-white px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingCart size={30} />
          <span className="text-2xl font-black tracking-tight">
            {estado?.empresa || "Bem-vindo!"}
          </span>
        </div>
        {estado?.cliente ? (
          <span className="flex items-center gap-2 text-2xl font-bold truncate">
            <UserRound size={28} className="shrink-0" />
            {estado.cliente}
            {estado.clube && (
              <span className="shrink-0 text-base font-black px-2 py-0.5 rounded bg-amber-400 text-amber-950">CLUBE DE DESCONTOS</span>
            )}
          </span>
        ) : (
          !telaCheia && (
            <span className="text-sm text-blue-100">
              Toque na tela para tela cheia
            </span>
          )
        )}
      </header>

      {pedindoCpf && (
        <TecladoCpf
          onFim={(cpf) => {
            setPedindoCpf(false);
            responderCpf(cpf);
          }}
        />
      )}

      {pix ? (
        <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <p className="text-3xl font-bold text-stone-700">Pague com PIX</p>
          <img
            src={pix.qr}
            alt="QR Code do PIX"
            className="w-[min(420px,50vh)] h-[min(420px,50vh)] bg-white p-3 rounded-2xl shadow-lg"
          />
          <p className="text-6xl font-black font-mono text-blue-700">
            {brl(pix.valor)}
          </p>
          <p className="text-xl text-stone-500">
            Aponte a câmera do aplicativo do seu banco para o QR Code
          </p>
        </main>
      ) : !itens.length ? (
        // Igual ao "Caixa Livre" do operador, por cima de tudo (o aviso do Menu Fiscal fica no pé da janela)
        <div className="absolute inset-0 bg-blue-600 z-[100] flex flex-col items-center justify-center text-white">
          <h1 className="text-7xl md:text-[140px] font-black tracking-tighter mb-8">CAIXA LIVRE</h1>
          <p className="text-2xl md:text-3xl font-medium animate-pulse opacity-90">
            {estado?.cliente && !estado.cliente.startsWith("CPF") && !estado.cliente.startsWith("CNPJ")
              ? `Olá, ${estado.cliente}!`
              : "Seja bem-vindo!"}
          </p>
        </div>
      ) : (
        // Mesmo visual do cupom na tela do caixa: papel amarelo, último item com a barra âmbar e a faixa do TOTAL
        <main className="flex-1 flex min-h-0 bg-white p-6 gap-6">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="flex justify-between items-center shrink-0">
              <h2 className="text-2xl font-bold">Cupom Fiscal</h2>
              <span className="bg-stone-100 text-stone-600 border border-stone-200 font-semibold text-base py-1 px-3 rounded-full">
                {itens.length} {itens.length === 1 ? "item" : "itens"}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 bg-[#FFFFC7] border border-stone-200 rounded-lg divide-y divide-stone-200">
              {itens.map((it, i) => {
                const quebrado = it.quantidade % 1 !== 0 || it.unidade?.toUpperCase() === "KG";
                const dif =
                  Math.round((it.valor - it.quantidade * it.preco) * 100) / 100;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-6 px-6 py-4 ${i === itens.length - 1 ? "bg-amber-200/50 border-l-8 border-l-amber-500" : ""}`}
                  >
                    <span className="self-start mt-1 w-12 shrink-0 font-mono font-bold text-xl text-stone-400">
                      {String(i + 1).padStart(3, "0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-3xl font-semibold uppercase truncate">
                        {it.nome}
                      </p>
                      <p className="text-xl font-mono text-stone-500 mt-1">
                        <span className="font-semibold text-stone-700">
                          {quebrado
                            ? it.quantidade.toFixed(3).replace(".", ",")
                            : it.quantidade}
                        </span>{" "}
                        {it.unidade?.toLowerCase() || (quebrado ? "kg" : "un")} x {brl(it.preco)}
                        {!!dif && (
                          <span
                            className={
                              dif < 0 ? "text-rose-600" : "text-blue-700"
                            }
                          >
                            {" "}
                            · {dif < 0 ? "desc." : "acrésc."}{" "}
                            {brl(Math.abs(dif))}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-4xl font-bold tracking-tight">
                      {brl(it.valor)}
                    </span>
                  </div>
                );
              })}
              <div ref={fim} />
            </div>
            {(!!estado?.ajuste || (estado?.finalizando && estado.pago > 0)) && (
              <div className="flex justify-end gap-10 text-2xl font-mono shrink-0 px-2">
                {!!estado?.ajuste && (
                  <span>
                    <span className="font-sans font-bold text-stone-500">
                      {estado.ajuste < 0 ? "Desconto " : "Acréscimo "}
                    </span>
                    {brl(Math.abs(estado.ajuste))}
                  </span>
                )}
                {estado?.finalizando && estado.pago > 0 && (
                  <span>
                    <span className="font-sans font-bold text-stone-500">
                      Pago{" "}
                    </span>
                    {brl(estado.pago)}
                  </span>
                )}
              </div>
            )}
            <div className="bg-[#3c60a3] text-white rounded-lg px-8 py-5 flex justify-between items-center shrink-0 font-[Verdana] font-bold">
              <span className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-tight text-blue-100">
                TOTAL
              </span>
              <span className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-tighter">
                {brl(estado?.total ?? 0)}
              </span>
            </div>
            {estado?.finalizando && estado.troco > 0 && (
              <div className="bg-emerald-600 text-white rounded-lg px-8 py-5 flex justify-between items-center shrink-0 font-[Verdana] font-bold">
                <span className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-tight text-emerald-100">
                  TROCO
                </span>
                <span className="text-[clamp(2.5rem,5vw,4.5rem)] leading-none tracking-tighter">
                  {brl(estado.troco)}
                </span>
              </div>
            )}
          </div>
          {/* Coluna vertical (2:3) das imagens da tela do cliente; sem imagem do dia, o cupom ocupa a largura toda */}
          <Vitrine
            tela="cliente"
            className="h-full aspect-[2/3] max-w-[35%] shrink-0 rounded-lg border border-stone-200"
          />
        </main>
      )}
    </div>
  );
}

/** 52998224725 → 529.982.247-25, montando enquanto digita */
const mascaraCpf = (d: string) =>
  d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2").replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, "$1-$2");

/** Teclado numérico de toque para o cliente digitar o CPF; null = não quer CPF na nota */
function TecladoCpf({ onFim }: { onFim: (cpf: string | null) => void }) {
  const [cpf, setCpf] = useState("");
  const [erro, setErro] = useState(false);
  const tecla = (t: string) => {
    setErro(false);
    if (t === "apagar") return setCpf((c) => c.slice(0, -1));
    if (t === "ok") return cpfValido(cpf) ? onFim(cpf) : setErro(true);
    setCpf((c) => (c + t).slice(0, 11));
  };
  // Teclado físico na janela do cliente também vale
  const ultima = useRef(tecla);
  ultima.current = tecla;
  useEffect(() => {
    const ouvir = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) ultima.current(e.key);
      else if (e.key === "Backspace") ultima.current("apagar");
      else if (e.key === "Enter") ultima.current("ok");
      else if (e.key === "Escape") onFim(null);
    };
    window.addEventListener("keydown", ouvir);
    return () => window.removeEventListener("keydown", ouvir);
  }, [onFim]);

  const BOTAO = "h-20 rounded-2xl text-4xl font-bold active:scale-95 transition-transform cursor-pointer";
  return (
    <div className="absolute inset-0 z-[200] bg-stone-900/70 flex items-center justify-center p-6" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-[min(560px,92vw)] flex flex-col gap-5">
        <h2 className="text-3xl font-black text-center text-stone-800">CPF na nota</h2>
        <p className={`text-center text-xl ${erro ? "text-rose-600 font-semibold" : "text-stone-500"}`}>
          {erro ? "CPF inválido: confira os números" : "Digite o seu CPF"}
        </p>
        <div className={`h-20 rounded-2xl border-2 flex items-center justify-center text-5xl font-mono font-bold tracking-wider ${erro ? "border-rose-400 bg-rose-50" : "border-blue-300 bg-blue-50/50"}`}>
          {mascaraCpf(cpf) || <span className="text-stone-300">000.000.000-00</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
            <button key={n} type="button" className={`${BOTAO} bg-stone-100 hover:bg-stone-200 text-stone-800`} onClick={() => tecla(n)}>
              {n}
            </button>
          ))}
          <button type="button" aria-label="Apagar" className={`${BOTAO} bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center`} onClick={() => tecla("apagar")}>
            <Delete size={36} />
          </button>
          <button type="button" className={`${BOTAO} bg-stone-100 hover:bg-stone-200 text-stone-800`} onClick={() => tecla("0")}>
            0
          </button>
          <button
            type="button"
            disabled={cpf.length !== 11}
            className={`${BOTAO} bg-emerald-600 hover:bg-emerald-700 text-white text-2xl disabled:opacity-40 disabled:cursor-not-allowed`}
            onClick={() => tecla("ok")}
          >
            OK
          </button>
        </div>
        <button type="button" className="h-14 rounded-2xl text-xl font-semibold text-stone-500 hover:bg-stone-100 cursor-pointer" onClick={() => onFim(null)}>
          Não quero CPF na nota
        </button>
      </div>
    </div>
  );
}
