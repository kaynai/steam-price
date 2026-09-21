/* Steam 跨区比价前端 (纯静态, 无依赖)
 * 数据两层:
 *  1. data/prices.json  - 每日预抓的热门游戏 (含小黑盒史低), 秒开
 *  2. /api/steam?prices= - Cloudflare Pages Function 实时查询, 覆盖全部 Steam 游戏
 */
"use strict";

const SYMBOL = {
  CNY: "¥", USD: "$", GBP: "£", EUR: "€", JPY: "JP¥", KRW: "₩",
  INR: "₹", BRL: "R$", CAD: "C$", AUD: "A$", MXN: "MX$", HKD: "HK$",
  TWD: "NT$", PLN: "zł", NOK: "kr", IDR: "Rp", PHP: "₱", SGD: "S$",
};

const CS_STORES = {
  1: "Steam", 3: "GreenManGaming", 7: "GOG", 8: "EA App", 11: "Humble Store",
  13: "育碧商店", 15: "Fanatical", 16: "Gamesplanet", 21: "2Game",
  22: "IndieGala", 24: "WinGameStore", 30: "DLGamer", 33: "Epic Games",
  34: "微软商店",
};

const LIVE_CACHE_HOURS = 6;
let DB = null; // data/prices.json (可能为空)
const $ = (id) => document.getElementById(id);

/* ---------- 工具 ---------- */
const fmtCNY = (v) => (v == null ? "—" : "¥" + (Math.round(v * 100) / 100).toFixed(2));
const fmtCur = (v, cur) => (v == null ? "—" : (SYMBOL[cur] || cur + " ") + v.toFixed(2));
const steamLink = (appid, cc) => `https://store.steampowered.com/app/${appid}/?cc=${cc || "cn"}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function regionsMeta() {
  return (DB && DB.regions) || [];
}

function regionLabel(cc, meta) {
  const r = (meta || regionsMeta()).find((x) => x.cc === cc);
  return r ? `${r.flag} ${r.name}` : cc.toUpperCase();
}

function cnyOf(price, rates) {
  const r = rates || (DB && DB.rates);
  return price && r && r[price.currency] ? price.final / r[price.currency] : null;
}

/* Steam API 跨域访问:
 * 1. CF Pages: 走 functions 代理 (首选)
 * 2. 其它环境 (GitHub Pages): 公共 CORS 代理直连 Steam (较慢)
 */
const PUBLIC_PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];

async function proxyFetch(steamURL) {
  for (const wrap of PUBLIC_PROXIES) {
    try {
      return await fetchJSON(wrap(steamURL));
    } catch {}
  }
  throw new Error("公共代理不可用");
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "TWD", "VND", "IDR", "CLP", "PYG"]);

async function apiSearch(term) {
  try {
    return await fetchJSON(`api/steam?search=${encodeURIComponent(term)}`);
  } catch {}
  const d = await proxyFetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`
  );
  return {
    items: (d.items || []).map((i) => ({
      appid: i.id,
      name: i.name,
      image: i.tiny_image || null,
      price: i.price ? { initial: i.price.initial, final: i.price.final } : null,
    })),
  };
}

async function apiPrices(appid) {
  try {
    return await fetchJSON(`api/steam?prices=${appid}`);
  } catch {}
  /* 回退: 逐区通过公共代理抓取 (较慢, 约 20 秒) */
  const meta = regionsMeta();
  if (!meta.length) throw new Error("无地区配置");
  const regions = {};
  for (const reg of meta) {
    try {
      const d = await proxyFetch(
        `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${reg.cc}&filters=price_overview`
      );
      const po = d && d[appid] && d[appid].success && d[appid].data ? d[appid].data.price_overview : null;
      if (po) {
        const div = ZERO_DECIMAL.has(po.currency) ? 1 : 100;
        regions[reg.cc] = {
          currency: po.currency,
          initial: po.initial / div,
          final: po.final / div,
          discount: po.discount_percent,
        };
      }
    } catch {}
  }
  if (!Object.keys(regions).length) throw new Error("实时查询失败");
  return { appid, name: `App ${appid}`, regions, regions_meta: meta };
}

