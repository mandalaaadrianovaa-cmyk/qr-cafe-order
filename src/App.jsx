import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';
import { CAFE_CONFIG } from './data/cafeConfig';
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
  History,
  FileSpreadsheet,
  CheckCheck,
  Volume2,
  VolumeX,
  Search,
} from 'lucide-react';
import { supabase } from './supabaseClient';

const STAFF_PIN = CAFE_CONFIG.staffPin || '1234';
const OWNER_PIN = CAFE_CONFIG.ownerPin || '9999';

const formatIDR = (amount) => {
  return `${CAFE_CONFIG.currency} ${Number(amount || 0).toLocaleString('id-ID')}`;
};

const isMenuSoldOut = (menu) => {
  return menu?.soldOut === true || menu?.available === false || menu?.inStock === false;
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
  if (hash === '#riwayat' || hash === '#owner') return 'riwayat';
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

  const rawPayment = String(row.payment_method || '').toUpperCase();
  const paymentMethod =
    rawPayment === 'KASIR' || rawPayment === 'KASIR/TUNAI'
      ? 'Kasir/Tunai'
      : rawPayment === 'QRIS'
      ? 'QRIS'
      : row.status === 'Konfirmasi Kasir'
      ? 'Kasir/Tunai'
      : 'QRIS';

  return {
    id: row.id,
    orderCode: row.order_code || row.id,
    createdAt: row.created_at
      ? new Date(row.created_at).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '',
    createdDate: row.created_at
      ? new Date(row.created_at).toLocaleDateString('id-ID')
      : '',
    table: row.is_takeaway
      ? 'Takeaway'
      : row.table_number
      ? `Meja ${row.table_number}`
      : 'Takeaway',
    customerName: row.customer_name || 'Tamu Kafe',
    paymentMethod,
    status: row.status || 'Menunggu Masak',
    items: rawItems,
    subtotal: computedSubtotal,
    taxAmount,
    total,
  };
};

