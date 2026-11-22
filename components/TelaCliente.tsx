import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ShoppingCart } from "lucide-react";
import { Vitrine } from "./Vitrine";
import {
  pedirEstado,
  useCanalCliente,
  type EstadoCliente,
} from "@/lib/telaCliente";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Tela do cliente (/?tela=cliente), no monitor virado para o cliente: o cupom (itens e total), o troco na
 * finalização, o QR Code do PIX e, com o caixa livre, a vitrine de promoções. Só mostra: não tem botão nem campo.
 */
export function TelaCliente() {
  const [estado, setEstado] = useState<EstadoCliente | null>(null);
  const [pix, setPix] = useState<{ qr: string; valor: number } | null>(null);
  const [telaCheia, setTelaCheia] = useState(!!document.fullscreenElement);
  const fim = useRef<HTMLDivElement>(null);

  useCanalCliente((m) => {
    if (m.tipo === "estado") setEstado(m.estado);
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
      <header className="bg-[#3c60a3] text-white px-8 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingCart size={30} />
          <span className="text-2xl font-black tracking-tight">
            {estado?.empresa || "Bem-vindo!"}
          </span>
        </div>
        {!telaCheia && (
          <span className="text-sm text-blue-100">
            Toque na tela para tela cheia
          </span>
        )}
      </header>

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
        // Igual ao "Caixa Livre" do operador (sem o aviso do Menu Fiscal), por cima de tudo
        <div className="absolute inset-0 bg-blue-600 z-[100] flex flex-col items-center justify-center text-white">
          <h1 className="text-7xl md:text-[140px] font-black tracking-tighter mb-8">CAIXA LIVRE</h1>
          <p className="text-2xl md:text-3xl font-medium animate-pulse opacity-90">Seja bem-vindo!</p>
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
