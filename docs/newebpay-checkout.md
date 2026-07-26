# 藍新金流 MPG + Shopify Admin 回寫

H5 **不**存放 HashKey / HashIV / Admin Token。加簽、Notify、建單只在 [`workers/newebpay`](../workers/newebpay)。

## 架構（對齊訂單流轉示意圖）

```text
收貨資訊「立即付款」
  → POST /api/checkout
       ① 必做：Shopify Admin 建立「未付款」訂單（與藍新是否就緒無關）
       ② 可選：AES 加簽 → 回傳藍新 MPG 參數（失敗不回滾 Shopify 單）
  → 若 paymentReady：瀏覽器 POST → 藍新 MPG
  → 支付成功 NotifyURL / ReturnURL
       → 驗簽 → 既有 Shopify 單標記已付款 + pearl:scheduling（排單中）
  → 支付失敗 / 取消 / 藍新未就緒
       → Shopify 單維持未付款（pending / pearl:unpaid）
  → 後續履約（後台 tag / 出貨）
       → 設計中 → 運送中 → 待提貨 → 已完成 → 已關閉
```

金額 = 珠款小計 + 設計費 + 運費（珠款 ≥ NT$1000 免運，否則 NT$50）。  
**不經 Shopify Checkout**，一般不產生 Shopify 第三方結帳手續費。

## 建單欄位（立即付款時寫入 Shopify）

| Admin 欄位 | H5 寫入 |
|------------|---------|
| 訂單 / 日期 / 發貨期限 / 渠道 / 商品件數顯示 / 配送狀態 / 配送方式 | Shopify 自動，不特別寫入 |
| 客戶 | `order.email` |
| 總計 | BOM 珠款 + 設計費 + 運費（= 藍新支付總價） |
| 商品 | H5 BOM → 後台變體（SKU=`productId`，含產品圖）；設計費 =「設計費用」× 數量（NT$1 單位） |
| 運費 | `shipping_lines`：珠款 ≥1000 包郵，否則 NT$50（不建運費商品行） |
| 支付狀態 | 初值 `pending`（待付款）；藍新成功後 `paid` |
| 發貨狀態 | 初值未發貨；後台上傳物流單號後變更 |
| 標記 | H5 狀態中文：起初「未付款」；付款成功改「排單中」（其餘狀態後台手動加） |
| 備註 | 藍新訂單號、手圍、商品編碼（上方中央偏右起點順時針 `1. id` 每顆一行）；**不含**商品明細 |

商品編碼順序與畫布一致：陣列第 1 顆 = 手串上方中央偏右，其後順時針。

## Shopify Admin（Dev Dashboard — 新店唯一方式）

商店後台已無法新建舊版「自訂應用」`shpat_`。請用 Dev Dashboard：

1. 設定 → 應用 → 開發應用 → **在 Dev Dashboard 中構建應用**（或沿用已建的 `order_update`）
2. 應用 **Versions / 版本** → 建立版本，Admin API scopes 勾選：
   - `write_orders`
   - `read_orders`
   - `read_products`（建單時依 SKU 對應變體，建議勾選）
3. **Release / 發布** 該版本
4. **Install / 安裝到** `pearl-diy` 商店（必須安裝，否則換 token 會失敗）
5. **Settings / 設置** 複製：
   - Client ID
   - Client Secret（加密密钥）
6. 寫入 `workers/newebpay/.dev.vars`（勿提交 git、勿貼聊天）：

```bash
SHOPIFY_STORE_DOMAIN=pearl-diy.myshopify.com
SHOPIFY_CLIENT_ID=你的ClientID
SHOPIFY_CLIENT_SECRET=你的ClientSecret
```

Worker 會用 [client_credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant) 自動換 ~24h access token，無需手填 `shpat_`。

正式：`npx wrangler secret put SHOPIFY_CLIENT_ID` 與 `SHOPIFY_CLIENT_SECRET`。

## 本機

```bash
cp workers/newebpay/.dev.vars.example workers/newebpay/.dev.vars
# 填 HashKey/HashIV + Shopify 憑證

npm run newebpay:dev   # :8787
npm run dev            # :5173  且 .env 有 VITE_NEWEBPAY_API_BASE=/newebpay-api
```

### 藍新尚未過審時：模擬付款 → 測「未付款 → 排單中」

1. 在詳情頁點「立即購買」→ 收貨資訊填寫 →「立即付款」  
2. Worker 應已在 Shopify 建立 **未付款** 單；日誌有 `unpaid order created` 與 `merchantOrderNo`  
3. 模擬付款成功：

```bash
curl -sS -X POST http://127.0.0.1:8787/api/dev/simulate-paid \
  -H 'Content-Type: application/json' \
  -d '{"merchantOrderNo":"P你的單號"}'
```

4. 到 Shopify Admin → **訂單** 應變為已付款，tag 含 `pearl:scheduling`  
5. 查狀態：`GET http://127.0.0.1:8787/api/order/P你的單號`

也可只打 checkout API（不必真的跳藍新）：

```bash
curl -sS -X POST http://127.0.0.1:8787/api/checkout \
  -H 'Content-Type: application/json' \
  -d '{"bom":[{"productId":"hmn_agt_6","name":"紅瑪瑙","diameterMm":6,"qty":1,"unitPrice":69,"lineTotal":69}],"designName":"同步測試","beadsSubtotalTwd":69,"designFeeTwd":0,"email":"test@example.com","beadProductCode":"hmn_agt_6","wristCm":"16"}'
```

## 上線

1. 建立 KV：`npx wrangler kv namespace create pearl-newebpay-orders`（及 `--preview`），把 id 填进 `wrangler.toml`  
2. `PUBLIC_API_BASE` = Worker 公網網址；`ALLOW_DEV_SIMULATE` 正式請改 `"0"`  
3. Secrets：藍新三組 + Shopify 憑證（建議再加 `ADMIN_SYNC_SECRET`）  
4. `npm run newebpay:deploy`  
5. GitHub Secret `VITE_NEWEBPAY_API_BASE` = Worker 網址，觸發 Pages 建置  

若付款成功但 Shopify 標記失敗可重試：

```bash
curl -X POST https://YOUR_WORKER/api/admin/retry-sync \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Sync-Secret: 你的SECRET' \
  -d '{"merchantOrderNo":"P…"}'
```

## 安全

- HashKey / HashIV / Admin Token / **Webhook Secret** 只放 Secrets / `.dev.vars`，勿進 git、勿 `VITE_*`  
- 正式關閉 `ALLOW_DEV_SIMULATE`  
- Notify 驗 `TradeSha`；付款標記以 `status=shopify_synced` + `h5Status=scheduling` 冪等  

## Shopify 訂單狀態 →「我的訂單」

見 [shopify-order-webhooks.md](shopify-order-webhooks.md)：`POST /api/webhooks/shopify`。
