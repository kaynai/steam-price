/**
 * Steam 跨区价格抓取脚本
 * 用法: node scripts/fetch-prices.mjs
 * 环境变量:
 *   LIMIT=3        只抓前 N 个游戏（测试用）
 *   APPIDS=730,570 强制只抓这些 appid
 * 输出: data/prices.json
 *
 * 数据来源:
 *  - Steam appdetails API (各 cc 区价格)
 *  - open.er-api.com 汇率 (以 CNY 为基准)
 *  - api.xiaoheihe.cn 小黑盒价格/史低 (尽力抓取, 失败则跳过)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Steam 地区: cc = 国家代码
// 注意: 2023-11 起 Steam 已将阿根廷/土耳其区改为美元定价
const REGIONS = [
  { cc: "cn", name: "国区", flag: "🇨🇳" },
  { cc: "us", name: "美国", flag: "🇺🇸" },
  { cc: "gb", name: "英国", flag: "🇬🇧" },
  { cc: "de", name: "欧元区", flag: "🇪🇺" },
  { cc: "jp", name: "日本", flag: "🇯🇵" },
  { cc: "kr", name: "韩国", flag: "🇰🇷" },
  { cc: "ph", name: "菲律宾", flag: "🇵🇭" },
  { cc: "sg", name: "新加坡", flag: "🇸🇬" },
  { cc: "in", name: "印度", flag: "🇮🇳" },
  { cc: "br", name: "巴西", flag: "🇧🇷" },
  { cc: "ca", name: "加拿大", flag: "🇨🇦" },
  { cc: "au", name: "澳大利亚", flag: "🇦🇺" },
  { cc: "mx", name: "墨西哥", flag: "🇲🇽" },
  { cc: "hk", name: "中国香港", flag: "🇭🇰" },
  { cc: "tw", name: "中国台湾", flag: "🇹🇼" },
  { cc: "pl", name: "波兰", flag: "🇵🇱" },
  { cc: "no", name: "挪威", flag: "🇳🇴" },
  { cc: "tr", name: "土耳其", flag: "🇹🇷" },
  { cc: "ar", name: "阿根廷", flag: "🇦🇷" },
];

// Steam 无小数位的货币
const ZERO_DECIMAL = new Set(["JPY", "KRW", "TWD", "VND", "IDR", "CLP", "PYG"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, headers = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", ...headers },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status === 403) {
        console.log(`  [${res.status}] 限流, 等待重试...`);
        await sleep(3000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i === tries - 1) return null;
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

async function getRates() {
  console.log("获取汇率 (open.er-api.com)...");
  const d = await fetchJSON("https://open.er-api.com/v6/latest/CNY");
  if (!d || !d.rates) throw new Error("汇率获取失败");
  const rates = { ...d.rates, CNY: 1 };
  console.log(`  汇率更新时间: ${d.time_last_update_utc}`);
  return rates;
}

/** 抓某游戏在某区的价格 */
async function getRegionPrice(appid, cc) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`;
  const d = await fetchJSON(url);
  if (!d || !d[appid] || !d[appid].success || !d[appid].data) return null;
  const po = d[appid].data.price_overview;
  if (!po) return null; // 免费/不可购买
  const div = ZERO_DECIMAL.has(po.currency) ? 1 : 100;
  return {
    currency: po.currency,
    initial: po.initial / div,
    final: po.final / div,
    discount: po.discount_percent,
  };
}

/** 小黑盒搜索: 取国区现价/史低 (尽力而为) */
async function getHeybox(query, appid) {
  const url = `https://api.xiaoheihe.cn/game/search/?os_type=web&version=999.0.0&q=${encodeURIComponent(query)}`;
  const d = await fetchJSON(url, { Referer: "https://www.xiaoheihe.cn/" }, 2);
  if (!d || !d.result || !Array.isArray(d.result.games)) return null;
  const hit =
    d.result.games.find((g) => Number(g.steam_appid) === Number(appid)) ||
    d.result.games.find((g) => g.platforms && g.platforms.includes("steam") && g.price);
  if (!hit || !hit.price) return null;
  return {
    initial: hit.price.initial ?? null,
    current: hit.price.current ?? null,
    discount: hit.price.discount ?? 0,
    lowest: hit.price.lowest_price ?? hit.price.current ?? null,
    isLowest: hit.price.is_lowest === 1,
  };
}

async function main() {
  const limit = parseInt(process.env.LIMIT || "0", 10);
  const forced = process.env.APPIDS
    ? process.env.APPIDS.split(",").map((s) => parseInt(s.trim(), 10))
    : null;

  const catalog = JSON.parse(readFileSync(join(ROOT, "data", "games.json"), "utf8")).games;
  const games = forced
    ? catalog.filter((g) => forced.includes(g.appid)).concat(
        forced
          .filter((id) => !catalog.some((g) => g.appid === id))
          .map((id) => ({ appid: id, name: `App ${id}`, nameCN: "" }))
      )
    : limit
      ? catalog.slice(0, limit)
      : catalog;

  const rates = await getRates();

  // 断点续抓: 若已有数据文件, 合并并只补缺失的部分
  let prev = null;
  try {
    const old = JSON.parse(readFileSync(join(ROOT, "data", "prices.json"), "utf8"));
    if (old && old.games && old.rates) prev = old;
  } catch {}

  const out = {
    updatedAt: new Date().toISOString(),
    rates,
    regions: REGIONS,
    games: {},
  };

  for (const game of games) {
    const label = game.nameCN || game.name;
    const prevGame = prev && prev.games[game.appid];
    const haveAll =
      prevGame &&
      Object.keys(prevGame.regions || {}).length >= REGIONS.length &&
      prevGame.heybox;
    if (haveAll) {
      console.log(`\n=== ${label} (${game.appid}) 已有完整数据, 跳过 ===`);
      out.games[game.appid] = prevGame;
      continue;
    }
    console.log(`\n=== ${label} (${game.appid}) ===`);
    const regions = {};
    for (const r of REGIONS) {
      if (prevGame && prevGame.regions && prevGame.regions[r.cc]) {
        regions[r.cc] = prevGame.regions[r.cc]; // 复用旧数据
        continue;
      }
      const p = await getRegionPrice(game.appid, r.cc);
      if (p) regions[r.cc] = p;
      else console.log(`  ${r.cc}: 无价格`);
      await sleep(1600); // ~187 req/5min, 低于 Steam 限流阈值(200)
    }
    if (!Object.keys(regions).length) {
      console.log("  全部地区无价格, 跳过");
      continue;
    }

    let heybox = prevGame && prevGame.heybox;
    if (!heybox) {
      console.log("  小黑盒...");
      heybox = await getHeybox(game.nameCN || game.name, game.appid);
      if (heybox) console.log(`  小黑盒: ¥${heybox.current} (史低 ¥${heybox.lowest})`);
      else console.log("  小黑盒: 未获取到");
    }

    out.games[game.appid] = {
      name: game.name,
      nameCN: game.nameCN || "",
      regions,
      heybox: heybox || null,
    };
  }

  writeFileSync(join(ROOT, "data", "prices.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(`\n完成! 共 ${Object.keys(out.games).length} 款游戏 -> data/prices.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
