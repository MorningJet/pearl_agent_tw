# 藍新金流 MPG（立即購買 → Cloudflare Worker → 藍新）

H5 **不**存放 HashKey / HashIV。加簽與回傳只在 [`workers/newebpay`](../workers/newebpay)。

## 架構

```text
立即購買 → POST {VITE_NEWEBPAY_API_BASE}/api/checkout
         → Worker AES 加密 TradeInfo
         → 瀏覽器 POST 表單 → 藍新 MPG
         → NotifyURL / ReturnURL → Worker
```

金額 = 珠款小計 + 設計費 + 運費（珠款 ≥ NT$1000 免運，否則 NT$50）。

## 本機

1. 複製 Worker 密鑰檔：

```bash
cp workers/newebpay/.dev.vars.example workers/newebpay/.dev.vars
```

填入 `NEWEBPAY_MERCHANT_ID`、`NEWEBPAY_HASH_KEY`、`NEWEBPAY_HASH_IV`。  
`PUBLIC_API_BASE=http://127.0.0.1:8787`（本機 Notify 僅在你有公網 tunnel 時可被藍新打到；本機主要測加簽與跳轉）。

2. 根目錄 `.env`：

```bash
VITE_NEWEBPAY_API_BASE=/newebpay-api
```

3. 兩個終端：

```bash
npm run newebpay:dev
npm run dev
```

4. 點「立即購買」應跳轉藍新（測試閘道 `ccore.newebpay.com`，需 `NEWEBPAY_ENV=sandbox` 且使用**測試商店**金鑰）。

## 上線（Cloudflare Workers）

```bash
cd workers/newebpay
npx wrangler login
npx wrangler secret put NEWEBPAY_MERCHANT_ID
npx wrangler secret put NEWEBPAY_HASH_KEY
npx wrangler secret put NEWEBPAY_HASH_IV
```

編輯 [`wrangler.toml`](../workers/newebpay/wrangler.toml)：

- `NEWEBPAY_ENV = "production"`（正式）或 `sandbox`
- `PUBLIC_API_BASE = "https://pearl-newebpay.<你的>.workers.dev"`（部署後填真實網址再部署一次）
- `H5_RETURN_URL = "https://morningjet.github.io/pearl_agent_tw/?embed=1"`
- `CORS_ORIGINS` 建議鎖 GitHub Pages 與 Shopify 網域

```bash
npm run newebpay:deploy
```

GitHub Actions / 本機建置 H5 時設定：

```bash
VITE_NEWEBPAY_API_BASE=https://pearl-newebpay.<你的>.workers.dev
```

（Pages 的 Secret 同名即可。）

## 安全

- 不要把 HashKey / HashIV 貼進聊天、Issue、前端、`VITE_*`
- 若金鑰曾外洩，到藍新後台輪換後再 `wrangler secret put`
