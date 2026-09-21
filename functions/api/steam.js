// Cloudflare Pages Function: Steam API 代理
// /api/steam?search=名称   -> Steam 全库搜索 (含国区价格)
// /api/steam?prices=APPID  -> 实时抓取该游戏全部地区价格 (边缘缓存 6 小时)
// 解决浏览器直连 Steam 的跨域限制

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

const ZERO_DECIMAL = new Set(["JPY", "KRW", "TWD", "VND", "IDR", "CLP", "PYG"]);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" };

async function steamFetch(url, ttl) {
  const r = await fetch(url, {
    headers: H,
    // Cloudflare 边缘缓存, 大幅降低触发 Steam 限流的概率
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const json = (data, status = 200, cache = 600) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": `public, max-age=${cache}`,
      },
    });

  try {
    /* ---- 全库搜索 ---- */
    const search = url.searchParams.get("search");
    if (search) {
      const d = await steamFetch(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(search)}&l=schinese&cc=cn`,
        1800
      );
      if (!d) return json({ error: "steam search failed" }, 502);
      return json({
        items: (d.items || []).map((i) => ({
          appid: i.id,
          name: i.name,
          image: i.tiny_image || null,
          price: i.price
            ? { currency: i.price.currency, initial: i.price.initial, final: i.price.final }
            : null,
        })),
      });
    }

    /* ---- 实时跨区价格 ---- */
    const appid = parseInt(url.searchParams.get("prices"), 10);
    if (appid > 0) {
      // 基本信息 (中文名 + 头图)
      const bd = await steamFetch(
        `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=cn&l=schinese&filters=basic`,
        21600
      );
      const binfo = bd && bd[appid] && bd[appid].success ? bd[appid].data : null;

      const regions = {};
      for (const reg of REGIONS) {
        const d = await steamFetch(
          `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${reg.cc}&filters=price_overview`,
          21600
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
      }

      if (!Object.keys(regions).length && !binfo) {
        return json({ error: "app not found", appid }, 404);
      }
      return json(
        {
          appid,
          name: (binfo && binfo.name) || `App ${appid}`,
          image: (binfo && binfo.header_image) || null,
          regions,
          regions_meta: REGIONS,
        },
        200,
        3600
      );
    }

    return json({ error: "missing params: search / prices" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
}
