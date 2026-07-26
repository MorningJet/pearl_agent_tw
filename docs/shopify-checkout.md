# Shopify 結帳（舊方案／商品對照）

> **立即購買已改走藍新 MPG**，見 [`newebpay-checkout.md`](newebpay-checkout.md)。  
> 下文保留 Storefront 購物車說明，供商品 SKU／設計費變體對照；付款不再使用 Shopify Checkout。

三種詳情（普通 / 廣場 / 廣場修改後）點 **立即購買** 時邏輯相同（金額仍依 BOM）：

| 項目 | 做法 |
|------|------|
| 珠款 | 購物車加入 **每種珠／配件 SKU × 數量**（與 H5 商品明細一致；catalog `id` = Shopify Variant SKU） |
| 設計費 | 若有：售價 **NT$1** 的「設計費用」× **數量 = H5 設計費** |
| 運費 | **不**加商品列；用 Shopify 運送規則（建議：滿 NT$1000 免運，否則 NT$50） |

訂單備註／屬性會帶：設計名、手圍、配方、設計師 ID 等。

廣場頁 UI 即使只顯示「彩虹」一個名稱，結帳仍按底層珠串拆 SKU。

---

## 你要準備的

1. **珠子商品**已匯入（SKU = 目錄 id）  
2. 手動新增商品 **設計費用**，售價 **NT$1**，複製 Variant GID  
3. Storefront API token  
4. 環境變數：

```bash
VITE_SHOPIFY_STORE_DOMAIN=1gfsew-ic.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=…
VITE_SHOPIFY_API_VERSION=2025-01
VITE_SHOPIFY_DESIGN_FEE_UNIT_VARIANT_GID=gid://shopify/ProductVariant/你的設計費用變體ID
```

如何找 Variant GID：商品 → 變體 → 網址或 API；或瀏覽器開發者工具看 Admin 請求。也可先 `npm run sync:shopify-variants` 對照 SKU。

GitHub Actions Secrets 寫入同名變數後 push 即可上線。

運送：**Settings → Shipping and delivery** 對齊 H5 免運門檻。

## 結帳出現 Out of stock / SOLD OUT

常見有兩種完全不同的原因：

### A. 未帶台灣市場（本專案曾踩過）

商店 Markets 有 **Taiwan / Hong Kong** 時，Storefront `cartCreate` **不帶** `buyerIdentity.countryCode: TW`（或 `@inContext(country: TW)`）會把商品加成 **quantity = 0**，Checkout 顯示整車 SOLD OUT——即使 Admin 裡「可用數量」是 100。

H5 已固定以台灣市場建車。若仍售罄，再查 B。

### B. 真的沒庫存／庫存位置不對

DIY 接單手作建議珠款與「設計費用」開啟 **Continue selling when out of stock**，或把 Inventory 調高，並確認 **Online Store 出貨庫房** 有貨。

「設計費用」若追蹤庫存，數量需 ≥ 設計費金額（例如 NT$59 → 至少 59 件）。

## 嵌入與「立即付款」卡在 Cloudflare / workers.dev

H5 若嵌在 Shopify Page 的 **iframe** 裡：

1. **底部留白**：iframe 高度必須是 `100dvh`（或 fixed 铺满），且 Page 用 `{% layout none %}` 去掉主題頭尾。見 [`shopify-embed-page.liquid`](shopify-embed-page.liquid)。
2. **結帳 API**：正式環境 `VITE_NEWEBPAY_API_BASE` 應為 Shopify App Proxy  
   `https://pearl-diy.myshopify.com/apps/pearl-pay`  
   （瀏覽器直連 `*.workers.dev` 常被劫持／人機驗證卡住，導致停在「前往付款」且後台無單。）
3. 點「立即付款」會開同域 `pay-bridge.html`，再經 App Proxy 建單並導向藍新。

勿再使用 README 舊版的 `min-height:80vh` 嵌入方式。
