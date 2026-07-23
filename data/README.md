# data/ — 主檔工作簿

## 商品目錄

`commodity_idx.xlsx` 是本專案的**完整** SKU 工作簿。

| 欄位 | 說明 |
|------|------|
| `id` | 唯一 SKU 編號 |
| `category1` | 珠子 / 配件 |
| `category2` | 子分類 |
| `name` | 顯示名稱（一名一圖）|
| `size_mm` | 直徑（mm）|
| `price_twd` | 單價（新台幣）|
| `picture` | `public/products/` 內的檔名 |

請勿用部分上傳覆寫此檔。新 SKU 請放入 `new_input/`，由 `npm run sync:catalog` **合併**至此。

僅在批次修正既有列時，才直接編輯此工作簿。

## 設計廣場

`plaza_designs.xlsx` 是設計廣場的**維護主表**（欄位說明見同檔 `fields` sheet，或 `docs/plaza-designs.md`）。

| 檔案 | 用途 |
|------|------|
| `plaza_designs.xlsx` | 完整主表（官方 seed + 用戶 UGC） |
| `plaza_ugc.json` | 用戶發佈列鏡像（sync 時覆寫進 xlsx 的 user 列） |
| `../src/shared/data/plazaDesigns.json` | App 運行時鏡像 |

在 `npm run dev` 下發佈/下架會經 Vite API 自動寫入上述檔案；亦可手動執行 `npm run sync:plaza`。
