
/* global React */
const { useEffect, useMemo, useRef, useState } = React;

// ====== 可自訂品牌（套你的 Logo / 配色） ======
const BRAND = {
  name: "Airdrop",
  // 放你的 logo，若不想顯示 logo 就設為 null
  logoSrc: "https://i.ibb.co/q3DYk2jr/Newx5logo.png",
};

// ====== 任務資料格式（替換為你的 API 回傳即可） ======
// Task schema 參考：
// {
//   id: "string",
//   title: "Follow & Retweet to join allowlist",
//   project: "CoolProject",
//   chain: "ETH" | "SOL" | "BNB" | "BASE" | "ARB" | "BLAST" | "OP" | "SUI" | ...,
//   category: "社交" | "上鏈互動" | "研究" | "測試網" | ...,
//   platform: "官方" | "交易所" | "Galxe" | "Zealy" | "QuestN" | ...,
//   reward_type: "Token" | "Points" | "WL" | "NFT" | "Raffle",
//   reward_est_usd: number,
//   difficulty: 1|2|3|4|5,
//   risk: "低" | "中" | "高",
//   startAt: string, // ISO
//   endAt: string,   // ISO
//   url: "https://...",
//   tags: ["DeFi", "L2", "Social"],
//   steps: [{ id: "s1", label: "Follow @xxx", type: "social", link: "https://x.com/..." }, ...]
// }

