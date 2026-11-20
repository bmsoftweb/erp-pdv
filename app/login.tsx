import React, { useState } from 'react';
import { User, Lock, ArrowRight, Eye, EyeOff, ShoppingCart, Building2 } from 'lucide-react';
import { AvisoErro } from '@/components/AvisoErro';
import { Toggle } from '@/components/Toggle';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { lerLembrete, salvarLembrete, limparLembrete } from '@/lib/lembrete';

const LABEL = 'block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400';
const INPUT = 'w-full bg-stone-50 p-3 text-sm font-medium text-stone-800 placeholder:text-stone-400 placeholder:font-normal transition-all';
const ICONE = 'absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none';

/** Login do ERP BMsoft (mesmo do erp-vendas): usuário, senha e, com mais de uma filial, a escolha da filial */
export default function LoginPage({ onEntrou }: { onEntrou: () => void }) {
  // Um lembrete salvo pré-preenche usuário e senha e já deixa a opção marcada
  const [lembrete] = useState(() => lerLembrete());
  const [login, setLogin] = useState(() => lembrete?.login ?? '');
  const [password, setPassword] = useState(() => lembrete?.senha ?? '');
  const [lembrar, setLembrar] = useState(() => Boolean(lembrete));
  const [temDados, setTemDados] = useState(() => Boolean(lembrete));
  const [limpando, setLimpando] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Usuário com mais de uma filial: a API devolve a lista e a tela pergunta em qual entrar
  const [filiais, setFiliais] = useState<{ id: number; nome: string; grupo: string }[] | null>(null);

  const entrar = async (empresaId?: number) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), senha: password, empresaId }),
      });
      const data = await res.json();

      if (res.ok && data.escolherFilial) {
        setFiliais(data.filiais);
      } else if (res.ok) {
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
    <main className="campos-padrao min-h-screen flex relative bg-white text-stone-900 font-sans">
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

          {filiais ? (
            <div className="flex flex-col gap-2 mt-8">
              <span className={LABEL}>Em qual filial você vai trabalhar?</span>
              {filiais.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  autoFocus={i === 0}
                  disabled={isLoading}
                  onClick={() => entrar(f.id)}
                  className="w-full flex items-center gap-3 text-left bg-white border border-stone-200 hover:border-indigo-400 focus:border-indigo-500 px-4 py-3 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Building2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-stone-800 truncate">{f.nome}</span>
                    {f.grupo && <span className="block text-[11px] text-stone-500 truncate">{f.grupo}</span>}
                  </span>
                  <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFiliais(null)}
                className="self-start mt-2 text-xs font-bold text-stone-500 hover:text-stone-700 cursor-pointer"
              >
                ← Voltar
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); entrar(); }} className="flex flex-col gap-5 mt-8">
              <div>
                <label htmlFor="input-login-usuario" className={LABEL}>Usuário</label>
                <div className="relative">
                  <User className={ICONE} />
                  <input
                    id="input-login-usuario"
                    type="text"
                    required
                    autoFocus
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
