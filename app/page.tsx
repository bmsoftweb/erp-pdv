import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { ShoppingCart, Search, Plus, Trash2, Printer, CheckCircle, RefreshCw, Database, Menu, ChevronUp, ChevronDown, FileText, X, Package, LogOut, MoreHorizontal, Keyboard, Monitor, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { dataHoraSql, dataSql } from '@/lib/dataHora';
import { MEIOS_PAGAMENTO, nomeMeioPagamento, totalDoItem, modeloDoDocumento, digitos, cpfValido, cnpjValido } from '@/lib/fiscal';
import { imprimirDanfe, erroDe } from '@/lib/arquivos';
import { MenuFiscal, MenuFiscalInacessivel } from '@/components/MenuFiscal';
import { useMenuTeclado, ITEM_MENU, NUMERO_MENU } from '@/components/menuTeclado';
import { tecladoLigado, ligarTeclado, lerDoCaixa } from '@/components/TecladoVirtual';
import { usePublicarCupom, abrirTelaCliente, fecharTelaCliente, telaClienteLembrada } from '@/lib/telaCliente';
import { NotasPdv } from '@/components/NotasPdv';
import { PesquisaCategoria } from '@/components/PesquisaCategoria';
import { Intermediadores, Intermediador } from '@/components/Intermediadores';
import { EditarItem } from '@/components/EditarItem';
import { Toggle } from '@/components/Toggle';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Janela, BOTAO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '@/components/Janela';
import { NumberField } from '@/components/NumberField';
import { TefSitef, ResultadoTef } from '@/components/TefSitef';
import { PixBanco } from '@/components/PixBanco';
import { Vitrine } from '@/components/Vitrine';
import { ConfigSitef, DocumentoTef, FUNCAO_SITEF, novoDocumento, finalizar, imprimirComprovantes } from '@/lib/sitef';
import { db, LocalProduct, substituirProdutos, buscarProdutos, porKg } from '@/lib/localDB';
import { balancaDoCaixa, atualizarBalanca, lerPeso, escolherPorta } from '@/lib/balanca';

interface Product {
  id: number;
  nome: string;
  codigo_barras: string;
  preco_venda: string | number;
  iat?: string | null;
  unidade?: string | null;
}

interface CartItem {
  cartId: string;
  product: Product;
  quantidade: number;
  subtotal: number;
  /** Total negociado ou informado (valor total, etiqueta de balança); sem ele vale quantidade × preço */
  valorTotal?: number;
}

/** Funções chamadas digitando o código no campo do EAN (+ Enter) */
const CODIGOS = [
  ['00', 'ajuda', 'Tela de ajuda (esta lista)'],
  ['99', 'fechar', 'Fechar cupom'],
  ['22', 'item', 'Cancelar item'],
  ['33', 'cupom', 'Cancelar cupom'],
  ['44', 'livre', 'Caixa livre'],
  ['55', 'preco', 'Consultar preço'],
  ['66', 'mais', 'Abrir o menu "Mais"'],
  ['77', 'categoria', 'Pesquisa por categoria (hortifrúti, padaria…)'],
  ['88', 'fiscal', 'Menu Fiscal'],
] as const;
/** Teclas de função da tela de venda, para a tela de ajuda */
const TECLAS = [
  ['F2', 'Fechar cupom / confirmar e emitir'],
  ['F3', 'Informar a quantidade do próximo item'],
  ['*', 'No peso: ler a balança de novo'],
  ['F4', 'Caixa livre'],
  ['F5', 'Consultar preço'],
  ['F6', 'Cancelar item'],
] as const;

const precoDe = (p: Product) => (typeof p.preco_venda === 'string' ? parseFloat(p.preco_venda) : p.preco_venda);

/** Identificação da venda: AAAAMMDD + HHMMSSmmm + 8 aleatórios (25 dígitos), a referência PDV-<id> no erp-nfe */
function gerarIdApp() {
  const t = new Date();
  const pad = (n: number, size = 2) => n.toString().padStart(size, '0');
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}${pad(t.getMilliseconds(), 3)}${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
}

const BANDEIRAS: [string, string][] = [
  ['01', 'Visa'], ['02', 'Mastercard'], ['03', 'American Express'], ['04', 'Sorocred'], ['05', 'Diners Club'], ['06', 'Elo'],
  ['07', 'Hipercard'], ['08', 'Aura'], ['09', 'Cabal'], ['10', 'Alelo'], ['11', 'Banes Card'], ['12', 'CalCard'], ['13', 'Credz'],
  ['14', 'Discover'], ['15', 'GoodCard'], ['16', 'GreenCard'], ['17', 'Hiper'], ['18', 'JCB'], ['19', 'Mais'], ['20', 'MaxVan'],
  ['21', 'Policard'], ['22', 'RedeCompras'], ['23', 'Sodexo'], ['24', 'ValeCard'], ['25', 'Verocheque'], ['26', 'VR'], ['27', 'Ticket'], ['99', 'Outros'],
];

function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function playErrorBeep() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    
    const audioCtx = new AudioContext();
    
    const playSingleBeep = (time: number) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime + time);
      
      gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime + time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + time + 0.2);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start(audioCtx.currentTime + time);
      oscillator.stop(audioCtx.currentTime + time + 0.2);
    };

    playSingleBeep(0);
    playSingleBeep(0.25);
    playSingleBeep(0.5);
  } catch (error) {
    console.error('Erro ao tocar bipe', error);
  }
}

const showErrorToast = (message: string, options?: any) => {
  toast.error(message, options);
  playErrorBeep();
};

function formatCurrency(value: string | number) {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numericValue);
}

/** Quem está no caixa (sessão do login do ERP) */
export interface UsuarioPdv {
  userName?: string;
  empresaNome?: string;
  /** Caixa deste computador (pdv_caixas), quando registrado */
  caixaNumero?: number;
}

/** Quantidade no cupom: produto por kg (ou quebrada) com 3 casas; unidade do cadastro quando a sincronização trouxe */
const qtdTexto = (q: number, p: LocalProduct) => (q % 1 !== 0 || porKg(p) ? q.toFixed(3).replace('.', ',') : String(q));
const unTexto = (q: number, p: LocalProduct) => p.unidade?.toLowerCase() || (q % 1 !== 0 ? 'kg' : 'un');

