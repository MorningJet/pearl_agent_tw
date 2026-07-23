# Shopify 結帳（簡化方案）

三種詳情（普通 / 廣場 / 廣場修改後）點 **立即購買** 時邏輯相同：

| 項目 | 做法 |
|------|------|
| 珠款 | 購物車加入 **每種珠／配件 SKU × 數量**（與 H5 商品明細一致；catalog `id` = Shopify Variant SKU） |
| 設計費 | 若有：售價 **NT$1** 的「設計費用」× **數量 = H5 設計費** |
| 運費 | **不**加商品列；用 Shopify 運送規則（建議：滿 NT$1000 免運，否則 NT$50） |

訂單備註／屬性會帶：設計名、腕圍、配方、設計師 ID 等。

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
