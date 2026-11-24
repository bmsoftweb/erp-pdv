import React, { useEffect, useState } from 'react';
import { User, Lock, ArrowRight, Eye, EyeOff, ShoppingCart, Monitor, KeyRound, Keyboard } from 'lucide-react';
import { AvisoErro } from '@/components/AvisoErro';
import { Toggle } from '@/components/Toggle';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { avancarComEnter } from '@/components/Janela';
import { tecladoLigado, ligarTeclado } from '@/components/TecladoVirtual';
import { lerLembrete, salvarLembrete, limparLembrete } from '@/lib/lembrete';

const LABEL = 'block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400';
const INPUT = 'w-full bg-stone-50 p-3 text-sm font-medium text-stone-800 placeholder:text-stone-400 placeholder:font-normal transition-all';
const ICONE = 'absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none';

interface CaixaLocal {
  numero: number;
  descricao: string;
  empresaNome: string;
  login: string | null;
}

/** Login do ERP BMsoft (mesmo do erp-vendas). Só entra computador registrado num caixa: sem registro, pede o token */
export default function LoginPage({ onEntrou }: { onEntrou: () => void }) {
  // Um lembrete salvo pré-preenche usuário e senha e já deixa a opção marcada
  const [lembrete] = useState(() => lerLembrete());
  const [teclado, setTeclado] = useState(tecladoLigado);
  const [login, setLogin] = useState(() => lembrete?.login ?? '');
  const [password, setPassword] = useState(() => lembrete?.senha ?? '');
  const [lembrar, setLembrar] = useState(() => Boolean(lembrete));
  const [temDados, setTemDados] = useState(() => Boolean(lembrete));
  const [limpando, setLimpando] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Caixa em que este computador foi registrado (pdv_caixas): fixa a filial e, se tiver, o usuário.
  // undefined = ainda lendo; null = sem registro válido (a tela pede o token)
  const [caixa, setCaixa] = useState<CaixaLocal | null | undefined>(undefined);
  const [erroCaixa, setErroCaixa] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const [token, setToken] = useState('');

  const aplicarCaixa = (c: CaixaLocal | null) => {
    // Saindo de um caixa com usuário fixo: o campo volta ao usuário lembrado (ou vazio)
    if (!c?.login && caixa?.login) setLogin(lembrete?.login ?? '');
    setCaixa(c);
    if (!c?.login) return;
    setLogin(c.login);
    if (lembrete?.login.toLowerCase() !== c.login.toLowerCase()) setPassword(''); // senha lembrada é de outro usuário
    setTimeout(() => document.getElementById('input-login-senha')?.focus()); // usuário fixo: o foco vai para a senha
  };
  useEffect(() => {
    fetch('/api/caixa-local')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        aplicarCaixa(d.caixa);
        setErroCaixa(d.erro || '');
      })
      .catch(() => {});
  }, []);

  const registrar = async () => {
    setIsLoading(true);
    setError('');
    try {
      const r = await fetch('/api/caixa-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || 'Não foi possível registrar o computador.');
      aplicarCaixa(d.caixa);
      setErroCaixa('');
      setRegistrando(false);
      setToken('');
    } catch {
      setError('Ocorreu um erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  const pedirToken = registrando || caixa === null;

  const entrar = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), senha: password }),
      });
      const data = await res.json();

      if (res.ok) {
        // Só guarda usuário e senha depois de um login válido
        if (lembrar) salvarLembrete(login.trim(), password);
        else limparLembrete();
        onEntrou();
      } else {
        setError(data.error || 'Falha ao autenticar. Verifique suas credenciais.');
      }
    } catch {
      setError('Ocorreu um erro ao conectar ao servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  /** Marca: ícone + nome, no painel esquerdo e, no celular, acima do formulário */
  const marca = (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50 shrink-0">
        <ShoppingCart className="w-5 h-5 text-white" />
      </div>
      <span className="text-sm font-black tracking-wider uppercase text-stone-800">BM-PDV</span>
    </div>
  );

  return (
    <main className="min-h-screen flex relative bg-white text-stone-900 font-sans">
      {/* Painel esquerdo: identidade visual (oculto em telas pequenas) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col p-12 bg-white isolate">
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          <svg viewBox="0 0 380 470" aria-hidden="true" className="absolute top-1/2 right-[6%] -translate-y-1/2 w-[min(440px,70%)] text-indigo-200">
            <g fill="currentColor">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <rect key={i} x={30 + (i % 2) * 16} y={60 + i * 40} width={304} height={26} rx={4} opacity={0.35 + i * 0.07} />
              ))}
            </g>
          </svg>
          <div className="absolute top-[15%] left-[10%] w-[280px] h-[280px] rounded-[40%] rotate-12 blur-3xl bg-indigo-100/70" />
          <div className="absolute bottom-[10%] right-[5%] w-[220px] h-[220px] rounded-[45%] -rotate-12 blur-2xl bg-blue-100/60" />
        </div>

        {marca}

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-6xl font-black leading-[0.95] tracking-tight text-stone-900">
            Frente de<br />
            <span className="text-blue-600">Caixa</span>
          </h1>
          <p className="mt-4 text-sm font-medium max-w-xs text-stone-500">
            Vendas no balcão e emissão de cupom fiscal (NFC-e), mesmo sem internet.
          </p>
        </div>
      </div>

      {/* Painel direito: formulário de login */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 relative bg-stone-50">
        <div className="w-full max-w-md">
          <div className="flex lg:hidden mb-8">{marca}</div>

          <h2 className="text-3xl font-black tracking-tight text-stone-900">Login</h2>
          <p className="text-sm font-medium mt-1.5 text-stone-500">
            Entre com o usuário e a senha do sistema BMsoft. No primeiro acesso, a senha digitada passa a ser a sua.
          </p>

          {error && <AvisoErro mensagem={error} onFechar={() => setError('')} />}

          {/* Caixa deste computador: fixa a filial (e o usuário, quando o caixa tem um) */}
          {caixa !== undefined && !registrando && (
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5">
              <Monitor className={`w-4 h-4 shrink-0 ${caixa ? 'text-blue-600' : 'text-stone-400'}`} />
              <span className="flex-1 min-w-0 text-xs">
                {caixa ? (
                  <>
                    <span className="block font-bold text-stone-800 truncate">Caixa {caixa.numero}{caixa.descricao && ` · ${caixa.descricao}`}</span>
                    <span className="block text-stone-500 truncate">{caixa.empresaNome}{caixa.login && ` · só ${caixa.login}`}</span>
                  </>
                ) : (
                  <span className="text-amber-700 font-semibold">{erroCaixa || 'Computador não registrado em nenhum caixa: só entra com o token do caixa.'}</span>
                )}
              </span>
              {caixa && (
                <button type="button" onClick={() => { setRegistrando(true); setError(''); }} className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer shrink-0">
                  Trocar
                </button>
              )}
            </div>
          )}

          {pedirToken ? (
            <form onSubmit={(e) => { e.preventDefault(); registrar(); }} onKeyDown={(e) => avancarComEnter(e, e.currentTarget, () => {})} className="flex flex-col gap-5 mt-8">
              <div>
                <label htmlFor="input-login-token" className={LABEL}>Token do caixa</label>
                <div className="relative">
                  <KeyRound className={ICONE} />
                  <input
                    id="input-login-token"
                    type="text"
                    inputMode="numeric"
                    required
                    autoFocus
                    autoComplete="off"
                    value={token}
                    onChange={(e) => {
                      // Só dígitos; o traço entra sozinho depois do 4º
                      const d = e.target.value.replace(/\D/g, '').slice(0, 8);
                      setToken(d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d);
                      setError('');
                    }}
                    onFocus={(e) => e.target.select()}
                    className={`${INPUT} pl-11 font-mono tracking-widest`}
                    placeholder="NNNN-NNNN"
                  />
                </div>
                <p className="text-[11px] text-stone-500 mt-1.5 ml-1">
                  O token está no ERP-Master, em Empresas → Configurações → Caixas (PDV). Daqui em diante este computador só entra na filial desse caixa.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {caixa && (
                  <button type="button" onClick={() => { setRegistrando(false); setError(''); }} className="px-5 py-3.5 rounded-xl text-sm font-bold text-stone-600 border border-stone-300 hover:bg-stone-100 cursor-pointer">
                    Voltar
                  </button>
                )}
                <button type="submit" disabled={isLoading} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-200 uppercase tracking-wide disabled:opacity-70 cursor-pointer">
                  Registrar este computador
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); entrar(); }} onKeyDown={(e) => avancarComEnter(e, e.currentTarget, () => {})} className="flex flex-col gap-5 mt-8">
              <div>
                <label htmlFor="input-login-usuario" className={LABEL}>Usuário</label>
                <div className="relative">
                  <User className={ICONE} />
                  <input
                    id="input-login-usuario"
                    type="text"
                    required
                    autoFocus={!caixa?.login}
                    readOnly={!!caixa?.login}
                    title={caixa?.login ? `O caixa ${caixa.numero} só aceita este usuário` : undefined}
                    autoComplete="username"
                    value={login}
                    onChange={(e) => { setLogin(e.target.value); setError(''); }}
                    onFocus={(e) => e.target.select()}
                    className={`${INPUT} pl-11`}
                    placeholder="seu usuário"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="input-login-senha" className={LABEL}>Senha</label>
                <div className="relative">
                  <Lock className={ICONE} />
                  <input
                    id="input-login-senha"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoFocus={!!caixa?.login}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    onFocus={(e) => e.target.select()}
                    className={`${INPUT} pl-11 pr-10`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 cursor-pointer"
                    tabIndex={-1}
                    title={showPassword ? 'Esconder a senha' : 'Mostrar a senha'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 py-1">
                <Toggle
                  id="input-login-lembrar"
                  checked={lembrar}
                  onChange={setLembrar}
                  size="sm"
                  label={<span className="text-xs font-bold uppercase tracking-wider text-stone-500">Lembrar neste dispositivo</span>}
                  title="Já traz usuário e senha preenchidos no próximo acesso. A senha fica guardada neste navegador."
                />
                {temDados && (
                  <button
                    type="button"
                    onClick={() => setLimpando(true)}
                    title="Apaga o usuário e a senha guardados neste navegador"
                    className="text-xs font-bold text-stone-500 hover:text-rose-600 cursor-pointer shrink-0"
                  >
                    Limpar
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 mt-2 group disabled:opacity-70 cursor-pointer"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span className="uppercase tracking-wide">Entrar</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-stone-200 text-[10px] font-bold uppercase tracking-wider text-stone-400">
            <span>BM-PDV by BMsoft Sistemas</span>
            <span>MENU FISCAL INACESSÍVEL NESTA TELA</span>
            <span className="normal-case">© {new Date().getFullYear()}</span>
          </div>
          <button
            type="button"
            onClick={() => { ligarTeclado(!teclado); setTeclado(!teclado); }}
            className="mt-3 mx-auto flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-blue-600 cursor-pointer"
          >
            <Keyboard className="w-4 h-4" /> {teclado ? 'Desligar o teclado virtual' : 'Ligar o teclado virtual (tela touch)'}
          </button>
        </div>
      </div>

      {limpando && (
        <ConfirmDialog
          titulo="Limpar os dados deste dispositivo?"
          mensagem="Apaga o usuário e a senha guardados neste navegador. Você precisará digitar tudo de novo no próximo acesso."
          confirmar="Limpar"
          onConfirmar={() => {
            limparLembrete();
            setLogin('');
            setPassword('');
            setLembrar(false);
            setTemDados(false);
            setLimpando(false);
          }}
          onCancelar={() => setLimpando(false)}
        />
      )}
    </main>
  );
}