const MOCK_TASKS = [
  {
    id: "t1",
    title: "Follow & Repost 開啟通知",
    project: "OrbiterX",
    chain: "ETH",
    category: "社交",
    platform: "官方",
    reward_type: "Points",
    reward_est_usd: 15,
    difficulty: 1,
    risk: "低",
    startAt: isoOffsetMinutes(-24 * 60 * 7),
    endAt: isoOffsetMinutes(24 * 60 * 7),
    url: "https://x.com/",
    tags: ["L2", "Bridge"],
    steps: [
      { id: "s1", label: "Follow 官方帳號", type: "social", link: "https://x.com/" },
      { id: "s2", label: "Repost 置頂貼文", type: "social", link: "https://x.com/" },
      { id: "s3", label: "在貼文下方留言 #OrbiterX", type: "social" },
    ],
  },
  {
    id: "t2",
    title: "跨鏈一次（>= 10 USD）",
    project: "FluidBridge",
    chain: "BASE",
    category: "上鏈互動",
    platform: "官方",
    reward_type: "Token",
    reward_est_usd: 40,
    difficulty: 3,
    risk: "中",
    startAt: isoOffsetMinutes(-24 * 60 * 2),
    endAt: isoOffsetMinutes(24 * 60 * 10),
    url: "https://app.example/bridge",
    tags: ["Bridge", "DEX"],
    steps: [
      { id: "s1", label: "連接錢包", type: "onchain" },
      { id: "s2", label: "從 ETH → BASE 跨鏈 ≥ $10", type: "onchain" },
      { id: "s3", label: "簽名提交任務", type: "onchain" },
    ],
  },
  {
    id: "t3",
    title: "完成 3 個 Zealy 任務",
    project: "Lumen",
    chain: "SOL",
    category: "社交",
    platform: "Zealy",
    reward_type: "WL",
    reward_est_usd: 0,
    difficulty: 2,
    risk: "低",
    startAt: isoOffsetMinutes(-24 * 60 * 1),
    endAt: isoOffsetMinutes(24 * 60 * 20),
    url: "https://zealy.io/",
    tags: ["Solana", "WL"],
    steps: [
      { id: "s1", label: "加入 Discord", type: "social" },
      { id: "s2", label: "完成每日挑戰", type: "social" },
      { id: "s3", label: "上傳錢包地址", type: "social" },
    ],
  },
  {
    id: "t4",
    title: "Swap 兩次 + 提供 LP",
    project: "HyperDEX",
    chain: "ARB",
    category: "上鏈互動",
    platform: "官方",
    reward_type: "Token",
    reward_est_usd: 55,
    difficulty: 4,
    risk: "中",
    startAt: isoOffsetMinutes(-24 * 60 * 14),
    endAt: isoOffsetMinutes(24 * 60 * 1),
    url: "https://hyperdex.app",
    tags: ["DEX", "LP"],
    steps: [
      { id: "s1", label: "Swap #1", type: "onchain" },
      { id: "s2", label: "Swap #2", type: "onchain" },
      { id: "s3", label: "提供 7 天 LP", type: "onchain" },
    ],
  },
  {
    id: "t5",
    title: "測試網提交 3 筆交易",
    project: "Nebula",
    chain: "OP",
    category: "測試網",
    platform: "官方",
    reward_type: "NFT",
    reward_est_usd: 5,
    difficulty: 2,
    risk: "低",
    startAt: isoOffsetMinutes(-24 * 60 * 3),
    endAt: isoOffsetMinutes(24 * 60 * 30),
    url: "https://test.nebula.dev",
    tags: ["Testnet"],
    steps: [
      { id: "s1", label: "申請水龍頭", type: "onchain" },
      { id: "s2", label: "送三筆交易", type: "onchain" },
      { id: "s3", label: "回報錯誤", type: "research" },
    ],
  },
  {
    id: "t6",
    title: "完成 QuestN 週任務 5/7",
    project: "Aqua",
    chain: "BNB",
    category: "社交",
    platform: "QuestN",
    reward_type: "Points",
    reward_est_usd: 10,
    difficulty: 2,
    risk: "低",
    startAt: isoOffsetMinutes(-24 * 60 * 5),
    endAt: isoOffsetMinutes(24 * 60 * 2),
    url: "https://questn.com/",
    tags: ["BNB", "Quest"],
    steps: [
      { id: "s1", label: "Follow", type: "social" },
      { id: "s2", label: "轉推", type: "social" },
      { id: "s3", label: "連接錢包", type: "social" },
      { id: "s4", label: "完成額外任務", type: "social" },
    ],
  },
  {
    id: "t7",
    title: "寫一篇測試回饋（≥150字）",
    project: "Echo",
    chain: "BLAST",
    category: "研究",
    platform: "官方",
    reward_type: "Raffle",
    reward_est_usd: 0,
    difficulty: 3,
    risk: "高",
    startAt: isoOffsetMinutes(-24 * 60 * 9),
    endAt: isoOffsetMinutes(-24 * 60 * 1),
    url: "https://echo.gitbook.io",
    tags: ["Audit", "Feedback"],
    steps: [
      { id: "s1", label: "使用產品 30 分鐘", type: "research" },
      { id: "s2", label: "撰寫回饋表單", type: "research" },
    ],
  },
  {
    id: "t8",
    title: "鑄造 NFT（Gas ≤ $1）",
    project: "Minty",
    chain: "BASE",
    category: "上鏈互動",
    platform: "官方",
    reward_type: "NFT",
    reward_est_usd: 3,
    difficulty: 1,
    risk: "低",
    startAt: isoOffsetMinutes(-24 * 60 * 2),
    endAt: isoOffsetMinutes(24 * 60 * 60),
    url: "https://minty.xyz",
    tags: ["NFT"],
    steps: [
      { id: "s1", label: "連接錢包", type: "onchain" },
      { id: "s2", label: "鑄造任一 NFT", type: "onchain" },
    ],
  },
];