export default function App() {
  const initialTab = getInitialTabFromHash();
  const [activeTab, setActiveTab] = useState(() => initialTab); // 'menu' | 'kitchen' | 'qr' | 'riwayat'
  const [isStaffUnlocked, setIsStaffUnlocked] = useState(
    () => initialTab === 'kitchen' || initialTab === 'qr'
  );
  const [isOwnerUnlocked, setIsOwnerUnlocked] = useState(() => initialTab === 'riwayat');

  // 'staff' | 'owner' | null
  const [pinModalRole, setPinModalRole] = useState(null);
  const [pendingTab, setPendingTab] = useState(null);
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
  const [nameError, setNameError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('QRIS'); // 'QRIS' | 'KASIR'
  const [checkoutStep, setCheckoutStep] = useState('cart'); // 'cart' | 'qris' | 'receipt'
  const [activeReceipt, setActiveReceipt] = useState(null);

  // State Pesanan (Sinkron via Supabase)
  const [orders, setOrders] = useState([]);
  const ordersRef = useRef(orders);

  // Notifikasi Suara Pesanan Masuk
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(soundEnabled);
  const audioCtxRef = useRef(null);

  // State Thermal Print Kasir
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [printOrder, setPrintOrder] = useState(null);

  // State Scanner QR Kasir
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null);

  // Filter & Pencarian Riwayat Owner
  const [historySearch, setHistorySearch] = useState('');
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState('Semua'); // 'Semua' | 'QRIS' | 'Kasir/Tunai'

  // State QR Generator
  const [totalTables, setTotalTables] = useState(10);
  const [baseDomain, setBaseDomain] = useState(() =>
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://kafeanda.com'
  );

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Trigger window.print() otomatis saat printOrder di-set
  useEffect(() => {
    if (!printOrder) return;
    const timer = setTimeout(() => {
      window.print();
    }, 150);
    return () => clearTimeout(timer);
  }, [printOrder]);

  // Bersihkan printOrder setelah dialog print ditutup
  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintOrder(null);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const triggerReceiptPrint = useCallback((orderObj, overrideStatus) => {
    if (!orderObj) return;
    setPrintOrder({
      ...orderObj,
      status: overrideStatus || orderObj.status,
      printedAt: new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  }, []);

  const playOrderDing = useCallback(() => {
    if (!soundEnabledRef.current || typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.14);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.46);
    } catch (err) {
      console.warn('Tidak dapat memutar suara notifikasi:', err);
    }
  }, []);

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
      const mapped = data.map(mapDbRowToOrder);
      setOrders(mapped);
      setActiveReceipt((prev) => {
        if (!prev) return prev;
        const updated = mapped.find((item) => item.id === prev.id);
        return updated ? { ...prev, status: updated.status } : prev;
      });
    }
  }, []);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('public-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            playOrderDing();
          }
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, playOrderDing]);

  useEffect(() => {
    const handleHashChange = () => {
      const nextTab = getInitialTabFromHash();
      setActiveTab(nextTab);
      if (nextTab === 'menu') {
        setIsStaffUnlocked(false);
        setIsOwnerUnlocked(false);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const switchToMenu = () => {
    setIsScannerOpen(false);
    setActiveTab('menu');
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  const requestStaffTab = (targetTab) => {
    if (targetTab !== 'kitchen') {
      setIsScannerOpen(false);
    }
    if (isStaffUnlocked) {
      setActiveTab(targetTab);
      window.location.hash = targetTab === 'kitchen' ? 'dapur' : 'qr-meja';
      return;
    }
    setPendingTab(targetTab);
    setPinModalRole('staff');
    setPinInput('');
    setPinError('');
  };

  const requestOwnerTab = () => {
    setIsScannerOpen(false);
    if (isOwnerUnlocked) {
      setActiveTab('riwayat');
      window.location.hash = 'riwayat';
      return;
    }
    setPendingTab('riwayat');
    setPinModalRole('owner');
    setPinInput('');
    setPinError('');
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    const expectedPin = pinModalRole === 'owner' ? OWNER_PIN : STAFF_PIN;

    if (pinInput.trim() === expectedPin) {
      const target = pendingTab || (pinModalRole === 'owner' ? 'riwayat' : 'kitchen');
      if (pinModalRole === 'owner') {
        setIsOwnerUnlocked(true);
        setActiveTab('riwayat');
        window.location.hash = 'riwayat';
      } else {
        setIsStaffUnlocked(true);
        setActiveTab(target);
        window.location.hash = target === 'kitchen' ? 'dapur' : 'qr-meja';
      }
      setPinModalRole(null);
      setPendingTab(null);
      setPinInput('');
      setPinError('');
    } else {
      setPinError(
        pinModalRole === 'owner'
          ? 'PIN owner salah. Coba lagi.'
          : 'PIN staf salah. Coba lagi.'
      );
    }
  };

  const filteredMenus = useMemo(() => {
    if (selectedCategory === 'Semua') return CAFE_CONFIG.menus;
    return CAFE_CONFIG.menus.filter((item) => item.category === selectedCategory);
  }, [selectedCategory]);

  const openCustomizeModal = (menu) => {
    if (isMenuSoldOut(menu)) return;
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
      payment_method: paymentMethod,
    };

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
      paymentMethod: paymentMethod === 'KASIR' ? 'Kasir/Tunai' : 'QRIS',
      subtotal,
      taxAmount,
      total: grandTotal,
    };

    setOrders((prev) => [mappedOrder, ...prev]);
    setActiveReceipt(mappedOrder);
    setCart([]);
    setCustomerName('');
    setNameError('');
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

  const updateOrderStatus = useCallback(
    async (orderId, nextStatus, shouldAutoPrint = false) => {
      const { error } = await supabase
        .from('orders')
        .update({ status: nextStatus })
        .eq('id', orderId);

      if (error) {
        console.error('Gagal mengupdate status pesanan:', error);
        alert('Gagal mengubah status pesanan.');
        return;
      }

      const targetOrder = ordersRef.current.find((ord) => ord.id === orderId);

      setOrders((prev) =>
        prev.map((ord) => (ord.id === orderId ? { ...ord, status: nextStatus } : ord))
      );
      if (activeReceipt?.id === orderId) {
        setActiveReceipt((prev) => (prev ? { ...prev, status: nextStatus } : null));
      }

      if (shouldAutoPrint && autoPrintEnabled && targetOrder) {
        triggerReceiptPrint(targetOrder, nextStatus);
      }
    },
    [activeReceipt?.id, autoPrintEnabled, triggerReceiptPrint]
  );

  const handleScannedOrderCode = useCallback(
    async (rawCode) => {
      const cleanCode = String(rawCode || '').trim().toUpperCase();
      if (!cleanCode) return;

      const targetOrder = ordersRef.current.find(
        (o) => String(o.orderCode || '').toUpperCase() === cleanCode
      );

      if (!targetOrder) {
        setScanFeedback({ type: 'error', text: `Kode ${cleanCode} tidak ditemukan.` });
        return;
      }

      if (targetOrder.status !== 'Konfirmasi Kasir') {
        setScanFeedback({
          type: 'info',
          text: `${cleanCode} • ${targetOrder.table} (${targetOrder.customerName}) sudah berstatus "${targetOrder.status}" • ${formatIDR(targetOrder.total)}.`,
        });
        return;
      }

      await updateOrderStatus(targetOrder.id, 'Menunggu Masak', true);
      setScanFeedback({
        type: 'success',
        text: `${cleanCode} • ${targetOrder.table} (${targetOrder.customerName}) • ${formatIDR(targetOrder.total)} terkonfirmasi${autoPrintEnabled ? ' & mencetak struk!' : ' & masuk ke antrean masak!'}`,
      });
    },
    [updateOrderStatus, autoPrintEnabled]
  );

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
  }, [isScannerOpen, activeTab, handleScannedOrderCode]);

  // Hapus riwayat (khusus pesanan berstatus Clear, opsi sementara untuk testing/bersih-bersih)
  const deleteClearedOrders = async () => {
    const confirmed = window.confirm(
      'Hapus semua data riwayat (status Clear) dari database? Aksi ini tidak bisa dibatalkan.'
    );
    if (!confirmed) return;

    const { error } = await supabase.from('orders').delete().eq('status', 'Clear');

    if (error) {
      console.error('Gagal menghapus riwayat pesanan:', error);
      alert('Gagal menghapus riwayat pesanan.');
      return;
    }

    setOrders((prev) => prev.filter((o) => o.status !== 'Clear'));
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

  const filteredClearedOrders = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return clearedOrders.filter((ord) => {
      const matchesMethod =
        historyPaymentFilter === 'Semua' || ord.paymentMethod === historyPaymentFilter;
      const matchesQuery =
        !q ||
        String(ord.orderCode || '').toLowerCase().includes(q) ||
        String(ord.customerName || '').toLowerCase().includes(q) ||
        String(ord.table || '').toLowerCase().includes(q);
      return matchesMethod && matchesQuery;
    });
  }, [clearedOrders, historySearch, historyPaymentFilter]);

  const filteredClearedRevenue = useMemo(
    () => filteredClearedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0),
    [filteredClearedOrders]
  );

  const exportClearedToExcel = () => {
    if (filteredClearedOrders.length === 0) return;

    const rows = filteredClearedOrders.map((o, idx) => {
      const itemSummary = Array.isArray(o.items)
        ? o.items
            .map((it) => {
              const variant = it.variantSummary ? ` (${it.variantSummary})` : '';
              const addons =
                it.addons?.length > 0
                  ? ` + ${it.addons.map((a) => a.name).join(', ')}`
                  : '';
              const note = it.note ? ` [Cat: ${it.note}]` : '';
              return `${it.qty}x ${it.name}${variant}${addons}${note}`;
            })
            .join(', ')
        : '';

      return {
        No: idx + 1,
        'Order Code': o.orderCode,
        Tanggal: o.createdDate || '-',
        Waktu: o.createdAt || '-',
        'Meja / Tipe': o.table,
        Pemesan: o.customerName,
        'Detail Pesanan': itemSummary,
        'Metode Pembayaran': o.paymentMethod,
        'Total (Rp)': Number(o.total || 0),
        Status: o.status,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const totalRowIndex = rows.length + 2;

    XLSX.utils.sheet_add_aoa(
      worksheet,
      [['', '', '', '', '', '', '', 'TOTAL OMZET', { f: `SUM(I2:I${rows.length + 1})` }, '']],
      { origin: `A${totalRowIndex}` }
    );

    for (let r = 2; r <= totalRowIndex; r++) {
      const cellRef = `I${r}`;
      if (worksheet[cellRef]) {
        worksheet[cellRef].z = '"Rp"#,##0';
      }
    }

    worksheet['!cols'] = [
      { wch: 5 },  // No
      { wch: 14 }, // Order Code
      { wch: 13 }, // Tanggal
      { wch: 10 }, // Waktu
      { wch: 14 }, // Meja / Tipe
      { wch: 18 }, // Pemesan
      { wch: 44 }, // Detail Pesanan
      { wch: 18 }, // Metode Pembayaran
      { wch: 18 }, // Total (Rp)
      { wch: 10 }, // Status
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Riwayat Penjualan');

    const today = new Date().toISOString().slice(0, 10);
    const safeCafeName = String(CAFE_CONFIG.name || 'Kafe').replace(/[^a-zA-Z0-9_-]/g, '_');
    XLSX.writeFile(workbook, `Laporan_${safeCafeName}_${today}.xlsx`);
  };

  const isCustomerView = activeTab === 'menu' && !isStaffUnlocked && !isOwnerUnlocked;

  return (
    <>
      {/* Isolasi CSS Khusus Thermal Printer (58mm / 80mm) */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #thermal-receipt-area,
          #thermal-receipt-area * {
            visibility: visible !important;
          }
          #thermal-receipt-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 58mm !important;
            max-width: 100% !important;
            padding: 3mm 2mm !important;
            margin: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Courier New', Courier, monospace !important;
            font-size: 11px !important;
            line-height: 1.35 !important;
            box-shadow: none !important;
          }
          @page {
            margin: 0;
          }
        }
      `}</style>

      {/* AREA STRUK THERMAL TERSEMBUNYI (HANYA MUNCUL SAAT PRINT) */}
      {printOrder && (
        <div id="thermal-receipt-area" className="hidden print:block">
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '6px', marginBottom: '6px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '13px', textTransform: 'uppercase' }}>
              {CAFE_CONFIG.name}
            </div>
            <div style={{ fontSize: '9px' }}>{CAFE_CONFIG.address}</div>
          </div>

          <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', marginBottom: '6px', fontSize: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Order:</span>
              <span style={{ fontWeight: 'bold' }}>{printOrder.orderCode || printOrder.id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Waktu:</span>
              <span>
                {printOrder.createdDate ? `${printOrder.createdDate} ` : ''}
                {printOrder.createdAt || printOrder.printedAt}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Meja:</span>
              <span style={{ fontWeight: 'bold' }}>{printOrder.table}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Pemesan:</span>
              <span>{printOrder.customerName}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Metode:</span>
              <span>{printOrder.paymentMethod}</span>
            </div>
          </div>

          <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', marginBottom: '6px' }}>
            {printOrder.items?.map((it, idx) => (
              <div key={it.cartId || idx} style={{ marginBottom: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span>
                    {it.qty}x {it.name}
                  </span>
                  <span>{formatIDR(it.unitPrice * it.qty)}</span>
                </div>
                {it.variantSummary && (
                  <div style={{ fontSize: '9px', paddingLeft: '8px' }}>- {it.variantSummary}</div>
                )}
                {it.addons?.length > 0 && (
                  <div style={{ fontSize: '9px', paddingLeft: '8px' }}>
                    + {it.addons.map((a) => a.name).join(', ')}
                  </div>
                )}
                {it.note && (
                  <div style={{ fontSize: '9px', paddingLeft: '8px', fontStyle: 'italic' }}>
                    Cat: {it.note}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ fontSize: '10px', marginBottom: '8px' }}>
            {printOrder.taxAmount > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Subtotal</span>
                  <span>{formatIDR(printOrder.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Pajak ({CAFE_CONFIG.taxPercentage}%)</span>
                  <span>{formatIDR(printOrder.taxAmount)}</span>
                </div>
              </>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 'bold',
                fontSize: '12px',
                marginTop: '3px',
                borderTop: '1px solid #000',
                paddingTop: '3px',
              }}
            >
              <span>TOTAL</span>
              <span>{formatIDR(printOrder.total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
              <span>Status:</span>
              <span style={{ fontWeight: 'bold' }}>LUNAS ({printOrder.status})</span>
            </div>
          </div>

          <div style={{ textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '6px', fontSize: '9px' }}>
            <div>Terima kasih telah memesan!</div>
            <div>Simpan struk ini sebagai bukti pesanan</div>
          </div>
        </div>
      )}

      {/* MAIN APP UI (TERSEMBUNYI SAAT PRINT) */}
      <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-amber-500/30 selection:text-amber-200 print:hidden">
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

            {/* Navigasi: Hanya muncul penuh saat mode staf / owner aktif */}
            {!isCustomerView && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1">
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
                  {activeOrders.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        activeTab === 'kitchen'
                          ? 'bg-zinc-950 text-amber-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {activeOrders.length}
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
                <button
                  onClick={requestOwnerTab}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'riwayat'
                      ? 'bg-amber-500 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  Riwayat
                  {clearedOrders.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        activeTab === 'riwayat'
                          ? 'bg-zinc-950 text-amber-400'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {clearedOrders.length}
                    </span>
                  )}
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
              {filteredMenus.map((menu) => {
                const soldOut = isMenuSoldOut(menu);

                return (
                  <article
                    key={menu.id}
                    className={`group flex flex-col justify-between overflow-hidden rounded-2xl border transition ${
                      soldOut
                        ? 'border-zinc-800/60 bg-zinc-900/35 opacity-75'
                        : 'border-zinc-800/90 bg-zinc-900/60 hover:border-amber-500/50 hover:bg-zinc-900'
                    }`}
                  >
                    <div>
                      <div className="relative h-44 w-full overflow-hidden bg-zinc-950">
                        <img
                          src={menu.image}
                          alt={menu.name}
                          className={`h-full w-full object-cover transition duration-500 ${
                            soldOut ? 'grayscale' : 'group-hover:scale-105'
                          }`}
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
                        <span className="absolute left-3 top-3 rounded-md border border-zinc-700/80 bg-zinc-950/85 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                          {menu.category}
                        </span>
                        {soldOut ? (
                          <span className="absolute right-3 top-3 rounded-md border border-rose-500/50 bg-rose-950/90 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-rose-300">
                            Sold Out
                          </span>
                        ) : (
                          menu.popular && (
                            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-950">
                              <Flame className="h-3 w-3" />
                              Best Seller
                            </span>
                          )
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
                        type="button"
                        disabled={soldOut}
                        onClick={() => openCustomizeModal(menu)}
                        className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                          soldOut
                            ? 'cursor-not-allowed border border-zinc-700 bg-zinc-800 text-zinc-500'
                            : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 active:scale-95'
                        }`}
                      >
                        <Plus className="h-4 w-4" />
                        {soldOut ? 'Habis' : 'Pilih'}
                      </button>
                    </div>
                  </article>
                );
              })}
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
                  Konfirmasi pembayaran kasir otomatis mencetak struk jika <span className="font-semibold text-amber-400">Auto-Print</span> aktif.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoPrintEnabled((prev) => !prev)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    autoPrintEnabled
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                  }`}
                  title="Cetak struk otomatis saat konfirmasi/scan bayar kasir"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {autoPrintEnabled ? 'Auto-Print: ON' : 'Auto-Print: OFF'}
                </button>

                <button
                  type="button"
                  onClick={() => setSoundEnabled((prev) => !prev)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    soundEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                  }`}
                  title="Toggle suara notifikasi pesanan baru"
                >
                  {soundEnabled ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                  {soundEnabled ? 'Suara Aktif' : 'Suara Muted'}
                </button>

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
                    Cari Kode
                  </button>
                </form>
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

            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center">
                <ChefHat className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
                <p className="text-sm font-semibold text-zinc-300">Belum ada pesanan aktif</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Buka tab <span className="text-amber-400">Menu</span> untuk membuat pesanan baru, atau cek tab <span className="text-emerald-400">Riwayat</span> untuk order yang sudah Clear.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {activeOrders.map((ord) => {
                  const isPendingPayment = ord.status === 'Konfirmasi Kasir';

                  return (
                    <div
                      key={ord.id}
                      className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-amber-400">
                                {ord.orderCode || ord.id}
                              </span>

                              {isPendingPayment ? (
                                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                  Menunggu Pembayaran
                                </span>
                              ) : (
                                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                  Pembayaran Berhasil
                                </span>
                              )}
                            </div>

                            <p className="mt-1 text-sm font-bold text-white">
                              {ord.table} • {ord.customerName}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => triggerReceiptPrint(ord)}
                              title="Cetak Struk Fisik"
                              className="rounded-lg border border-zinc-700 bg-zinc-950 p-1.5 text-zinc-300 transition hover:border-amber-500 hover:text-amber-400"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <span className="font-mono text-xs text-zinc-400">{ord.createdAt}</span>
                          </div>
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
                            Bayar:{' '}
                            <strong className="text-zinc-200">
                              {ord.paymentMethod || (isPendingPayment ? 'Kasir/Tunai' : 'QRIS')}
                            </strong>
                          </span>
                          <span className="font-mono text-sm font-bold text-amber-400">
                            {formatIDR(ord.total)}
                          </span>
                        </div>

                        {isPendingPayment ? (
                          <button
                            type="button"
                            onClick={() => updateOrderStatus(ord.id, 'Menunggu Masak', true)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            {autoPrintEnabled
                              ? 'Konfirmasi & Cetak Struk'
                              : 'Konfirmasi Pembayaran'}
                          </button>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-3 gap-1.5">
                              {['Menunggu Masak', 'Sedang Disiapkan', 'Siap'].map((st) => {
                                const isCurrent = ord.status === st;
                                return (
                                  <button
                                    key={st}
                                    type="button"
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

                            {ord.status === 'Siap' && (
                              <button
                                type="button"
                                onClick={() => updateOrderStatus(ord.id, 'Clear')}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500 hover:text-zinc-950"
                              >
                                <CheckCheck className="h-3.5 w-3.5" />
                                Selesai & Pindahkan ke Riwayat (Clear)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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

        {/* TAB 4: RIWAYAT OWNER (CLEAR ORDERS + FILTER + EXCEL EXPORT + HAPUS SEMENTARA) */}
        {activeTab === 'riwayat' && (
          <main className="mx-auto max-w-6xl px-4 py-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                  OWNER PANEL • STATUS CLEAR
                </div>
                <h2 className="mt-1.5 text-xl font-bold text-white">Riwayat Pesanan Selesai (Clear)</h2>
                <p className="text-xs text-zinc-400">
                  Menampilkan pesanan berstatus <strong className="text-zinc-200">Clear</strong> yang terpisah dari antrean dapur aktif.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportClearedToExcel}
                  disabled={filteredClearedOrders.length === 0}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export Excel (.xlsx)
                </button>

                {clearedOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={deleteClearedOrders}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus Riwayat (Sementara)
                  </button>
                )}
              </div>
            </div>

            {/* Filter & Pencarian */}
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Cari kode ORD, nama pemesan, atau meja..."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {['Semua', 'QRIS', 'Kasir/Tunai'].map((method) => {
                  const active = historyPaymentFilter === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setHistoryPaymentFilter(method)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-amber-500 bg-amber-500 text-zinc-950'
                          : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      {method}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ringkasan */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <span className="font-mono text-[11px] uppercase text-zinc-400">
                  Order Clear Terfilter
                </span>
                <p className="mt-1 font-mono text-2xl font-extrabold text-white">
                  {filteredClearedOrders.length}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <span className="font-mono text-[11px] uppercase text-zinc-400">
                  Total Omzet Terfilter (Clear)
                </span>
                <p className="mt-1 font-mono text-2xl font-extrabold text-emerald-400">
                  {formatIDR(filteredClearedRevenue)}
                </p>
              </div>
            </div>

            {filteredClearedOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center">
                <History className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
                <p className="text-sm font-semibold text-zinc-300">
                  {clearedOrders.length === 0
                    ? 'Belum ada pesanan berstatus Clear'
                    : 'Tidak ada riwayat yang cocok dengan filter'}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {clearedOrders.length === 0 ? (
                    <>
                      Set pesanan di tab <span className="text-amber-400">Dapur</span> ke{' '}
                      <span className="text-zinc-200">Siap</span> lalu klik{' '}
                      <span className="text-emerald-400">Selesai & Pindahkan ke Riwayat (Clear)</span>.
                    </>
                  ) : (
                    'Coba ubah kata kunci pencarian atau pilih filter metode pembayaran Semua.'
                  )}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-800 bg-zinc-950/80 font-mono text-[11px] uppercase text-zinc-400">
                    <tr>
                      <th className="px-4 py-3">Kode</th>
                      <th className="px-4 py-3">Waktu</th>
                      <th className="px-4 py-3">Lokasi & Pemesan</th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Pembayaran</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {filteredClearedOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-zinc-950/40">
                        <td className="px-4 py-3 font-mono font-bold text-amber-400">
                          {ord.orderCode || ord.id}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-zinc-400">
                          {ord.createdDate ? `${ord.createdDate} • ` : ''}
                          {ord.createdAt}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-white">{ord.table}</span>
                          <span className="text-zinc-400"> • {ord.customerName}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          {ord.items.map((it) => `${it.qty}x ${it.name}`).join(', ')}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                            {ord.paymentMethod}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-bold text-emerald-400">
                          {formatIDR(ord.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        )}

        {/* MODAL PIN STAF / OWNER */}
        {pinModalRole && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <form
              onSubmit={handlePinSubmit}
              className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400">
                  <Lock className="h-4 w-4" />
                  <h3 className="text-sm font-bold text-white">
                    {pinModalRole === 'owner' ? 'Akses Owner (Riwayat)' : 'Akses Kasir / Dapur'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPinModalRole(null);
                    setPendingTab(null);
                  }}
                  className="rounded-lg border border-zinc-700 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-xs text-zinc-400">
                Masukkan PIN {pinModalRole === 'owner' ? 'owner' : 'staf'} (default demo:{' '}
                <span className="font-mono text-amber-400">
                  {pinModalRole === 'owner' ? OWNER_PIN : STAFF_PIN}
                </span>
                ).
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
                {pinModalRole === 'owner' ? 'Buka Riwayat Owner' : 'Masuk Panel Staf'}
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="text-sm font-bold">Pesanan Berhasil Dibuat!</span>
                      </div>
                      <button
                        type="button"
                        onClick={fetchOrders}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 font-mono text-[10px] text-zinc-300 hover:border-amber-500 hover:text-amber-400"
                      >
                        Refresh Status
                      </button>
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
                        <span className="text-zinc-500">Status Pesanan</span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 font-semibold ${
                            activeReceipt.status === 'Siap' || activeReceipt.status === 'Clear'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {activeReceipt.status}
                        </span>
                      </div>
                    </div>

                    {activeReceipt.paymentMethod === 'Kasir/Tunai' &&
                      activeReceipt.status === 'Konfirmasi Kasir' && (
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
    </>
  );
}