import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './app/globals.css';
import '@/lib/origemMaster'; // antes das telas: guarda a marca ?master=1 e limpa o endereço
import { fecharNoMaster } from '@/lib/origemMaster';
import POSPage, { UsuarioPdv } from './app/page';
import LoginPage from './app/login';
import { Dica } from './components/Dica';

const ULTIMO_USUARIO = 'pdv_ultimo_usuario';

/** Último usuário logado neste navegador: o cabeçalho mostra a empresa mesmo sem internet */
function ultimoUsuario(): UsuarioPdv {
  try {
    return JSON.parse(localStorage.getItem(ULTIMO_USUARIO) || '{}');
  } catch {
    return {};
  }
}

// Sessão expirada no meio do uso (qualquer /api/* devolvendo 401): o login abre por cima do PDV, sem perder o cupom
const SESSAO_EXPIROU = 'pdv:sessao-expirou';
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (entrada, init) => {
  const r = await fetchOriginal(entrada, init);
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.pathname : entrada.url;
  if (r.status === 401 && /\/api\//.test(url) && !/\/api\/(user|login)\b/.test(url)) window.dispatchEvent(new Event(SESSAO_EXPIROU));
  return r;
};

/**
 * Sem sessão: tela de login. Logado: o PDV. Sem conexão com o servidor (offline): o PDV segue com o último usuário,
 * porque as vendas ficam na base local e sincronizam depois (o sync manda para a filial da sessão ativa).
 */
function Portao() {
  // undefined = verificando; null = sem sessão
  const [usuario, setUsuario] = useState<UsuarioPdv | null | undefined>(undefined);
  const [expirou, setExpirou] = useState(false);

  const carregar = async () => {
    try {
      const r = await fetch('/api/user');
      if (r.status === 401) return setUsuario(null);
      if (!r.ok) throw new Error();
      const u: UsuarioPdv = await r.json();
      const resumo = { userName: u.userName, empresaNome: u.empresaNome };
      try {
        localStorage.setItem(ULTIMO_USUARIO, JSON.stringify(resumo));
      } catch {
        // sem storage: só não guarda
      }
      setUsuario(resumo);
      setExpirou(false);
    } catch {
      // Servidor fora do ar: segue com quem estava logado neste navegador; depois de um Sair, só entra com internet
      const u = ultimoUsuario();
      setUsuario(u.userName ? u : null);
    }
  };

  useEffect(() => {
    carregar();
    const aoExpirar = () => setExpirou(true);
    window.addEventListener(SESSAO_EXPIROU, aoExpirar);
    return () => window.removeEventListener(SESSAO_EXPIROU, aoExpirar);
  }, []);

  const sair = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    try {
      localStorage.removeItem(ULTIMO_USUARIO);
    } catch {
      // sem storage
    }
    if (fecharNoMaster()) return;
    setUsuario(null);
  };

  if (usuario === undefined) return <div className="min-h-screen bg-gray-50" />;
  if (usuario === null) return <LoginPage onEntrou={carregar} />;
  return (
    <>
      <POSPage usuario={usuario} onSair={sair} />
      {expirou && (
        <div className="fixed inset-0 z-[150] overflow-auto">
          <LoginPage onEntrou={carregar} />
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Portao />
    <Toaster richColors position="top-center" />
    <Dica />
  </React.StrictMode>,
);
