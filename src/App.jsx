import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CAFE_CONFIG } from "./data/cafeConfig";
import { Html5Qrcode } from 'html5-qrcode';
import {
  Coffee,
  ShoppingBag,
  UtensilsCrossed,
  QrCode,
  Plus,
  Minus,
  X,
  CheckCircle2,
  Clock,
  Flame,
  MapPin,
  Printer,
  Trash2,
  Sparkles,
  ChefHat,
  Lock,
} from 'lucide-react';
import { supabase } from './supabaseClient';

const [scanFeedback, setScanFeedback] = useState(null);

const STAFF_PIN = '1234'; // Bisa diganti sesuai kebutuhan kafe

const [isScannerOpen, setIsScannerOpen] = useState(false);
const [manualCodeInput, setManualCodeInput] = useState('');
const ordersRef = React.useRef(orders);

useEffect(() => {
  ordersRef.current = orders;
}, [orders]);

useEffect(() => {
  if (!isScannerOpen || activeTab !== 'kitchen') return;

  const html5QrCode = new Html5Qrcode('qr-reader');
  let isMounted = true;

  html5QrCode
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        if (!isMounted) return;
        await handleScannedOrderCode(decodedText);
        setIsScannerOpen(false);
      },
      () => {}
    )
    .catch((err) => {
      console.error('Gagal menyalakan kamera:', err);
      if (isMounted) {
        setScanFeedback({
          type: 'error',
          text: 'Kamera gagal dibuka. Cek izin kamera atau gunakan input kode manual.',
        });
      }
    });

  return () => {
    isMounted = false;
    html5QrCode
      .stop()
      .then(() => html5QrCode.clear())
      .catch(() => {});
  };
}, [isScannerOpen, activeTab]);

const formatIDR = (amount) => {
  return `${CAFE_CONFIG.currency} ${Number(amount || 0).toLocaleString('id-ID')}`;
};

const getTableFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const meja = params.get('meja');
  if (meja && meja.trim() !== '') {
    return meja.trim().padStart(2, '0');
  }
  return null;
};

const getInitialTabFromHash = () => {
  if (typeof window === 'undefined') return 'menu';
  const hash = window.location.hash.toLowerCase();
  if (hash === '#dapur' || hash === '#kitchen') return 'kitchen';
  if (hash === '#qr' || hash === '#qr-meja') return 'qr';
  return 'menu';
};

const mapDbRowToOrder = (row) => {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const computedSubtotal = rawItems.reduce(
    (sum, item) => sum + Number(item.unitPrice || 0) * Number(item.qty || 1),
    0
  );
  const total = Number(row.total_price ?? computedSubtotal);
  const taxAmount = Math.max(0, total - computedSubtotal);

  return {
    id: row.id,
    orderCode: row.order_code || row.id,
    createdAt: row.created_at
      ? new Date(row.created_at).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '',
    table: row.is_takeaway
      ? 'Takeaway'
      : row.table_number
      ? `Meja ${row.table_number}`
      : 'Takeaway',
    customerName: row.customer_name || 'Tamu Kafe',
    paymentMethod: row.payment_method || (row.status === 'Konfirmasi Kasir' ? 'Kasir/Tunai' : 'QRIS'),
    status: row.status || 'Menunggu Masak',
    items: rawItems,
    subtotal: computedSubtotal,
    taxAmount,
    total,
  };
};