/* ---------- 列表 ---------- */
function gameCardHTML(g, { inDB }) {
  const cn = g.regions && g.regions.cn;
  const rows = Object.entries(g.regions || {})
    .map(([cc, p]) => ({ cc, ...p, cny: cnyOf(p) }))
    .filter((r) => r.cny != null)
    .sort((a, b) => a.cny - b.cny);
  const best = rows[0];
  return `
    <img loading="lazy" alt="${esc(g.nameCN || g.name)}" src="${g.img || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`}" />
    <div class="gc-body">
      <h4>${esc(g.nameCN || g.name)}</h4>
      <div class="cn">${esc(g.nameCN ? g.name : "")} · ${g.appid}${inDB ? "" : ` · <span class="tag">实时查询</span>`}</div>
      <div class="price-line">
        ${cn ? `国区 <span class="price-now">¥${cn.final}</span>` : ""}
        ${cn && cn.discount > 0 ? `<span class="price-cut"> -${cn.discount}%</span>` : ""}
        ${best ? `　最低 <span class="price-now">${fmtCNY(best.cny)}</span><span class="tag">${best.cc.toUpperCase()}</span>` : ""}
        ${g.heybox && g.heybox.isLowest ? `<span class="tag tag-lowest">黑盒史低</span>` : ""}
      </div>
    </div>`;
}

function rowsOf(g, rates) {
  return Object.entries(g.regions || {})
    .map(([cc, p]) => ({ cc, ...p, cny: cnyOf(p, rates) }))
    .filter((r) => r.cny != null)
    .sort((a, b) => a.cny - b.cny);
}

function renderList(filter) {
  const list = $("game-list");
  const f = (filter || "").trim().toLowerCase();
  list.innerHTML = "";
  $("search-hint").textContent = "";

  const games = DB
    ? Object.entries(DB.games)
        .map(([appid, g]) => ({ appid: Number(appid), ...g }))
        .filter(
          (g) =>
            !f ||
            g.name.toLowerCase().includes(f) ||
            (g.nameCN || "").toLowerCase().includes(f) ||
            String(g.appid) === f
        )
    : [];

  games.forEach((g) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = gameCardHTML(g, { inDB: true });
    card.onclick = () => showDBDetail(g.appid);
    list.appendChild(card);
  });

  /* Steam 全库在线搜索 (覆盖所有游戏) */
  if (f && f.length >= 2) {
    const hint = document.createElement("div");
    hint.className = "search-hint";
    hint.textContent = games.length ? "以下是 Steam 全库搜索结果（点击实时查询全区价格）…" : "Steam 全库搜索中…";
    list.appendChild(hint);
    onlineSearch(f, list, games.map((g) => g.appid));
  } else if (!games.length) {
    list.innerHTML = `<div class="search-hint">输入游戏名搜索全部 Steam 游戏，或直接输入 AppID。</div>`;
  }
}

async function onlineSearch(term, list, excludeIds) {
  let res;
  try {
    res = await apiSearch(term);
  } catch {
    list.querySelector(".search-hint")?.remove();
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="search-hint">⚠️ 在线搜索不可用（需要部署在 Cloudflare Pages 上才有实时查询接口）。</div>`
    );
    return;
  }
  const hint = list.querySelector(".search-hint");
  if (hint) hint.textContent = "Steam 全库搜索结果（点击卡片实时查询全区价格）：" + `（${res.items?.length || 0} 条）`;

  for (const it of (res.items || []).slice(0, 12)) {
    if (excludeIds.includes(it.appid)) continue;
    const inDB = DB && !!DB.games[it.appid];
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = gameCardHTML(
      {
        appid: it.appid,
        name: it.name,
        img: it.image,
        regions: it.price
          ? { cn: { currency: "CNY", final: it.price.final / 100, initial: it.price.initial / 100, discount: 0 } }
          : {},
      },
      { inDB }
    );
    card.onclick = () => (inDB ? showDBDetail(it.appid) : showLiveDetail(it.appid, it.name, it.image));
    list.appendChild(card);
  }
}

/* ---------- 详情: 已收录游戏 (含小黑盒) ---------- */
function showDBDetail(appid) {
  const g = DB.games[appid];
  if (!g) return;
  g.appid = Number(appid);
  renderDetail(g, { live: false });
}

/* ---------- 详情: 任意游戏实时查询 ---------- */
function liveCacheGet(appid) {
  try {
    const c = JSON.parse(localStorage.getItem("sp_live_" + appid) || "null");
    if (c && Date.now() - c.t < LIVE_CACHE_HOURS * 3600e3) return c.data;
  } catch {}
  return null;
}
function liveCacheSet(appid, data) {
  try {
    localStorage.setItem("sp_live_" + appid, JSON.stringify({ t: Date.now(), data }));
  } catch {}
}