export default function POSPage({ usuario, onSair }: { usuario: UsuarioPdv; onSair: () => void }) {
  const [ean, setEan] = useState('');
  const [quantidade, setQuantidade] = useState<number>(1);
  const [quantidadeText, setQuantidadeText] = useState('1,000');
  
  const handleQtyChange = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (!digits) {
      setQuantidadeText('');
      setQuantidade(0);
      return;
    }
    const numValue = parseInt(digits, 10) / 1000; // sempre 3 casas: 1250 → 1,250 (kg)
    setQuantidadeText(
      new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(numValue)
    );
    setQuantidade(numValue);
  };
  const [pesando, setPesando] = useState(false);
  
  const [currentProduct, setCurrentProduct] = useState<LocalProduct | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [localProductsCount, setLocalProductsCount] = useState<number>(0);
  const [isMenuFiscalOpen, setIsMenuFiscalOpen] = useState(false);
  
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, message: string, onConfirm: () => void, onCancel: () => void}>({ isOpen: false, message: '', onConfirm: () => {}, onCancel: () => {} });
  
  const askConfirm = (message: string) => new Promise<boolean>((resolve) => {
      setConfirmDialog({
          isOpen: true,
          message,
          onConfirm: () => { setConfirmDialog(prev => ({...prev, isOpen: false})); resolve(true); },
          onCancel: () => { setConfirmDialog(prev => ({...prev, isOpen: false})); resolve(false); }
      });
  });
  
  const [isConsultaOpen, setIsConsultaOpen] = useState(false);
  const [consultaEan, setConsultaEan] = useState('');
  const [consultaProduct, setConsultaProduct] = useState<LocalProduct | null>(null);
  /** Consulta pelo nome: lista escolhida com as setas */
  const [consultaLista, setConsultaLista] = useState<LocalProduct[]>([]);
  const [consultaSel, setConsultaSel] = useState(0);
  const consultaUltima = useRef('');
  const consultaInputRef = useRef<HTMLInputElement>(null);

  const [isStartupModalOpen, setIsStartupModalOpen] = useState(true);
  const [startingTroco, setStartingTroco] = useState('0,00');

  const [isNfceListOpen, setIsNfceListOpen] = useState(false);
  const [isIntermediadoresOpen, setIsIntermediadoresOpen] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  /** Código 66 ou botão: menu "Mais" escolhido pelas setas */
  const menuMais = useMenuTeclado(maisAberto, setMaisAberto);
  /** F6: número do item a cancelar (null = janela fechada) */
  const [cancelarItem, setCancelarItem] = useState<string | null>(null);
  /** Código 00: tela de ajuda com os atalhos */
  const [ajudaAberta, setAjudaAberta] = useState(false);
  const [categoriaAberta, setCategoriaAberta] = useState(false);
  const listaCupomRef = useRef<HTMLDivElement>(null);

  const [isPesquisaOpen, setIsPesquisaOpen] = useState(false);
  const [pesquisaQuery, setPesquisaQuery] = useState('');
  const [pesquisaResults, setPesquisaResults] = useState<LocalProduct[]>([]);
  const pesquisaInputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const [askForQuantity, setAskForQuantity] = useState(false);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  // O último item lançado sempre à vista
  useEffect(() => {
    const l = listaCupomRef.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [cart.length]);
  const [isStandby, setIsStandby] = useState(true);

  // Checkout state variables
  interface PaymentItem {
    id: string;
    /** Meio de pagamento da tabela da NF-e (tPag) */
    tPag: string;
    valor: number;
    intermediadorId: number;
    bandeira?: string;
    autorizacao?: string;
    cnpjPagamento?: string;
    ufPagamento?: string;
    /** 1 = TEF integrado ao PDV (SiTEF), 2 = maquininha à parte */
    integracao?: number;
    /** CNPJ da credenciadora informado pelo TEF (vai na NFC-e no lugar do intermediador) */
    cnpjCredenciadora?: string;
    /** Vias do comprovante do TEF, impressas na conclusão (não vão ao servidor) */
    comprovantes?: string[];
    /** PIX recebido pelo banco (BMBancos): o dinheiro já entrou, não sai desfazendo o cupom */
    pixTxid?: string;
  }
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState('01');
  const [paymentValue, setPaymentValue] = useState('');
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [isPaymentValueModalOpen, setIsPaymentValueModalOpen] = useState(false);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  /** TEF do caixa (pdv_caixas.sitef_*); sem ele, cartão é lançado à mão */
  const [sitef, setSitef] = useState<ConfigSitef | null>(null);
  /** Transação TEF em andamento (janela aberta) */
  const [tef, setTef] = useState<{ funcao: number; valor: number } | null>(null);
  /** Documento que agrupa as transações TEF da venda: confirmadas juntas na emissão ou desfeitas no cancelamento */
  const tefDocRef = useRef<DocumentoTef | null>(null);
  /** TEF fora do ar: o cartão é lançado à mão (maquininha à parte) até a próxima venda */
  const [cartaoAMao, setCartaoAMao] = useState(false);
  /** PDV ligado ao BMBancos: o PIX Dinâmico é cobrado no banco (QR Code na tela) */
  const [pixBanco, setPixBanco] = useState(false);
  /** Cobrança PIX em andamento (janela aberta) */
  const [pix, setPix] = useState<{ valor: number } | null>(null);
  const [changeAmount, setChangeAmount] = useState(0);
  const [isPrintSelected, setIsPrintSelected] = useState(true);
  const paymentValueInputRef = useRef<HTMLInputElement>(null);

  // Dados fiscais da venda: consumidor (Requisito IV), ajustes (VIII) e intermediadores (XI)
  const [intermediadores, setIntermediadores] = useState<Intermediador[]>([]);
  const [payInter, setPayInter] = useState(0);
  const [payBandeira, setPayBandeira] = useState('');
  const [payAutorizacao, setPayAutorizacao] = useState('');
  const [payCnpj, setPayCnpj] = useState('');
  const [payUf, setPayUf] = useState('');
  const [consumidorDoc, setConsumidorDoc] = useState('');
  const [consumidorIe, setConsumidorIe] = useState('');
  const [interTransacao, setInterTransacao] = useState(0);
  const [descontoTotal, setDescontoTotal] = useState('');
  const [acrescimoTotal, setAcrescimoTotal] = useState('');
  const [discriminar, setDiscriminar] = useState(true);
  const [editandoItem, setEditandoItem] = useState<string | null>(null);
  const [valorItem, setValorItem] = useState('');
  const [emitindo, setEmitindo] = useState(false);
  /**
   * Um id por venda, do primeiro "Emitir" até a próxima venda: repetir nunca gera outra nota, e a nota
   * recusada (rascunho/rejeitada) é gerada de novo com o cupom corrigido, no mesmo número.
   * ponytail: NF-e que ficou "em processamento" e o caixa alterou o cupom volta com os dados da primeira tentativa.
   */
  const idVendaRef = useRef('');
  /** Conexão do navegador (sem internet a venda não fecha) */
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const mudou = () => setOnline(navigator.onLine);
    window.addEventListener('online', mudou);
    window.addEventListener('offline', mudou);
    return () => {
      window.removeEventListener('online', mudou);
      window.removeEventListener('offline', mudou);
    };
  }, []);
  const intermediadoresPagamento = intermediadores.filter((i) => i.tipo === 'P' && i.ativo);
  const meioCartao = !!MEIOS_PAGAMENTO.find((m) => m.codigo === paymentForm)?.cartao;
  // PIX Dinâmico: no banco (BMBancos) quando ligado; senão pelo SiTEF, se o caixa tiver
  const meioPixBanco = pixBanco && paymentForm === '17';
  const viaPixBanco = meioPixBanco && !cartaoAMao;
  const meioTef = !!sitef && !!FUNCAO_SITEF[paymentForm] && !meioPixBanco;
  const viaTef = meioTef && !cartaoAMao;

  const openCheckout = () => {
    setIsCheckoutOpen(true);
    setPayments([]);
    setPaymentForm('01');
    setIsPaymentValueModalOpen(false);
    setIsChangeModalOpen(false);
    setChangeAmount(0);
    setPaymentValue(total.toFixed(2));
    setIsPrintSelected(true);
  };

  /** Pagamento aprovado no TEF ou PIX recebido: só sai concluindo a venda ou cancelando o cupom */
  const temTef = payments.some((p) => p.integracao === 1);
  const temPix = payments.some((p) => p.pixTxid);

  const closeCheckout = () => {
    if (temTef) {
      showErrorToast(temPix ? 'Há PIX recebido nesta venda.' : 'Há pagamento aprovado no TEF.', { description: 'Conclua a venda ou cancele o cupom.' });
      return;
    }
    setIsCheckoutOpen(false);
    setPayments([]);
    setIsPaymentValueModalOpen(false);
    setIsChangeModalOpen(false);
    setChangeAmount(0);
    setPaymentValue('');
    setTimeout(() => {
      if (eanInputRef.current) eanInputRef.current.focus();
    }, 100);
  };

  const openPaymentValueModal = () => {
    const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
    const updatedRemaining = Math.max(0, round2(total - totalPago));
    setPaymentValue(updatedRemaining > 0 ? updatedRemaining.toFixed(2) : '0.00');
    setIsPaymentValueModalOpen(true);
    setTimeout(() => {
      if (paymentValueInputRef.current) {
        paymentValueInputRef.current.focus();
        paymentValueInputRef.current.select();
      }
    }, 100);
  };

  /** Abertura de caixa: botão "Iniciar Caixa" ou Enter no troco inicial */
  const abrirCaixa = () => {
    // Tela do cliente usada neste computador: reabre junto (o clique/Enter do operador libera o pop-up)
    if (telaClienteLembrada()) void abrirTelaCliente();
    setIsStartupModalOpen(false);
    setIsStandby(false);
    // Arquivo .db e .ini só pelos botões "Conectar": abrir o caixa não pede arquivo
    toast.success('Abertura de Caixa realizada!', { description: `Troco inicial registrado: R$ ${startingTroco}` });
    setTimeout(() => eanInputRef.current?.focus(), 200);
  };

  const closePaymentValueModal = () => {
    setIsPaymentValueModalOpen(false);
  };

  const addPayment = () => {
    const val = round2(parseFloat(paymentValue.replace(',', '.')));
    if (isNaN(val) || val <= 0) {
      showErrorToast('Informe um valor de pagamento válido.');
      return;
    }

    if (!payInter) {
      showErrorToast('Escolha o intermediador do pagamento.', { description: 'Cadastre em Intermediadores, no rodapé, se a lista estiver vazia.' });
      return;
    }
    if (payCnpj && (!cnpjValido(payCnpj) || !/^[A-Z]{2}$/.test(payUf))) {
      showErrorToast('CNPJ ou UF do estabelecimento do pagamento inválidos.');
      return;
    }

    const currentTotalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
    const remaining = round2(total - currentTotalPago);

    if (val > remaining) {
      if (paymentForm !== '01') {
        showErrorToast('Valor maior que o restante: troco só em dinheiro.');
        return;
      }
      // Intercept for Change modal!
      setChangeAmount(round2(val - remaining));
      setIsChangeModalOpen(true);
      return;
    }

    if (viaPixBanco) {
      if (!idVendaRef.current) idVendaRef.current = gerarIdApp();
      setIsPaymentValueModalOpen(false);
      setPix({ valor: val });
      return;
    }

    if (viaTef) {
      if (!idVendaRef.current) idVendaRef.current = gerarIdApp();
      tefDocRef.current ??= novoDocumento(idVendaRef.current);
      setIsPaymentValueModalOpen(false);
      setTef({ funcao: FUNCAO_SITEF[paymentForm], valor: val });
      return;
    }

    commitPayment(val);
  };

  const commitPayment = (val: number, tef?: ResultadoTef & { pixTxid?: string }) => {
    const roundedVal = round2(val);
    const newPayment: PaymentItem = {
      id: Math.random().toString(),
      tPag: paymentForm,
      valor: roundedVal,
      intermediadorId: payInter,
      integracao: tef ? 1 : 2,
      ...(tef
        ? { bandeira: tef.bandeira, autorizacao: tef.autorizacao, cnpjCredenciadora: tef.cnpjCredenciadora, comprovantes: tef.comprovantes, pixTxid: tef.pixTxid }
        : {
            ...(meioCartao && payBandeira && { bandeira: payBandeira }),
            ...(meioCartao && payAutorizacao.trim() && { autorizacao: payAutorizacao.trim() }),
          }),
      ...(digitos(payCnpj) && { cnpjPagamento: digitos(payCnpj), ufPagamento: payUf }),
    };
    setPayAutorizacao('');

    const newPayments = [...payments, newPayment];
    setPayments(newPayments);

    // Calculate new total paid
    const updatedTotalPago = round2(newPayments.reduce((acc, p) => acc + p.valor, 0));
    const updatedRemaining = Math.max(0, round2(total - updatedTotalPago));

    // Update payment values remaining and close modals
    setPaymentValue(updatedRemaining > 0 ? updatedRemaining.toFixed(2) : '0.00');
    setIsPaymentValueModalOpen(false);
    setIsChangeModalOpen(false);
  };

  const confirmChange = () => {
    const val = parseFloat(paymentValue.replace(',', '.'));
    if (!isNaN(val)) {
      commitPayment(val);
    }
  };

  const removePayment = async (id: string) => {
    const pg = payments.find((p) => p.id === id);
    if (pg?.pixTxid) {
      showErrorToast('PIX recebido não sai do cupom.', { description: 'Para desistir da venda, cancele o cupom e devolva o PIX pelo banco.' });
      return;
    }
    if (pg?.integracao === 1) {
      showErrorToast('Pagamento do TEF não sai sozinho.', { description: 'Cancele o cupom para desfazer o TEF.' });
      return;
    }
    if (!await askConfirm('Remover este pagamento?')) return;
    const newPayments = payments.filter(p => p.id !== id);
    setPayments(newPayments);
    
    // Calculate new total paid and update prefill value
    const updatedTotalPago = round2(newPayments.reduce((acc, p) => acc + p.valor, 0));
    const updatedRemaining = Math.max(0, round2(total - updatedTotalPago));
    setPaymentValue(updatedRemaining.toFixed(2));
  };

  const eanInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  /**
   * O campo do EAN é o início de tudo: terminada qualquer função (janela, menu, confirmação fechados),
   * o foco volta para ele. Só age com a tela livre (sem diálogo nem menu aberto) e com o foco fora de
   * um campo (no fundo da página ou num botão clicado).
   * ponytail: verificação a cada 300 ms em vez de tratar o fechamento de cada janela
   */
  useEffect(() => {
    const t = setInterval(() => {
      const ean = eanInputRef.current;
      const ativo = document.activeElement;
      if (!ean || ean.disabled || ativo === ean) return;
      if (ativo && /^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName)) return;
      if (document.querySelector('[role="dialog"], .fixed.inset-0')) return;
      ean.focus();
    }, 300);
    return () => clearInterval(t);
  }, []);

  // Focus EAN on load and check local storage size
  useEffect(() => {
    // Com a abertura de caixa na frente, o foco fica no troco inicial (abrirCaixa leva para o EAN)
    if (!isStartupModalOpen) eanInputRef.current?.focus();

    // Check local database count
    const fetchLocalCount = async () => {
      try {
        const count = await db.products.count();
        setLocalProductsCount(count);
      } catch (err) {
        console.error("Local DB check error:", err);
      }
    };
    
    fetchLocalCount();
  }, []);

  const carregarIntermediadores = async () => {
    // Última lista do servidor fica no navegador: sem conexão o caixa ainda lança o pagamento
    const CHAVE = 'pdv.intermediadores';
    try {
      let lista: Intermediador[];
      try {
        const r = await fetch('/api/intermediadores');
        if (!r.ok) throw new Error(await erroDe(r));
        lista = await r.json();
        try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* armazenamento bloqueado */ }
      } catch (err) {
        let guardada: Intermediador[] | null = null;
        try { guardada = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { /* sem cópia */ }
        if (!guardada) throw err;
        lista = guardada;
      }
      setIntermediadores(lista);
      setPayInter((atual) => atual || lista.find((i) => i.tipo === 'P' && i.ativo)?.id || 0);
    } catch (err) {
      console.error('Intermediadores:', err);
    }
  };

  useEffect(() => {
    carregarIntermediadores();
    // Cadastro do caixa no Master (balança, teclado virtual): relido a cada login, sem precisar recarregar a página
    atualizarBalanca();
    lerDoCaixa();
    fetch('/api/caixa/sitef').then((r) => (r.ok ? r.json() : null)).then((d) => setSitef(d?.sitef ?? null)).catch(() => {});
    fetch('/api/pix').then((r) => (r.ok ? r.json() : null)).then((d) => setPixBanco(!!d?.ativo)).catch(() => {});
    // NFC-e em contingência: transmite sozinho a cada minuto e quando a internet volta (Requisito III, II)
    const transmitir = async () => {
      if (!navigator.onLine) return;
      try {
        const r = await fetch('/api/nfce/contingencia', { method: 'POST' });
        const d = await r.json();
        if (r.ok && d?.transmitidas) toast.success(`${d.transmitidas} NFC-e de contingência transmitida(s) à SEFAZ.`);
      } catch {
        // tenta no próximo minuto
      }
    };
    transmitir();
    const t = setInterval(transmitir, 60_000);
    window.addEventListener('online', transmitir);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', transmitir);
    };
  }, []);

  const closeConsulta = () => {
     setIsConsultaOpen(false);
     setConsultaEan('');
     setConsultaProduct(null);
     setConsultaLista([]);
     setTimeout(() => eanInputRef.current?.focus(), 100);
  };

  /** Texto (não só dígitos, que são código de barras) lista os produtos pelo nome */
  const handleConsultaChange = async (texto: string) => {
    setConsultaEan(texto);
    setConsultaSel(0);
    const t = texto.trim();
    consultaUltima.current = t;
    if (t.length < 2 || /^\d+$/.test(t)) return setConsultaLista([]);
    const achados = await buscarProdutos(t, 30).catch(() => [] as LocalProduct[]);
    if (consultaUltima.current === t) setConsultaLista(achados); // resposta de uma digitação antiga não vale
  };

  const escolherConsulta = (p: LocalProduct) => {
    setConsultaProduct(p);
    setConsultaLista([]);
    consultaInputRef.current?.select();
  };

  const handleConsultaSearch = async () => {
    const currentEan = consultaEan.trim();
    if (!currentEan) return;
    
    setConsultaProduct(null);
    
    let searchCode = currentEan;
    
    if (currentEan.length === 13 && currentEan.startsWith('2')) {
      searchCode = currentEan.substring(1, 6);
    }
    
    try {
      let product = await db.products
        .where('codigo_barras')
        .equals(searchCode)
        .first();
        
      if (!product && !isNaN(Number(searchCode))) {
         product = await db.products.get(Number(searchCode));
      }
      
      if (!product) {
        showErrorToast('Produto não encontrado.', {
          description: 'Nenhum item com este EAN.'
        });
      } else {
        setConsultaProduct(product);
      }
    } catch (err) {
      console.error(err);
      showErrorToast('Erro ao buscar produto.', {
        description: err instanceof Error ? err.message : String(err)
      });
    }
    
    if (consultaInputRef.current) {
        consultaInputRef.current.focus();
        consultaInputRef.current.select();
    }
  };

  const handleConsultaKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (consultaLista.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setConsultaSel((i) => Math.max(0, Math.min(consultaLista.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (consultaLista.length) escolherConsulta(consultaLista[consultaSel]);
      else handleConsultaSearch();
    } else if (e.key === 'Escape') {
      closeConsulta();
    }
  };

  /** Automática (ao abrir e ao voltar a internet): sem aviso de erro, a base local continua valendo */
  const syncProducts = async (automatica = false) => {
    setIsSyncing(true);
    setSyncStatus('Baixando produtos do servidor...');
    try {
      const res = await fetch('/api/produtos/sync');
      if (!res.ok) throw new Error('Falha ao sincronizar');
      
      const products: LocalProduct[] = await res.json();
      
      setSyncStatus('Atualizando base local...');
      await substituirProdutos(products);
      
      setLocalProductsCount(products.length);
      setSyncStatus(`Sucesso! ${products.length} produtos sincronizados.`);
      
      setTimeout(() => setSyncStatus(''), 4000);
    } catch (err) {
      console.error(err);
      setSyncStatus('');
      if (!automatica) showErrorToast('Erro ao sincronizar produtos.', {
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Produtos do servidor ao abrir e quando a internet volta: o PDV não depende de arquivo de dados
  useEffect(() => {
    const sincronizar = () => { if (navigator.onLine) syncProducts(true); };
    sincronizar();
    window.addEventListener('online', sincronizar);
    return () => window.removeEventListener('online', sincronizar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePesquisaChange = async (query: string) => {
    setPesquisaQuery(query);
    setSelectedIndex(0);
    if (query.trim().length === 0) {
      setPesquisaResults([]);
      return;
    }
    try {
      const results = await buscarProdutos(query.trim(), 20);
      setPesquisaResults(results);
    } catch (err) {
      console.error(err);
    }
  };

  const selectPesquisaItem = (product: LocalProduct) => {
      setIsPesquisaOpen(false);
      setPesquisaQuery('');
      setPesquisaResults([]);
      setSelectedIndex(0);
      const code = product.codigo_barras || product.id?.toString() || '';
      setEan(code);
      setTimeout(() => {
          if (eanInputRef.current) eanInputRef.current.focus();
      }, 50);
  };

  const handlePesquisaKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, pesquisaResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (pesquisaResults.length > 0 && selectedIndex >= 0 && selectedIndex < pesquisaResults.length) {
        selectPesquisaItem(pesquisaResults[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      closePesquisa();
    }
  };

  const closePesquisa = () => {
      setIsPesquisaOpen(false);
      setPesquisaQuery('');
      setPesquisaResults([]);
      setSelectedIndex(0);
      setTimeout(() => {
          if (eanInputRef.current) eanInputRef.current.focus();
      }, 50);
  };

  const searchProduct = async () => {
    const currentEan = ean.trim();
    if (!currentEan) {
       setIsPesquisaOpen(true);
       setTimeout(() => pesquisaInputRef.current?.focus(), 100);
       return;
    }

    // Funções por código de 2 dígitos no lugar do EAN
    const funcao = CODIGOS.find(([c]) => c === currentEan)?.[1];
    if (funcao) {
      setEan('');
      if (funcao === 'ajuda') return setAjudaAberta(true);
      const semItens = () => showErrorToast('O cupom não tem itens.');
      if (funcao === 'fechar') return cart.length ? openCheckout() : semItens();
      if (funcao === 'item') return cart.length ? setCancelarItem(String(cart.length)) : semItens();
      if (funcao === 'cupom') return cart.length ? void cancelarCupom() : semItens();
      if (funcao === 'preco') {
        setIsConsultaOpen(true);
        return void setTimeout(() => consultaInputRef.current?.focus(), 100);
      }
      if (funcao === 'livre') return cart.length ? showErrorToast('Caixa Livre só com o cupom vazio.') : setIsStandby(true);
      if (funcao === 'mais') return setMaisAberto(true);
      if (funcao === 'categoria') return setCategoriaAberta(true);
      return setIsMenuFiscalOpen(true);
    }

    setIsLoading(true);
    
    let isWeightProduct = false;
    let weightTotalPrice = 0;

    try {
      // Código exato primeiro: EAN interno também começa com "2" e não é etiqueta de balança
      let product = await db.products.where('codigo_barras').equals(currentEan).first();

      if (!product && currentEan.length === 13 && currentEan.startsWith('2')) {
        isWeightProduct = true;
        weightTotalPrice = parseInt(currentEan.substring(6, 12), 10) / 100;
        product = await db.products.where('codigo_barras').equals(currentEan.substring(1, 6)).first();
      }

      const searchCode = isWeightProduct ? currentEan.substring(1, 6) : currentEan;
      if (!product && !isNaN(Number(searchCode))) {
         product = await db.products.get(Number(searchCode));
      }
      
      if (!product) {
        showErrorToast('Produto não encontrado na base local.', { description: 'Verifique o código ou sincronize os produtos' });
        setEan(''); // erro: o campo fica limpo para digitar de novo
        setCurrentProduct(null);
        setTimeout(() => eanInputRef.current?.focus(), 50);
        return;
      }

      const unitPrice = typeof product.preco_venda === 'string' 
        ? parseFloat(product.preco_venda) 
        : product.preco_venda;

      if (isWeightProduct) {
        // Etiqueta de balança traz o total: quantidade calculada com 3 casas (Requisito VIII, II)
        const calculatedQuantity = Math.round((weightTotalPrice / unitPrice) * 1000) / 1000;

        const newItem: CartItem = {
          cartId: Math.random().toString(36).substring(7),
          product: product,
          quantidade: calculatedQuantity,
          subtotal: weightTotalPrice,
          valorTotal: weightTotalPrice
        };

        setCart(prev => [...prev, newItem]);
        setEan('');
        setTimeout(() => eanInputRef.current?.focus(), 50);
      } else if (askForQuantity || porKg(product)) {
        // Por kg sem etiqueta de balança: não entra com 1 kg, pede o peso
        pedirQuantidade(product);
      } else {
        const newItem: CartItem = {
          cartId: Math.random().toString(36).substring(7),
          product: product,
          quantidade: 1,
          subtotal: totalDoItem(1, unitPrice, product.iat)
        };

        setCart(prev => [...prev, newItem]);
        setEan('');
        setTimeout(() => eanInputRef.current?.focus(), 50);
      }

    } catch (err) {
      console.error(err);
      showErrorToast('Falha ao acessar o banco de dados local.', { description: err instanceof Error ? err.message : String(err) });
      setEan('');
      setCurrentProduct(null);
    } finally {
      setIsLoading(false);
    }
  };

  /** Peso da balança do caixa no campo Qtd (caixa sem balança: o operador digita; no * ele é avisado) */
  const pesar = async (pedidoDoOperador = false) => {
    const cfg = balancaDoCaixa();
    if (!cfg) {
      if (pedidoDoOperador) toast.warning('Caixa sem balança no cadastro: digite o peso.', { description: 'A balança se liga no cadastro do caixa (BM-Master → Caixas (PDV)).' });
      return;
    }
    if (pesando) return;
    setPesando(true);
    try {
      const kg = await lerPeso(cfg);
      setQuantidade(kg);
      setQuantidadeText(kg.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
    } catch (e) {
      showErrorToast('Balança: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPesando(false);
      setTimeout(() => {
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
      }, 50);
    }
  };

  /**
   * Produto à espera da quantidade (F3, código 77, produto por kg). Por kg o peso começa vazio (um Enter distraído
   * não lança 1 kg) e já é pedido à balança; sem balança, o operador digita.
   */
  const pedirQuantidade = (product: LocalProduct) => {
    const kg = porKg(product);
    setCurrentProduct(product);
    setQuantidade(kg ? 0 : 1);
    setQuantidadeText(kg ? '' : '1,000');
    setValorItem('');
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
    if (kg) pesar();
  };

  const handleEanKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isStandby) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // O Enter fica no campo: um código (99, 66…) abre a tela e, se seguisse até o atalho geral, já agiria nela
      // (no 99 pulava a escolha do finalizador e ia direto ao valor)
      e.stopPropagation();
      searchProduct();
    }
  };

  const handleQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (pesando) return;
      if (!(quantidade > 0) && !(Number(valorItem) > 0)) return void toast.warning(porKg(currentProduct) ? 'Informe o peso.' : 'Informe a quantidade.');
      addToCart();
    }
    // * (teclado numérico): lê a balança de novo (cliente mexeu na sacola)
    if (e.key === '*') {
      e.preventDefault();
      pesar(true);
    }
  };

  const addToCart = () => {
    if (!currentProduct) return;
    const price = precoDe(currentProduct);
    // Registro pelo valor total: a quantidade sai do total (Requisito VIII, II)
    const informado = Number(valorItem) || 0;
    const q = informado > 0 ? Math.round((informado / price) * 1000) / 1000 : quantidade;
    if (!(q > 0)) return;

    const newItem: CartItem = {
      cartId: Math.random().toString(36).substring(7),
      product: currentProduct,
      quantidade: q,
      subtotal: informado > 0 ? informado : totalDoItem(q, price, currentProduct.iat),
      ...(informado > 0 && { valorTotal: informado })
    };

    setCart(prev => [...prev, newItem]);
    
    // Reset form
    setEan('');
    setQuantidade(1);
    setQuantidadeText('1,000');
    setValorItem('');
    setCurrentProduct(null);
    setAskForQuantity(false);
    
    // Focus EAN again
    setTimeout(() => {
      if (eanInputRef.current) eanInputRef.current.focus();
    }, 50);
  };

  const removeFromCart = async (cartId: string) => {
    const n = cart.findIndex((i) => i.cartId === cartId);
    if (n < 0) return;
    if (!await askConfirm(`Remover o item ${String(n + 1).padStart(3, '0')} (${cart[n].product.nome}) do cupom?`)) return;
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  const totalItens = round2(cart.reduce((acc, item) => acc + item.subtotal, 0));
  /** Desconto (−) ou acréscimo (+) no total da venda, rateado pelos itens no servidor */
  const ajusteTotal = round2((Number(acrescimoTotal) || 0) - (Number(descontoTotal) || 0));
  const total = round2(totalItens + ajusteTotal);
  const docConsumidor = digitos(consumidorDoc);
  const docInvalido = !!docConsumidor && !(docConsumidor.length === 11 ? cpfValido(docConsumidor) : docConsumidor.length === 14 && cnpjValido(docConsumidor));
  const modeloVenda = modeloDoDocumento(docConsumidor, docConsumidor.length === 11 ? consumidorIe : '', total);

  const novaVenda = () => {
    setCart([]);
    setEan('');
    setCurrentProduct(null);
    setIsStandby(true);
    setIsCheckoutOpen(false);
    setPayments([]);
    setPaymentValue('');
    setConsumidorDoc('');
    setConsumidorIe('');
    setInterTransacao(0);
    setDescontoTotal('');
    setAcrescimoTotal('');
    setDiscriminar(true);
    idVendaRef.current = '';
    tefDocRef.current = null;
    setCartaoAMao(false);
  };

  /** Cancela o cupom; com TEF aprovado, desfaz as transações antes */
  const cancelarCupom = async () => {
    if (!await askConfirm(temPix
      ? 'Cancelar este cupom? O PIX já recebido NÃO é devolvido sozinho: devolva pelo banco.'
      : temTef
      ? 'Cancelar este cupom? Os pagamentos aprovados no TEF serão desfeitos.'
      : 'Cancelar este cupom? Os itens e pagamentos lançados serão descartados.')) return;
    if (temTef && sitef && tefDocRef.current) {
      // ponytail: sem o Agente, a CliSiTef desfaz a pendência sozinha na próxima transação
      await finalizar(sitef, tefDocRef.current, false).catch((e) =>
        showErrorToast('Não foi possível desfazer o TEF agora.', { description: `${e.message} A CliSiTef desfaz a transação pendente na próxima venda com cartão.` }));
    }
    novaVenda();
  };

  /**
   * Conclusão da venda = emissão do DF-e (Requisito III): só com internet. Sem resposta da SEFAZ,
   * a NFC-e sai em contingência no servidor. Erro: o cupom continua aberto para corrigir e tentar de novo.
   */
  const handleFinalize = async (imprimir: boolean = true) => {
    if (cart.length === 0 || emitindo) return;
    if (!navigator.onLine) {
      showErrorToast('Sem internet: a venda só é concluída com conexão.', { description: 'O cupom continua aberto. Conclua quando a conexão voltar.' });
      return;
    }
    if (docInvalido) {
      showErrorToast('CPF/CNPJ do consumidor inválido.');
      return;
    }
    if (!idVendaRef.current) idVendaRef.current = gerarIdApp();
    // Aba do DANFE aberta ainda no gesto do caixa (depois da emissão o navegador bloquearia)
    const janela = imprimir ? window.open('', '_blank') : null;
    setEmitindo(true);
    let chegou = false;
    try {
      const r = await fetch('/api/nfce/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idApp: idVendaRef.current,
          itens: cart.map((i) => ({
            produtoId: Number(i.product.id),
            quantidade: i.quantidade,
            valorUnitario: precoDe(i.product),
            ...(i.valorTotal != null && { valorTotal: i.valorTotal }),
          })),
          ...(docConsumidor && { consumidor: { documento: docConsumidor, ...(docConsumidor.length === 11 && consumidorIe.trim() && { ieProdutor: consumidorIe.trim() }) } }),
          pagamentos: payments.map(({ id, comprovantes, pixTxid, ...p }) => p),
          ajusteTotal,
          discriminarAjustes: discriminar,
          ...(interTransacao && { intermediadorTransacaoId: interTransacao }),
        }),
      });
      chegou = true;
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      const nome = d.modelo === '55' ? 'NF-e' : 'NFC-e';
      if (d.situacao === 'autorizada') toast.success(`${nome} ${d.numero} autorizada.`);
      else if (d.situacao === 'contingencia') toast.warning(`${nome} ${d.numero} emitida em contingência.`, { description: 'Será transmitida à SEFAZ automaticamente.' });
      else throw new Error(`${nome} ${d.numero ?? ''} ainda em processamento na SEFAZ (${d.situacao || 'sem resposta'}). Tente concluir de novo: a mesma venda não gera outra nota.`);
      if (d.aviso) toast.warning(d.aviso);
      if (janela && d.chave) imprimirDanfe(d.chave, janela).catch((e) => showErrorToast('Não foi possível abrir o DANFE.', { description: e.message }));
      else janela?.close();
      if (temTef && sitef && tefDocRef.current) {
        await finalizar(sitef, tefDocRef.current, true).catch((e) =>
          showErrorToast('A nota saiu, mas o TEF não foi confirmado.', { description: `${e.message} Confira a transação no SiTEF: sem confirmação ela é desfeita.`, duration: Infinity }));
        imprimirComprovantes(payments.flatMap((p) => p.comprovantes || []));
      }
      novaVenda();
      eanInputRef.current?.focus();
    } catch (err: any) {
      janela?.close();
      // O pedido nem chegou ao servidor (sem rede ou servidor fora do ar)
      const semServidor = !chegou;
      showErrorToast(semServidor ? 'Sem conexão com o servidor: a venda só é concluída com conexão.' : 'A venda não foi concluída.', {
        description: semServidor ? 'O cupom continua aberto. Conclua quando a conexão voltar.' : err?.message || String(err),
      });
    } finally {
      setEmitindo(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (isStartupModalOpen) return; // a abertura de caixa trata as próprias teclas
      if (isStandby) {
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
          e.preventDefault();
          setIsStandby(false);
          setTimeout(() => {
            if (eanInputRef.current) eanInputRef.current.focus();
          }, 100);
        }
        return;
      }
      
      if (isConsultaOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeConsulta();
        }
        return; // as demais teclas são da consulta (campo e setas da lista)
      }

      if (isNfceListOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsNfceListOpen(false);
        }
        return; // as demais teclas são da tela de notas (setas e números)
      }

      if (tef || pix || cancelarItem !== null || ajudaAberta || categoriaAberta) return; // a janela aberta trata as teclas

      if (isChangeModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsChangeModalOpen(false);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          confirmChange();
          return;
        }
        return;
      }

      if (isPaymentValueModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closePaymentValueModal();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          addPayment();
          return;
        }
        // Let user type normally in the inputs without any global triggers
        return;
      }

      if (e.key === 'Escape') {
        if (isCheckoutOpen) {
          e.preventDefault();
          closeCheckout();
          return;
        }
      }

      if (isCheckoutOpen) {
        const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
        if (e.key === 'Enter') {
          e.preventDefault();
          if (totalPago >= total) {
            handleFinalize(isPrintSelected);
          } else {
            openPaymentValueModal();
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (totalPago >= total) {
            setIsPrintSelected(current => !current);
          } else {
            const pMethods = MEIOS_PAGAMENTO.map((m) => m.codigo);
            setPaymentForm(current => {
              const idx = pMethods.indexOf(current);
              const nextIdx = (idx + 1) % pMethods.length;
              return pMethods[nextIdx];
            });
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (totalPago >= total) {
            setIsPrintSelected(current => !current);
          } else {
            const pMethods = MEIOS_PAGAMENTO.map((m) => m.codigo);
            setPaymentForm(current => {
              const idx = pMethods.indexOf(current);
              const prevIdx = (idx - 1 + pMethods.length) % pMethods.length;
              return pMethods[prevIdx];
            });
          }
          return;
        }
      }
      
      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length > 0) {
          if (!isCheckoutOpen) {
            openCheckout();
          } else {
            const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
            if (totalPago >= total) {
              handleFinalize(isPrintSelected);
            }
          }
        }
      }
      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length === 0 && !isCheckoutOpen) {
          setIsStandby(true);
        }
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (!isStandby && !isCheckoutOpen) {
           setIsConsultaOpen(true);
           setTimeout(() => consultaInputRef.current?.focus(), 100);
        }
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (!isCheckoutOpen) {
          setAskForQuantity(true);
          if (eanInputRef.current) eanInputRef.current.focus();
        }
      }
      if (e.key === 'F6') {
        e.preventDefault();
        if (!isCheckoutOpen && cart.length > 0) setCancelarItem(String(cart.length));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, total, isStandby, isCheckoutOpen, payments, isPaymentValueModalOpen, isChangeModalOpen, tef, pix, sitef, paymentValue, paymentForm, isConsultaOpen, isNfceListOpen, isPrintSelected, cancelarItem, ajudaAberta, categoriaAberta, isStartupModalOpen]);

  /** Ajuda dos atalhos: qualquer tecla fecha (e não chega ao campo do EAN) */
  useEffect(() => {
    if (!ajudaAberta) return;
    const fechar = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setAjudaAberta(false);
      setTimeout(() => eanInputRef.current?.focus(), 50);
    };
    window.addEventListener('keydown', fechar, true);
    return () => window.removeEventListener('keydown', fechar, true);
  }, [ajudaAberta]);

  const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
  const remainingValue = round2(Math.max(0, total - totalPago));
  const isFullyPaid = totalPago >= total;

  // Tela do cliente (segunda janela, outro monitor): o cupom a cada mudança
  usePublicarCupom({
    empresa: usuario.empresaNome || '',
    itens: cart.map((i) => ({ nome: i.product.nome, quantidade: i.quantidade, unidade: i.product.unidade ?? null, preco: precoDe(i.product), valor: i.subtotal })),
    ajuste: ajusteTotal,
    total,
    finalizando: isCheckoutOpen,
    pago: totalPago,
    troco: round2(Math.max(0, totalPago - total)),
  });

  return (
    <div className="h-[calc(100dvh-var(--teclado,0px))] w-screen bg-stone-100 flex flex-col font-sans text-stone-800 overflow-hidden relative">
      
      {/* Standby / Caixa Livre Screen */}
      {isStandby && (
        <div className="absolute inset-0 bg-blue-600 z-[100] flex flex-col items-center justify-center text-white" onClick={() => { setIsStandby(false); setTimeout(() => eanInputRef.current?.focus(), 100); }}>
          <h1 className="text-7xl md:text-[140px] font-black tracking-tighter mb-8">CAIXA LIVRE</h1>
          <p className="text-2xl md:text-3xl font-medium animate-pulse opacity-90">Pressione ENTER para iniciar nova venda</p>
          <p className="absolute bottom-6 text-xs font-black tracking-widest opacity-60">MENU FISCAL INACESSÍVEL NESTA TELA</p>
        </div>
      )}

      <div className="w-full h-full flex flex-col">
        
        {/* Header Empresa */}
        <header className="h-[4.375rem] shrink-0 bg-white border-b border-stone-200">
          <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                <ShoppingCart size={20} className="text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-stone-900 leading-tight truncate uppercase">
                  {usuario.caixaNumero != null && (
                    <span className="text-[11px] font-semibold text-blue-600 tracking-wider mr-2 hidden sm:inline">Caixa {usuario.caixaNumero} •</span>
                  )}
                  {usuario.empresaNome || 'Sua Empresa Aqui'}
                </h1>
                <p className="text-[11px] text-stone-500 truncate hidden sm:flex items-center gap-2">
                  PDV Cupom · BMsoft Sistemas
                  <span className={`inline-flex items-center gap-1 font-semibold ${online ? 'text-emerald-600' : 'text-rose-600'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                    {online ? 'Online' : 'Sem internet: a venda não fecha'}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {usuario.userName && <span className="text-xs font-semibold text-stone-500 hidden sm:inline">{usuario.userName}</span>}
              <button
                type="button"
                onClick={onSair}
                title="Sair"
                data-dica-desc="Encerra a sessão deste usuário no PDV"
                className={`${BOTAO_SECUNDARIO} hover:text-rose-600`}
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </header>

        {isConsultaOpen ? (
          /* FULL SCREEN CONSULTA DE PREÇO */
          <div className="flex-1 bg-white overflow-hidden flex flex-col min-h-0 animate-in fade-in duration-200">
             <div className="flex justify-between items-center px-5 py-3 border-b border-stone-200 shrink-0">
                <h3 className="text-base font-bold flex items-center gap-2 text-stone-900">
                  <Search size={18} className="text-blue-600" />
                  Consulta de Preço
                </h3>
                <MenuFiscalInacessivel />
                <button 
                  type="button"
                  onClick={closeConsulta}
                  className={BOTAO_SECUNDARIO}
                >
                  Fechar (Esc)
                </button>
             </div>
             
             <div className="p-6 sm:p-8 flex flex-col flex-1 overflow-hidden max-w-3xl mx-auto w-full">
                <div className="mb-6 shrink-0">
                  <label htmlFor="consultaEan" className="block text-xs font-semibold text-stone-500 mb-1">
                    Código de Barras (EAN)
                  </label>
                  <input
                    id="consultaEan"
                    ref={consultaInputRef}
                    type="text"
                    className="w-full px-4 py-3.5 bg-blue-500/[0.03] text-2xl font-mono text-stone-800 outline-none transition-all"
                    placeholder="Escaneie o código de barras ou digite o nome..."
                    value={consultaEan}
                    onChange={e => handleConsultaChange(e.target.value)}
                    onKeyDown={handleConsultaKeyDown}
                  />
                </div>
                
                <div className="flex-1 flex flex-col min-h-0">
                  {consultaLista.length > 0 ? (
                    <div className="border border-stone-200 rounded-lg divide-y divide-stone-200 overflow-y-auto">
                      {consultaLista.map((p, i) => (
                        <div
                          key={p.id}
                          ref={i === consultaSel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                          onClick={() => escolherConsulta(p)}
                          className={`flex items-center justify-between gap-4 px-4 py-3 cursor-pointer border-l-2 ${i === consultaSel ? 'bg-blue-50 border-l-blue-600' : 'bg-white border-l-transparent hover:bg-stone-50'}`}
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] text-stone-400 font-mono">{p.codigo_barras || p.id}</p>
                            <p className="text-sm font-bold text-stone-800 truncate">{p.nome}</p>
                          </div>
                          <p className="text-lg font-mono font-black text-blue-700 shrink-0">{formatCurrency(p.preco_venda)}</p>
                        </div>
                      ))}
                    </div>
                  ) : consultaProduct ? (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-6 sm:p-8 flex flex-col items-center justify-center text-center animate-in fade-in h-full">
                       <h4 className="text-3xl font-black text-stone-950 mb-6 leading-tight uppercase tracking-tight">{consultaProduct.nome}</h4>
                       
                       <div className="bg-white px-10 py-8 rounded-lg border border-blue-200 min-w-full sm:min-w-[60%]">
                          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Preço de Venda</p>
                          <p className="text-6xl sm:text-7xl font-[Verdana] font-black text-blue-700 tracking-tighter">
                            {formatCurrency(consultaProduct.preco_venda)}
                          </p>
                       </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-stone-300 rounded-lg flex flex-col items-center justify-center text-center h-full text-stone-400 p-6 bg-stone-50">
                       <Search size={64} className="mb-4 text-blue-400/80 animate-pulse" />
                       <p className="text-base font-bold text-stone-700">Aguardando leitura de produto...</p>
                       <p className="text-sm text-stone-500 max-w-md mt-2 leading-relaxed">Passe o produto no leitor, digite o código e pressione Enter, ou digite o nome e escolha com as setas.</p>
                    </div>
                  )}
                </div>
             </div>
          </div>
        ) : isNfceListOpen ? (
          <NotasPdv onFechar={() => setIsNfceListOpen(false)} confirmar={askConfirm} />
        ) : (
          <>
            <div className="flex-1 bg-white overflow-hidden flex flex-col md:flex-row min-h-0">
         
         {/* Left Side: Controls */}
         <div className="md:w-[45%] lg:w-[40%] p-5 bg-stone-50 flex flex-col border-r border-stone-200 min-h-0 overflow-y-auto">
            
            {/* Sync Feedback Message */}
            {syncStatus && (
               <div className="mb-4 text-xs font-semibold px-3 py-2 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg flex items-center gap-2 animate-in fade-in">
                 <Database size={14} />
                 {syncStatus}
               </div>
            )}
            
            {/* Product Search Form / Checkout Portal */}
            {isCheckoutOpen ? (
              <div className="space-y-4 bg-white p-4 rounded-lg border border-emerald-300 border-l-2 border-l-emerald-500 relative shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-stone-100">
                  <h3 className="text-sm font-black text-emerald-700 flex items-center gap-1.5 uppercase tracking-wide">
                    <CheckCircle size={16} className="text-emerald-600 animate-pulse" />
                    Finalizar Cupom
                  </h3>
                  <button 
                    onClick={closeCheckout}
                    className="text-xs font-semibold text-stone-600 hover:text-rose-600 px-2.5 py-1 rounded-lg border border-stone-300 hover:bg-stone-100 transition-colors cursor-pointer"
                  >
                    Voltar (Esc)
                  </button>
                </div>

                {/* Resumo de Valores */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-stone-500 font-medium">Total da Venda:</span>
                    <span className="font-bold text-stone-800">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500 font-medium">Total Pago:</span>
                    <span className="font-bold text-blue-600">{formatCurrency(totalPago)}</span>
                  </div>
                  {!isFullyPaid ? (
                    <div className="flex justify-between text-xs font-bold text-amber-600 pt-1.5 border-t border-dashed border-stone-200">
                      <span>Restante a Pagar:</span>
                      <span>{formatCurrency(remainingValue)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-xs font-bold text-emerald-600 pt-1.5 border-t border-dashed border-stone-200">
                      <span>Status:</span>
                      <span>PAGAMENTO CONCLUÍDO</span>
                    </div>
                  )}
                </div>

                {/* Consumidor, desconto/acréscimo e intermediador da transação (Requisitos IV, VIII e XI) */}
                <div
                  className="space-y-2.5 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
                  }}
                >
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label htmlFor="consumidorDoc" className="text-xs font-semibold text-stone-500">CPF/CNPJ do consumidor</label>
                      <span className={`text-[10px] font-black ${docInvalido || (modeloVenda === '55' && !docConsumidor) ? 'text-rose-600' : 'text-blue-700'}`}>
                        {docInvalido ? 'INVÁLIDO' : modeloVenda === '55' ? (docConsumidor ? 'NF-e (modelo 55)' : 'NF-e: INFORME O CPF/CNPJ') : 'NFC-e (modelo 65)'}
                      </span>
                    </div>
                    <input
                      id="consumidorDoc"
                      className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm font-mono"
                      inputMode="numeric"
                      placeholder="Não informado"
                      value={consumidorDoc}
                      maxLength={18}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setConsumidorDoc(digitos(e.target.value).slice(0, 14))}
                    />
                  </div>
                  {docConsumidor.length === 11 && (
                    <div>
                      <label htmlFor="consumidorIe" className="block text-xs font-semibold text-stone-500 mb-1">IE de produtor rural (emite NF-e)</label>
                      <input
                        id="consumidorIe"
                        className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm font-mono"
                        placeholder="Não é produtor"
                        value={consumidorIe}
                        maxLength={20}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setConsumidorIe(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 mb-1">Desconto</label>
                      <NumberField scale={2} value={descontoTotal} onChange={setDescontoTotal} className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 mb-1">Acréscimo</label>
                      <NumberField scale={2} value={acrescimoTotal} onChange={setAcrescimoTotal} className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm" />
                    </div>
                  </div>
                  <Toggle checked={discriminar} onChange={setDiscriminar} label="Mostrar desconto/acréscimo no documento" size="sm" />
                  {intermediadores.some((i) => i.tipo === 'T' && i.ativo) && (
                    <div>
                      <label className="block text-xs font-semibold text-stone-500 mb-1">Intermediador da transação</label>
                      <select className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm" value={interTransacao} onChange={(e) => setInterTransacao(Number(e.target.value))}>
                        <option value={0}>Nenhum (venda direta)</option>
                        {intermediadores.filter((i) => i.tipo === 'T' && i.ativo).map((i) => (
                          <option key={i.id} value={i.id}>{i.codigo} - {i.nome_fantasia}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Forma de Pagamento */}
                {!isFullyPaid && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="block text-xs font-semibold text-stone-500">Forma de Pagamento</span>
                        <span className="text-[9px] text-stone-500 font-medium">Setas [↑ / ↓] para escolher</span>
                      </div>
                      <div className="border border-stone-200 rounded-lg divide-y divide-stone-200 overflow-hidden max-h-56 overflow-y-auto">
                        {MEIOS_PAGAMENTO.map(({ codigo: form, nome }) => {
                          const isSelected = paymentForm === form;
                          return (
                            <button
                              key={form}
                              ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                              type="button"
                              onClick={() => {
                                setPaymentForm(form);
                                openPaymentValueModal();
                              }}
                              className={`w-full flex items-center justify-between px-3 py-3 text-sm font-semibold transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-stone-700 hover:bg-stone-100'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white animate-pulse' : 'bg-stone-300'}`} />
                                <span className="uppercase tracking-wide">{nome}</span>
                              </div>
                              {isSelected && <span className="text-[9px] font-semibold bg-blue-700 px-1.5 py-0.5 rounded text-white animate-pulse">Ativo</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-center py-2 mt-3 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg">
                        Pressione [ENTER] ou toque para lançar o valor
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista de Pagamentos Lançados */}
                {payments.length > 0 && (
                  <div className="space-y-1.5 font-sans">
                    <span className="block text-xs font-semibold text-stone-500">Pagamentos Lançados</span>
                    <div className="border border-stone-200 rounded-lg divide-y divide-stone-200 overflow-hidden max-h-28 overflow-y-auto">
                      {payments.map((p) => (
                        <div key={p.id} className="flex justify-between items-center p-2 bg-white text-[10px]">
                          <span className="font-semibold text-stone-700 uppercase truncate">
                            {nomeMeioPagamento(p.tPag)}
                            <span className="text-stone-400 normal-case font-normal"> · {intermediadores.find((i) => i.id === p.intermediadorId)?.nome_fantasia}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-stone-900">{formatCurrency(p.valor)}</span>
                            <button
                              type="button"
                              onClick={() => removePayment(p.id)}
                              className="text-stone-400 hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                              title="Remover pagamento"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Troco acumulado se ultrapassar com dinheiro */}
                {totalPago > total && payments.some(p => p.tPag === '01') && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                    <span className="block text-sm font-black text-emerald-800 uppercase tracking-widest mb-1">Troco</span>
                    <span className="text-5xl font-black text-emerald-700 tracking-tight font-mono">
                      {formatCurrency(round2(totalPago - total))}
                    </span>
                  </div>
                )}

                {/* Botão Finalizar Cupom definitivo */}
                {isFullyPaid && (
                  <div className="space-y-2 bg-stone-50 p-3 rounded-lg border border-stone-200 mt-4">
                    <span className="block text-center text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">
                      Selecione com as setas ▲ ▼ e confirme com ENTER
                    </span>
                    <button
                      type="button"
                      onClick={() => handleFinalize(true)}
                      disabled={emitindo}
                      className={`w-full flex items-center justify-between gap-1.5 px-4 py-3 rounded-lg text-sm border transition-colors cursor-pointer ${
                        isPrintSelected
                          ? 'bg-emerald-600 border-emerald-600 text-white font-bold'
                          : 'bg-white border-stone-300 text-stone-500 font-medium hover:bg-stone-100'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <CheckCircle size={16} />
                        {emitindo ? 'Emitindo…' : 'Emitir e imprimir DANFE (F2)'}
                      </span>
                      {isPrintSelected && (
                        <span className="text-[10px] bg-emerald-700 px-2 py-0.5 rounded font-bold tracking-wider">
                          ▲ SELECIONADO ▼
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalize(false)}
                      disabled={emitindo}
                      className={`w-full flex items-center justify-between gap-1.5 px-4 py-3 rounded-lg text-sm border transition-colors cursor-pointer ${
                        !isPrintSelected
                          ? 'bg-stone-800 border-stone-800 text-white font-bold'
                          : 'bg-white border-stone-300 text-stone-500 font-medium hover:bg-stone-100'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <CheckCircle size={16} />
                        {emitindo ? 'Emitindo…' : 'Emitir sem imprimir'}
                      </span>
                      {!isPrintSelected && (
                        <span className="text-[10px] bg-stone-600 px-2 py-0.5 rounded font-bold tracking-wider text-white">
                          ▲ SELECIONADO ▼
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 relative shrink-0">
                  
                  {/* EAN Input */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label htmlFor="codigoEan" className="block text-xs font-semibold text-stone-500">
                        Código de Barras (EAN)
                        <span className="ml-2 font-normal text-stone-400">F3 quantidade · F6 cancelar item · 00 ajuda</span>
                      </label>
                      {askForQuantity && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded animate-pulse uppercase tracking-wide">
                          Informar Quantidade
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="codigoEan"
                        ref={eanInputRef}
                        type="text"
                        className="w-full pl-11 pr-4 py-3.5 bg-blue-500/[0.03] disabled:bg-stone-50 outline-none transition-all text-lg font-mono text-stone-800 placeholder:font-sans placeholder:text-stone-400"
                        placeholder="Escaneie o EAN e pressione Enter..."
                        value={ean}
                        onChange={e => setEan(e.target.value)}
                        onKeyDown={handleEanKeyDown}
                        disabled={isLoading}
                      />
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                        <Search size={22} />
                      </div>
                    </div>
                  </div>

                  {/* Loading State */}
                  {isLoading && (
                    <div className="py-8 text-center text-stone-500 flex flex-col items-center gap-3 animate-in fade-in">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm font-medium">Buscando produto...</span>
                    </div>
                  )}

                  {/* Found Product Card */}
                  {currentProduct && !isLoading && (
                    <div className="bg-white border border-stone-200 border-l-2 border-l-blue-600 rounded-lg p-4 animate-in fade-in">
                      <div className="flex justify-between items-start mb-4">
                        <div className="pr-3">
                           <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Produto Encontrado</p>
                           <h3 className="font-bold text-stone-900 text-lg leading-tight line-clamp-2">{currentProduct.nome}</h3>
                           {currentProduct.codigo_barras && <p className="text-[11px] text-stone-400 mt-1.5 font-mono">{currentProduct.codigo_barras}</p>}
                        </div>
                        <div className="text-right shrink-0">
                           <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1">Preço (R$)</p>
                           <p className="font-bold text-blue-700 text-2xl tracking-tight">
                             {formatCurrency(currentProduct.preco_venda)}
                           </p>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-stone-200 flex items-end gap-3">
                        <div className="w-28">
                          <label htmlFor="quantidade" className="block text-xs font-semibold text-stone-500 mb-1">
                            {porKg(currentProduct) ? 'Peso (kg)' : 'Qtd'}
                          </label>
                          <input
                            id="quantidade"
                            ref={qtyInputRef}
                            type="tel"
                            className="w-full px-3 h-[48px] bg-blue-500/[0.03] disabled:bg-stone-50 text-lg text-center font-bold text-stone-900 outline-none transition-all"
                            value={pesando ? '' : quantidadeText}
                            placeholder={pesando ? 'Pesando…' : '0,000'}
                            readOnly={pesando}
                            onChange={e => handleQtyChange(e.target.value)}
                            onKeyDown={handleQtyKeyDown}
                            onFocus={e => e.target.select()}
                            disabled={Number(valorItem) > 0}
                          />
                        </div>
                        {porKg(currentProduct) && balancaDoCaixa() && (
                          <button
                            type="button"
                            onClick={() => pesar(true)}
                            disabled={pesando || Number(valorItem) > 0}
                            title="Ler a balança de novo (*)"
                            className={`${BOTAO_SECUNDARIO} h-[48px] text-sm`}
                          >
                            <Scale size={18} className={pesando ? 'animate-pulse' : ''} />
                            Pesar
                          </button>
                        )}
                        <div className="w-32">
                          <label htmlFor="valorItem" className="block text-xs font-semibold text-stone-500 mb-1">
                            Ou valor total
                          </label>
                          <NumberField
                            id="valorItem"
                            scale={2}
                            value={valorItem}
                            onChange={setValorItem}
                            className="w-full px-3 h-[48px] bg-blue-500/[0.03] disabled:bg-stone-50 text-lg font-bold text-stone-900 outline-none"
                          />
                        </div>
                        <button
                          onClick={addToCart}
                          disabled={pesando || (quantidade <= 0 && !(Number(valorItem) > 0))}
                          className={`${BOTAO_PRIMARIO} flex-1 h-[48px] text-sm`}
                        >
                          <Plus size={18} strokeWidth={3} />
                          Confirmar Item
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Último item lançado, grande para o caixa conferir de longe */}
                  {!currentProduct && !isLoading && cart.length > 0 && (() => {
                    const ultimo = cart[cart.length - 1];
                    const q = qtdTexto(ultimo.quantidade, ultimo.product);
                    return (
                      <div className="mt-5 bg-white border border-stone-200 border-l-4 border-l-amber-500 rounded-lg p-5 animate-in fade-in">
                        <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-2">
                          Último item · {String(cart.length).padStart(3, '0')}
                        </p>
                        <h3 className="font-bold text-stone-900 text-2xl leading-tight line-clamp-2">{ultimo.product.nome}</h3>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <p className="text-base text-stone-500 font-mono">
                            {q} {unTexto(ultimo.quantidade, ultimo.product)} × {formatCurrency(ultimo.product.preco_venda)}
                          </p>
                          <p className="text-3xl font-bold text-stone-900 tracking-tight">{formatCurrency(ultimo.subtotal)}</p>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            )}

            {/* Promoções e datas comemorativas (BM-Master → Imagens do PDV) */}
            {!isCheckoutOpen && <Vitrine />}
         </div>

         {/* Right Side: Receipt List */}
         <div className="md:w-[55%] lg:w-[60%] bg-white flex flex-col min-h-0">
           <div className="flex-1 flex flex-col p-5 min-h-0">
            <div className="flex justify-between items-center mb-3 shrink-0">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                Cupom Fiscal
              </h2>
              {cart.length > 0 && (
                <span className="bg-stone-100 text-stone-600 border border-stone-200 font-semibold text-[11px] py-0.5 px-2 rounded-full">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-stone-400 space-y-4 bg-[#FFFFC7] border border-stone-200 rounded-lg min-h-0">
                <Printer size={56} className="text-stone-300" />
                <p className="text-sm font-semibold">O cupom está vazio</p>
                <p className="text-xs text-stone-400 text-center max-w-xs">Escaneie um código de barras para adicionar um produto à venda.</p>
              </div>
            ) : (
              <div ref={listaCupomRef} className="flex-1 overflow-y-auto relative min-h-0 bg-[#FFFFC7] border border-stone-200 rounded-lg divide-y divide-stone-200">
                {cart.map((item, index) => (
                  <div
                    key={item.cartId}
                    onClick={() => !isCheckoutOpen && setEditandoItem(item.cartId)}
                    title={isCheckoutOpen ? undefined : 'Alterar valor'}
                    data-dica-desc="Desconto ou acréscimo no item, pelo unitário ou pelo total"
                    className={`group flex justify-between items-center px-4 py-3 hover:bg-white/70 transition-colors ${index === cart.length - 1 ? 'bg-amber-200/50 border-l-4 border-l-amber-500' : ''} ${isCheckoutOpen ? '' : 'cursor-pointer'}`}
                  >
                    <div className="flex-1 pr-4 truncate">
                      <div className="flex items-start gap-4">
                          <span className="text-sm font-mono text-stone-400 font-bold mt-0.5 w-8 shrink-0">
                            {(index + 1).toString().padStart(3, '0')}
                          </span>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-stone-900 text-base truncate">{item.product.nome}</h4>
                            <p className="text-sm text-stone-500 mt-1 font-mono">
                              <span className="font-semibold text-stone-700">{qtdTexto(item.quantidade, item.product)}</span> {unTexto(item.quantidade, item.product)} x {formatCurrency(item.product.preco_venda)}
                              {(() => {
                                const dif = round2(item.subtotal - totalDoItem(item.quantidade, precoDe(item.product), item.product.iat));
                                return dif ? <span className={dif < 0 ? 'text-rose-600' : 'text-blue-700'}> · {dif < 0 ? 'desc.' : 'acrésc.'} {formatCurrency(Math.abs(dif))}</span> : null;
                              })()}
                            </p>
                          </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-bold text-stone-900 tracking-tight text-xl">
                        {formatCurrency(item.subtotal)}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.cartId); }}
                        className="text-stone-400 hover:text-rose-600 hover:bg-rose-50 p-2.5 rounded-lg transition-colors cursor-pointer"
                        title="Remover item"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total: faixa chapada no pé do cupom, alinhada com ele */}
            <div className="mt-3 bg-[#3c60a3] text-white rounded-lg px-5 pt-5 pb-4 shrink-0">
               <div className="flex justify-between items-end mb-4 mt-[7px]">
                  <p className="text-[42px] leading-[43px] font-[Verdana] font-bold tracking-tight text-blue-100 -mt-[3px] -mb-[13px]">TOTAL</p>
                  <p className="text-[42px] leading-[43px] font-[Verdana] font-bold tracking-tighter text-[#ffffff] -mt-[3px] -mb-[13px]">{formatCurrency(total)}</p>
               </div>
            </div>
           </div>
         </div>
        </div>

        {/* Action Footer */}
        <div className="w-full bg-stone-50 border-t border-stone-200 px-4 py-3 flex flex-wrap gap-2.5 items-center justify-between relative shrink-0 [&_button]:min-h-11 [&_button]:text-sm">
           <div className="flex flex-wrap gap-2.5">
             <button  
                onClick={() => {
                  if (cart.length > 0) {
                    if (isCheckoutOpen) {
                      if (isFullyPaid) {
                        handleFinalize(isPrintSelected);
                      }
                    } else {
                      openCheckout();
                    }
                  }
                }}
                disabled={cart.length === 0 || (isCheckoutOpen && !isFullyPaid)}
                className={`${BOTAO} border ${
                  isCheckoutOpen
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600'
                    : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                }`}
             >
                <CheckCircle size={16} />
                {isCheckoutOpen ? 'Confirmar e Emitir (F2)' : 'Finalizar Cupom (F2)'}
             </button>
             <button 
                onClick={cancelarCupom}
                disabled={cart.length === 0}
                className={`${BOTAO} border text-rose-600 border-rose-200 hover:bg-rose-50`}
             >
                <Trash2 size={18} />
                Cancelar Cupom
             </button>
             <button
               onClick={() => setCancelarItem(String(cart.length))}
               disabled={cart.length === 0 || isCheckoutOpen}
               className={`${BOTAO} border text-rose-600 border-rose-200 hover:bg-rose-50`}
             >
                <X size={18} />
                Cancelar Item (F6)
             </button>
             <button 
               onClick={() => {
                 setIsConsultaOpen(true);
                 setTimeout(() => consultaInputRef.current?.focus(), 100);
               }}
               className={BOTAO_SECUNDARIO}
             >
                <Search size={18} />
                Consulta Preço (F5)
             </button>
             <button 
               onClick={() => setIsStandby(true)}
               disabled={cart.length > 0}
               className={BOTAO_SECUNDARIO}
             >
                                Caixa Livre (F4)
             </button>
           </div>
           
           <div className="flex flex-wrap gap-2.5 relative">
             {/* Funções de gerência fora da vista do caixa */}
             <div className="relative">
               <button
                 type="button"
                 onClick={() => setMaisAberto(!maisAberto)}
                 className={`${BOTAO} border ${maisAberto ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-stone-600 border-stone-300 hover:bg-stone-100'}`}
               >
                 <MoreHorizontal size={16} />
                 Mais
                 {maisAberto ? <ChevronDown size={14} className="ml-1 opacity-70" /> : <ChevronUp size={14} className="ml-1 opacity-70" />}
               </button>
               {maisAberto && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={menuMais.fechar} />
                   <div ref={menuMais.lista} role="menu" onKeyDown={menuMais.teclas} className="absolute bottom-full right-0 mb-2 w-72 py-1 bg-white rounded-lg shadow-xl border border-stone-200 overflow-hidden z-50">
                     {([
                       [RefreshCw, isSyncing ? 'Sincronizando…' : 'Sincronizar produtos', `${localProductsCount} produtos neste caixa`, () => syncProducts(), isSyncing],
                       [FileText, 'Notas emitidas', '', () => setIsNfceListOpen(true), false],
                       [Package, 'Intermediadores', 'Pagamento e transação', () => setIsIntermediadoresOpen(true), false],
                       [Monitor, telaClienteLembrada() ? 'Fechar a tela do cliente' : 'Abrir a tela do cliente', 'Cupom e total no segundo monitor', () => (telaClienteLembrada() ? fecharTelaCliente() : void abrirTelaCliente()), false],
                       [Scale, 'Configurar balança', balancaDoCaixa() ? 'Escolher a porta (COM) da balança' : 'Caixa sem balança no cadastro', () =>
                         escolherPorta()
                           .then(() => toast.success('Porta da balança guardada neste computador.'))
                           .catch((e) => e?.name !== 'NotFoundError' && showErrorToast(e instanceof Error ? e.message : String(e))), !balancaDoCaixa()],
                       [Keyboard, tecladoLigado() ? 'Desligar o teclado virtual' : 'Ligar o teclado virtual', 'Para telas touch sem teclado', () => ligarTeclado(!tecladoLigado()), false],
                     ] as const).map(([Icone, nome, desc, acao, bloqueado], n) => (
                       <button
                         key={nome}
                         type="button"
                         role="menuitem"
                         disabled={bloqueado}
                         onClick={() => {
                           setMaisAberto(false);
                           acao();
                         }}
                         className={ITEM_MENU}
                       >
                         <span className={NUMERO_MENU}>{n + 1}</span>
                         <Icone size={16} className="text-blue-600 shrink-0" />
                         <span className="flex flex-col">
                           {nome}
                           {desc && <span className="text-[11px] text-stone-400 font-normal">{desc}</span>}
                         </span>
                       </button>
                     ))}
                   </div>
                 </>
               )}
             </div>
             <MenuFiscal aberto={isMenuFiscalOpen} setAberto={setIsMenuFiscalOpen} />
             {categoriaAberta && (
               <PesquisaCategoria
                 onFechar={() => {
                   setCategoriaAberta(false);
                   setTimeout(() => eanInputRef.current?.focus(), 50);
                 }}
                 onEscolher={(p) => {
                   // Como no F3: o produto fica à espera da quantidade (peso) ou do valor total
                   setCategoriaAberta(false);
                   setEan('');
                   pedirQuantidade(p);
                 }}
               />
             )}
           </div>
        </div>
          </>
        )}
      </div>

      {/* Startup / Abertura de Caixa & Banco de Dados Modal */}
      {isStartupModalOpen && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[150] overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-white border border-stone-200 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 my-8">
            <div className="px-5 py-4 border-b border-stone-200">
              <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Database size={18} className="text-blue-600" />
                Abertura de Caixa
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Bem-vindo ao PDV Cupom! Informe o valor do troco em caixa para iniciar o fluxo de vendas.
              </p>
              <p className="text-[10px] font-black tracking-widest text-stone-400 mt-2">MENU FISCAL INACESSÍVEL NESTA TELA</p>
            </div>

            <div className="p-5 space-y-6 overflow-y-auto max-h-[70vh]">
              {/* Troco em Caixa Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-stone-500">Troco inicial (fundo de caixa)</h4>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Informe a quantidade de dinheiro físico em caixa para iniciar o fluxo diário e fornecer o troco aos clientes.
                </p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 font-bold text-lg">R$</span>
                  <input
                    type="text"
                    value={startingTroco}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (!val) {
                        setStartingTroco("0,00");
                        return;
                      }
                      const floatVal = parseFloat(val) / 100;
                      setStartingTroco(floatVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                    }}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      abrirCaixa();
                    }}
                    className="w-full pl-12 pr-4 py-3 bg-blue-500/[0.03] outline-none text-2xl font-mono text-stone-800 transition-all font-bold"
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setIsStartupModalOpen(false);
                  toast.info('Modo de demonstração ativado. Lembre-se de abrir o caixa para iniciar suas vendas.');
                }}
                className={BOTAO_SECUNDARIO}
              >
                Ignorar por Enquanto
              </button>
              
              <button
                type="button"
                onClick={abrirCaixa}
                className={BOTAO_PRIMARIO}
              >
                <CheckCircle size={16} />
                <span>Iniciar Caixa e Abrir Vendas</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pesquisa Produto Modal */}
      {isPesquisaOpen && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div role="dialog" aria-modal="true" className="bg-white border border-stone-200 rounded-2xl shadow-2xl w-full max-w-2xl h-[650px] max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
             <div className="flex justify-between items-center px-5 py-4 border-b border-stone-200 shrink-0">
                <h3 className="text-base font-bold flex items-center gap-2 text-stone-900">
                  <Search size={18} className="text-blue-600" />
                  Pesquisa de Produtos
                </h3>
                <MenuFiscalInacessivel />
                <button 
                  onClick={closePesquisa}
                  title="Fechar (Esc)"
                  className="p-1 rounded text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={16} />
                </button>
             </div>
             
             <div className="px-5 pt-4 pb-3 shrink-0 relative bg-white">
                <input
                  ref={pesquisaInputRef}
                  type="text"
                  className="w-full px-4 py-3 bg-blue-500/[0.03] outline-none transition-all text-lg font-medium text-stone-800 placeholder:font-normal placeholder:text-stone-400"
                  placeholder="Digite a descrição do produto..."
                  value={pesquisaQuery}
                  onChange={e => handlePesquisaChange(e.target.value)}
                  onKeyDown={handlePesquisaKeyDown}
                />
             </div>
             
             <div className="flex-1 overflow-y-auto px-5 pb-5">
               {pesquisaResults.length > 0 ? (
                 <div className="border border-stone-200 rounded-lg divide-y divide-stone-200 overflow-hidden">
                   {pesquisaResults.map((product, idx) => {
                     const isSelected = idx === selectedIndex;
                     return (
                     <div 
                       key={product.id}
                       ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                       onClick={() => selectPesquisaItem(product)}
                       className={`flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 gap-4 cursor-pointer transition-colors border-l-2 ${isSelected ? 'bg-blue-50 border-l-blue-600' : 'bg-white border-l-transparent hover:bg-stone-50'}`}
                     >
                       <div>
                         <p className="text-[11px] text-stone-400 font-mono uppercase mb-0.5">
                           EAN: {product.codigo_barras || product.id}
                         </p>
                         <h4 className="text-sm font-bold text-stone-900">{product.nome}</h4>
                       </div>
                       <div className="text-emerald-700 text-right self-start sm:self-auto shrink-0 min-w-[120px]">
                         <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 block">Preço</span>
                         <span className="font-mono font-bold text-lg">{formatCurrency(
                            typeof product.preco_venda === 'string' ? parseFloat(product.preco_venda) : product.preco_venda
                         )}</span>
                       </div>
                     </div>
                   )})}
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-stone-400">
                   <Package size={64} className="mb-4 opacity-20" />
                   <p className="text-lg font-medium">{pesquisaQuery ? 'Nenhum produto encontrado.' : 'Digite para iniciar a busca'}</p>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}



      {/* Modal de Digitação de Valor do Pagamento */}
      {isPaymentValueModalOpen && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[150] animate-in fade-in duration-200">
          <div role="dialog" aria-modal="true" className="bg-white border border-stone-200 rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg tracking-wider uppercase">
                {nomeMeioPagamento(paymentForm)}
              </span>
              <button 
                onClick={closePaymentValueModal}
                title="Fechar (Esc)"
                className="p-1 rounded text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="mb-5 space-y-1">
              <h4 className="text-base font-bold text-stone-900">Digite o valor do pagamento</h4>
              <p className="text-xs text-stone-500 flex justify-between">
                <span>Restante a pagar:</span>
                <span className="font-bold font-mono text-emerald-700">
                  {formatCurrency(remainingValue)}
                </span>
              </p>
            </div>

            <div className="relative mb-5">
              <NumberField
                inputRef={paymentValueInputRef}
                scale={2}
                className="w-full bg-blue-500/[0.03] text-stone-900 pl-14 pr-4 py-3 text-3xl font-bold outline-none"
                value={paymentValue}
                onChange={setPaymentValue}
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg font-bold text-stone-400">R$</span>
            </div>

            {/* Intermediador do pagamento e dados do cartão (Requisito XI) */}
            <div className="space-y-3 mb-5 text-xs">
              <div>
                <label className="block text-xs font-semibold text-stone-500 mb-1">Intermediador do pagamento</label>
                <select
                  className="w-full bg-blue-500/[0.03] disabled:bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800"
                  value={payInter}
                  onChange={(e) => setPayInter(Number(e.target.value))}
                >
                  {!payInter && <option value={0}>Escolha…</option>}
                  {intermediadoresPagamento.map((i) => (
                    <option key={i.id} value={i.id}>{i.codigo} - {i.nome_fantasia}</option>
                  ))}
                </select>
              </div>
              {meioTef && (
                <Toggle checked={cartaoAMao} onChange={setCartaoAMao} size="sm" label="Lançar à mão, sem TEF (maquininha à parte)" />
              )}
              {meioPixBanco && (
                <Toggle checked={cartaoAMao} onChange={setCartaoAMao} size="sm" label="Lançar à mão, sem cobrança no banco (PIX conferido pelo caixa)" />
              )}
              {meioCartao && !viaTef && !viaPixBanco && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-stone-500 mb-1">Bandeira</label>
                    <select className="w-full bg-blue-500/[0.03] disabled:bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800" value={payBandeira} onChange={(e) => setPayBandeira(e.target.value)}>
                      <option value="">Não informada</option>
                      {BANDEIRAS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-500 mb-1">Autorização</label>
                    <input
                      className="w-full bg-blue-500/[0.03] disabled:bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800 font-mono"
                      value={payAutorizacao}
                      maxLength={128}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setPayAutorizacao(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-[1fr_70px] gap-2">
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">CNPJ onde o pagamento foi processado</label>
                  <input
                    className="w-full bg-blue-500/[0.03] disabled:bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800 font-mono"
                    inputMode="numeric"
                    placeholder="Opcional"
                    value={payCnpj}
                    maxLength={14}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setPayCnpj(digitos(e.target.value).slice(0, 14))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">UF</label>
                  <input
                    className="w-full bg-blue-500/[0.03] disabled:bg-stone-50 px-3 py-2 text-sm font-medium text-stone-800 font-mono uppercase"
                    value={payUf}
                    maxLength={2}
                    disabled={!payCnpj}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setPayUf(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  />
                </div>
              </div>
            </div>

            {/* Troco preview if value exceeds remaining amount and paymentform is Dinheiro */}
            {paymentForm === '01' && !isNaN(parseFloat(paymentValue.replace(',', '.'))) && round2(parseFloat(paymentValue.replace(',', '.'))) > remainingValue && (
              <div className="mb-5 text-[11px] font-semibold text-emerald-700 flex justify-between items-center bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                <span>Troco Previsto:</span>
                <span className="font-mono font-bold text-sm">
                  {formatCurrency(round2(parseFloat(paymentValue.replace(',', '.')) - remainingValue))}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 shrink-0">
              <button 
                type="button"
                onClick={closePaymentValueModal}
                className={`${BOTAO_SECUNDARIO} w-full`}
              >
                Voltar (Esc)
              </button>
              <button 
                type="button"
                onClick={addPayment}
                className={`${BOTAO} w-full bg-emerald-600 hover:bg-emerald-700 text-white`}
              >
                Lançar (Enter)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Troco (Change Modal) */}
      {isChangeModalOpen && (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[160] animate-in fade-in duration-200">
          <div role="dialog" aria-modal="true" className="bg-white border border-stone-200 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 flex flex-col text-center">
            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full tracking-widest uppercase mx-auto mb-3">
              TROCO REQUERIDO
            </span>

            <h3 className="text-base font-bold text-stone-900 mb-4">Troco do Cliente</h3>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg py-8 px-6 mb-6">
              <div className="text-3xl sm:text-4xl lg:text-5xl font-mono font-black text-emerald-700 tracking-tight uppercase">
                TROCO: {formatCurrency(changeAmount)}
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-stone-500">
                Pressione <span className="font-bold text-stone-700 px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded">ENTER</span> ou clique em prosseguir
              </p>
              
              <button 
                type="button"
                onClick={confirmChange}
                className={`${BOTAO} w-full py-3 text-sm bg-emerald-600 hover:bg-emerald-700 text-white`}
              >
                Prosseguir (Enter)
              </button>
              
              <button 
                type="button"
                onClick={() => {
                  setIsChangeModalOpen(false);
                  setTimeout(() => {
                    if (paymentValueInputRef.current) {
                      paymentValueInputRef.current.focus();
                      paymentValueInputRef.current.select();
                    }
                  }, 100);
                }}
                className={`${BOTAO_SECUNDARIO} w-full`}
              >
                Ajustar Valor (Esc)
              </button>
            </div>
          </div>
        </div>
      )}


      {pix && (
        <PixBanco
          valor={pix.valor}
          referencia={idVendaRef.current}
          onFim={(r, erro) => {
            setPix(null);
            if (r) {
              // tpIntegra 1, CNPJ do banco que recebeu (vem do BMBancos) e o endToEndId como autorização
              commitPayment(pix.valor, { cnpjCredenciadora: r.cnpj, autorizacao: r.endToEndId || r.txid, comprovantes: [], pixTxid: r.txid });
              toast.success('PIX recebido.');
            } else {
              showErrorToast('PIX não recebido.', { description: `${erro} Com o banco fora do ar, ligue "Lançar à mão" e confira o PIX no app do banco.` });
              openPaymentValueModal();
            }
          }}
        />
      )}

      {tef && sitef && tefDocRef.current && (
        <TefSitef
          config={sitef}
          documento={tefDocRef.current}
          funcao={tef.funcao}
          valor={tef.valor}
          operador={usuario.userName || ''}
          titulo={`TEF · ${nomeMeioPagamento(paymentForm)}`}
          onFim={(r, erro) => {
            setTef(null);
            if (r) {
              commitPayment(tef.valor, r);
              toast.success('Pagamento aprovado no TEF.');
            } else {
              showErrorToast('Pagamento não aprovado no TEF.', { description: `${erro} Com o TEF fora do ar, ligue "Lançar à mão" e passe na maquininha.` });
              openPaymentValueModal();
            }
          }}
        />
      )}

      {cancelarItem !== null && (
        <Janela
          titulo="Cancelar item"
          onFechar={() => setCancelarItem(null)}
          largura="max-w-xs"
          rodape={
            <>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setCancelarItem(null)}>Voltar (Esc)</button>
              <button type="submit" form="form-cancelar-item" className={`${BOTAO} bg-rose-600 text-white hover:bg-rose-700`}>Cancelar item</button>
            </>
          }
        >
          <form
            id="form-cancelar-item"
            onSubmit={(e) => {
              e.preventDefault();
              const it = cart[Number(cancelarItem) - 1];
              if (!it) return showErrorToast(`O cupom não tem o item ${cancelarItem}.`);
              setCancelarItem(null);
              removeFromCart(it.cartId).then(() => eanInputRef.current?.focus());
            }}
          >
            <label htmlFor="numeroItem" className="block text-xs font-semibold text-stone-500 mb-1">Número do item (1 a {cart.length})</label>
            <input
              id="numeroItem"
              autoFocus
              inputMode="numeric"
              className="w-full px-3 h-[48px] bg-blue-500/[0.03] text-2xl text-center font-mono font-bold text-stone-900 outline-none"
              value={cancelarItem}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setCancelarItem(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            {cart[Number(cancelarItem) - 1] && <p className="mt-2 text-sm text-stone-700 text-center truncate">{cart[Number(cancelarItem) - 1].product.nome}</p>}
          </form>
        </Janela>
      )}

      {editandoItem && (() => {
        const it = cart.find((c) => c.cartId === editandoItem);
        if (!it) return null;
        return (
          <EditarItem
            nome={it.product.nome}
            quantidade={it.quantidade}
            precoTabela={precoDe(it.product)}
            iat={it.product.iat}
            valorTotal={it.subtotal}
            onFechar={() => setEditandoItem(null)}
            onSalvar={(novo) => {
              setCart((c) => c.map((x) => x.cartId !== it.cartId ? x : {
                ...x,
                valorTotal: novo ?? undefined,
                subtotal: novo ?? totalDoItem(x.quantidade, precoDe(x.product), x.product.iat),
              }));
              setEditandoItem(null);
            }}
          />
        );
      })()}

      {ajudaAberta && (
        <Janela
          titulo="Atalhos do caixa"
          onFechar={() => { setAjudaAberta(false); setTimeout(() => eanInputRef.current?.focus(), 50); }}
          largura="max-w-md"
        >
          <p className="text-xs text-stone-500 mb-3">Digite o código no campo do código de barras e pressione Enter. Qualquer tecla fecha esta tela.</p>
          <table className="w-full text-sm">
            <tbody>
              {[...CODIGOS, ...TECLAS.map(([t, d]) => [t, '', d] as const)].map(([c, , desc], i) => (
                <tr key={c} className={`border-b border-stone-100 ${i === CODIGOS.length ? 'border-t-2 border-t-stone-200' : ''}`}>
                  <td className="py-1.5 pr-4 w-16 font-mono font-bold text-blue-700">{c}</td>
                  <td className="py-1.5 text-stone-800">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Janela>
      )}

      {isIntermediadoresOpen && (
        <Intermediadores onFechar={() => { setIsIntermediadoresOpen(false); carregarIntermediadores(); }} />
      )}

{/* Confirm Dialog */}
      {confirmDialog.isOpen && (
        <div className="relative z-[300]">
          <ConfirmDialog
            titulo="Confirmação"
            mensagem={confirmDialog.message}
            confirmar="Sim"
            cancelar="Não"
            tom={/^(Remover|Cancelar)/.test(confirmDialog.message) ? 'perigo' : 'normal'}
            onConfirmar={confirmDialog.onConfirm}
            onCancelar={confirmDialog.onCancel}
          />
        </div>
      )}

    </div>
  );
}
