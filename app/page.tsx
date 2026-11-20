import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { ShoppingCart, Search, Plus, Trash2, Printer, CheckCircle, RefreshCw, Database, Menu, ChevronUp, ChevronDown, FileText, X, Package, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { dataHoraSql, dataSql } from '@/lib/dataHora';
import { MEIOS_PAGAMENTO, nomeMeioPagamento, totalDoItem, modeloDoDocumento, digitos, cpfValido, cnpjValido } from '@/lib/fiscal';
import { imprimirDanfe, erroDe } from '@/lib/arquivos';
import { MenuFiscal, MenuFiscalInacessivel } from '@/components/MenuFiscal';
import { NotasPdv } from '@/components/NotasPdv';
import { Intermediadores, Intermediador } from '@/components/Intermediadores';
import { EditarItem } from '@/components/EditarItem';
import { Toggle } from '@/components/Toggle';
import { NumberField } from '@/components/NumberField';
import { db, LocalProduct, substituirProdutos, buscarProdutos } from '@/lib/localDB';

interface Product {
  id: number;
  nome: string;
  codigo_barras: string;
  preco_venda: string | number;
  iat?: string | null;
}

interface CartItem {
  cartId: string;
  product: Product;
  quantidade: number;
  subtotal: number;
  /** Total negociado ou informado (valor total, etiqueta de balança); sem ele vale quantidade × preço */
  valorTotal?: number;
}

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
}

