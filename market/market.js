'use strict';

const BACKEND_BASE   = 'https://x5capital.onrender.com';
const RECEIVING_ADDR = '0x9c7291a52e4653a5c0501ea999e5e3fca41a1471';
const ORDERS_PATHS   = ['/orders'];

/* ====== 小工具 ====== */
const NGROK_BYPASS_HEADER = { 'ngrok-skip-browser-warning': 'any' };
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
function showToast(msg){ const t=$('#toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1600); }
function toUnits(amount, decimals){
  const [i,f=''] = String(amount).split('.');
  const padded = (f + '0'.repeat(decimals)).slice(0,decimals);
  return BigInt(i + padded);
}

/* ---- 統一的 JSON 取用（加 ngrok 繞過） ---- */
async function fetchJSON(url, opt={}) {
  const u = new URL(url);
  u.searchParams.set('ngrok-skip-browser-warning', 'true'); // 雙保險：query + header
  const r = await fetch(u.toString(), {
    cache:'no-store',
    ...opt,
    headers:{ ...(opt.headers||{}), ...NGROK_BYPASS_HEADER }
  });
  const ct  = r.headers.get('content-type')||'';
  const txt = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0,120)}`);
  if(!/json/i.test(ct)) throw new Error('Not JSON: ' + txt.slice(0,120));
  return JSON.parse(txt);
}

/* ====== 產品（示例） ====== */
window.PRODUCTS = [
  { id:'nft-hero',   title:'X5 Genesis NFT',   desc:'首發收藏',        price:49,  category:'nft',        img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:5 },
  { id:'design-pack',title:'Logo / Banner 設計包', desc:'品牌識別',     price:120, category:'design',     img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:3 },
  { id:'alpha-pass', title:'Alpha Pass(月)',    desc:'觀測專區',        price:19,  category:'membership',  img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:50 },
  { id:'pfp-pack',   title:'PFP 快速上線包',     desc:'10 張頭像',      price:35,  category:'design',     img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:10 },
  { id:'ads-slot',   title:'網站曝光位(7天)',    desc:'首頁/Blog 曝光',  price:150, category:'ads',        img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:2 },
  { id:'mint-credit',title:'鑄造點數(100次)',    desc:'/mint 配額',     price:25,  category:'credits',    img:'https://i.ibb.co/k2H7kfrt/Newx5logo-1.png', stock:100 },
  { id:'cs2-skin',   title:'蝴蝶刀(★) | 傳說',   desc:'Butterfly knife', price:1,   category:'cs2',       img:'https://spect.fp.ps.netease.com/file/6863b6a2949bfc538d443a11zlgOYbHd06', stock:1 }
];

/* ====== CART ====== */
const CART_KEY='x5_cart_v1';
let cart=[];
function loadCart(){ try{ cart=JSON.parse(localStorage.getItem(CART_KEY))||[]; }catch{ cart=[]; } }
function saveCart(){ try{ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }catch{} }
function getCartTotal(){ return cart.reduce((s,it)=>{ const p=PRODUCTS.find(x=>x.id===it.id); return p?s+p.price*it.qty:s; },0); }
function updateCartBadge(){ const n=cart.reduce((s,i)=>s+i.qty,0); const b=$('#cartBtn'); if(b) b.textContent='Cart ('+n+')'; }
function openCart(open){ const d=$('#cartDrawer'); if(!d) return; d.classList.toggle('open',open!==false); }
function addToCart(id){
  const p = PRODUCTS.find(x=>x.id===id); if(!p) return;
  const existed = cart.find(i=>i.id===id);
  const current = existed?existed.qty:0;
  const remain = isFinite(p.stock)?(p.stock-current):Infinity;
  if(remain<=0){ showToast('庫存不足'); return; }
  if(existed) existed.qty+=1; else cart.push({id,qty:1});
  saveCart(); updateCartBadge(); renderCart(); openCart(true);
}
function renderCart(){
  const box=$('#cartItems'); if(!box) return;
  if(cart.length===0){ box.innerHTML='<div style="color:var(--x5-muted);">購物車目前是空的～</div>'; calcTotal(); return; }
  box.innerHTML = cart.map(it=>{
    const p=PRODUCTS.find(x=>x.id===it.id)||{};
    const remain = isFinite(p.stock)?p.stock:Infinity;
    return `<div class="drawer-item" data-id="${it.id}">
      <div class="it-thumb"><img src="${p.img||''}" alt="${p.title||''}"></div>
      <div class="it-meta"><div class="it-title">${p.title||'-'}</div><div class="it-sub">$${p.price||0} USDT</div></div>
      <div class="it-act">
        <div class="qty">
          <button data-dec="${it.id}">−</button>
          <span>${it.qty}</span>
          <button data-inc="${it.id}" ${(remain-it.qty)<=0?'disabled':''}>+</button>
        </div>
        <button class="btn" data-del="${it.id}">移除</button>
      </div>
    </div>`;
  }).join('');
  calcTotal();
}
function calcTotal(){
  const sub=getCartTotal();
  const st=$('#subTotal'), gt=$('#grandTotal');
  if(st) st.textContent='$'+sub.toFixed(2)+' USDT';
  if(gt) gt.textContent='$'+sub.toFixed(2)+' USDT';
}

/* ====== 商品列表 ====== */
let selectedChain='eth';
let selectedAsset='USDT';
window.renderProducts = function(){
  const grid=$('#productGrid'); if(!grid) return;
  const q   = ($('#searchInput')?.value||'').toLowerCase().trim();
  const sort= $('#sortSelect')?.value||'featured';
  const cat = $('#categoryFilter')?.value||'all';
  let data  = PRODUCTS.filter(p=>{
    const okQ = p.title.toLowerCase().includes(q)||p.desc.toLowerCase().includes(q);
    const okC = (cat==='all')||p.category===cat;
    return okQ && okC;
  });
  if(sort==='price_asc')  data.sort((a,b)=>a.price-b.price);
  if(sort==='price_desc') data.sort((a,b)=>b.price-a.price);
  grid.innerHTML = data.map(p=>{
    const soldOut = isFinite(p.stock)&&p.stock<=0;
    return `<article class="card" data-id="${p.id}">
      <div class="thumb"><img src="${p.img}" alt="${p.title}"/></div>
      <div class="content">
        <div class="title">${p.title}</div>
        <div class="desc">${p.desc}</div>
        <div class="meta">
          <div class="price">$${p.price} <span style="color:var(--x5-muted);font-weight:600;">USDT</span></div>
          <div class="stock" style="color:var(--x5-muted);font-size:.9rem;">${soldOut?'售罄':'剩餘 '+p.stock}</div>
          <button class="add" data-add="${p.id}" ${soldOut?'disabled':''}>加入購物車</button>
        </div>
      </div>
    </article>`;
  }).join('');
};

/* ====== 本地訂單 ====== */
const ORDERS_KEY='x5_orders_v1';
let ordersLocal=[];
const pollMap = new Map();
function asStatus(v){ return v==null?'':String(v).toLowerCase(); }
function normalizeOrderStatus(o){
  if(!o) return false;
  if(asStatus(o.status)==='pending' && o.expiresAt && Date.now()>o.expiresAt){ o.status='expired'; return true; }
  return false;
}
function normalizeAllOrders(){ let ch=false; for(const o of ordersLocal){ if(normalizeOrderStatus(o)) ch=true; } if(ch) saveLocalOrders(); }
function loadLocalOrders(){ try{ ordersLocal=JSON.parse(localStorage.getItem(ORDERS_KEY))||[]; }catch{ ordersLocal=[]; } }
function saveLocalOrders(){ try{ localStorage.setItem(ORDERS_KEY, JSON.stringify(ordersLocal)); }catch{} }
function upsertLocalOrder(o){
  if(o && o.status!=null) o.status=asStatus(o.status);
  const i = ordersLocal.findIndex(x=>x.id===o.id);
  if(i>=0) ordersLocal[i] = Object.assign({}, ordersLocal[i], o);
  else ordersLocal.unshift(o);
  saveLocalOrders(); renderOrdersDrawer(); updateOrdersBadge();
}
function updateOrdersBadge(){ const n=ordersLocal.filter(o=>asStatus(o.status)==='pending').length; const b=$('#ordersBtn'); if(b) b.textContent='Orders ('+n+')'; }
function openOrders(open){ const d=$('#ordersDrawer'); if(!d) return; d.classList.toggle('open',open!==false); d.setAttribute('aria-hidden',open!==false?'false':'true'); if(open!==false){ normalizeAllOrders(); renderOrdersDrawer(); } }
function statusBadge(s){ s=asStatus(s); let c='#60a5fa'; if(s==='paid') c='#37d399'; else if(s==='expired') c='#f87272'; else if(s==='cancelled') c='#fb923c'; return `<span style="border:1px solid ${c};color:${c};padding:.1rem .5rem;border-radius:.6rem;font-size:.8rem;">${s}</span>`; }
function renderOrdersDrawer(){
  const box=$('#ordersList'); if(!box) return;
  normalizeAllOrders();
  if(ordersLocal.length===0){ box.innerHTML='<div style="color:var(--x5-muted);">目前沒有訂單</div>'; return; }
  box.innerHTML = ordersLocal.map(o=>{
    const st=asStatus(o.status);
    const amt = (o.amount ?? '—'), ast=(o.asset ?? '—');
    const actions = (st==='pending')
      ? `<div class="it-act"><button class="btn primary" data-order-reopen="${o.id}">前往付款</button><button class="btn warn" data-order-cancel="${o.id}">取消</button></div>`
      : `<div class="it-act"><button class="btn" data-order-view="${o.id}">查看</button></div>`;
    return `<div class="drawer-item" data-order="${o.id}">
      <div class="it-meta"><div class="it-title">${o.id}</div><div class="it-sub">${amt} ${ast} · ${statusBadge(st)}</div></div>
      ${actions}
    </div>`;
  }).join('');
}

/* ====== 後端 API （統一） ====== */
// 以 ID 取單（單一版本、同時同步到本地）
async function getOrder(id){
  const data = await fetchJSON(`${BACKEND_BASE}/orders/${encodeURIComponent(id)}?t=${Date.now()}`, {
    method:'GET',
    mode:'cors'
  });
  const o = data.order ?? data;
  if(o && o.id){
    upsertLocalOrder({
      id:o.id, status:o.status, asset:o.asset, amount:o.amount,
      expiresAt:o.expiresAt, txHash:o.txHash, network:o.network
    });
  }
  return o;
}

// 建單（命名與呼叫一致）
async function createOrder(orderId, asset, amount){
  const data = await fetchJSON(`${BACKEND_BASE}/orders`, {
    method:'POST',
    mode:'cors',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ id:orderId, asset, amount })
  });
  return data; // {order:{...}}
}

// 取消訂單
async function cancelOrder(orderId){
  try{
    await fetchJSON(`${BACKEND_BASE}/orders/${encodeURIComponent(orderId)}/cancel`, { method:'POST' });
  }catch{}
}

/* ====== QR ====== */
function loadScriptOnce(src){ return new Promise((res,rej)=>{ if(document.querySelector(`script[src="${src}"]`)) return res(); const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
function renderQR(data){
  const box=$('#qrBox'); if(!box) return Promise.resolve();
  box.innerHTML='';
  return loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js')
    .then(()=>{ if(window.QRCode){ new QRCode(box,{ text:String(data||''), width:160, height:160, correctLevel:QRCode.CorrectLevel.M }); }
                else { const img=new Image(); img.width=160; img.height=160; img.src='https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='+encodeURIComponent(String(data||'')); box.appendChild(img); } })
    .catch(()=>{ const img=new Image(); img.width=160; img.height=160; img.src='https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='+encodeURIComponent(String(data||'')); box.appendChild(img); });
}
function makeEip681(opt){
  const {asset,amount}=opt;
  if(asset==='ETH'){ const wei=toUnits(amount,18).toString(); return 'ethereum:'+RECEIVING_ADDR+'?value='+wei; }
  const USDT='0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'; // Arb One USDT
  const units=toUnits(amount,6).toString();
  return `ethereum:${USDT}/transfer?address=${RECEIVING_ADDR}&uint256=${units}`;
}

/* ====== 支付流程（輪詢 + TTL） ====== */
let lastOrderId=null, ttlTimer=null, isCheckingOut=false;
function startPolling(orderId){
  if(!orderId) return;
  if(pollMap.has(orderId)){ clearInterval(pollMap.get(orderId)); pollMap.delete(orderId); }
  const it = setInterval(async ()=>{
    try{
      const o = await getOrder(orderId);
      if(!o) return;
      const st = asStatus(o.status);
      upsertLocalOrder({ id:o.id, status:st, expiresAt:o.expiresAt, txHash:o.txHash, network:o.network });

      if(st==='paid'){
        clearInterval(it); pollMap.delete(orderId);
        showToast('付款成功'); const pm=$('#payMask'); if(pm) pm.style.display='none';
        isCheckingOut=false; const cb=$('#checkoutBtn'); if(cb) cb.disabled=false; return;
      }
      if(st==='expired' || st==='cancelled'){
        clearInterval(it); pollMap.delete(orderId);
        showToast(st==='expired'?'訂單已逾時':'訂單已取消'); const pm=$('#payMask'); if(pm) pm.style.display='none';
        isCheckingOut=false; const cb=$('#checkoutBtn'); if(cb) cb.disabled=false; return;
      }
      if(st==='pending' && normalizeOrderStatus({status:st,expiresAt:o.expiresAt})){
        upsertLocalOrder({ id:o.id, status:'expired' });
        clearInterval(it); pollMap.delete(orderId);
        showToast('訂單已逾時'); const pm=$('#payMask'); if(pm) pm.style.display='none';
        isCheckingOut=false; const cb=$('#checkoutBtn'); if(cb) cb.disabled=false;
      }
    }catch(err){
      console.warn('[poll] getOrder error:', err.message); // 不是致命，繼續輪詢
    }
  }, 2500);
  pollMap.set(orderId, it);
}
function startTTLCountdown(expiresAt){
  clearInterval(ttlTimer);
  const el=$('#ttlText'); if(!el) return;
  ttlTimer=setInterval(()=>{
    const left=Math.max(0,(expiresAt||0)-Date.now());
    const m=Math.floor(left/60000), s=Math.floor((left%60000)/1000);
    el.textContent = left>0 ? (`訂單將在 ${m}:${String(s).padStart(2,'0')} 後逾時`) : '訂單已逾時';
    if(left<=0) clearInterval(ttlTimer);
  },1000);
}

/* ====== 訂單詳情彈窗（只有一份的 UI 更新） ====== */
function updateOrderViewUI(order){
  if(!order) return;
  const st = asStatus(order.status||'pending');
  const idEl = $('#orderViewId');       if(idEl) idEl.textContent = order.id || '-';
  const amtEl= $('#orderViewAmount');   if(amtEl) amtEl.textContent = `${order.amount??'-'} ${order.asset??''}`;
  const stEl = $('#orderViewStatus');   if(stEl){ stEl.textContent = (st||'pending').toUpperCase();
    stEl.classList.remove('badge','badge-green','badge-yellow','badge-red','badge-gray');
    stEl.classList.add('badge', st==='paid'?'badge-green': st==='expired'?'badge-gray': st==='cancelled'?'badge-red':'badge-yellow');
  }
  const txEl = $('#orderViewTx');       if(txEl){ if(order.txHash){ txEl.innerHTML = `<a href="https://arbiscan.io/tx/${order.txHash}" target="_blank" rel="noreferrer">查看交易</a>`; } else { txEl.textContent='-'; } }
  const expEl= $('#orderViewExpireAt'); if(expEl && order.expiresAt){ const left=Math.max(0,Math.floor((order.expiresAt-Date.now())/1000)); expEl.textContent = left+' 秒'; }
}
function openOrderView(o){ updateOrderViewUI(o); const m=$('#orderViewMask'); if(m) m.style.display='grid'; }
function closeOrderView(){ const m=$('#orderViewMask'); if(m) m.style.display='none'; }

/* ====== 事件委派 ====== */
document.addEventListener('click', async (e)=>{
  const t=e.target;
  const add=t.getAttribute('data-add');
  const dec=t.getAttribute('data-dec');
  const inc=t.getAttribute('data-inc');
  const del=t.getAttribute('data-del');
  const chip=t.closest && t.closest('.chip');

  if(add){ addToCart(add); }
  if(dec){ const it=cart.find(i=>i.id===dec); if(it){ it.qty=Math.max(1,it.qty-1); saveCart(); renderCart(); updateCartBadge(); } }
  if(inc){
    const it2=cart.find(i=>i.id===inc), p=PRODUCTS.find(x=>x.id===inc);
    const current=(it2?.qty)||0, remain=isFinite(p?.stock)?(p.stock-current):Infinity;
    if(remain<=0){ showToast('庫存不足'); return; }
    if(it2){ it2.qty++; saveCart(); renderCart(); updateCartBadge(); }
  }
  if(del){ cart=cart.filter(i=>i.id!==del); saveCart(); renderCart(); updateCartBadge(); }

  if(chip && chip.dataset.chain){ selectedChain=chip.dataset.chain; $all('#chainRow .chip').forEach(n=>n.classList.toggle('active', n.dataset.chain===selectedChain)); }
  if(chip && chip.dataset.asset){ selectedAsset=chip.dataset.asset; $all('#assetRow .chip').forEach(n=>n.classList.toggle('active', n.dataset.asset===selectedAsset)); }

  const reopen=t.getAttribute('data-order-reopen');
  const cancel=t.getAttribute('data-order-cancel');
  const view  =t.getAttribute('data-order-view');

  if(reopen){
    const o=ordersLocal.find(x=>x.id===reopen); if(!o) return;
    lastOrderId=o.id; selectedAsset=o.asset;
    $all('#assetRow .chip').forEach(n=>n.classList.toggle('active', n.dataset.asset===selectedAsset));
    $('#orderIdText')   && ($('#orderIdText').textContent=o.id);
    $('#payAmountText') && ($('#payAmountText').textContent=o.amount+' '+o.asset);
    $('#payAddr')       && ($('#payAddr').textContent=RECEIVING_ADDR);
    await renderQR(makeEip681({asset:o.asset, amount:o.amount}));
    $('#payMask') && ($('#payMask').style.display='grid');
    startPolling(o.id);
    startTTLCountdown(o.expiresAt || (Date.now()+15*60*1000));
  }

  if(cancel){
    await cancelOrder(cancel);
    const o2=ordersLocal.find(x=>x.id===cancel);
    upsertLocalOrder({ id:cancel, status:'cancelled' });
    if(o2 && o2.items?.length){
      for(const it of o2.items){ const p=PRODUCTS.find(x=>x.id===it.id); if(p && isFinite(p.stock)) p.stock+=it.qty; }
      renderProducts(); renderCart();
    }
    if(pollMap.has(cancel)){ clearInterval(pollMap.get(cancel)); pollMap.delete(cancel); }
    updateOrdersBadge(); renderOrdersDrawer();
  }

  if(view){ const o3=ordersLocal.find(x=>x.id===view); if(!o3) return; openOrderView(o3); }

  // 訂單詳情：關閉/遮罩
  if(t.id==='closeOrderView') closeOrderView();
  if(t.id==='orderViewMask')  closeOrderView();

  // 訂單詳情：手動刷新
  if(t.id==='ovRefresh' && lastOrderId){
    try{ const o=await getOrder(lastOrderId); if(o){ upsertLocalOrder({ id:o.id, status:o.status, expiresAt:o.expiresAt, txHash:o.txHash, network:o.network }); updateOrderViewUI(o); showToast('已刷新'); } }
    catch{ showToast('查詢訂單失敗'); }
  }
});

/* Esc 關閉 */
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeOrderView(); const pm=$('#payMask'); if(pm) pm.style.display='none'; }});

/* ====== 額外綁定 ====== */
let btn;
btn=$('#cartBtn');     if(btn) btn.addEventListener('click', ()=>openCart(true));
btn=$('#closeCart');   if(btn) btn.addEventListener('click', ()=>openCart(false));
btn=$('#ordersBtn');   if(btn) btn.addEventListener('click', ()=>openOrders(true));
btn=$('#closeOrders'); if(btn) btn.addEventListener('click', ()=>openOrders(false));
btn=$('#refreshBtn');  if(btn) btn.addEventListener('click', renderProducts);
btn=$('#searchInput'); if(btn) btn.addEventListener('input', renderProducts);
btn=$('#sortSelect');  if(btn) btn.addEventListener('change', renderProducts);
btn=$('#categoryFilter'); if(btn) btn.addEventListener('change', renderProducts);

btn=$('#copyAddr'); if(btn) btn.addEventListener('click', ()=>{ try{ navigator.clipboard.writeText($('#payAddr').textContent.trim()); showToast('已複製收款地址'); }catch{ showToast('複製失敗'); } });

btn=$('#confirmPaid'); if(btn) btn.addEventListener('click', async ()=>{
  if(!lastOrderId) return;
  try{
    // 沒有也沒關係：這只是「通知」後端，可忽略錯誤
    await fetch(`${BACKEND_BASE}/orders/${encodeURIComponent(lastOrderId)}/confirm`, { method:'POST', mode:'cors', cache:'no-store', headers:NGROK_BYPASS_HEADER })
      .catch(()=>{ /* ignore */ });

    // 立即拉一次單 & 讓輪詢繼續跑
    const o=await getOrder(lastOrderId);
    if(o){ updateOrderViewUI(o); }
    showToast('我們已收到確認，等待鏈上確認');
  }catch{ showToast('確認付款失敗'); }
});

btn=$('#cancelOrder'); if(btn) btn.addEventListener('click', async ()=>{
  if(!lastOrderId) return;
  await cancelOrder(lastOrderId);
  const o=ordersLocal.find(x=>x.id===lastOrderId);
  upsertLocalOrder({ id:lastOrderId, status:'cancelled' });
  if(o && o.items?.length){ for(const it of o.items){ const p=PRODUCTS.find(x=>x.id===it.id); if(p && isFinite(p.stock)) p.stock+=it.qty; } renderProducts(); renderCart(); }
  if(pollMap.has(lastOrderId)){ clearInterval(pollMap.get(lastOrderId)); pollMap.delete(lastOrderId); }
  clearInterval(ttlTimer);
  const pm=$('#payMask'); if(pm) pm.style.display='none';
  isCheckingOut=false; const cb=$('#checkoutBtn'); if(cb) cb.disabled=false;
  updateOrdersBadge(); renderOrdersDrawer(); showToast('已取消訂單');
});
btn=$('#closePay'); if(btn) btn.addEventListener('click', ()=>{ const pm=$('#payMask'); if(pm) pm.style.display='none'; isCheckingOut=false; const cb=$('#checkoutBtn'); if(cb) cb.disabled=false; });

/* ====== CHECKOUT ====== */
btn=$('#checkoutBtn'); if(btn) btn.addEventListener('click', ()=>{
  if(isCheckingOut) return;
  if(cart.length===0){ showToast('購物車是空的'); return; }
  if(selectedChain!=='eth' || !['USDT','ETH'].includes(selectedAsset)){ showToast('目前僅支援 Ethereum (USDT/ETH)'); return; }

  isCheckingOut=true; const cb=$('#checkoutBtn'); if(cb) cb.disabled=true;
  const orderId='order-'+Date.now();
  const amount=Number(getCartTotal().toFixed(2));
  const asset =selectedAsset;

  createOrder(orderId, asset, amount).then(resp=>{
    const order = resp.order || { id:orderId, createdAt:Date.now(), expiresAt: Date.now()+15*60*1000, status:'pending' };
    lastOrderId = order.id;

    // 本地訂單
    upsertLocalOrder({ id:order.id, asset, amount, status:asStatus(order.status||'pending'),
      createdAt:order.createdAt, expiresAt:order.expiresAt, items: cart.map(it=>({id:it.id,qty:it.qty})) });

    // 扣庫存 + 清空購物車
    for(const it of cart){ const p=PRODUCTS.find(x=>x.id===it.id); if(p && isFinite(p.stock)) p.stock=Math.max(0,p.stock-it.qty); }
    cart=[]; saveCart(); updateCartBadge(); renderCart(); renderProducts();

    // 顯示付款資訊
    $('#orderIdText')   && ($('#orderIdText').textContent=order.id);
    $('#payAmountText') && ($('#payAmountText').textContent=amount+' '+asset);
    $('#payAddr')       && ($('#payAddr').textContent=RECEIVING_ADDR);

    return renderQR(makeEip681({asset,amount})).then(()=>{
      const pm=$('#payMask'); if(pm) pm.style.display='grid';
      startPolling(order.id);
      startTTLCountdown(order.expiresAt || (Date.now()+15*60*1000));
      updateOrdersBadge(); renderOrdersDrawer();
    });
  }).catch(err=>{
    console.error('create order failed:', err);
    showToast('建單失敗');
    isCheckingOut=false; const cb2=$('#checkoutBtn'); if(cb2) cb2.disabled=false;
  });
});

/* ====== BOOT ====== */
window.__market_boot_ran = window.__market_boot_ran || false;
window.__market_boot = function(){
  if(window.__market_boot_ran) return;
  window.__market_boot_ran = true;
  try{
    loadCart(); renderProducts(); renderCart(); updateCartBadge();
    loadLocalOrders(); normalizeAllOrders(); updateOrdersBadge(); renderOrdersDrawer();
    ordersLocal.filter(o=>asStatus(o.status)==='pending').forEach(o=>startPolling(o.id));
    console.log('[market] boot ok');
  }catch(err){
    console.error('[init error]', err); showToast('載入時發生錯誤(F12看console)');
  }
};
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', window.__market_boot, {once:true}); } else { window.__market_boot(); }

console.log('[market] market.js ready');

