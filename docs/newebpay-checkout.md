# 藍新金流 MPG + Shopify Admin 回寫（方案 B）

H5 **不**存放 HashKey / HashIV / Admin Token。加簽、Notify、建單只在 [`workers/newebpay`](../workers/newebpay)。

## 架構

```text
立即購買
  → POST /api/checkout（Worker 存 pending 訂單 + AES 加簽）
  → 瀏覽器 POST 表單 → 藍新 MPG
  → NotifyURL / ReturnURL
  → 驗簽 → 標記 paid → Shopify Admin API 建立「已付款」訂單（冪等）
```

金額 = 珠款小計 + 設計費 + 運費（珠款 ≥ NT$1000 免運，否則 NT$50）。  
**不經 Shopify Checkout**，一般不產生 Shopify 第三方結帳手續費。

## Shopify Admin Token（藍新過審前可先做好）

1. Shopify Admin → **設定** → **應用程式和銷售管道** → **開發應用程式** → 建立 App  
2. Admin API 權限至少勾選：`write_orders`、`read_orders`（建議再加 `write_order_edits` 視需求）  
3. 安裝 App，複製 **Admin API access token**  
4. 寫入本機 `workers/newebpay/.dev.vars`：

```bash
SHOPIFY_STORE_DOMAIN=pearl-diy.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxx
SHOPIFY_API_VERSION=2025-01
ALLOW_DEV_SIMULATE=1
```

正式環境用：

```bash
npx wrangler secret put SHOPIFY_ADMIN_TOKEN
```

並在 `wrangler.toml` `[vars]` 設定 `SHOPIFY_STORE_DOMAIN`。

## 本機

```bash
cp workers/newebpay/.dev.vars.example workers/newebpay/.dev.vars
# 填 HashKey/HashIV + SHOPIFY_ADMIN_TOKEN

npm run newebpay:dev   # :8787
npm run dev            # :5173  且 .env 有 VITE_NEWEBPAY_API_BASE=/newebpay-api
```

### 藍新尚未過審時：模擬付款 → 測 Shopify 寫回

1. 在詳情頁點「立即購買」（會跳藍新並可能顯示「查無商店代號」——可忽略）  
2. 看 Worker 日誌裡的 `merchantOrderNo`（或對 `/api/checkout` 自己打一筆拿回單號）  
3. 模擬付款成功：

```bash
curl -sS -X POST http://127.0.0.1:8787/api/dev/simulate-paid \
  -H 'Content-Type: application/json' \
  -d '{"merchantOrderNo":"P你的單號"}'
```

4. 到 Shopify Admin → **訂單** 應出現已付款單（tag: `newebpay`）  
5. 查狀態：`GET http://127.0.0.1:8787/api/order/P你的單號`

也可只打 checkout API 拿單號（不必真的跳藍新）：

```bash
curl -sS -X POST http://127.0.0.1:8787/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"bom":[{"productId":"hmn_agt_6","name":"紅瑪瑙","diameterMm":6,"qty":1,"unitPrice":69,"lineTotal":69}],"designName":"同步測試","beadsSubtotalTwd":69,"designFeeTwd":0}'
```

## 上線

1. 建立 KV：`npx wrangler kv namespace create pearl-newebpay-orders`（及 `--preview`），把 id 填进 `wrangler.toml`  
2. `PUBLIC_API_BASE` = Worker 公網網址；`ALLOW_DEV_SIMULATE` 正式請改 `"0"`  
3. Secrets：藍新三組 + `SHOPIFY_ADMIN_TOKEN`（建議再加 `ADMIN_SYNC_SECRET`）  
4. `npm run newebpay:deploy`  
5. GitHub Secret `VITE_NEWEBPAY_API_BASE` = Worker 網址，觸發 Pages 建置  

建單失敗可重試：

```bash
curl -X POST https://YOUR_WORKER/api/admin/retry-sync \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Sync-Secret: 你的SECRET' \
  -d '{"merchantOrderNo":"P…"}'
```

## 安全

- HashKey / HashIV / Admin Token 只放 Secrets / `.dev.vars`，勿進 git、勿 `VITE_*`  
- 正式關閉 `ALLOW_DEV_SIMULATE`  
- Notify 驗 `TradeSha`；Shopify 建單以 `shopifyOrderId` 冪等