async function showLiveDetail(appid, fallbackName, fallbackImg) {
  openDetailShell();
  $("d-name").textContent = fallbackName || `App ${appid}`;
  $("d-sub").textContent = "实时查询中，约需 3~8 秒…";
  $("verdict").innerHTML = "⏳ 正在从 Steam 各地区服务器获取价格…";
  $("region-table").querySelector("tbody").innerHTML = "";
  $("channels").innerHTML = "";

  let data = liveCacheGet(appid);
  if (!data) {
    try {
      data = await apiPrices(appid);
      if (data.error) throw new Error(data.error);
      liveCacheSet(appid, data);
    } catch (e) {
      $("d-sub").textContent = "";
      $("verdict").innerHTML =
        `⚠️ 实时查询失败（${esc(String(e.message || e))}）。<br>` +
        `实时查询依赖 Cloudflare Pages Functions，请将本站部署到 CF Pages；` +
        `或稍后重试 / <a href="${steamLink(appid)}" target="_blank" rel="noopener">直接打开 Steam 商店页</a>`;
      return;
    }
  }
  data.appid = appid;
  if (!data.image && fallbackImg) data.image = fallbackImg;
  renderDetail(data, { live: true });
}

/* ---------- 详情渲染 (通用) ---------- */
function openDetailShell() {
  $("game-list").classList.add("hidden");
  $("detail").classList.remove("hidden");
  window.scrollTo({ top: 0 });
}

