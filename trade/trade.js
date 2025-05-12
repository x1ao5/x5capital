let currentSymbol = "BTCUSDT";
let dropdownOpen = false;

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

async function connectWallet() {
  if (typeof window.ethereum !== "undefined") {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const address = await signer.getAddress();
      const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
      document.getElementById("wallet-button").innerText = short;
      localStorage.setItem("x5_wallet", address);
      showToast("✅ 錢包已連接");
    } catch (err) {
      console.error("❌ Wallet connect failed", err);
    }
  } else {
    alert("請安裝 MetaMask 或啟用錢包！");
  }
}

function disconnectWallet() {
  localStorage.removeItem("x5_wallet");
  document.getElementById("wallet-button").innerText = "Connect Wallet";
  showToast("👋 錢包已斷開連接");
}

function updateWalletButtonOnLoad() {
  const stored = localStorage.getItem("x5_wallet");
  if (stored) {
    const short = `${stored.slice(0, 6)}...${stored.slice(-4)}`;
    document.getElementById("wallet-button").innerText = short;
  }
}

async function fetchMarketData(symbol) {
  try {
    const url = `https://corsproxy.io/?https://api.mexc.com/api/v3/ticker/24hr?symbol=${symbol}`;
    const res = await fetch(url);
    const data = await res.json();

    document.getElementById("selected-symbol").innerText = `${symbol.replace("USDT", "")}/USDT`;
    document.getElementById("price").innerText = `$${parseFloat(data.lastPrice).toFixed(6)}`;
    document.getElementById("change").innerText = `${parseFloat(data.priceChangePercent).toFixed(2)}%`;
    document.getElementById("volume").innerText = parseFloat(data.volume).toFixed(2);
  } catch (err) {
    console.error("❌ Failed to fetch market data", err);
  }
}

function updateActiveSymbol(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll("#symbol-list li").forEach((el) => {
    el.classList.remove("active");
    if (el.dataset.symbol === symbol) el.classList.add("active");
  });

  fetchMarketData(symbol);
  initChart(symbol);
}

function initChart(symbol = "BTCUSDT") {
  const mappedSymbol = symbol.replace("USDT", "USDT");
  setTimeout(() => {
    if (window.tvWidget) window.tvWidget.remove();
    window.tvWidget = new TradingView.widget({
      autosize: true,
      symbol: `BINANCE:${mappedSymbol}`,
      interval: "15",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "zh",
      toolbar_bg: "#0b0b0b",
      enable_publishing: false,
      allow_symbol_change: false,
      container_id: "tv-chart",
    });
  }, 300);
}

async function fetchMexcAvailableUSDT() {
  const apiKey = localStorage.getItem("mexc_api_key");
  const apiSecret = localStorage.getItem("mexc_api_secret");
  if (!apiKey || !apiSecret) {
    showToast("❌ 尚未設定 API 金鑰");
    return;
  }

  const reqTime = Date.now();
  const signPayload = `req_time=${reqTime}`;
  const signature = CryptoJS.HmacSHA256(signPayload, apiSecret).toString();

  try {
    const response = await fetch("https://x5-mexc-proxy.a0960582395.workers.dev", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    apiKey: localStorage.getItem("mexc_api_key"),
    apiSecret: localStorage.getItem("mexc_api_secret")
  })
});

    const json = await response.json();
    const usdtAsset = json.data.find(item => item.currency === "USDT");

    const available = usdtAsset?.availableBalance || 0;
    document.getElementById("available-usdt").innerText = available.toFixed(2);
    window.maxAvailableUSDT = available;
  } catch (err) {
    console.error("❌ 查詢餘額失敗", err);
    showToast("❌ 餘額查詢失敗");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateWalletButtonOnLoad();
  fetchMexcAvailableUSDT();

  document.getElementById("wallet-button").addEventListener("click", () => {
    const connected = localStorage.getItem("x5_wallet");
    if (!connected) {
      connectWallet();
    } else {
      dropdownOpen = !dropdownOpen;
      document.getElementById("wallet-dropdown").style.display = dropdownOpen ? "block" : "none";
    }
  });

  document.getElementById("copy-address").addEventListener("click", (e) => {
  e.stopPropagation();
  const addr = localStorage.getItem("x5_wallet");
  if (addr) {
    navigator.clipboard.writeText(addr);
    showToast("📋 地址已複製");
  }
  closeDropdown();
});

  document.getElementById("view-explorer").addEventListener("click", (e) => {
  e.stopPropagation();
  const addr = localStorage.getItem("x5_wallet");
  if (addr) {
    window.open(`https://etherscan.io/address/${addr}`, "_blank");
  }
  closeDropdown();
});

  document.getElementById("disconnect-wallet").addEventListener("click", (e) => {
  e.stopPropagation();
  disconnectWallet();
  closeDropdown();
});

  document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // 切換 active 按鈕
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // 切換 tab 區塊
    const selected = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.getElementById(selected).classList.add("active");
  });
});


  // 幣種切換點擊事件
  document.querySelectorAll("#symbol-list li").forEach((el) => {
  el.addEventListener("click", () => {
    updateActiveSymbol(el.dataset.symbol);
   });
  });

  const openOrderBtn = document.getElementById("open-order-btn");
  const orderPanel = document.querySelector(".order-panel");

  if (openOrderBtn && orderPanel) {
  openOrderBtn.addEventListener("click", () => {
    orderPanel.classList.add("active");
  });
}

  const closeOrderBtn = document.getElementById("close-order-panel");

if (closeOrderBtn && orderPanel) {
  closeOrderBtn.addEventListener("click", () => {
    orderPanel.classList.remove("active");
  });
}

  document.getElementById("api-settings-trigger").addEventListener("click", () => {
    document.getElementById("api-settings").style.display = "block";
  });

  document.getElementById("close-api").addEventListener("click", () => {
    document.getElementById("api-settings").style.display = "none";
  });

  const saveApiBtn = document.getElementById("save-api");
  const apiKeyInput = document.getElementById("api-key");
  const apiSecretInput = document.getElementById("api-secret");

  if (saveApiBtn && apiKeyInput && apiSecretInput) {
    saveApiBtn.addEventListener("click", () => {
      const key = apiKeyInput.value.trim();
      const secret = apiSecretInput.value.trim();

      if (!key || !secret) {
        showToast("❌ 請輸入完整金鑰");
        return;
      }

      localStorage.setItem("mexc_api_key", key);
      localStorage.setItem("mexc_api_secret", secret);
      document.getElementById("api-settings").style.display = "none";
      showToast("✅ API 金鑰已儲存");
      fetchMexcAvailableUSDT();
    });
  }

  document.querySelectorAll(".order-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".order-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const isLimit = tab.dataset.type === "limit";
      const priceInput = document.getElementById("price-input");
      priceInput.style.display = isLimit ? "block" : "none";
    });
  });

  const leverageSlider = document.getElementById("leverage-slider");
  const leverageValue = document.getElementById("leverage-value");
  leverageSlider.addEventListener("input", () => {
    leverageValue.innerText = `${leverageSlider.value}x`;
  });

  const percentRange = document.getElementById("percent-range");
  const quantityInput = document.getElementById("quantity-input");
  percentRange.addEventListener("input", () => {
    const percent = parseInt(percentRange.value, 10);
    const maxAvailable = window.maxAvailableUSDT || 100;
    const qty = (maxAvailable * percent / 100).toFixed(2);
    quantityInput.value = qty;
  });

  updateActiveSymbol(currentSymbol);
  setInterval(() => fetchMarketData(currentSymbol), 5000);
});