export default function POSPage({ usuario, onSair }: { usuario: UsuarioPdv; onSair: () => void }) {
  const [ean, setEan] = useState('');
  const [quantidade, setQuantidade] = useState<number>(1);
  const [quantidadeText, setQuantidadeText] = useState('1,00');
  
  const handleQtyChange = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (!digits) {
      setQuantidadeText('');
      setQuantidade(0);
      return;
    }
    const numValue = parseInt(digits, 10) / 100;
    setQuantidadeText(
      new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numValue)
    );
    setQuantidade(numValue);
  };
  
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
  const consultaInputRef = useRef<HTMLInputElement>(null);

  const [isStartupModalOpen, setIsStartupModalOpen] = useState(true);
  const [startingTroco, setStartingTroco] = useState('0,00');
  const [caixaFund, setCaixaFund] = useState<number>(0);

  const [isNfceListOpen, setIsNfceListOpen] = useState(false);
  const [isIntermediadoresOpen, setIsIntermediadoresOpen] = useState(false);

  const [isPesquisaOpen, setIsPesquisaOpen] = useState(false);
  const [pesquisaQuery, setPesquisaQuery] = useState('');
  const [pesquisaResults, setPesquisaResults] = useState<LocalProduct[]>([]);
  const pesquisaInputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const [askForQuantity, setAskForQuantity] = useState(false);
  
  const [cart, setCart] = useState<CartItem[]>([]);
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
    /** 1 = TEF integrado ao PDV, 2 = maquininha à parte */
    integracao?: number;
  }
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState('01');
  const [paymentValue, setPaymentValue] = useState('');
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [isPaymentValueModalOpen, setIsPaymentValueModalOpen] = useState(false);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [isDebitCardModalOpen, setIsDebitCardModalOpen] = useState(false);
  const [debitCardValue, setDebitCardValue] = useState(0);
  const [isApiResultModalOpen, setIsApiResultModalOpen] = useState(false);
  const [apiResult, setApiResult] = useState<any>(null);
  const [isSendingApi, setIsSendingApi] = useState(false);
  const [isPollingPayment, setIsPollingPayment] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
  const intermediadoresPagamento = intermediadores.filter((i) => i.tipo === 'P' && i.ativo);
  const meioCartao = !!MEIOS_PAGAMENTO.find((m) => m.codigo === paymentForm)?.cartao;

  const openCheckout = () => {
    setIsCheckoutOpen(true);
    setPayments([]);
    setPaymentForm('01');
    setIsPaymentValueModalOpen(false);
    setIsChangeModalOpen(false);
    setIsDebitCardModalOpen(false);
    setDebitCardValue(0);
    setIsApiResultModalOpen(false);
    setApiResult(null);
    setIsSendingApi(false);
    setIsPollingPayment(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setChangeAmount(0);
    setPaymentValue(total.toFixed(2));
    setIsPrintSelected(true);
  };

  const closeCheckout = () => {
    setIsCheckoutOpen(false);
    setPayments([]);
    setIsPaymentValueModalOpen(false);
    setIsChangeModalOpen(false);
    setIsDebitCardModalOpen(false);
    setDebitCardValue(0);
    setIsApiResultModalOpen(false);
    setApiResult(null);
    setIsSendingApi(false);
    setIsPollingPayment(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setChangeAmount(0);
    setPaymentValue('');
    setTimeout(() => {
      if (eanInputRef.current) eanInputRef.current.focus();
    }, 100);
  };

  const openPaymentValueModal = () => {
    const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
    const updatedRemaining = Math.max(0, round2(total - totalPago));
    setPaymentValue(updatedRemaining > 0 ? updatedRemaining.toFixed(2) : '0,00');
    setIsPaymentValueModalOpen(true);
    setTimeout(() => {
      if (paymentValueInputRef.current) {
        paymentValueInputRef.current.focus();
        paymentValueInputRef.current.select();
      }
    }, 100);
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

    if (paymentForm === '04') {
      setDebitCardValue(val);
      setIsDebitCardModalOpen(true);
      setIsPaymentValueModalOpen(false);
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

    commitPayment(val);
  };

  const pollPaymentStatus = (uniqueId: string) => {
    setIsPollingPayment(true);
    // Remove qualquer intervalo existente por segurança
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/supertef/status?uniqueid=${uniqueId}`);
        const result = await res.json();
        
        let paymentStatus = null;
        let paymentMessage = null;
        if (result?.data?.data?.payment_status !== undefined) {
          paymentStatus = result.data.data.payment_status;
          paymentMessage = result.data.data.payment_message;
        } else if (result?.data?.payment_status !== undefined) {
          paymentStatus = result.data.payment_status;
          paymentMessage = result.data.payment_message;
        }

        if (paymentStatus !== undefined && paymentStatus !== "1" && paymentStatus !== 1) {
          // Encerrar polling
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsPollingPayment(false);
          setIsSendingApi(false);
          
          if (paymentStatus === "4" || paymentStatus === 4) {
            commitPayment(debitCardValue, true);
            setIsDebitCardModalOpen(false);
            toast.success('Pagamento com cartão de débito aprovado!');
          } else if (paymentStatus === "5" || paymentStatus === 5) {
            showErrorToast(`Pagamento não aprovado: ${paymentMessage || 'Transação cancelada ou negada.'}`);
          } else {
            setApiResult(result);
            setIsApiResultModalOpen(true);
          }
        }
      } catch (error) {
        console.error('Erro ao consultar status:', error);
      }
    }, 5000);
  };

  const handleSendPaymentApi = async () => {
    setIsSendingApi(true);
    try {
      const res = await fetch('/api/supertef', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: debitCardValue })
      });
      const result = await res.json();
      
      const uniqueId = result?.data?.data?.payment_uniqueid || result?.data?.payment_uniqueid;

      const paymentStatus = result?.data?.data?.payment_status || result?.data?.payment_status;
      const paymentMessage = result?.data?.data?.payment_message || result?.data?.payment_message;

      if (paymentStatus === "4" || paymentStatus === 4) {
        commitPayment(debitCardValue, true);
        setIsDebitCardModalOpen(false);
        toast.success('Pagamento com cartão de débito aprovado!');
        setIsSendingApi(false);
      } else if (paymentStatus === "5" || paymentStatus === 5) {
        showErrorToast(`Pagamento não aprovado: ${paymentMessage || 'Transação cancelada ou negada.'}`);
        setIsSendingApi(false);
      } else if (uniqueId) {
        // Inicializar polling
        pollPaymentStatus(uniqueId);
      } else {
        // Falha ou modelo inesperado, exibe imediatamente
        setApiResult(result);
        setIsApiResultModalOpen(true);
        setIsSendingApi(false);
      }
    } catch (error) {
      console.error('Erro ao enviar pagamento:', error);
      setApiResult({
        success: false,
        error: 'Falha na requisição local ou de rede',
        details: error instanceof Error ? error.message : String(error)
      });
      setIsApiResultModalOpen(true);
      setIsSendingApi(false);
    }
  };

  const commitPayment = (val: number, integrado = false) => {
    const roundedVal = round2(val);
    const newPayment: PaymentItem = {
      id: Math.random().toString(),
      tPag: paymentForm,
      valor: roundedVal,
      intermediadorId: payInter,
      integracao: integrado ? 1 : 2,
      ...(meioCartao && payBandeira && { bandeira: payBandeira }),
      ...(meioCartao && payAutorizacao.trim() && { autorizacao: payAutorizacao.trim() }),
      ...(digitos(payCnpj) && { cnpjPagamento: digitos(payCnpj), ufPagamento: payUf }),
    };
    setPayAutorizacao('');

    const newPayments = [...payments, newPayment];
    setPayments(newPayments);

    // Calculate new total paid
    const updatedTotalPago = round2(newPayments.reduce((acc, p) => acc + p.valor, 0));
    const updatedRemaining = Math.max(0, round2(total - updatedTotalPago));

    // Update payment values remaining and close modals
    setPaymentValue(updatedRemaining > 0 ? updatedRemaining.toFixed(2) : '0,00');
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

  // Focus EAN on load and check local storage size
  useEffect(() => {
    if (eanInputRef.current) {
      eanInputRef.current.focus();
    }
    
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
     setTimeout(() => eanInputRef.current?.focus(), 100);
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
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConsultaSearch();
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
      } else if (askForQuantity) {
        setCurrentProduct(product);
        setQuantidade(1);
        
        // Auto-focus quantity Input
        setTimeout(() => {
           if (qtyInputRef.current) {
             qtyInputRef.current.focus();
             qtyInputRef.current.select();
           }
        }, 50);
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
      setCurrentProduct(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEanKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isStandby) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      searchProduct();
    }
  };

  const handleQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addToCart();
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
    setQuantidadeText('1,00');
    setValorItem('');
    setCurrentProduct(null);
    setAskForQuantity(false);
    
    // Focus EAN again
    setTimeout(() => {
      if (eanInputRef.current) eanInputRef.current.focus();
    }, 50);
  };

  const removeFromCart = async (cartId: string) => {
    if (!await askConfirm('Remover este item do cupom?')) return;
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  const totalItens = round2(cart.reduce((acc, item) => acc + item.subtotal, 0));
  /** Desconto (−) ou acréscimo (+) no total da venda, rateado pelos itens no servidor */
  const ajusteTotal = round2((Number(acrescimoTotal) || 0) - (Number(descontoTotal) || 0));
  const total = round2(totalItens + ajusteTotal);
  const docConsumidor = digitos(consumidorDoc);
  const docInvalido = !!docConsumidor && !(docConsumidor.length === 11 ? cpfValido(docConsumidor) : docConsumidor.length === 14 && cnpjValido(docConsumidor));
  const modeloVenda = modeloDoDocumento(docConsumidor, docConsumidor.length === 11 ? consumidorIe : '');

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
          pagamentos: payments.map(({ id, ...p }) => p),
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
          return;
        }
      }

      if (isNfceListOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsNfceListOpen(false);
          return;
        }
      }

      if (isApiResultModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsApiResultModalOpen(false);
          return;
        }
        if (e.key === 'F2') {
          e.preventDefault();
          commitPayment(debitCardValue, true);
          setIsApiResultModalOpen(false);
          setIsDebitCardModalOpen(false);
          toast.success('Lançamento registrado com sucesso no PDV!');
          return;
        }
        return;
      }

      if (isDebitCardModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsDebitCardModalOpen(false);
          setTimeout(() => {
            if (paymentValueInputRef.current) {
              paymentValueInputRef.current.focus();
              paymentValueInputRef.current.select();
            }
          }, 100);
          return;
        }
        return;
      }
      
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, total, isStandby, isCheckoutOpen, payments, isPaymentValueModalOpen, isChangeModalOpen, isDebitCardModalOpen, isApiResultModalOpen, apiResult, debitCardValue, paymentValue, paymentForm, isConsultaOpen, isNfceListOpen, isPrintSelected]);

  const totalPago = round2(payments.reduce((acc, p) => acc + p.valor, 0));
  const remainingValue = round2(Math.max(0, total - totalPago));
  const isFullyPaid = totalPago >= total;

  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col p-0 sm:p-2 md:p-4 font-sans text-gray-900 overflow-hidden relative">
      
      {/* Standby / Caixa Livre Screen */}
      {isStandby && (
        <div className="absolute inset-0 bg-blue-600 z-[100] flex flex-col items-center justify-center text-white" onClick={() => { setIsStandby(false); setTimeout(() => eanInputRef.current?.focus(), 100); }}>
          <h1 className="text-7xl md:text-[140px] font-black tracking-tighter mb-8 drop-shadow-xl">CAIXA LIVRE</h1>
          <p className="text-2xl md:text-3xl font-medium animate-pulse opacity-90 drop-shadow-md">Pressione ENTER para iniciar nova venda</p>
          <p className="absolute bottom-6 text-xs font-black tracking-widest opacity-60">MENU FISCAL INACESSÍVEL NESTA TELA</p>
        </div>
      )}

      <div className="w-full h-full flex flex-col gap-2 md:gap-3">
        
        {/* Header Empresa */}
        <div className="w-full bg-white shadow-md rounded-2xl border border-gray-100 flex items-center justify-center shrink-0 h-[80px] relative px-40">
          <h1 className="text-3xl sm:text-4xl font-black text-gray-800 tracking-tight text-center uppercase truncate">
            {usuario.empresaNome || 'Sua Empresa Aqui'}
          </h1>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {usuario.userName && <span className="text-xs font-semibold text-gray-500 hidden sm:inline">{usuario.userName}</span>}
            <button
              type="button"
              onClick={onSair}
              title="Sair"
              data-dica-desc="Encerra a sessão deste usuário no PDV"
              className="flex items-center gap-1.5 px-3 h-[36px] rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-rose-600 text-xs font-bold cursor-pointer"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>

        {isConsultaOpen ? (
          /* FULL SCREEN CONSULTA DE PREÇO */
          <div className="flex-1 bg-white shadow-xl rounded-2xl overflow-hidden flex flex-col border border-gray-100 min-h-0 animate-in fade-in duration-200">
             <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50/50 shrink-0">
                <h3 className="text-2xl font-bold flex items-center gap-3 text-gray-800">
                  <Search size={28} className="text-blue-600" />
                  Consulta de Preço
                </h3>
                <MenuFiscalInacessivel />
                <button 
                  type="button"
                  onClick={closeConsulta}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all font-bold text-sm cursor-pointer"
                >
                  Fechar (Esc)
                </button>
             </div>
             
             <div className="p-6 sm:p-8 flex flex-col flex-1 overflow-hidden max-w-3xl mx-auto w-full">
                <div className="mb-6 shrink-0">
                  <label htmlFor="consultaEan" className="block text-sm font-semibold text-gray-700 mb-2">
                    Código de Barras (EAN)
                  </label>
                  <input
                    id="consultaEan"
                    ref={consultaInputRef}
                    type="text"
                    className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-0 focus:border-blue-500 text-2xl font-mono outline-none transition-colors shadow-sm"
                    placeholder="Escaneie o código de barras ou digite..."
                    value={consultaEan}
                    onChange={e => setConsultaEan(e.target.value)}
                    onKeyDown={handleConsultaKeyDown}
                  />
                </div>
                
                <div className="flex-1 flex flex-col min-h-0">
                  {consultaProduct ? (
                    <div className="bg-blue-50/50 border-2 border-blue-100 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 h-full">
                       <h4 className="text-3xl font-black text-gray-950 mb-6 leading-tight uppercase tracking-tight">{consultaProduct.nome}</h4>
                       
                       <div className="bg-white px-10 py-8 rounded-2xl shadow-xl border border-blue-150 min-w-full sm:min-w-[60%]">
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Preço de Venda</p>
                          <p className="text-6xl sm:text-7xl font-[Verdana] font-black text-blue-700 tracking-tighter">
                            {formatCurrency(consultaProduct.preco_venda)}
                          </p>
                       </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-250 rounded-2xl flex flex-col items-center justify-center text-center h-full text-gray-400 p-6 bg-gray-50/30">
                       <Search size={64} className="mb-4 text-blue-400/80 animate-pulse" />
                       <p className="text-xl font-bold text-gray-700">Aguardando leitura de produto...</p>
                       <p className="text-sm text-gray-500 max-w-md mt-2 leading-relaxed">Passe o produto no leitor de código de barras ou insira o código manualmente e pressione Enter.</p>
                    </div>
                  )}
                </div>
             </div>
          </div>
        ) : isNfceListOpen ? (
          <NotasPdv onFechar={() => setIsNfceListOpen(false)} confirmar={askConfirm} />
        ) : (
          <>
            <div className="flex-1 bg-white shadow-xl rounded-2xl overflow-hidden flex flex-col md:flex-row border border-gray-100 min-h-0">
         
         {/* Left Side: Controls */}
         <div className="md:w-[45%] lg:w-[40%] p-5 md:p-6 bg-gray-50/50 flex flex-col border-r border-gray-100 min-h-0 overflow-y-auto">
            <div className="flex justify-between items-start mb-6 shrink-0">
               <div className="flex items-center gap-3">
                 <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-sm">
                   <ShoppingCart size={24} />
                 </div>
                 <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[#4285de]">PDV Cupom</h1>
                    <p className="text-sm text-gray-500 font-medium">BMS Software (Offline)</p>
                 </div>
               </div>
               

            </div>
            
            {/* Sync Feedback Message */}
            {syncStatus && (
               <div className="mb-4 text-xs font-semibold px-3 py-2 bg-blue-50 text-blue-700 rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                 <Database size={14} />
                 {syncStatus}
               </div>
            )}
            
            <div className="mb-3 text-xs text-gray-500 font-medium flex flex-col gap-1 px-1 shrink-0">
              <div className="flex items-center justify-between">
                <span>Modo Operação: <strong className="text-emerald-600">Local (PWA)</strong></span>
                <span>{localProductsCount} res.</span>
              </div>
              {caixaFund > 0 && (
                <div className="flex items-center justify-between text-blue-700 bg-blue-50/50 px-2 py-1.5 rounded-lg border border-blue-100 font-bold mt-1 text-[11px] animate-in slide-in-from-top-1 duration-200">
                  <span>Troco Inicial (Caixa):</span>
                  <span>{formatCurrency(caixaFund)}</span>
                </div>
              )}
            </div>

            {/* Product Search Form / Checkout Portal */}
            {isCheckoutOpen ? (
              <div className="space-y-4 bg-white p-5 rounded-2xl border-2 border-emerald-500 shadow-md relative transition-all shrink-0">
                <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                  <h3 className="text-sm font-black text-emerald-700 flex items-center gap-1.5 uppercase tracking-wide">
                    <CheckCircle size={16} className="text-emerald-600 animate-pulse" />
                    Finalizar Cupom
                  </h3>
                  <button 
                    onClick={closeCheckout}
                    className="text-xs font-bold text-gray-500 hover:text-red-500 px-2 py-1 bg-gray-100 hover:bg-red-50 rounded-lg transition-colors border border-gray-200 cursor-pointer"
                  >
                    Voltar (Esc)
                  </button>
                </div>

                {/* Resumo de Valores */}
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Total da Venda:</span>
                    <span className="font-bold text-gray-800">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Total Pago:</span>
                    <span className="font-bold text-blue-600">{formatCurrency(totalPago)}</span>
                  </div>
                  {!isFullyPaid ? (
                    <div className="flex justify-between text-xs font-bold text-amber-600 pt-1.5 border-t border-dashed border-gray-200">
                      <span>Restante a Pagar:</span>
                      <span>{formatCurrency(remainingValue)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-xs font-bold text-emerald-600 pt-1.5 border-t border-dashed border-gray-200">
                      <span>Status:</span>
                      <span>PAGAMENTO CONCLUÍDO</span>
                    </div>
                  )}
                </div>

                {/* Consumidor, desconto/acréscimo e intermediador da transação (Requisitos IV, VIII e XI) */}
                <div
                  className="campos-padrao space-y-2.5 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
                  }}
                >
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label htmlFor="consumidorDoc" className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">CPF/CNPJ do consumidor</label>
                      <span className={`text-[10px] font-black ${docInvalido ? 'text-rose-600' : 'text-blue-700'}`}>
                        {docInvalido ? 'INVÁLIDO' : modeloVenda === '55' ? 'NF-e (modelo 55)' : 'NFC-e (modelo 65)'}
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
                      <label htmlFor="consumidorIe" className="block text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1">IE de produtor rural (emite NF-e)</label>
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
                      <label className="block text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1">Desconto</label>
                      <NumberField scale={2} value={descontoTotal} onChange={setDescontoTotal} className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1">Acréscimo</label>
                      <NumberField scale={2} value={acrescimoTotal} onChange={setAcrescimoTotal} className="w-full bg-blue-500/[0.03] p-2 px-3 text-sm" />
                    </div>
                  </div>
                  <Toggle checked={discriminar} onChange={setDiscriminar} label="Mostrar desconto/acréscimo no documento" size="sm" />
                  {intermediadores.some((i) => i.tipo === 'T' && i.ativo) && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-1">Intermediador da transação</label>
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
                        <span className="block text-[10px] font-bold text-gray-700 uppercase tracking-wider">Forma de Pagamento</span>
                        <span className="text-[9px] text-gray-500 font-medium">Setas [↑ / ↓] para escolher</span>
                      </div>
                      <div className="space-y-1.5 border border-gray-100 rounded-xl p-1 bg-gray-50/50 max-h-56 overflow-y-auto">
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
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/20'
                                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white animate-pulse' : 'bg-gray-300'}`} />
                                <span className="uppercase tracking-wide">{nome}</span>
                              </div>
                              {isSelected && <span className="text-[9px] font-semibold bg-blue-700 px-1.5 py-0.5 rounded text-white animate-pulse">Ativo</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-center py-2.5 mt-3 text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-xl animate-pulse">
                        Pressione [ENTER] ou toque para lançar o valor
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista de Pagamentos Lançados */}
                {payments.length > 0 && (
                  <div className="space-y-1.5 font-sans">
                    <span className="block text-[10px] font-bold text-gray-600 uppercase tracking-wider">Pagamentos Lançados</span>
                    <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 overflow-hidden max-h-28 overflow-y-auto">
                      {payments.map((p) => (
                        <div key={p.id} className="flex justify-between items-center p-2 bg-gray-50/50 text-[10px]">
                          <span className="font-semibold text-gray-700 uppercase truncate">
                            {nomeMeioPagamento(p.tPag)}
                            <span className="text-gray-400 normal-case font-normal"> · {intermediadores.find((i) => i.id === p.intermediadorId)?.nome_fantasia}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-gray-900">{formatCurrency(p.valor)}</span>
                            <button
                              type="button"
                              onClick={() => removePayment(p.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
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
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                    <span className="block text-[9px] font-black text-emerald-800 uppercase tracking-widest mb-0.5">Troco</span>
                    <span className="text-xl font-black text-emerald-700 tracking-tight font-mono">
                      {formatCurrency(round2(totalPago - total))}
                    </span>
                  </div>
                )}

                {/* Botão Finalizar Cupom definitivo */}
                {isFullyPaid && (
                  <div className="space-y-3 bg-slate-900/5 p-3 rounded-2xl border border-slate-200/50 mt-4">
                    <span className="block text-center text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                      Selecione com as setas ▲ ▼ e confirme com ENTER
                    </span>
                    <button
                      type="button"
                      onClick={() => handleFinalize(true)}
                      disabled={emitindo}
                      className={`w-full flex items-center justify-between gap-1.5 px-4 rounded-xl transition-all active:scale-95 cursor-pointer ${
                        isPrintSelected 
                          ? 'bg-emerald-600 text-white py-3.5 font-black text-sm ring-4 ring-emerald-300 shadow-lg shadow-emerald-600/30 translate-x-0.5 scale-[1.02]' 
                          : 'bg-emerald-100/40 text-emerald-700 border border-emerald-200/30 py-2.5 font-medium text-xs opacity-50 hover:opacity-80'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <CheckCircle size={isPrintSelected ? 18 : 14} />
                        {emitindo ? 'Emitindo…' : 'Emitir e imprimir DANFE (F2)'}
                      </span>
                      {isPrintSelected && (
                        <span className="text-[10px] bg-emerald-500 px-2 py-0.5 rounded font-black tracking-wider shadow">
                          ▲ SELECIONADO ▼
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalize(false)}
                      disabled={emitindo}
                      className={`w-full flex items-center justify-between gap-1.5 px-4 rounded-xl transition-all active:scale-95 cursor-pointer ${
                        !isPrintSelected 
                          ? 'bg-slate-800 text-white py-3.5 font-black text-sm ring-4 ring-slate-400 shadow-lg shadow-slate-800/30 translate-x-0.5 scale-[1.02]' 
                          : 'bg-slate-100/50 text-slate-500 border border-slate-200 py-2.5 font-medium text-xs opacity-50 hover:opacity-80'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <CheckCircle size={!isPrintSelected ? 18 : 14} />
                        {emitindo ? 'Emitindo…' : 'Emitir sem imprimir'}
                      </span>
                      {!isPrintSelected && (
                        <span className="text-[10px] bg-slate-700 px-2 py-0.5 rounded font-black tracking-wider shadow text-white">
                          ▲ SELECIONADO ▼
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative transition-all shrink-0">
                  
                  {/* EAN Input */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label htmlFor="codigoEan" className="block text-sm font-semibold text-gray-700">
                        Código de Barras (EAN)
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
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-lg font-mono placeholder:font-sans"
                        placeholder="Escaneie o EAN e pressione Enter..."
                        value={ean}
                        onChange={e => setEan(e.target.value)}
                        onKeyDown={handleEanKeyDown}
                        disabled={isLoading}
                      />
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <Search size={22} />
                      </div>
                    </div>
                  </div>

                  {/* Loading State */}
                  {isLoading && (
                    <div className="py-8 text-center text-gray-500 flex flex-col items-center gap-3 animate-in fade-in">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm font-medium">Buscando produto...</span>
                    </div>
                  )}

                  {/* Found Product Card */}
                  {currentProduct && !isLoading && (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-5 animate-in fade-in slide-in-from-top-2">
                      <div className="flex justify-between items-start mb-4">
                        <div className="pr-3">
                           <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Produto Encontrado</p>
                           <h3 className="font-bold text-gray-900 text-lg leading-tight line-clamp-2">{currentProduct.nome}</h3>
                           <p className="text-xs text-gray-500 mt-1.5 font-mono">ID: {currentProduct.id} | EAN: {currentProduct.codigo_barras || 'N/A'}</p>
                        </div>
                        <div className="text-right shrink-0">
                           <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Preço (R$)</p>
                           <p className="font-bold text-blue-700 text-2xl tracking-tight">
                             {formatCurrency(currentProduct.preco_venda)}
                           </p>
                        </div>
                      </div>

                      <div className="mt-5 pt-5 border-t border-blue-200/60 flex items-end gap-3">
                        <div className="w-24">
                          <label htmlFor="quantidade" className="block text-[10px] font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
                            Qtd
                          </label>
                          <input
                            id="quantidade"
                            ref={qtyInputRef}
                            type="tel"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg text-center font-bold text-gray-900 outline-none transition-all"
                            value={quantidadeText}
                            onChange={e => handleQtyChange(e.target.value)}
                            onKeyDown={handleQtyKeyDown}
                            onFocus={e => e.target.select()}
                            disabled={Number(valorItem) > 0}
                          />
                        </div>
                        <div className="w-32">
                          <label htmlFor="valorItem" className="block text-[10px] font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
                            Ou valor total
                          </label>
                          <NumberField
                            id="valorItem"
                            scale={2}
                            value={valorItem}
                            onChange={setValorItem}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-lg font-bold text-gray-900 outline-none"
                          />
                        </div>
                        <button
                          onClick={addToCart}
                          disabled={quantidade <= 0 && !(Number(valorItem) > 0)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed h-[48px] shadow-sm shadow-blue-600/20"
                        >
                          <Plus size={18} strokeWidth={3} />
                          Confirmar Item
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            )}

         </div>

         {/* Right Side: Receipt List */}
         <div className="md:w-[55%] lg:w-[60%] bg-white flex flex-col p-5 md:p-6 min-h-0">
           
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                Cupom Fiscal
              </h2>
              {cart.length > 0 && (
                <span className="bg-gray-100 text-gray-700 font-bold text-xs py-1.5 px-3 rounded-full">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 space-y-4 bg-[#FFFFC7] rounded-2xl border-2 border-dashed border-gray-200 min-h-0">
                <Printer size={56} className="text-gray-300" />
                <p className="text-sm font-semibold">O cupom está vazio</p>
                <p className="text-xs text-gray-400 text-center max-w-xs">Escaneie um código de barras para adicionar um produto à venda.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-2 relative mb-4 min-h-0 bg-[#FFFFC7] rounded-2xl p-2">
                {cart.map((item, index) => (
                  <div
                    key={item.cartId}
                    onClick={() => !isCheckoutOpen && setEditandoItem(item.cartId)}
                    title={isCheckoutOpen ? undefined : 'Alterar valor'}
                    data-dica-desc="Desconto ou acréscimo no item, pelo unitário ou pelo total"
                    className={`group flex justify-between items-center bg-white border border-gray-100 p-4 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all duration-200 ${isCheckoutOpen ? '' : 'cursor-pointer'}`}
                  >
                    <div className="flex-1 pr-4 truncate">
                      <div className="flex items-start gap-4">
                          <span className="text-xs font-mono text-gray-400 font-bold mt-1 w-6 shrink-0">
                            {(index + 1).toString().padStart(3, '0')}
                          </span>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-gray-900 text-sm truncate">{item.product.nome}</h4>
                            <p className="text-xs text-gray-500 mt-1 font-mono">
                              <span className="font-semibold text-gray-700">{item.quantidade % 1 !== 0 ? item.quantidade.toFixed(3).replace('.', ',') : item.quantidade}</span> {item.quantidade % 1 !== 0 ? 'kg' : 'un'} x {formatCurrency(item.product.preco_venda)}
                              {(() => {
                                const dif = round2(item.subtotal - totalDoItem(item.quantidade, precoDe(item.product), item.product.iat));
                                return dif ? <span className={dif < 0 ? 'text-rose-600' : 'text-blue-700'}> · {dif < 0 ? 'desc.' : 'acrésc.'} {formatCurrency(Math.abs(dif))}</span> : null;
                              })()}
                            </p>
                          </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-bold text-gray-900 tracking-tight text-lg">
                        {formatCurrency(item.subtotal)}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.cartId); }}
                        className="text-gray-300 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors cursor-pointer"
                        title="Remover item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total Banner */}
            <div className="bg-[#3c60a3] text-white p-5 rounded-2xl shadow-xl mt-auto relative overflow-hidden shrink-0">
               {/* Decorative background circle */}
               <div className="absolute top-0 right-0 -mr-16 -mt-16 w-32 h-32 rounded-full bg-white/5 pointer-events-none"></div>
               
               <div className="flex justify-between items-end mb-4 relative z-10 mt-[7px]">
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Total da Venda</p>
                  <p className="text-[42px] leading-[43px] font-[Verdana] font-bold tracking-tighter text-[#ffffff] -mt-[3px] -mb-[13px]">{formatCurrency(total)}</p>
               </div>
            </div>
         </div>
        </div>

        {/* Action Footer */}
        <div className="w-full bg-white shadow-md rounded-2xl border border-gray-100 p-3 sm:p-4 flex flex-wrap gap-4 items-center justify-between relative shrink-0">
           <div className="flex flex-wrap gap-3">
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
                className={`flex items-center gap-2 px-4 py-2 font-medium text-xs rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer ${
                  isCheckoutOpen 
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-600'
                    : 'bg-white text-emerald-600 border border-emerald-100 hover:bg-emerald-50'
                }`}
             >
                <CheckCircle size={18} className={cart.length > 0 ? "animate-in zoom-in" : ""} />
                {isCheckoutOpen ? 'Confirmar e Emitir (F2)' : 'Finalizar Cupom (F2)'}
             </button>
             <button 
                onClick={async () => {
                  if (await askConfirm('Cancelar este cupom? Os itens e pagamentos lançados serão descartados.')) novaVenda();
                }}
                disabled={cart.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-white text-red-500 border border-red-100 hover:bg-red-50 font-medium text-xs rounded-xl transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
             >
                <Trash2 size={18} />
                Cancelar Cupom
             </button>
             <button 
               onClick={() => {
                 setIsConsultaOpen(true);
                 setTimeout(() => consultaInputRef.current?.focus(), 100);
               }}
               className="flex items-center gap-2 px-4 py-2 bg-white text-gray-600 border border-gray-200 hover:bg-gray-100 font-medium text-xs rounded-xl transition-colors active:scale-95 shadow-sm"
             >
                <Search size={18} />
                Consulta Preço (F5)
             </button>
             <button 
               onClick={() => setIsStandby(true)}
               disabled={cart.length > 0}
               className="flex items-center gap-2 px-4 py-2 bg-white text-gray-600 border border-gray-200 hover:bg-gray-100 font-medium text-xs rounded-xl transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
             >
                <CheckCircle size={18} className="opacity-0 w-0 h-0 hidden" />
                Caixa Livre (F4)
             </button>
           </div>
           
           <div className="flex flex-wrap gap-3 relative">
             <button 
               onClick={() => syncProducts()}
               disabled={isSyncing}
               className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 border border-blue-100 hover:bg-blue-50 font-medium text-xs rounded-xl transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
               title="Sincronizar Produtos (MySQL -> Local)"
             >
                <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                Sincronizar
             </button>
             <div className="relative">
               <button 
                 onClick={() => setIsNfceListOpen(true)}
                 className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 border border-blue-100 hover:bg-blue-50 font-medium text-xs rounded-xl transition-colors active:scale-95 shadow-sm"
               >
                  <FileText size={18} />
                  Notas emitidas
               </button>
             </div>
             <button
               type="button"
               onClick={() => setIsIntermediadoresOpen(true)}
               className="flex items-center gap-2 px-4 py-2 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 font-medium text-xs rounded-xl transition-colors active:scale-95 shadow-sm cursor-pointer"
               title="Intermediadores"
               data-dica-desc="Tabela de intermediadores de pagamento e de transação"
             >
                <Package size={18} />
                Intermediadores
             </button>
             <MenuFiscal />
           </div>
        </div>
          </>
        )}
      </div>

      {/* Startup / Abertura de Caixa & Banco de Dados Modal */}
      {isStartupModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[150] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 my-8">
            <div className="bg-[#1e3a8a] text-white p-6 relative">
              <h3 className="text-2xl font-black tracking-tight flex items-center gap-3">
                <Database size={28} className="text-blue-300" />
                Abertura de Caixa
              </h3>
              <p className="text-blue-100 text-xs mt-2 opacity-90 leading-relaxed">
                Bem-vindo ao PDV Cupom! Informe o valor do troco em caixa para iniciar o fluxo de vendas.
              </p>
              <p className="text-[10px] font-black tracking-widest text-blue-200 mt-3">MENU FISCAL INACESSÍVEL NESTA TELA</p>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              {/* Troco em Caixa Section */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Troco Inicial (Fundo de Caixa)</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Informe a quantidade de dinheiro físico em caixa para iniciar o fluxo diário e fornecer o troco aos clientes.
                </p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">R$</span>
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
                    className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:bg-white outline-none text-2xl font-mono text-gray-800 transition-all font-bold"
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setIsStartupModalOpen(false);
                  toast.info('Modo de demonstração ativado. Lembre-se de abrir o caixa para iniciar suas vendas.');
                }}
                className="px-4 py-2.5 text-xs text-gray-500 hover:text-gray-800 font-semibold transition-colors"
              >
                Ignorar por Enquanto
              </button>
              
              <button
                type="button"
                onClick={async () => {
                  const floatValue = parseFloat(startingTroco.replace(/\./g, "").replace(",", "."));
                  setCaixaFund(floatValue);
                  setIsStartupModalOpen(false);
                  setIsStandby(false);
                  // Arquivo .db e .ini só pelos botões "Conectar": abrir o caixa não pede arquivo
                  toast.success("Abertura de Caixa realizada!", {
                    description: `Troco inicial registrado: R$ ${startingTroco}`
                  });
                  setTimeout(() => {
                    if (eanInputRef.current) eanInputRef.current.focus();
                  }, 200);
                }}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all cursor-pointer shadow-md shadow-blue-600/10 active:scale-95 flex items-center gap-2"
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
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl h-[650px] max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
             <div className="flex justify-between items-center p-6 border-b border-gray-100 bg-gray-50/50 shrink-0">
                <h3 className="text-2xl font-bold flex items-center gap-3 text-gray-800">
                  <Search size={28} className="text-blue-600" />
                  Pesquisa de Produtos
                </h3>
                <MenuFiscalInacessivel />
                <button 
                  onClick={closePesquisa}
                  className="p-2 hover:bg-gray-200 rounded-full text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <X size={24} />
                </button>
             </div>
             
             <div className="p-6 shrink-0 relative bg-white">
                <input
                  ref={pesquisaInputRef}
                  type="text"
                  className="w-full pl-6 pr-4 py-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-0 focus:border-blue-500 focus:bg-white outline-none transition-all text-xl font-medium placeholder:font-normal placeholder:text-gray-400"
                  placeholder="Digite a descrição do produto..."
                  value={pesquisaQuery}
                  onChange={e => handlePesquisaChange(e.target.value)}
                  onKeyDown={handlePesquisaKeyDown}
                />
             </div>
             
             <div className="flex-1 overflow-y-auto px-6 pb-6 bg-gray-50/30">
               {pesquisaResults.length > 0 ? (
                 <div className="space-y-4">
                   {pesquisaResults.map((product, idx) => {
                     const isSelected = idx === selectedIndex;
                     return (
                     <div 
                       key={product.id}
                       onClick={() => selectPesquisaItem(product)}
                       className={`flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-white border ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'} rounded-2xl gap-4 cursor-pointer transition-all`}
                     >
                       <div>
                         <p className="text-xs text-gray-400 font-mono tracking-widest uppercase mb-1">
                           EAN: {product.codigo_barras || product.id}
                         </p>
                         <h4 className="text-lg font-bold text-gray-800">{product.nome}</h4>
                       </div>
                       <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-center self-start sm:self-auto shrink-0 border border-emerald-100/50 min-w-[120px]">
                         <span className="text-xs font-bold uppercase tracking-widest opacity-80 block mb-0.5">Preço</span>
                         <span className="font-mono font-black text-xl">{formatCurrency(
                            typeof product.preco_venda === 'string' ? parseFloat(product.preco_venda) : product.preco_venda
                         )}</span>
                       </div>
                     </div>
                   )})}
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
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
        <div className="fixed inset-0 bg-black/75 z-[150] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <span className="font-mono text-[10px] font-black bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2.5 py-1 rounded-lg tracking-wider uppercase">
                {nomeMeioPagamento(paymentForm)}
              </span>
              <button 
                onClick={closePaymentValueModal}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="mb-5 space-y-1">
              <h4 className="text-sm font-bold text-slate-300">Digite o valor do pagamento</h4>
              <p className="text-xs text-slate-400 flex justify-between">
                <span>Restante a pagar:</span>
                <span className="font-bold font-mono text-emerald-400">
                  {formatCurrency(remainingValue)}
                </span>
              </p>
            </div>

            <div className="relative mb-6">
              <input
                ref={paymentValueInputRef}
                type="text"
                className="w-full bg-slate-950 text-emerald-400 border border-slate-800 rounded-2xl px-4 py-4 text-center text-3xl font-mono font-black focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none shadow-inner"
                placeholder="0,00"
                value={paymentValue}
                onChange={(e) => setPaymentValue(e.target.value)}
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg font-black text-slate-600">R$</span>
            </div>

            {/* Intermediador do pagamento e dados do cartão (Requisito XI) */}
            <div className="space-y-3 mb-5 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Intermediador do pagamento</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
                  value={payInter}
                  onChange={(e) => setPayInter(Number(e.target.value))}
                >
                  {!payInter && <option value={0}>Escolha…</option>}
                  {intermediadoresPagamento.map((i) => (
                    <option key={i.id} value={i.id}>{i.codigo} - {i.nome_fantasia}</option>
                  ))}
                </select>
              </div>
              {meioCartao && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bandeira</label>
                    <select className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white" value={payBandeira} onChange={(e) => setPayBandeira(e.target.value)}>
                      <option value="">Não informada</option>
                      {BANDEIRAS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Autorização</label>
                    <input
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white font-mono"
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
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">CNPJ onde o pagamento foi processado</label>
                  <input
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white font-mono"
                    inputMode="numeric"
                    placeholder="Opcional"
                    value={payCnpj}
                    maxLength={14}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setPayCnpj(digitos(e.target.value).slice(0, 14))}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">UF</label>
                  <input
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white font-mono uppercase"
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
              <div className="mb-6 text-[11px] font-semibold text-emerald-300 flex justify-between items-center bg-emerald-950/40 border border-emerald-900/50 px-3 py-2 rounded-xl">
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
                className="w-full py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl transition-all font-bold text-xs"
              >
                Voltar (Esc)
              </button>
              <button 
                type="button"
                onClick={addPayment}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-all font-bold text-xs shadow-lg shadow-emerald-700/15"
              >
                Lançar (Enter)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Troco (Change Modal) */}
      {isChangeModalOpen && (
        <div className="fixed inset-0 bg-black/85 z-[160] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-8 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200 flex flex-col text-center">
            <span className="font-mono text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-full tracking-widest uppercase mx-auto mb-4">
              TROCO REQUERIDO
            </span>
            
            <h3 className="text-xl font-bold text-slate-300 mb-6">Troco do Cliente</h3>
            
            <div className="bg-slate-950 border border-slate-800 rounded-3xl py-10 px-6 mb-8 shadow-inner">
              <div className="text-3xl sm:text-4xl lg:text-5xl font-mono font-black text-emerald-400 animate-pulse tracking-tight uppercase">
                TROCO: {formatCurrency(changeAmount)}
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Pressione <span className="font-bold text-white px-1.5 py-0.5 bg-slate-800 rounded">ENTER</span> ou clique em prosseguir
              </p>
              
              <button 
                type="button"
                onClick={confirmChange}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl transition-all font-black text-sm shadow-xl shadow-emerald-700/20 cursor-pointer uppercase tracking-wider"
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
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-xl transition-all font-bold text-xs cursor-pointer"
              >
                Ajustar Valor (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Processar Cartão de Débito */}
      {isDebitCardModalOpen && (
        <div className="fixed inset-0 bg-black/85 z-[170] flex items-center justify-center p-4 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-8 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200 flex flex-col text-center">
            <span className="font-mono text-xs font-black bg-blue-500/25 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded-full tracking-widest uppercase mx-auto mb-4">
              PAGAMENTO CARTÃO DÉBITO
            </span>
            
            <h3 className="text-xl font-bold text-slate-300 mb-6">Processar Cartão Débito</h3>
            
            <div className="bg-slate-950 border border-slate-800 rounded-3xl py-10 px-6 mb-8 shadow-inner">
              <span className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                Valor do Lançamento
              </span>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-mono font-black text-blue-400 tracking-tight">
                {formatCurrency(debitCardValue)}
              </div>
            </div>

            <div className="space-y-4">
              <button 
                type="button"
                disabled={isSendingApi || isPollingPayment}
                onClick={handleSendPaymentApi}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white rounded-2xl transition-all font-black text-sm shadow-xl shadow-emerald-700/20 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {isSendingApi || isPollingPayment ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {isPollingPayment ? 'Aguardando pagamento...' : 'Enviando pagamento...'}
                  </>
                ) : (
                  'Enviar pagamento'
                )}
              </button>
              
              <button 
                type="button"
                disabled={isSendingApi || isPollingPayment}
                onClick={() => {
                  toast.info('Status do pagamento consultado: Processado e aprovado com sucesso!');
                }}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-2xl transition-all font-bold text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-blue-700/15"
              >
                Consultar pagamento
              </button>
              
              <button 
                type="button"
                disabled={isSendingApi || isPollingPayment}
                onClick={() => {
                  setIsDebitCardModalOpen(false);
                  setTimeout(() => {
                    if (paymentValueInputRef.current) {
                      paymentValueInputRef.current.focus();
                      paymentValueInputRef.current.select();
                    }
                  }, 100);
                }}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 disabled:bg-slate-900 text-slate-400 hover:text-white rounded-xl transition-all font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Retorno da API SuperTEF */}
      {isApiResultModalOpen && (
        <div className="fixed inset-0 bg-black/90 z-[180] flex items-center justify-center p-4 backdrop-blur-2xl animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${apiResult?.success ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-pulse'}`} />
                <h3 className="text-lg font-bold text-slate-200 font-sans">Retorno API SuperTEF</h3>
              </div>
              <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded-full ${
                apiResult?.success ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}>
                Status: {apiResult?.status || 'Erro'}
              </span>
            </div>

            <p className="text-xs text-slate-400 mb-4 text-left">
              Confira abaixo o payload retornado pela API da SuperTEF para a transação de <span className="text-blue-400 font-bold font-mono">{formatCurrency(debitCardValue)}</span>:
            </p>

            <div className="flex-1 overflow-auto bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] leading-relaxed text-slate-300 max-h-[350px] text-left">
              <pre className="whitespace-pre-wrap word-break-all select-all">
                {JSON.stringify(apiResult?.data || apiResult, null, 2)}
              </pre>
            </div>

            <div className="space-y-3 mt-5">
              <button 
                type="button"
                onClick={() => {
                  commitPayment(debitCardValue, true);
                  setIsApiResultModalOpen(false);
                  setIsDebitCardModalOpen(false);
                  toast.success('Lançamento registrado com sucesso no PDV!');
                }}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl transition-all font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/20 cursor-pointer"
              >
                <CheckCircle size={16} />
                Confirmar Lançamento no PDV (F2)
              </button>

              <button 
                type="button"
                onClick={() => {
                  setIsApiResultModalOpen(false);
                }}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-xl transition-all font-bold text-xs cursor-pointer text-center"
              >
                Fechar sem registrar pagamento
              </button>
            </div>
          </div>
        </div>
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

      {isIntermediadoresOpen && (
        <Intermediadores onFechar={() => { setIsIntermediadoresOpen(false); carregarIntermediadores(); }} />
      )}

{/* Confirm Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Confirmação</h3>
            <p className="text-gray-600 mb-6 font-medium">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={confirmDialog.onCancel}
                className="px-5 py-2.5 rounded-xl font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm"
              >
                Não
              </button>
              <button 
                onClick={confirmDialog.onConfirm}
                className="px-5 py-2.5 rounded-xl font-medium text-blue-600 bg-white border border-blue-100 hover:bg-blue-50 transition-colors shadow-sm"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