function renderDetail(g, { live }) {
  openDetailShell();

  $("d-name").textContent = g.nameCN || g.name;
  $("d-sub").textContent =
    `${g.name}${g.nameCN ? " · " : ""}AppID ${g.appid}` +
    (live ? ` · ⚡ 实时查询（缓存 ${LIVE_CACHE_HOURS} 小时）` : " · 每日更新数据");

  const img = $("d-img");
  img.style.visibility = "visible";
  img.onerror = () => (img.style.visibility = "hidden");
  img.src = g.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_616x353.jpg`;
  $("d-steam").href = steamLink(g.appid);

  const rates = live ? liveRates() : DB.rates;
  const rows = rowsOf(g, rates);
  const cnRow = rows.find((r) => r.cc === "cn");
  const best = rows[0];
  $("d-cheapest").href = best ? steamLink(g.appid, best.cc) : steamLink(g.appid);

  if (!rows.length) {
    $("verdict").innerHTML = "该游戏免费游玩或未在售。";
    $("region-table").querySelector("tbody").innerHTML = "";
    $("channels").innerHTML = "";
    return;
  }

  /* 结论卡 */
  const hb = g.heybox;
  let v = `<b>全区最低：</b>${regionLabel(best.cc)} ${fmtCur(best.final, best.currency)}（≈${fmtCNY(best.cny, rates)}）`;
  if (cnRow) {
    const diff = Math.round((1 - best.cny / cnyOf(cnRow, rates)) * 100);
    v += diff > 0 ? `，比国区便宜 <b>${diff}%</b>` : "，国区已是全区最低价";
  }
  if (hb && hb.current) {
    v += `<br><b>小黑盒：</b>¥${hb.current}${hb.isLowest ? ` <span class="ch-lowest">（当前为史低）</span>` : `（史低 ¥${hb.lowest}）`}`;
  }
  $("verdict").innerHTML = v;

  /* 区域表 */
  const tb = $("region-table").querySelector("tbody");
  tb.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.className = "cheapest";
    else if (cnRow) {
      if (r.cny < cnyOf(cnRow, rates)) tr.className = "cheaper-than-cn";
      else if (r.cny > cnyOf(cnRow, rates)) tr.className = "pricier-than-cn";
    }
    const vsCN = !cnRow
      ? `<td class="vs">—</td>`
      : r.cc === "cn"
        ? `<td class="vs cn-row">基准（国区）</td>`
        : `<td class="vs">${r.cny < cnyOf(cnRow, rates) ? "省 " : "贵 "}${fmtCNY(Math.abs(r.cny - cnyOf(cnRow, rates)))}（${r.cny < cnyOf(cnRow, rates) ? "" : "+"}${Math.round((r.cny / cnyOf(cnRow, rates) - 1) * 100)}%）</td>`;
    tr.innerHTML = `
      <td>${regionLabel(r.cc, g.regions_meta)}${i === 0 ? `<span class="badge-best">最低</span>` : ""}</td>
      <td>${r.discount > 0 ? `<span class="strike">${fmtCur(r.initial, r.currency)}</span>` : fmtCur(r.initial, r.currency)}</td>
      <td>${r.discount > 0 ? `<b style="color:var(--green)">-${r.discount}%</b>` : "—"}</td>
      <td><b>${fmtCur(r.final, r.currency)}</b></td>
      <td><b>${fmtCNY(r.cny, rates)}</b></td>
      ${vsCN}`;
    tb.appendChild(tr);
  });

  renderChannels(g, best, hb);
}

/* 实时模式下汇率: 用首屏 DB 汇率; 若 DB 不存在则从 fr-CNY 反推(用 USD 兜底) */
function liveRates() {
  if (DB && DB.rates) return DB.rates;
  return null; // cnyOf 会返回 null -> 表格显示换算失败, 仅显示原价
}

/* ---------- 第三方渠道 ---------- */
function renderChannels(g, best, hb) {
  const box = $("channels");
  box.innerHTML = "";

  /* 小黑盒 (仅预抓数据里有) */
  if (hb && hb.current) {
    box.appendChild(
      chCard({
        name: "🖤 小黑盒",
        price: `¥${hb.current}`,
        sub: `史低 ¥${hb.lowest}${hb.isLowest ? " · <span class='ch-lowest'>当前即史低！</span>" : ""}`,
        btn: "打开小黑盒 ↗",
        href: "https://www.xiaoheihe.cn/",
        note: "国区账号可购 · CDKey / 直接激活",
      })
    );
  } else {
    box.appendChild(
      chCard({
        name: "🖤 小黑盒",
        price: "—",
        sub: `请在 App 内搜索「${esc(g.nameCN || g.name)}」查看价格与史低（浏览器无法直接调用小黑盒接口）`,
        btn: "打开小黑盒 ↗",
        href: "https://www.xiaoheihe.cn/",
        note: "",
      })
    );
  }

  /* SteamPY */
  box.appendChild(
    chCard({
      name: "🔑 SteamPY",
      price: "去查询",
      sub: "第三方 CDKey 平台，常有低于国区的全球 Key，价格波动大，需实时查看",
      btn: "SteamPY 搜索 ↗",
      href: "https://www.steampy.com/",
      note: "注意区分 区服/激活区域，部分 Key 需外区账号",
    })
  );

  /* CheapShark 实时 (正规商店, 浏览器直连) */
  const csCard = chCard({
    name: "🌍 海外正规商店 (CheapShark)",
    price: "查询中…",
    sub: "Fanatical / GOG / Humble 等正规商店实时最低价（美元换算）",
    btn: "",
    href: "#",
    note: "",
  });
  box.appendChild(csCard);
  loadCheapShark(g, csCard);
}

function chCard({ name, price, sub, btn, href, note }) {
  const d = document.createElement("div");
  d.className = "channel-card";
  d.innerHTML = `
    <div class="ch-head"><span class="ch-name">${name}</span><span class="ch-price">${price}</span></div>
    <div class="ch-sub">${sub}</div>
    ${note ? `<div class="ch-sub">${note}</div>` : ""}
    ${btn ? `<a class="btn" href="${href}" target="_blank" rel="noopener">${btn}</a>` : ""}`;
  return d;
}

async function loadCheapShark(g, card) {
  try {
    const list = await fetchJSON(
      `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(g.name)}&steamAppId=${g.appid}&limit=1`
    );
    if (!list || !list.length || !list[0].cheapestDealID) throw new Error("no deal");
    const deal = await fetchJSON(`https://www.cheapshark.com/api/1.0/deals?id=${list[0].cheapestDealID}`);
    const usd = parseFloat(deal.dealInfo.price);
    const storeName = CS_STORES[deal.dealInfo.storeID] || "海外商店";
    const usdRate = DB && DB.rates && DB.rates.USD ? 1 / DB.rates.USD : 7.2; // 1 USD = ? CNY
    card.querySelector(".ch-price").textContent = "¥" + (usd * usdRate).toFixed(2);
    card.querySelector(".ch-sub").innerHTML = `最低价来自 <b>${esc(storeName)}</b>：$${usd.toFixed(2)}（Steam 原价 $${deal.gameInfo.retailPrice}）`;
    const a = document.createElement("a");
    a.className = "btn";
    a.href = "https://www.cheapshark.com/redirect?dealID=" + deal.dealInfo.dealID;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `去 ${storeName} 购买 ↗`;
    card.appendChild(a);
  } catch {
    card.querySelector(".ch-price").textContent = "—";
    card.querySelector(".ch-sub").textContent = "未查询到该游戏的正规商店折扣（可能是新游戏或平台独占）";
  }
}

/* ---------- 初始化 ---------- */
async function init() {
  try {
    DB = await fetchJSON("data/prices.json");
  } catch {
    DB = null;
  }

  if (DB) {
    const t = new Date(DB.updatedAt);
    $("meta").textContent =
      `热门数据更新：${t.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 覆盖 ${Object.keys(DB.games).length} 款热门游戏 · 全部 Steam 游戏支持实时查询`;
  } else {
    $("meta").textContent = "热门数据未加载 · 全部 Steam 游戏支持实时查询";
  }

  $("search").addEventListener("input", (e) => {
    $("detail").classList.add("hidden");
    $("game-list").classList.remove("hidden");
    renderList(e.target.value);
  });
  $("back").onclick = () => {
    $("detail").classList.add("hidden");
    $("game-list").classList.remove("hidden");
  };

  renderList("");
}

init();