export default function App() {
  const [activeTab, setActiveTab] = useState(() => getInitialTabFromHash()); // 'menu' | 'kitchen' | 'qr'
  const [isStaffUnlocked, setIsStaffUnlocked] = useState(() => getInitialTabFromHash() !== 'menu');
  const [pendingStaffTab, setPendingStaffTab] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [tableNumber, setTableNumber] = useState(() => getTableFromUrl());
  const [customTableInput, setCustomTableInput] = useState('');

  // State Modal Kustomisasi Menu
  const [activeItem, setActiveItem] = useState(null);
  const [selectedTemp, setSelectedTemp] = useState('');
  const [selectedSugar, setSelectedSugar] = useState('');
  const [selectedSpice, setSelectedSpice] = useState('');
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [itemNote, setItemNote] = useState('');

  // State Keranjang & Checkout
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('QRIS'); // 'QRIS' | 'KASIR'
  const [checkoutStep, setCheckoutStep] = useState('cart'); // 'cart' | 'qris' | 'receipt'
  const [activeReceipt, setActiveReceipt] = useState(null);

  // State Pesanan (Sinkron via Supabase)
  const [orders, setOrders] = useState([]);

  // State QR Generator
  const [totalTables, setTotalTables] = useState(10);
  const [baseDomain, setBaseDomain] = useState(() =>
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://kafeanda.com'
  );

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Gagal mengambil pesanan dari Supabase:', error);
      return;
    }

    if (Array.isArray(data)) {
      setOrders(data.map(mapDbRowToOrder));
    }
  }, []);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('public-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  useEffect(() => {
    const handleHashChange = () => {
      const nextTab = getInitialTabFromHash();
      setActiveTab(nextTab);
      if (nextTab === 'menu') {
        setIsStaffUnlocked(false);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const switchToMenu = () => {
    setActiveTab('menu');
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  const requestStaffTab = (targetTab) => {
    if (isStaffUnlocked) {
      setActiveTab(targetTab);
      window.location.hash = targetTab === 'kitchen' ? 'dapur' : 'qr-meja';
      return;
    }
    setPendingStaffTab(targetTab);
    setPinInput('');
    setPinError('');
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (pinInput.trim() === STAFF_PIN) {
      setIsStaffUnlocked(true);
      const target = pendingStaffTab || 'kitchen';
      setActiveTab(target);
      window.location.hash = target === 'kitchen' ? 'dapur' : 'qr-meja';
      setPendingStaffTab(null);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('PIN staf salah. Coba lagi.');
    }
  };

  const filteredMenus = useMemo(() => {
    if (selectedCategory === 'Semua') return CAFE_CONFIG.menus;
    return CAFE_CONFIG.menus.filter((item) => item.category === selectedCategory);
  }, [selectedCategory]);

  const openCustomizeModal = (menu) => {
    setActiveItem(menu);
    setSelectedTemp(menu.options?.temperature?.[0] || '');
    setSelectedSugar(menu.options?.sugar?.[0] || '');
    setSelectedSpice(menu.options?.spiceLevel?.[0] || '');
    setSelectedAddons([]);
    setItemNote('');
  };

  const toggleAddon = (addon) => {
    setSelectedAddons((prev) => {
      const exists = prev.some((a) => a.name === addon.name);
      if (exists) return prev.filter((a) => a.name !== addon.name);
      return [...prev, addon];
    });
  };

  const calculateUnitPrice = (menu, addons) => {
    const addonsTotal = addons.reduce((sum, a) => sum + a.price, 0);
    return menu.price + addonsTotal;
  };

  const [nameError, setNameError] = useState('');

const validateCustomerName = () => {
  if (!customerName.trim()) {
    setNameError('Nama pemesan wajib diisi dulu sebelum melanjutkan pesanan.');
    return false;
  }
  setNameError('');
  return true;
};

  const handleAddToCart = () => {
    if (!activeItem) return;
    const unitPrice = calculateUnitPrice(activeItem, selectedAddons);
    const variantSummary = [selectedTemp, selectedSugar, selectedSpice]
      .filter(Boolean)
      .join(' • ');

    const cartEntry = {
      cartId: `${activeItem.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      menuId: activeItem.id,
      name: activeItem.name,
      image: activeItem.image,
      unitPrice,
      qty: 1,
      variantSummary,
      addons: selectedAddons,
      note: itemNote.trim(),
    };

    setCart((prev) => [...prev, cartEntry]);
    setActiveItem(null);
    setCheckoutStep('cart');
    setIsCartOpen(true);
  };

  const handleScannedOrderCode = async (rawCode) => {
  const cleanCode = String(rawCode || '').trim().toUpperCase();
  if (!cleanCode) return;

  const targetOrder = orders.find(
    (o) => String(o.orderCode || '').toUpperCase() === cleanCode
  );

  if (!targetOrder) {
    setScanFeedback({ type: 'error', text: `Kode ${cleanCode} tidak ditemukan.` });
    return;
  }

  if (targetOrder.status !== 'Konfirmasi Kasir') {
    setScanFeedback({
      type: 'info',
      text: `Order ${cleanCode} sudah berstatus "${targetOrder.status}".`,
    });
    return;
  }

  await updateOrderStatus(targetOrder.id, 'Menunggu Masak');
  setScanFeedback({
    type: 'success',
    text: `Order ${cleanCode} terkonfirmasi & masuk ke antrean masak!`,
  });
};

  const updateCartQty = (cartId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => (item.cartId === cartId ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const taxAmount = Math.round((subtotal * (CAFE_CONFIG.taxPercentage || 0)) / 100);
  const grandTotal = subtotal + taxAmount;

  const finalizeOrder = async () => {
    if (cart.length === 0) return;

    const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const initialStatus = paymentMethod === 'QRIS' ? 'Menunggu Masak' : 'Konfirmasi Kasir';
    const trimmedName = customerName.trim() || 'Tamu Kafe';

    const payload = {
      order_code: orderCode,
      table_number: tableNumber || null,
      is_takeaway: !tableNumber,
      items: cart,
      total_price: grandTotal,
      status: initialStatus,
      customer_name: trimmedName,
    };

    console.log('[DEBUG ORDER]', { customerName, trimmedName, payload });

    const { data, error } = await supabase
      .from('orders')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Gagal menyimpan pesanan ke Supabase:', error);
      alert('Gagal mengirim pesanan. Coba beberapa saat lagi ya.');
      return;
    }

    const mappedOrder = {
      ...mapDbRowToOrder(data),
      customerName: trimmedName,
      paymentMethod,
      subtotal,
      taxAmount,
      total: grandTotal,
    };

    setOrders((prev) => [mappedOrder, ...prev]);
    setActiveReceipt(mappedOrder);
    setCart([]);
    setCustomerName('');
    setCheckoutStep('receipt');
  };

  const handleCheckoutButton = () => {
    if (cart.length === 0) return;
    if (!validateCustomerName()) return;
    if (paymentMethod === 'QRIS') {
      setCheckoutStep('qris');
    } else {
      finalizeOrder();
    }
  };

  const updateOrderStatus = async (orderId, nextStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', orderId);

    if (error) {
      console.error('Gagal mengupdate status pesanan:', error);
      alert('Gagal mengubah status pesanan.');
      return;
    }

    setOrders((prev) =>
      prev.map((ord) => (ord.id === orderId ? { ...ord, status: nextStatus } : ord))
    );
    if (activeReceipt?.id === orderId) {
      setActiveReceipt((prev) => (prev ? { ...prev, status: nextStatus } : null));
    }
  };

  const clearOrders = async () => {
    const { error } = await supabase
      .from('orders')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      console.error('Gagal membersihkan riwayat pesanan:', error);
      alert('Gagal membersihkan riwayat pesanan.');
      return;
    }

    setOrders([]);
    setActiveReceipt(null);
  };

  const applyManualTable = (e) => {
    e.preventDefault();
    if (!customTableInput.trim()) {
      setTableNumber(null);
      return;
    }
    setTableNumber(customTableInput.trim().padStart(2, '0'));
  };

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'Clear'),
    [orders]
  );

  const clearedOrders = useMemo(
    () => orders.filter((o) => o.status === 'Clear'),
    [orders]
  );

  const exportClearedToCsv = () => {
    const headers = ['Order Code', 'Waktu', 'Meja/Tipe', 'Pemesan', 'Metode', 'Total', 'Status'];
    const rows = clearedOrders.map((o) => [
      o.orderCode,
      o.createdAt,
      o.table,
      o.customerName,
      o.paymentMethod,
      o.total,
      o.status,
    ]);
    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rekap-clear-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const qrisPayload = useMemo(() => {
    return `00020101021226620014ID.CO.QRIS.WWW01189360099900000000000215${CAFE_CONFIG.nmid}0303UMI520458145303360540${grandTotal}5802ID5915${CAFE_CONFIG.qrisMerchantName}6006DEPOK6304ABCD`;
  }, [grandTotal]);

  const isCustomerView = activeTab === 'menu' && !isStaffUnlocked;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Industrial Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/90 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-400">
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-wider text-white sm:text-lg">
                  {CAFE_CONFIG.name}
                </h1>
                <span className="hidden rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-400 sm:inline-block">
                  POS-SELF
                </span>
              </div>
              <p className="flex items-center gap-1 text-xs text-zinc-400">
                <MapPin className="h-3 w-3 text-amber-500" />
                {CAFE_CONFIG.address}
              </p>
            </div>
          </div>

          {/* Navigasi: Hanya muncul penuh saat mode staf aktif */}
          {!isCustomerView && (
            <div className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1">
              <button
                onClick={switchToMenu}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'menu'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Menu
              </button>
              <button
                onClick={() => requestStaffTab('kitchen')}
                className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'kitchen'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <ChefHat className="h-3.5 w-3.5" />
                Dapur
                {orders.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] font-bold ${
                      activeTab === 'kitchen'
                        ? 'bg-zinc-950 text-amber-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {orders.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => requestStaffTab('qr')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'qr'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <QrCode className="h-3.5 w-3.5" />
                QR Meja
              </button>
            </div>
          )}

          {/* Cart Trigger */}
          {activeTab === 'menu' && (
            <button
              onClick={() => {
                setCheckoutStep(cart.length > 0 ? 'cart' : activeReceipt ? 'receipt' : 'cart');
                setIsCartOpen(true);
              }}
              className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-amber-400 transition hover:border-amber-400 hover:bg-zinc-800"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Keranjang</span>
              <span className="rounded-md bg-amber-500 px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-950">
                {cartCount}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* TAB 1: MENU SELF-ORDER */}
      {activeTab === 'menu' && (
        <main className="mx-auto max-w-6xl px-4 py-6">
          {/* Industrial Hero + Table Detection Bar */}
          <section className="mb-8 rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-amber-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  {tableNumber ? `Terdeteksi: Meja ${tableNumber}` : 'Mode: Takeaway / Counter'}
                </div>
                <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                  {CAFE_CONFIG.tagline}
                </h2>
                <p className="max-w-xl text-sm text-zinc-400">
                  Pilih menu favorit, atur tingkat gula/suhu/pedas, bayar instan via QRIS, dan pesanan langsung diteruskan ke barista & dapur.
                </p>
              </div>

              {/* Simulasi / Override Nomor Meja (hanya muncul saat mode staf aktif atau belum ada ?meja=) */}
              {(!isCustomerView || !tableNumber) && (
                <form
                  onSubmit={applyManualTable}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"
                >
                  <span className="font-mono text-xs text-zinc-400">SET MEJA:</span>
                  <input
                    type="text"
                    value={customTableInput}
                    onChange={(e) => setCustomTableInput(e.target.value)}
                    placeholder="cth: 08"
                    maxLength={4}
                    className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-amber-500 hover:text-zinc-950"
                  >
                    Terapkan
                  </button>
                  {tableNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        setTableNumber(null);
                        setCustomTableInput('');
                      }}
                      className="rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:text-rose-400"
                    >
                      Reset
                    </button>
                  )}
                </form>
              )}
            </div>
          </section>

          {/* Category Filter Pills */}
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {CAFE_CONFIG.categories.map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-semibold tracking-wide transition ${
                    active
                      ? 'border-amber-500 bg-amber-500 text-zinc-950'
                      : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700 hover:text-white'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>

          {/* Menu Grid */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMenus.map((menu) => (
              <article
                key={menu.id}
                className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/60 transition hover:border-amber-500/50 hover:bg-zinc-900"
              >
                <div>
                  <div className="relative h-44 w-full overflow-hidden bg-zinc-950">
                    <img
                      src={menu.image}
                      alt={menu.name}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
                    <span className="absolute left-3 top-3 rounded-md border border-zinc-700/80 bg-zinc-950/85 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                      {menu.category}
                    </span>
                    {menu.popular && (
                      <span className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-950">
                        <Flame className="h-3 w-3" />
                        Best Seller
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-white">{menu.name}</h3>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                      {menu.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-800/80 px-4 py-3.5">
                  <div>
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Harga Mulai
                    </span>
                    <span className="font-mono text-sm font-bold text-amber-400">
                      {formatIDR(menu.price)}
                    </span>
                  </div>

                  <button
                    onClick={() => openCustomizeModal(menu)}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-400 active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    Pilih
                  </button>
                </div>
              </article>
            ))}
          </div>
        </main>
      )}

      {/* TAB 2: KITCHEN / CASHIER DISPLAY */}
      {activeTab === 'kitchen' && (
        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">Layar Antrean Dapur & Kasir</h2>
              <p className="text-xs text-zinc-400">
                Pesanan dari halaman Menu otomatis masuk ke sini. Ubah status untuk memantau progres.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onClick={() => {
        setScanFeedback(null);
        setIsScannerOpen((prev) => !prev);
      }}
      className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
    >
      <QrCode className="h-3.5 w-3.5" />
      {isScannerOpen ? 'Tutup Kamera' : 'Scan QR Kasir'}
    </button>

    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleScannedOrderCode(manualCodeInput);
        setManualCodeInput('');
      }}
      className="flex items-center gap-1.5"
    >
      <input
        type="text"
        value={manualCodeInput}
        onChange={(e) => setManualCodeInput(e.target.value)}
        placeholder="ORD-XXXXXX"
        className="w-28 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-amber-500 hover:text-amber-400"
      >
        Konfirmasi
      </button>
    </form>

            {orders.length > 0 && (
              <button
                onClick={clearOrders}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Bersihkan Riwayat
              </button>
            )}
          </div>
        </div>

        {scanFeedback && (
  <div
    className={`mb-4 rounded-xl border px-4 py-3 text-xs font-semibold ${
      scanFeedback.type === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : scanFeedback.type === 'info'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    }`}
  >
    {scanFeedback.text}
  </div>
)}

  {isScannerOpen && (
    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-zinc-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs font-bold uppercase text-amber-400">
          Arahkan Kamera ke QR Code Pelanggan
        </span>
        <button
          type="button"
          onClick={() => setIsScannerOpen(false)}
          className="rounded-lg border border-zinc-700 p-1 text-zinc-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div id="qr-reader" className="mx-auto max-w-sm overflow-hidden rounded-xl bg-zinc-950" />
    </div>
  )}
  ```[cite: 1, 6]  

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center">
              <ChefHat className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">Belum ada pesanan masuk</p>
              <p className="mt-1 text-xs text-zinc-500">
                Buka tab <span className="text-amber-400">Menu</span>, masukkan item ke keranjang, lalu lakukan checkout untuk mencoba.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {orders.map((ord) => (
                <div
                  key={ord.id}
                  className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                >
                  <div>
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                      <div>
                        <span className="font-mono text-xs font-bold text-amber-400">
                          {ord.orderCode || ord.id}
                        </span>
                        <p className="text-sm font-bold text-white">
                          {ord.table} • {ord.customerName}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-zinc-400">{ord.createdAt}</span>
                    </div>

                    <div className="my-3 space-y-2.5">
                      {ord.items.map((it) => (
                        <div key={it.cartId} className="rounded-lg bg-zinc-950/70 p-2.5 text-xs">
                          <div className="flex justify-between font-semibold text-zinc-100">
                            <span>
                              {it.qty}x {it.name}
                            </span>
                            <span className="font-mono text-zinc-400">
                              {formatIDR(it.unitPrice * it.qty)}
                            </span>
                          </div>
                          {it.variantSummary && (
                            <p className="mt-0.5 text-[11px] text-amber-400/90">
                              {it.variantSummary}
                            </p>
                          )}
                          {it.addons?.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-zinc-400">
                              + {it.addons.map((a) => a.name).join(', ')}
                            </p>
                          )}
                          {it.note && (
                            <p className="mt-1 italic text-[11px] text-zinc-500">
                              Catatan: &ldquo;{it.note}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-zinc-800 pt-3">
                    <div className="mb-3 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Bayar: <strong className="text-zinc-200">{ord.paymentMethod || (ord.status === "Konfirmasi Kasir" ? "Kasir" : "QRIS")}</strong>
                      </span>
                      <span className="font-mono text-sm font-bold text-amber-400">
                        {formatIDR(ord.total)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {['Menunggu Masak', 'Sedang Disiapkan', 'Siap'].map((st) => {
                        const isCurrent = ord.status === st;
                        return (
                          <button
                            key={st}
                            onClick={() => updateOrderStatus(ord.id, st)}
                            className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                              isCurrent
                                ? 'bg-amber-500 text-zinc-950'
                                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                            }`}
                          >
                            {st === 'Menunggu Masak'
                              ? 'Antre'
                              : st === 'Sedang Disiapkan'
                              ? 'Proses'
                              : 'Siap'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* TAB 3: TABLE QR GENERATOR */}
      {activeTab === 'qr' && (
        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-mono text-xs text-zinc-400">
                    URL DASAR WEBSITE KAFE
                  </label>
                  <input
                    type="text"
                    value={baseDomain}
                    onChange={(e) => setBaseDomain(e.target.value)}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-xs text-zinc-400">
                    JUMLAH MEJA (1 - 40)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={totalTables}
                    onChange={(e) =>
                      setTotalTables(Math.min(40, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={() => window.print()}
                className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
              >
                <Printer className="h-4 w-4" />
                Cetak / Save PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: totalTables }, (_, idx) => {
              const num = String(idx + 1).padStart(2, '0');
              const separator = baseDomain.includes('?') ? '&' : '?';
              const tableUrl = `${baseDomain}${separator}meja=${num}`;
              return (
                <div
                  key={num}
                  className="flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-center"
                >
                  <span className="mb-2 rounded-md bg-amber-500/15 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-400">
                    MEJA {num}
                  </span>
                  <div className="rounded-xl bg-white p-2.5">
                    <QRCodeSVG value={tableUrl} size={118} />
                  </div>
                  <p className="mt-2.5 line-clamp-1 w-full font-mono text-[10px] text-zinc-400">
                    {tableUrl}
                  </p>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* MODAL PIN STAF (DAPUR & QR MEJA) */}
      {pendingStaffTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handlePinSubmit}
            className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400">
                <Lock className="h-4 w-4" />
                <h3 className="text-sm font-bold text-white">Akses Kasir / Dapur</h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingStaffTab(null)}
                className="rounded-lg border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-zinc-400">
              Masukkan PIN staf (default demo: <span className="font-mono text-amber-400">1234</span>).
            </p>
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              autoFocus
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-center font-mono text-sm tracking-widest text-white focus:border-amber-500 focus:outline-none"
            />
            {pinError && <p className="mt-2 text-xs text-rose-400">{pinError}</p>}
            <button
              type="submit"
              className="mt-4 w-full rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
            >
              Masuk Panel Staf
            </button>
          </form>
        </div>
      )}

      {/* MODAL KUSTOMISASI ITEM */}
      {activeItem && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 p-5 sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <span className="font-mono text-[11px] uppercase text-amber-400">
                  {activeItem.category}
                </span>
                <h3 className="text-lg font-bold text-white">{activeItem.name}</h3>
                <p className="mt-1 text-xs text-zinc-400">{activeItem.description}</p>
              </div>
              <button
                onClick={() => setActiveItem(null)}
                className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {activeItem.options?.temperature && (
                <div>
                  <label className="mb-2 block font-mono text-xs text-zinc-400">SUHU</label>
                  <div className="flex gap-2">
                    {activeItem.options.temperature.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSelectedTemp(opt)}
                        className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                          selectedTemp === opt
                            ? 'border-amber-500 bg-amber-500 text-zinc-950'
                            : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeItem.options?.sugar && (
                <div>
                  <label className="mb-2 block font-mono text-xs text-zinc-400">
                    TINGKAT GULA
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {activeItem.options.sugar.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSelectedSugar(opt)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          selectedSugar === opt
                            ? 'border-amber-500 bg-amber-500 text-zinc-950'
                            : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeItem.options?.spiceLevel && (
                <div>
                  <label className="mb-2 block font-mono text-xs text-zinc-400">
                    LEVEL PEDAS
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {activeItem.options.spiceLevel.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSelectedSpice(opt)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          selectedSpice === opt
                            ? 'border-amber-500 bg-amber-500 text-zinc-950'
                            : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeItem.options?.addons?.length > 0 && (
                <div>
                  <label className="mb-2 block font-mono text-xs text-zinc-400">
                    TAMBAHAN (ADD-ONS)
                  </label>
                  <div className="space-y-2">
                    {activeItem.options.addons.map((addon) => {
                      const checked = selectedAddons.some((a) => a.name === addon.name);
                      return (
                        <button
                          key={addon.name}
                          type="button"
                          onClick={() => toggleAddon(addon)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs transition ${
                            checked
                              ? 'border-amber-500 bg-amber-500/15 text-white'
                              : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          <span className="font-medium">{addon.name}</span>
                          <span className="font-mono text-amber-400">
                            +{formatIDR(addon.price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block font-mono text-xs text-zinc-400">
                  CATATAN TAMBAHAN (OPSIONAL)
                </label>
                <input
                  type="text"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="Contoh: es batu sedikit saja..."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4">
              <div>
                <span className="block font-mono text-[10px] text-zinc-500">TOTAL ITEM</span>
                <span className="font-mono text-base font-bold text-amber-400">
                  {formatIDR(calculateUnitPrice(activeItem, selectedAddons))}
                </span>
              </div>
              <button
                onClick={handleAddToCart}
                className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
              >
                Tambah ke Keranjang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER KERANJANG, QRIS & STRUK DIGITAL */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  {checkoutStep === 'qris'
                    ? 'Pembayaran QRIS'
                    : checkoutStep === 'receipt'
                    ? 'Struk Pesanan Digital'
                    : `Pesanan (${tableNumber ? `Meja ${tableNumber}` : 'Takeaway'})`}
                </h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {checkoutStep === 'cart' && (
                <>
                  {cart.length === 0 ? (
                    <div className="py-16 text-center">
                      <p className="text-sm text-zinc-400">Keranjang kamu masih kosong.</p>
                      {activeReceipt && (
                        <button
                          onClick={() => setCheckoutStep('receipt')}
                          className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-400"
                        >
                          Lihat Struk Terakhir ({activeReceipt.orderCode || activeReceipt.id})
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="space-y-3">
                        {cart.map((item) => (
                          <div
                            key={item.cartId}
                            className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="text-xs font-bold text-white">{item.name}</h4>
                                {item.variantSummary && (
                                  <p className="mt-0.5 text-[11px] text-amber-400">
                                    {item.variantSummary}
                                  </p>
                                )}
                                {item.addons?.length > 0 && (
                                  <p className="mt-0.5 text-[11px] text-zinc-400">
                                    + {item.addons.map((a) => a.name).join(', ')}
                                  </p>
                                )}
                                {item.note && (
                                  <p className="mt-0.5 italic text-[11px] text-zinc-500">
                                    &ldquo;{item.note}&rdquo;
                                  </p>
                                )}
                              </div>
                              <span className="font-mono text-xs font-semibold text-zinc-200">
                                {formatIDR(item.unitPrice * item.qty)}
                              </span>
                            </div>

                            <div className="mt-2.5 flex items-center justify-end gap-2">
                              <button
                                onClick={() => updateCartQty(item.cartId, -1)}
                                className="rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:border-amber-500"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-6 text-center font-mono text-xs font-bold">
                                {item.qty}
                              </span>
                              <button
                                onClick={() => updateCartQty(item.cartId, 1)}
                                className="rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 hover:border-amber-500"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 border-t border-zinc-800 pt-4">
                        <div>
                          <label className="mb-1 block font-mono text-xs text-zinc-400">
                            NAMA PEMESAN
                          </label>
                          <input
                            type="text"
                            value={customerName}
                            onChange={(e) => {
                              setCustomerName(e.target.value);
                              if (nameError) setNameError('');
                            }}
                            placeholder="Masukkan nama panggilan..."
                            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                          />
                          {nameError && <p className="mt-1.5 text-xs text-rose-400">{nameError}</p>}
                        </div>

                        <div>
                          <label className="mb-1.5 block font-mono text-xs text-zinc-400">
                            METODE PEMBAYARAN
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {['QRIS', 'KASIR'].map((method) => (
                              <button
                                key={method}
                                type="button"
                                onClick={() => setPaymentMethod(method)}
                                className={`rounded-xl border py-2 font-mono text-xs font-bold transition ${
                                  paymentMethod === method
                                    ? 'border-amber-500 bg-amber-500 text-zinc-950'
                                    : 'border-zinc-700 bg-zinc-950 text-zinc-300'
                                }`}
                              >
                                {method === 'QRIS' ? 'QRIS Instan' : 'Bayar di Kasir'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {checkoutStep === 'qris' && (
                <div className="flex flex-col items-center text-center">
                  <span className="rounded-md bg-amber-500/15 px-3 py-1 font-mono text-xs font-bold text-amber-400">
                    {CAFE_CONFIG.qrisMerchantName}
                  </span>
                  <p className="mt-1 font-mono text-[11px] text-zinc-500">
                    NMID: {CAFE_CONFIG.nmid}
                  </p>
                  <div className="my-5 rounded-2xl bg-white p-4 shadow-lg">
                    <img
                      src="/qris-bank.jpg"
                      alt={`QRIS ${CAFE_CONFIG.qrisMerchantName}`}
                      className="h-44 w-44 object-contain"
                    />
                  </div>
                  <p className="text-xs text-zinc-400">Total Tagihan</p>
                  <p className="mt-0.5 font-mono text-xl font-extrabold text-amber-400">
                    {formatIDR(grandTotal)}
                  </p>
                  <p className="mt-3 max-w-xs text-[11px] text-zinc-500">
                    Scan QR di atas, ketik nominal sesuai Total Tagihan, lalu konfirmasi ke kasir setelah pembayaran berhasil.
                  </p>
                </div>
              )}

              {checkoutStep === 'receipt' && activeReceipt && (
                <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-bold">Pesanan Berhasil Dibuat!</span>
                  </div>
                  
                <div className="space-y-1 border-y border-dashed border-zinc-800 py-3 font-mono text-xs">
                   <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">ID Order</span>
                    <span className="text-white">{activeReceipt.orderCode || activeReceipt.id}</span>
                  </div>
                <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Lokasi</span>
                    <span className="text-amber-400">{activeReceipt.table}</span>                          
                  </div>
                <div className="flex justify-between gap-2">
                    <span className="text-zinc-500">Pemesan</span>
                    <span className="text-zinc-200">{activeReceipt.customerName}</span>
                  </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500">Status Dapur</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-amber-400">
                          <Clock className="h-3 w-3" />
                              {activeReceipt.status}
                    </span>
                  </div>
                </div>
                    
              {activeReceipt.paymentMethod === 'KASIR' && activeReceipt.status === 'Konfirmasi Kasir' && (
                <div className="flex flex-col items-center rounded-xl border border-amber-500/30 bg-zinc-900 p-3 text-center">
                  <span className="mb-2 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                        Tunjukkan QR Ini ke Kasir
                  </span>
                <div className="rounded-lg bg-white p-2">
                  <QRCodeSVG value={activeReceipt.orderCode || activeReceipt.id} size={120} />
                </div>
                  <span className="mt-2 font-mono text-xs font-bold text-white">
                    {activeReceipt.orderCode || activeReceipt.id}
                  </span>
                </div>
              )}

                  <div className="space-y-2 text-xs">
                    {activeReceipt.items.map((it) => (
                      <div key={it.cartId} className="flex justify-between text-zinc-300">
                        <span>
                          {it.qty}x {it.name}
                        </span>
                        <span className="font-mono">{formatIDR(it.unitPrice * it.qty)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between border-t border-zinc-800 pt-3 font-mono text-sm font-bold text-amber-400">
                    <span>TOTAL</span>
                    <span>{formatIDR(activeReceipt.total)}</span>
                  </div>
                </div>
              )}
            </div>

            {checkoutStep === 'cart' && cart.length > 0 && (
              <div className="border-t border-zinc-800 bg-zinc-950/90 p-5">
                <div className="mb-4 space-y-1.5 text-xs">
                  <div className="flex justify-between text-zinc-400">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatIDR(subtotal)}</span>
                  </div>
                  {CAFE_CONFIG.taxPercentage > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Pajak ({CAFE_CONFIG.taxPercentage}%)</span>
                      <span className="font-mono">{formatIDR(taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-zinc-800 pt-2 text-sm font-bold text-white">
                    <span>Total Bayar</span>
                    <span className="font-mono text-amber-400">{formatIDR(grandTotal)}</span>
                  </div>
                </div>

                <button
                  onClick={handleCheckoutButton}
                  className="w-full rounded-xl bg-amber-500 py-3 text-xs font-extrabold uppercase tracking-wider text-zinc-950 transition hover:bg-amber-400"
                >
                  {paymentMethod === 'QRIS' ? 'Lanjut Bayar QRIS' : 'Kirim Pesanan'}
                </button>
              </div>
            )}

            {checkoutStep === 'qris' && (
              <div className="flex gap-2 border-t border-zinc-800 bg-zinc-950/90 p-5">
                <button
                  onClick={() => setCheckoutStep('cart')}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  Kembali
                </button>
                <button
                  onClick={finalizeOrder}
                  className="flex-1 rounded-xl bg-emerald-500 py-3 text-xs font-extrabold uppercase tracking-wider text-zinc-950 transition hover:bg-emerald-400"
                >
                  Konfirmasi Pembayaran Masuk
                </button>
              </div>
            )}

            {checkoutStep === 'receipt' && (
              <div className="flex gap-2 border-t border-zinc-800 bg-zinc-950/90 p-5">
                {!isCustomerView ? (
                  <button
                    onClick={() => {
                      setIsCartOpen(false);
                      setActiveTab('kitchen');
                    }}
                    className="flex-1 rounded-xl bg-amber-500 py-3 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
                  >
                    Pantau di Layar Dapur
                  </button>
                ) : (
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="flex-1 rounded-xl bg-amber-500 py-3 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
                  >
                    Selesai & Kembali ke Menu
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}