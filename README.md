# Steam 跨区比价站

纯静态网页：查询 Steam **全部游戏**在各地区的价格（自动换算人民币），并汇总小黑盒、SteamPY、海外正规商店（CheapShark）等第三方渠道，找出最便宜的购买方式。

**可部署到 Cloudflare Pages 或 GitHub Pages，零服务器、零费用。**

## 功能

- 🌍 覆盖 18 个 Steam 地区：国区、美国、英国、欧元区、日本、韩国、菲律宾、新加坡、印度、巴西、加拿大、澳大利亚、墨西哥、中国香港、中国台湾、波兰、挪威、土耳其、阿根廷
- 🎮 **覆盖全部 Steam 游戏**（双层架构）：
  - 热门游戏走每日预抓的本地数据，秒开，附带小黑盒史低
  - 其它任何游戏：搜索 Steam 全库 → 点击卡片**实时查询**全区价格（Cloudflare 边缘缓存 6 小时）
- 💱 实时汇率换算人民币，按「换算价」排序，自动高亮全区最低价，每行显示"比国区省/贵多少"
- 🖤 小黑盒国区价格 + 史低标记（热门游戏每日自动抓取）
- 🌍 CheapShark 实时查询海外正规商店（Fanatical / GOG / Humble 等）最低价
- 🔑 SteamPY 渠道入口（价格波动大，需到平台实时查看）
- 📱 响应式布局，手机可用

## 数据架构

```
热门游戏 ──> data/prices.json (GitHub Actions 每日 06:00 抓取) ──> 秒开 + 小黑盒史低
其它游戏 ──> /api/steam?prices=APPID (CF Pages Function 实时抓 18 区) ──> 边缘缓存 6h
```

## 目录结构

```
├── index.html                  # 前端页面
├── app.js / style.css          # 前端逻辑与样式
├── data/
│   ├── games.json              # 预抓的热门游戏列表（自行增删）
│   └── prices.json             # 自动生成的价格数据
├── scripts/fetch-prices.mjs    # 抓取脚本（Node 18+，无需安装依赖，支持断点续抓）
├── functions/api/steam.js      # CF Pages Function（全库搜索 + 实时跨区价格）
└── .github/workflows/update-prices.yml  # 每日 06:00 自动更新数据
```

## 部署方式

### 方式一：Cloudflare Pages（推荐，支持全部游戏实时查询）

1. Cloudflare Dashboard → Workers & Pages → 创建 Pages → 连接 Git 仓库
2. 构建命令留空，输出目录填 `/`（根目录）
3. 部署完成后 `functions/` 目录自动生效为 API：`/api/steam?search=名称`、`/api/steam?prices=APPID`
4. 数据更新：GitHub Actions 每日自动抓热门游戏数据并提交，CF Pages 自动重新部署

### 方式二：GitHub Pages

1. 推到 GitHub 仓库（public），Settings → Pages → 选 main 分支根目录
2. Actions 每天自动更新价格数据
3. 访问 `https://<用户名>.github.io/<仓库名>/`

> 注意：GitHub Pages 没有 Functions，实时查询会退化到公共 CORS 代理（较慢约 20 秒且可能不稳定）；热门游戏的每日数据不受影响。想要完整的"全游戏秒查"体验请用 Cloudflare Pages。

## 如何添加 / 修改收录的游戏

编辑 `data/games.json`：

```json
{ "appid": 271590, "name": "Grand Theft Auto V Enhanced", "nameCN": "GTA5" }
```

- `appid`：Steam 商店页网址里的数字，如 `store.steampowered.com/app/1245620/`
- `name`：英文名（用于 CheapShark 匹配）
- `nameCN`：中文名（用于小黑盒搜索和页面展示）

改动后手动跑一次 `node scripts/fetch-prices.mjs` 或等每日自动更新即可收录。

## 本地运行

```bash
node scripts/fetch-prices.mjs   # 生成/更新 data/prices.json（需能访问 Steam）
# 然后随便起个静态服务器，例如:
npx serve .
```

## 风险提示

- 跨区礼物 / 代购 / 第三方 CDKey 均有一定账号风险，Steam 对非法渠道零容忍
- 阿根廷区、土耳其区自 2023 年 11 月起已改为美元定价，不再有"低价区"红利
- 汇率来自 open.er-api.com（每日更新），换算价仅供参考