// ====== 工具 ======
function isoOffsetMinutes(mins) {
  const d = new Date(Date.now() + mins * 60 * 1000);
  return d.toISOString();
}
function clsx(...arr) { return arr.filter(Boolean).join(" "); }
function fmtDate(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}
function toStatus(task) {
  const now = Date.now();
  const s = new Date(task.startAt).getTime();
  const e = new Date(task.endAt).getTime();
  if (now < s) return "未開始";
  if (now > e) return "已結束";
  return "進行中";
}
function downloadFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function toICS(tasks) {
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0",`PRODID:-//${BRAND.name}//CN`];
  tasks.forEach((t) => {
    const uid = `${t.id}@x5airdrop.local`;
    const dtStart = new Date(t.endAt);
    const stamp = dtStart.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const endStamp = stamp;
    const summary = `${t.project} — ${t.title}`;
    const desc = `鏈: ${t.chain}\\n類別: ${t.category}\\n平台: ${t.platform}\\n獎勵: ${t.reward_type} ~ $${t.reward_est_usd}\\n連結: ${t.url}`;
    lines.push("BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${stamp}`,`DTSTART:${stamp}`,`DTEND:${endStamp}`,`SUMMARY:${escapeICS(summary)}`,`DESCRIPTION:${escapeICS(desc)}`,`URL:${t.url}`,"END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function escapeICS(s) { return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function toCSV(tasks) {
  const header = ["id","title","project","chain","category","platform","reward_type","reward_est_usd","difficulty","risk","startAt","endAt","url","tags"];
  const rows = tasks.map(t => [t.id,t.title,t.project,t.chain,t.category,t.platform,t.reward_type,t.reward_est_usd,t.difficulty,t.risk,t.startAt,t.endAt,t.url,(t.tags||[]).join("|")]);
  return [header, ...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
}
function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}

const CHAINS = ["ETH","SOL","BNB","BASE","ARB","BLAST","OP","SUI","MONAD","AVAX","X5"];
const CATEGORIES = ["社交","上鏈互動","研究","測試網","x5"];
const PLATFORMS = ["官方","交易所","Galxe","Zealy","QuestN"];
const RISKS = ["低","中","高"];
const RWD_TYPES = ["Token","Points","WL","NFT","Raffle"];
// 用圖片管理鏈的 icon
const CHAIN_ICON_SRC = {
  ETH: "./assets/chains/eth.svg",
  SOL: "./assets/chains/sol.svg",
  BNB: "./assets/chains/bnb.svg",
  BASE:"./assets/chains/base.svg",
  ARB: "./assets/chains/arb.svg",
  BLAST:"./assets/chains/blast.svg",
  OP:  "./assets/chains/op.svg",
  SUI: "./assets/chains/sui.svg",
  MONAD: "./assets/chains/monad.svg",
  AVAX: "./assets/chains/avax.svg",
  X5: "./assets/chains/x5.svg",
  _:   "./assets/chains/generic.svg", // fallback
};

// 小元件：顯示鏈 icon（載不到就換預設）
function ChainIcon({ chain, size = 24, className = "" }) {
  const src = CHAIN_ICON_SRC[chain] || CHAIN_ICON_SRC._;
  return (
    <img
      src={src}
      alt={chain}
      width={size}
      height={size}
      loading="lazy"
      onError={(e)=>{ e.currentTarget.src = CHAIN_ICON_SRC._; }}
      className={`inline-block object-contain ${className}`}
    />
  );
}

// ====== 元件 ======
function AirdropHub() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tasks, setTasks] = useState([]);

  const [subs, setSubs] = useLocalStorage("x5_airdrop_subs", {});
  const [progress, setProgress] = useLocalStorage("x5_airdrop_progress", {});
  const [favs, setFavs] = useLocalStorage("x5_airdrop_favs", {});

  // 篩選器
  const [q, setQ] = useState(qs("q") || "");
  const [selChains, setSelChains] = useState(parseQSMulti("chains"));
  const [selCats, setSelCats] = useState(parseQSMulti("cats"));
  const [selPlatforms, setSelPlatforms] = useState(parseQSMulti("plats"));
  const [selRisks, setSelRisks] = useState(parseQSMulti("risks"));
  const [selRwd, setSelRwd] = useState(parseQSMulti("rwd"));
  const [status, setStatus] = useState(qs("status") || "全部");
  const [sortBy, setSortBy] = useState(qs("sort") || "綜合");
  const [onlySubs, setOnlySubs] = useState(qs("subs") === "1");
  const [limit, setLimit] = useState(20);
  const [modalTask, setModalTask] = useState(null);

  // 初次載入（模擬 API）
  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      setTasks(MOCK_TASKS);
      setLoading(false);
    }, 500);
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  // URL 深連結
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status !== "全部") sp.set("status", status);
    if (sortBy !== "綜合") sp.set("sort", sortBy);
    if (onlySubs) sp.set("subs", "1");
    if (selChains.length) sp.set("chains", selChains.join("."));
    if (selCats.length) sp.set("cats", selCats.join("."));
    if (selPlatforms.length) sp.set("plats", selPlatforms.join("."));
    if (selRisks.length) sp.set("risks", selRisks.join("."));
    if (selRwd.length) sp.set("rwd", selRwd.join("."));
    const url = `${location.pathname}?${sp.toString()}`;
    window.history.replaceState({}, "", url);
  }, [q, status, sortBy, onlySubs, selChains, selCats, selPlatforms, selRisks, selRwd]);

  const filtered = useMemo(() => {
    let arr = tasks.slice();
    if (q) {
      const k = q.toLowerCase();
      arr = arr.filter(t => [t.title, t.project, t.chain, t.category, t.platform, (t.tags||[]).join(" ")].join(" ").toLowerCase().includes(k));
    }
    if (status !== "全部") arr = arr.filter(t => toStatus(t) === status);
    if (selChains.length) arr = arr.filter(t => selChains.includes(t.chain));
    if (selCats.length) arr = arr.filter(t => selCats.includes(t.category));
    if (selPlatforms.length) arr = arr.filter(t => selPlatforms.includes(t.platform));
    if (selRisks.length) arr = arr.filter(t => selRisks.includes(t.risk));
    if (selRwd.length) arr = arr.filter(t => selRwd.includes(t.reward_type));
    if (onlySubs) arr = arr.filter(t => subs[t.id]);

    switch (sortBy) {
      case "截止時間": arr.sort((a,b)=> new Date(a.endAt) - new Date(b.endAt)); break;
      case "獎勵價值": arr.sort((a,b)=> (b.reward_est_usd||0) - (a.reward_est_usd||0)); break;
      case "難度": arr.sort((a,b)=> a.difficulty - b.difficulty); break;
      case "最新建立": arr.sort((a,b)=> new Date(b.startAt) - new Date(a.startAt)); break;
      default:
        arr.sort((a,b)=>{
          const sa = toStatus(a), sb = toStatus(b);
          const w = v => v === "進行中" ? 0 : v === "未開始" ? 1 : 2;
          const dw = w(sa) - w(sb);
          if (dw !== 0) return dw;
          const de = new Date(a.endAt) - new Date(b.endAt);
          if (de !== 0) return de;
          return (b.reward_est_usd||0) - (a.reward_est_usd||0);
        });
    }
    return arr;
  }, [tasks, q, status, selChains, selCats, selPlatforms, selRisks, selRwd, onlySubs, sortBy, subs]);

  const stats = useMemo(() => {
    const live = tasks.filter(t=>toStatus(t)==="進行中").length;
    const upcoming = tasks.filter(t=>toStatus(t)==="未開始").length;
    const ended = tasks.filter(t=>toStatus(t)==="已結束").length;
    const subCount = Object.values(subs).filter(Boolean).length;
    const tv = tasks.reduce((s,t)=> s + (t.reward_est_usd||0), 0);
    return { live, upcoming, ended, subCount, totalValue: tv };
  }, [tasks, subs]);

  const visible = filtered.slice(0, limit);

  function toggleSub(id) { setSubs(prev => ({ ...prev, [id]: !prev[id] })); }
  function setStepDone(taskId, stepId, done) {
    setProgress(prev => ({ ...prev, [taskId]: { ...(prev[taskId]||{}), [stepId]: done } }));
  }
  function resetFilters() {
    setQ(""); setStatus("全部");
    setSelChains([]); setSelCats([]); setSelPlatforms([]); setSelRisks([]); setSelRwd([]);
    setOnlySubs(false); setSortBy("綜合");
  }
  function handleExportICS() { const arr = filtered.length ? filtered : tasks; downloadFile("airdrop-tasks.ics", toICS(arr), "text/calendar;charset=utf-8"); }
  function handleExportCSV() { const arr = filtered.length ? filtered : tasks; downloadFile("airdrop-tasks.csv", toCSV(arr), "text/csv;charset=utf-8"); }
  function handleImportJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("JSON 必須是陣列");
        const cleaned = arr.map((t,i)=> ({
          id: t.id || `imp_${Date.now()}_${i}`,
          title: t.title || "Untitled",
          project: t.project || "Unknown",
          chain: t.chain || "ETH",
          category: t.category || "社交",
          platform: t.platform || "官方",
          reward_type: t.reward_type || "Points",
          reward_est_usd: Number(t.reward_est_usd||0),
          difficulty: Number(t.difficulty||1),
          risk: t.risk || "低",
          startAt: t.startAt || new Date().toISOString(),
          endAt: t.endAt || isoOffsetMinutes(24*60*7),
          url: t.url || "",
          tags: Array.isArray(t.tags) ? t.tags : [],
          steps: Array.isArray(t.steps) ? t.steps : [],
        }));
        setTasks(prev => dedupeById([...cleaned, ...prev]));
      } catch (e) { alert(`匯入失敗：${e.message}`); }
    };
    reader.readAsText(file);
  }
  function dedupeById(arr) { const m = new Map(); for (const t of arr) m.set(t.id, t); return Array.from(m.values()); }

  // ====== Header（品牌 + 統計 + Calendar 按鈕 + 匯出/匯入下拉 + 登入） ======
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 backdrop-blur border-b border-white/10 bg-neutral-950/70">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          {/* 品牌：Logo + 名稱（模仿你站上的 Navbar 左側） */}
          {BRAND.logoSrc ? (
            <a href="./index.html" className="flex items-center gap-2">
              <img src={BRAND.logoSrc} alt={BRAND.name} className="h-7 w-7 rounded" />
              <span className="hidden sm:block text-sm font-semibold">{BRAND.name}</span>
            </a>
          ) : (
            <div className={clsx("px-3 py-1 rounded-xl text-sm font-semibold bg-gradient-to-r", BRAND.accent, "text-white shadow")}>{BRAND.name}</div>
          )}

          <div className="hidden md:flex items-center gap-2 text-xs text-neutral-400">
            <StatPill label="進行中" value={stats.live} />
            <StatPill label="未開始" value={stats.upcoming} />
            <StatPill label="已結束" value={stats.ended} />
            <StatPill label="訂閱" value={stats.subCount} />
            <StatPill label="總獎勵$" value={stats.totalValue} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* 收益日曆按鈕（放在下拉左邊） */}
            <a href="./earnings.html" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm bg-white/10 hover:bg-white/20 border border-white/10">
              <CalendarIcon /> <span className="hidden sm:inline">收益日曆</span>
            </a>

            {/* 匯出/匯入（合併成一個下拉） */}
            <ExportDropdown
              onExportICS={handleExportICS}
              onExportCSV={handleExportCSV}
              onImportJSON={handleImportJSON}
            />

          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* 搜尋與狀態列 */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center mb-4">
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                value={q}
                onChange={e=>setQ(e.target.value)}
                placeholder="搜尋任務、專案、鏈、標籤…"
                className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-2.5 outline-none focus:ring-2 focus:ring-white/20"
              />
              {q && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white" onClick={()=>setQ("")}>✕</button>
              )}
            </div>
            <Select value={status} onChange={setStatus} options={["全部","進行中","未開始","已結束"]} />
            <Select value={sortBy} onChange={setSortBy} options={["綜合","截止時間","獎勵價值","難度","最新建立"]} />
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="scale-110 accent-white" checked={onlySubs} onChange={e=>setOnlySubs(e.target.checked)} />
              只看已訂閱
            </label>
            <button onClick={resetFilters} className="px-3 py-1.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 border border-white/10">重置</button>
          </div>
        </div>

        {/* 篩選器群 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <FilterGroup label="鏈" composite>
  <div className="flex flex-wrap gap-2">
    {CHAINS.map((chain) => (
      <Chip
        key={chain}
        active={selChains.includes(chain)}
        onClick={() => toggleInList(chain, selChains, setSelChains)}
      >
        <span className="flex items-center gap-1">
          <ChainIcon chain={chain} size={14} />
          <span>{chain}</span>
        </span>
      </Chip>
    ))}
  </div>
</FilterGroup>
          <FilterGroup label="類別" options={CATEGORIES} selected={selCats} onToggle={(v)=>toggleInList(v, selCats, setSelCats)} chips />
          <FilterGroup label="平台" options={PLATFORMS} selected={selPlatforms} onToggle={(v)=>toggleInList(v, selPlatforms, setSelPlatforms)} chips />
          <FilterGroup label="風險/獎勵" composite>
            <div className="flex flex-wrap gap-2">
              {RISKS.map(v => (<Chip key={v} active={selRisks.includes(v)} onClick={()=>toggleInList(v, selRisks, setSelRisks)}>{v}風險</Chip>))}
              {RWD_TYPES.map(v => (<Chip key={v} active={selRwd.includes(v)} onClick={()=>toggleInList(v, selRwd, setSelRwd)}>{v}</Chip>))}
            </div>
          </FilterGroup>
        </div>

        {/* 內容區 */}
        {loading ? (
          <SkeletonList />
        ) : error ? (
          <ErrorBlock retry={()=>{ setLoading(true); setError(null); setTimeout(()=>{ setTasks(MOCK_TASKS); setLoading(false); }, 800); }} />
        ) : (
          <>
            {visible.length === 0 ? (
              <EmptyBlock onClear={resetFilters} />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visible.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    subscribed={!!subs[t.id]}
                    fav={!!favs[t.id]}
                    onToggleFav={()=> setFavs(prev=> ({...prev, [t.id]: !prev[t.id]}))}
                    onToggleSub={()=> toggleSub(t.id)}
                    onOpen={()=> setModalTask(t)}
                    progress={progress[t.id]||{}}
                  />
                ))}
              </div>
            )}

            {visible.length < filtered.length && (
              <div className="flex justify-center mt-6">
                <button onClick={()=>setLimit(limit+20)} className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/10">載入更多</button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 text-sm text-neutral-500">
        <div className="border-t border-white/10 pt-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} X5 Capital. All rights reserved. 非投資建議。任務連結可能導向第三方。</div>
          <div className="opacity-80">最近更新：{fmtDate(new Date().toISOString())}</div>
        </div>
      </footer>

      {modalTask && (
        <TaskModal
          task={modalTask}
          onClose={()=>setModalTask(null)}
          subscribed={!!subs[modalTask.id]}
          onToggleSub={()=>toggleSub(modalTask.id)}
          progress={progress[modalTask.id]||{}}
          setStepDone={(stepId,done)=> setStepDone(modalTask.id, stepId, done)}
        />
      )}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
      <span className="text-neutral-300 mr-2">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

// ====== 匯出/匯入下拉 ======
function ExportDropdown({ onExportICS, onExportCSV, onImportJSON }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{
    const onClick = (e)=>{ if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('click', onClick);
    return ()=> window.removeEventListener('click', onClick);
  },[]);

  function chooseFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = (e)=>{
      const f = e.target.files && e.target.files[0];
      if (f) onImportJSON(f);
    };
    inp.click();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={()=>setOpen(!open)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm bg-white/10 hover:bg-white/20 border border-white/10">
        工具
        <svg width="14" height="14" viewBox="0 0 24 24" className={clsx("transition", open ? "rotate-180" : "")}><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 min-w-[180px] rounded-xl border border-white/10 bg-neutral-900 shadow-lg overflow-hidden z-50">
          <button onClick={()=>{ setOpen(false); onExportICS(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/10">匯出 .ics（行事曆）</button>
          <button onClick={()=>{ setOpen(false); onExportCSV(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/10">匯出 CSV</button>
          <div className="border-t border-white/10"></div>
          <button onClick={()=>{ setOpen(false); chooseFile(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/10">匯入 JSON</button>
        </div>
      )}
    </div>
  );
}

// ====== 其他小元件 ======
function ActionButton({ onClick, label }) {
  return (
    <button onClick={onClick} className={clsx("px-3 py-1.5 rounded-xl text-sm font-medium bg-gradient-to-r", BRAND.accent, "text-white/90 hover:text-white border border-white/10 shadow")}>{label}</button>
  );
}
function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e=>onChange(e.target.value)}
        className="appearance-none rounded-xl bg-white/5 border border-white/10 px-3 py-2 pr-8 text-sm hover:bg-white/10"
        style={{ colorScheme: 'dark' }}
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      {/* 自己放一個小箭頭，避免系統亮色箭頭跑出來 */}
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-70" width="14" height="14" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7 10l5 5 5-5z"/>
      </svg>
    </div>
  );
}
function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={clsx("px-3 py-1.5 rounded-full text-xs border", active ? "bg-white text-black border-white" : "bg-white/5 border-white/10 hover:bg-white/10 text-neutral-200")}>{children}</button>
  );
}
function FilterGroup({ label, options = [], selected = [], onToggle, chips, composite, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-2 text-sm text-neutral-300">{label}</div>
      {composite ? (
        children
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map(v => chips ? (
            <Chip key={v} active={selected.includes(v)} onClick={()=>onToggle(v)}>
              {label === "鏈" && CHAIN_EMOJI[v] ? `${CHAIN_EMOJI[v]} ` : ""}{v}
            </Chip>
          ) : (
            <label key={v} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="scale-110 accent-white" checked={selected.includes(v)} onChange={()=>onToggle(v)} /> {v}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function toggleInList(v, list, setList) { setList(list.includes(v) ? list.filter(x=>x!==v) : [...list, v]); }
function Badge({ children, tone = "neutral" }) {
  const toneClass = {
    neutral: "bg-white/10 text-white border-white/10",
    green: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
    yellow: "bg-amber-500/20 text-amber-200 border-amber-400/30",
    red: "bg-rose-500/20 text-rose-200 border-rose-400/30",
    blue: "bg-sky-500/20 text-sky-200 border-sky-400/30",
    purple: "bg-violet-500/20 text-violet-200 border-violet-400/30",
  }[tone];
  return <span className={clsx("px-2 py-0.5 rounded-lg text-[11px] border", toneClass)}>{children}</span>;
}
function TaskCard({ task, subscribed, fav, onToggleFav, onToggleSub, onOpen, progress }) {
  const s = toStatus(task);
  const progCount = Object.values(progress||{}).filter(Boolean).length;
  const totalSteps = (task.steps||[]).length;
  const progPct = totalSteps ? Math.round((100*progCount)/totalSteps) : 0;

  return (
    <div className="group rounded-2xl border border-white/10 bg-white/5 overflow-hidden hover:border-white/20 transition">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0"><ChainIcon chain={task.chain} size={28} className="rounded" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{task.title}</span>
              <Badge tone={s==="進行中"?"green":s==="未開始"?"blue":"red"}>{s}</Badge>
              <Badge tone="purple">{task.platform}</Badge>
              <Badge>{task.category}</Badge>
            </div>
            <div className="text-sm text-neutral-400 truncate">{task.project} · {task.chain} · 截止 {fmtDate(task.endAt)}</div>
          </div>
          <button title="收藏" onClick={onToggleFav} className={clsx("text-xl", fav?"opacity-100":"opacity-40 hover:opacity-80")}>★</button>
        </div>

        {/* Tags / Reward / Difficulty */}
        <div className="flex flex-wrap items-center gap-2">
          {(task.tags||[]).slice(0,4).map(tag => <span key={tag} className="text-xs text-neutral-300">#{tag}</span>)}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Badge tone="yellow">{task.reward_type} ~ ${task.reward_est_usd}</Badge>
            <Badge>難度 {"★".repeat(task.difficulty)}</Badge>
            <Badge tone={task.risk==="低"?"green":task.risk==="中"?"yellow":"red"}>{task.risk}風險</Badge>
          </div>
        </div>

        {/* Progress bar */}
        {totalSteps>0 && (
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-white/70" style={{ width: `${progPct}%` }} />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <a href={task.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-xl text-sm bg-white text-black hover:opacity-90">前往任務</a>
          <button onClick={onOpen} className="px-3 py-1.5 rounded-xl text-sm bg-white/10 hover:bg-white/20 border border-white/10">查看步驟</button>
          <button onClick={onToggleSub} className={clsx("ml-auto px-3 py-1.5 rounded-xl text-sm border", subscribed?"bg-emerald-400/20 border-emerald-400/40 text-emerald-200":"bg-white/10 hover:bg-white/20 border-white/10")}>{subscribed?"已訂閱":"訂閱提醒"}</button>
        </div>
      </div>
    </div>
  );
}
function SkeletonList() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 9 }).map((_,i)=> (
        <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4 animate-pulse">
          <div className="h-5 w-2/3 bg-white/10 rounded mb-3" />
          <div className="h-3 w-1/3 bg-white/10 rounded mb-1.5" />
          <div className="h-3 w-1/2 bg-white/10 rounded mb-4" />
          <div className="h-2 w-full bg-white/10 rounded mb-3" />
          <div className="h-8 w-1/2 bg-white/10 rounded" />
        </div>
      ))}
    </div>
  );
}
function ErrorBlock({ retry }) {
  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-rose-100">
      <div className="text-lg font-semibold mb-1">服務忙碌，資料載入失敗</div>
      <div className="opacity-80 mb-3">請稍後重試，或檢查 API / CORS 設定。</div>
      <button onClick={retry} className="px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-400/30">重新整理</button>
    </div>
  );
}
function EmptyBlock({ onClear }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
      <div className="text-xl font-semibold mb-2">找不到符合條件的任務</div>
      <div className="text-neutral-400 mb-4">試著清除篩選或更換關鍵字，馬上再找看看。</div>
      <button onClick={onClear} className="px-4 py-2 rounded-xl bg-white text-black">清除所有篩選</button>
    </div>
  );
}
function TaskModal({ task, onClose, subscribed, onToggleSub, progress, setStepDone }) {
  const s = toStatus(task);
  const dialogRef = useRef(null);
  useEffect(() => { const onKey = (e)=> e.key === 'Escape' && onClose(); window.addEventListener('keydown', onKey); return ()=> window.removeEventListener('keydown', onKey); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-end md:items-center justify-center p-0 md:p-6" onClick={(e)=>{ if(e.target===dialogRef.current) onClose(); }}>
      <div ref={dialogRef} className="w-full md:w-[720px] max-h-[80vh] overflow-auto rounded-t-3xl md:rounded-3xl border border-white/10 bg-neutral-900">
        <div className="p-4 border-b border-white/10 flex items-start gap-3">
          <div className="shrink-0"><ChainIcon chain={task.chain} size={28} className="rounded" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-lg">{task.title}</div>
              <Badge tone={s==="進行中"?"green":s==="未開始"?"blue":"red"}>{s}</Badge>
              <Badge tone="purple">{task.platform}</Badge>
              <Badge>{task.category}</Badge>
            </div>
            <div className="text-sm text-neutral-400 truncate">{task.project} · {task.chain} · {fmtDate(task.startAt)} — {fmtDate(task.endAt)}</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="yellow">{task.reward_type} ~ ${task.reward_est_usd}</Badge>
            <Badge>難度 {"★".repeat(task.difficulty)}</Badge>
            <Badge tone={task.risk==="低"?"green":task.risk==="中"?"yellow":"red"}>{task.risk}風險</Badge>
            <div className="ml-auto">
              <a href={task.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-xl text-sm bg-white text-black">前往任務</a>
            </div>
          </div>

          {task.tags?.length>0 && (
            <div className="flex flex-wrap gap-2 text-xs text-neutral-300">
              {task.tags.map(tag=> <span key={tag}>#{tag}</span>)}
            </div>
          )}

          {task.steps?.length>0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5">
              {task.steps.map((st, i)=> (
                <div key={st.id || i} className="flex items-start gap-3 p-3 border-b border-white/10 last:border-0">
                  <input type="checkbox" className="mt-1 accent-white" checked={!!progress[st.id]} onChange={e=> setStepDone(st.id, e.target.checked)} />
                  <div className="flex-1">
                    <div className="text-sm">{st.label}</div>
                    <div className="text-xs text-neutral-400">{typeLabel(st.type)}</div>
                  </div>
                  {st.link && <a className="text-sm underline" href={st.link} target="_blank" rel="noreferrer">前往</a>}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={onToggleSub} className={clsx("px-3 py-1.5 rounded-xl text-sm border", subscribed?"bg-emerald-400/20 border-emerald-400/40 text-emerald-200":"bg-white/10 hover:bg-white/20 border-white/10")}>{subscribed?"已訂閱":"訂閱提醒"}</button>
            <button onClick={()=> downloadFile(`${task.project}-${task.id}.ics`, toICS([task]), "text/calendar;charset=utf-8") } className="px-3 py-1.5 rounded-xl text-sm bg-white/10 hover:bg-white/20 border border-white/10">加入日曆</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function typeLabel(t){ return t === 'onchain' ? '上鏈互動' : t === 'social' ? '社交' : t === 'research' ? '研究' : '其他'; }
function CalendarIcon(){ return (<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm13 7H6v11h14V9ZM6 7h14V6H6v1Z"/></svg>); }
function qs(k){ const sp = new URLSearchParams(location.search); return sp.get(k); }
function parseQSMulti(k){ const sp = new URLSearchParams(location.search); const raw = sp.get(k); return raw ? raw.split('.') : []; }
