# Shopify 訂單 Webhook → H5「我的訂單」狀態

接收端掛在既有 NewebPay Worker（同一 `PUBLIC_API_BASE`），不另起服務。

## 路由

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/api/webhooks/shopify` | **Shopify 推送入口**（驗 `X-Shopify-Hmac-Sha256`） |
| `GET` | `/api/h5/order-status?shopifyOrderId=` | H5 查單狀態 |
| `GET` | `/api/h5/order-status?merchantOrderNo=` | 用藍新單號查 |
| `GET` | `/api/h5/order-status?shopifyOrderName=` | 用 `#1001` 這類名稱查 |
| `POST` | `/api/h5/order-status/batch` | 批量：`{ shopifyOrderIds, merchantOrderNos }` |

Webhook 成功回應示例：

```json
{ "ok": true, "topic": "orders/updated", "h5Status": "scheduling", "shopifyOrderId": "5678" }
```

H5 查詢示例：

```bash
curl "https://YOUR_WORKER/api/h5/order-status?shopifyOrderId=5678"
```

```json
{
  "ok": true,
  "order": {
    "shopifyOrderId": "5678",
    "shopifyOrderName": "#1001",
    "merchantOrderNo": "P…",
    "h5Status": "designing",
    "financialStatus": "paid",
    "fulfillmentStatus": null,
    "trackingNo": "",
    "title": "捕夢網",
    "amountTwd": 1025,
    "updatedAt": 1710000000000
  }
}
```

## 狀態對照（Shopify → H5）

| H5 `h5Status` | 觸發條件（優先序由上到下） |
|---------------|---------------------------|
| `closed` 已關閉 | `cancelled_at`，或 `financial_status` = refunded / voided |
| 標籤覆寫 | 訂單 tags 含中文「未付款／排單中／設計中／運送中／待提貨／已完成／已關閉」，或舊版 `pearl:unpaid` 等 |
| 屬性覆寫 | `note_attributes` 名 `pearl_h5_status` = 上列英文值 |
| `unpaid` 未付款 | pending / authorized / partially_paid |
| `done` 已完成 | `fulfillment_status` = fulfilled |
| `shipping` 運送中 | `fulfillment_status` = partial |
| `scheduling` 排單中 | paid（尚未出貨、無自訂標籤） |

**排單中 → 設計中 → 待提貨** 這三段可在後台訂單改 tag 為中文狀態（例如「設計中」「待提貨」）。

（改 tag 會觸發 `orders/updated`，Webhook 即更新 H5 狀態。）

## 在 Shopify 註冊 Webhook

1. 設定 → 通知 → **Webhooks**（或 App 的 webhook 訂閱）  
2. 建立事件（同一個 URL 可訂多個）：
   - Order creation  
   - Order update  
   - Order payment  
   - Order cancellation  
   - Fulfillment creation  
   - Fulfillment update  
   - Refund create（可選）  
3. URL：`https://YOUR_WORKER_HOST/api/webhooks/shopify`  
4. 格式：JSON  
5. 複製 **Signing secret** → Worker secret：

```bash
npx wrangler secret put SHOPIFY_WEBHOOK_SECRET --config workers/newebpay/wrangler.toml
# 本機：寫入 workers/newebpay/.dev.vars
```

6. `npm run newebpay:deploy`

本地測 HMAC 可用 Shopify CLI `webhook trigger`，或暫時用 Admin「发送测试通知」。

## 與藍新單關聯

「立即付款」時即建立 Shopify **未付款** 單，並寫入 `note_attributes.newebpay_merchant_order_no` + `pearl_h5_status=unpaid`。  
藍新支付成功後同單標記 paid，並改為 `pearl_h5_status=scheduling` / tag `pearl:scheduling`。

Webhook 收到後會：

1. 寫入 KV 鏡像 `shopify-order:{id}`  
2. 若找得到對應藍新 pending/paid 記錄，一併更新 `h5Status` / 物流單號  

## 建議後續（H5）

「我的訂單」改為：本地示意單 + `GET /api/h5/order-status` 輪詢／進頁刷新真實單狀態（本 PR 只提供服務端接收與查詢；列表 UI 接線可下一步做）。
