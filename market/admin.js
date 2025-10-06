// ===== Config + helpers =====
const baseEl = document.getElementById('base');
const tokenEl = document.getElementById('token');
const msg = (el, s) => el && (el.textContent = s);

baseEl.value = localStorage.getItem('admin_base') || 'https://x5capital.onrender.com';
tokenEl.value = localStorage.getItem('admin_token') || '';

function headersJson(){
  const h = { 'Content-Type': 'application/json' };
  const t = tokenEl.value.trim();
  if (t) h['x-admin-token'] = t;
  return h;
}
async function j(method, path, body){
  const r = await fetch(`${baseEl.value.trim()}${path}`, {
    method,
    headers: headersJson(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
function pad2(n){ return String(n).padStart(2,'0'); }
function ts(v){
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function money(n){ return Number(n||0).toFixed(2); }
function toast(s){ console.log('[admin]', s); }

// ===== Tabs =====
const tabs = document.querySelectorAll('[data-tab]');
tabs.forEach(btn => btn.onclick = () => {
  tabs.forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
});

// ===== Save base+token =====
document.getElementById('save').onclick = () => {
  localStorage.setItem('admin_base', baseEl.value.trim());
  localStorage.setItem('admin_token', tokenEl.value.trim());
  toast('saved');
};

// ===== Items =====
const itemsTbody = document.querySelector('#itemsTable tbody');
const qEl = document.getElementById('q');
const sortEl = document.getElementById('sort');

let ITEMS = [];
async function loadItems(){
  const { items } = await j('GET', '/items');
  ITEMS = items || [];
  renderItems();
}
function renderItems(){
  const q = qEl.value.trim().toLowerCase();
  const list = ITEMS
    .filter(it => (it.id||'').toLowerCase().includes(q) || (it.title||'').toLowerCase().includes(q))
    .sort((a,b)=>{
      if (sortEl.value==='title') return (a.title||'').localeCompare(b.title||'');
      if (sortEl.value==='recent') return String(b.created_at||'').localeCompare(String(a.created_at||''));
      return (a.sort_order??9999) - (b.sort_order??9999);
    });

  itemsTbody.innerHTML = list.map(it => `
    <tr data-id="${it.id}">
      <td>
        <div class="flex">
          <img src="${it.img||''}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid #222" onerror="this.style.display='none'">
          <div>
            <div><strong>${it.title||'-'}</strong> <span class="muted">(${it.id})</span></div>
            <div class="muted" style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.description||''}</div>
          </div>
        </div>
      </td>
      <td>${it.category||'-'}</td>
      <td class="right">$${money(it.price)} USDT</td>
      <td class="right">${Number(it.stock||0)}</td>
      <td class="right">${it.sort_order==null?'-':it.sort_order}</td>
      <td>
        <div class="row">
          <button data-act="edit">編輯</button>
          <button data-act="dec">-1</button>
          <button data-act="inc">+1</button>
          <button data-act="set">Set</button>
          <button data-act="sort">Sort</button>
          <button data-act="del" class="warn">刪除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.getElementById('reloadItems').onclick = loadItems;
qEl.oninput = renderItems;
sortEl.onchange = renderItems;

itemsTbody.onclick = async (e) => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const id = tr.dataset.id;
  const act = e.target.dataset.act;
  const it = ITEMS.find(x=>x.id===id);
  if (!id || !act || !it) return;

  try {
    if (act==='edit') {
      // 填入表單
      document.getElementById('formTitle').textContent = '編輯商品';
      document.getElementById('f_id').value = it.id;
      document.getElementById('f_sku').value = it.sku || it.id || '';
      document.getElementById('f_title').value = it.title || '';
      document.getElementById('f_desc').value = it.description || '';
      document.getElementById('f_category').value = it.category || '';
      document.getElementById('f_price').value = it.price || 0;
      document.getElementById('f_stock').value = it.stock || 0;
      document.getElementById('f_img').value = it.img || '';
      document.getElementById('f_sort').value = it.sort_order ?? '';
      return;
    }
    if (act==='inc' || act==='dec') {
      const delta = act==='inc' ? +1 : -1;
      const r = await j('POST', `/items/${encodeURIComponent(id)}/adjust`, { delta });
      toast(`stock: ${r.item.stock}`);
      await loadItems();
      return;
    }
    if (act==='set') {
      const v = prompt('設定庫存為：', String(it.stock||0));
      if (v==null) return;
      const stock = Math.max(0, Number(v));
      await j('POST', `/items/${encodeURIComponent(id)}/set-stock`, { stock });
      await loadItems();
      return;
    }
    if (act==='sort') {
      const v = prompt('sort_order（數字，可空）', it.sort_order ?? '');
      const sortOrder = v === '' ? null : Number(v);
      await j('POST', `/items/${encodeURIComponent(id)}/sort`, { sortOrder });
      await loadItems();
      return;
    }
    if (act==='del') {
      if (!confirm(`確定刪除 ${id}？（若已被訂單引用，將改為設置 stock=0）`)) return;
      const r = await j('DELETE', `/items/${encodeURIComponent(id)}`);
      if (r.ok) toast('deleted'); else toast(r.note || 'stock set to 0');
      await loadItems();
      return;
    }
  } catch (err) {
    alert(err.message);
  }
};

// 表單：upsert（修：正確宣告 id 與 sku，移除多餘括號）
document.getElementById('submitItem').onclick = async ()=>{
  const id  = document.getElementById('f_id').value.trim();
  const sku = (document.getElementById('f_sku').value || id).trim();

  const body = {
    id,
    sku, // ← 把 sku 一起送；後端沒填會 fallback = id
    title: document.getElementById('f_title').value.trim(),
    description: document.getElementById('f_desc').value.trim(),
    category: document.getElementById('f_category').value.trim() || null,
    price: Number(document.getElementById('f_price').value||0),
    stock: Number(document.getElementById('f_stock').value||0),
    img: document.getElementById('f_img').value.trim() || null,
    sortOrder: document.getElementById('f_sort').value==='' ? null : Number(document.getElementById('f_sort').value),
  };
  const msgEl = document.getElementById('formMsg');
  try {
    if (!body.id || !body.title) { msg(msgEl, 'id / title 必填'); return; }
    await j('POST', '/items/upsert', body);
    msg(msgEl, '已保存 ✔');
    await loadItems();
  } catch (e) {
    msg(msgEl, e.message);
  }
};
document.getElementById('resetForm').onclick = ()=>{
  document.getElementById('formTitle').textContent = '新增 / 編輯商品';
  ['f_id','f_sku','f_title','f_desc','f_category','f_price','f_stock','f_img','f_sort']
    .forEach(i=>document.getElementById(i).value='');
  msg(document.getElementById('formMsg'),'');
};

// 匯出 / 匯入
document.getElementById('exportItems').onclick = ()=>{
  const arr = ITEMS.map(it => ({
    id: it.id, sku: it.sku || it.id,
    title: it.title, description: it.description || '',
    category: it.category || null, price: Number(it.price||0), stock: Number(it.stock||0),
    img: it.img || null, sortOrder: it.sort_order ?? null
  }));
  const blob = new Blob([JSON.stringify(arr, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='items.json'; a.click();
};
document.getElementById('importItems').onclick = ()=>{
  document.querySelector('[data-tab="tools"]').click();
  document.getElementById('jsonArea').focus();
};

// ===== Orders =====
const ordersTbody = document.querySelector('#ordersTable tbody');
const oCountEl = document.getElementById('ordersCount');

async function loadOrders(){
  const status = document.getElementById('o_status').value || '';
  const q = document.getElementById('o_q').value.trim();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  params.set('limit', '100');
  try{
    const { orders } = await j('GET', `/orders/admin?${params.toString()}`);
    renderOrders(orders||[]);
  }catch{
    // 後端沒更新也能 fallback 少量看看
    const rows = await j('GET', '/orders/debug-latest');
    renderOrders(rows||[]);
  }
}
function renderOrders(list){
  oCountEl.textContent = `${list.length} 筆`;
  ordersTbody.innerHTML = list.map(o=>{
    const st = String(o.status||'').toLowerCase();
    const tx = o.txHash ? `<a href="https://arbiscan.io/tx/${o.txHash}" target="_blank">tx</a>` : '-';
    const act = st==='pending'
      ? `<button data-act="ocancel" data-id="${o.id}" class="warn">取消</button>`
      : `<button data-act="oitems" data-id="${o.id}">明細</button>`;
    return `<tr data-id="${o.id}">
      <td><strong>${o.id}</strong></td>
      <td>${o.asset||''} ${money(o.amount)}</td>
      <td>${st}</td>
      <td>${ts(o.created_at)}</td>
      <td>${ts(o.expiresAt || o.expires_at)}</td>
      <td class="row">${tx} ${act}</td>
    </tr>`;
  }).join('');
}
document.getElementById('reloadOrders').onclick = loadOrders;
document.getElementById('o_status').onchange = loadOrders;
document.getElementById('o_q').oninput = () => { clearTimeout(window.__o); window.__o = setTimeout(loadOrders, 300); };

ordersTbody.onclick = async (e)=>{
  const id = e.target.dataset.id;
  const act = e.target.dataset.act;
  if (!id || !act) return;
  try{
    if (act==='ocancel'){
      if (!confirm(`取消訂單 ${id}？`)) return;
      await j('POST', `/orders/${encodeURIComponent(id)}/cancel`);
      await loadOrders();
      return;
    }
    if (act==='oitems'){
      const { items } = await j('GET', `/orders/${encodeURIComponent(id)}/items`);
      alert(items.map(it=>`${it.itemId} × ${it.qty}（$${money(it.price)}）`).join('\n') || '無明細');
      return;
    }
  }catch(err){
    alert(err.message);
  }
};

// ===== Tools =====
document.getElementById('sweep').onclick = async ()=>{
  const out = document.getElementById('sweepMsg');
  try{
    const r = await j('POST', '/orders/sweep-expired');
    msg(out, `已處理 expired: ${r.expired||0}`);
    await loadItems();
    await loadOrders();
  }catch(e){
    msg(out, e.message);
  }
};

// 批次 upsert
document.getElementById('bulkUpsert').onclick = async ()=>{
  const out = document.getElementById('bulkMsg');
  out.textContent='';
  try{
    const raw = document.getElementById('jsonArea').value.trim();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('格式需為陣列');
    // 優先用 bulk API；失敗則逐筆 upsert
    try {
      await j('POST', '/items/bulk-upsert', arr);
    } catch {
      for (const it of arr) { // 逐筆
        // eslint-disable-next-line no-await-in-loop
        await j('POST', '/items/upsert', it);
      }
    }
    out.textContent = '完成 ✔';
    await loadItems();
  }catch(e){
    out.textContent = e.message;
  }
};

// ===== Init =====
(async function init(){
  await loadItems();
  await loadOrders();
})();
