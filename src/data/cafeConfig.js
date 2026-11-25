export const CAFE_CONFIG = {
  name: "KALA ROASTERY & EATERY",
  tagline: "Scan, Pesan, Nikmati Tanpa Antre",
  address: "Jl. Margonda Raya No. 88, Depok",
  currency: "Rp",
  taxPercentage: 10, // PPN 10% (isi 0 jika tanpa pajak)
  qrisMerchantName: "KALA ROASTERY DEPOK",
  nmid: "ID1020268899123",
  categories: ["Semua", "Signature Coffee", "Non-Coffee", "Makanan Berat", "Camilan"],
  menus: [
    {
      id: "kopi-1",
      name: "Es Kopi Susu Kala Gula Aren",
      category: "Signature Coffee",
      price: 22000,
      image: "https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=600&q=80",
      description: "Perpaduan espresso house blend, susu segar creamy, dan gula aren organik.",
      popular: true,
      options: {
        temperature: ["Ice", "Hot"],
        sugar: ["Normal Sugar", "Less Sugar", "No Sugar"],
        addons: [
          { name: "Extra Espresso Shot", price: 5000 },
          { name: "Oat Milk", price: 7000 }
        ]
      }
    },
    {
      id: "kopi-2",
      name: "Caramel Macchiato",
      category: "Signature Coffee",
      price: 28000,
      image: "https://images.unsplash.com/photo-1485808191679-5f86510681a2?auto=format&fit=crop&w=600&q=80",
      description: "Espresso lembut dengan vanilla syrup, steamed milk, dan saus karamel.",
      popular: false,
      options: {
        temperature: ["Ice", "Hot"],
        sugar: ["Normal Sugar", "Less Sugar"],
        addons: [{ name: "Extra Caramel Drizzle", price: 4000 }]
      }
    },
    {
      id: "non-1",
      name: "Matcha Uji Latte",
      category: "Non-Coffee",
      price: 26000,
      image: "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=600&q=80",
      description: "Bubuk matcha autentik Jepang dikocok dengan susu segar.",
      popular: true,
      options: {
        temperature: ["Ice", "Hot"],
        sugar: ["Normal Sugar", "Less Sugar"],
        addons: [{ name: "Oat Milk", price: 7000 }]
      }
    },
    {
      id: "makan-1",
      name: "Rice Bowl Chicken Salted Egg",
      category: "Makanan Berat",
      price: 32000,
      image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=600&q=80",
      description: "Nasi hangat dengan ayam crispy saus telur asin gurih dan telur mata sapi.",
      popular: true,
      options: {
        spiceLevel: ["Tidak Pedas", "Pedas Sedang", "Extra Pedas"],
        addons: [{ name: "Extra Telur Mata Sapi", price: 5000 }]
      }
    },
    {
      id: "snack-1",
      name: "Truffle French Fries",
      category: "Camilan",
      price: 20000,
      image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&q=80",
      description: "Kentang goreng renyah berbalut minyak truffle dan taburan keju parmesan.",
      popular: false,
      options: {
        addons: [{ name: "Extra Saus Keju", price: 4000 }]
      }
    },
    {
      id: "snack-2",
      name: "Mac&Cheese",
      category: "Camilan",
      price: 25000,
      image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&q=80",
      description: "Makaroni berbalut cheese mozarella premium dan taburan keju parmesan.",
      popular: false,
      options: {
        addons: [{ name: "Extra Saus Keju", price: 4000 },
                 { name: "Chili Oil", price: 5000 }
        ]         
      }
    }
  ]
};