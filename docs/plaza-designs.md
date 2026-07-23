# 設計廣場維護表

主檔：`data/plaza_designs.xlsx`  
UGC 鏡像：`data/plaza_ugc.json`  
運行時鏡像：`src/shared/data/plazaDesigns.json`

## 資料流

```
用戶點「發佈 / 下架 / 使用設計」
        │
        ├─► localStorage（瀏覽器即時 feed）
        │
        └─► POST /api/plaza/*（僅 vite dev）
                 │
                 ├─ 預覽圖 → public/plaza/<id>.png
                 ├─ 更新 data/plaza_ugc.json
                 └─ 合併官方 seed + UGC
                        ├─ data/plaza_designs.xlsx
                        └─ src/shared/data/plazaDesigns.json
```

- **官方 seed**（`source=seed`）：手動維護於 xlsx；sync 時保留。
- **用戶 UGC**（`source=user`）：以 `plaza_ugc.json` 為準；發佈/下架會覆寫進 xlsx。
- 手動重建：`npm run sync:plaza`
- 靜態 `preview` / 正式環境無 API 時：仍寫 localStorage，xlsx 不變更（需之後接真實後端）。

## 工作簿

| Sheet | 用途 |
|-------|------|
| `plaza_designs` | 設計主表（一行一設計） |
| `fields` | 欄位說明 |

## 欄位

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `id` | string | Y | 廣場設計唯一 ID（seed：`u-*`；用戶發佈：`pub-*`） |
| `title` | string | Y | 設計名稱 |
| `designer_name` | string | Y | 發佈暱稱（詳情頁主名稱；可不與帳號名一致） |
| `designer_id` | string | Y | **設計師 ID＝會員編號**（與「我的 → 會員編號」一致；詳情頁顯示 `ID 912525`） |
| `blurb` | string | N | 設計簡介（用戶發佈上限 15 字） |
| `use_price_twd` | number | Y | 使用價格（TWD/次）；`0` = 免費 |
| `use_count` | number | Y | 已使用次數 |
| `status` | enum | Y | `published` \| `unpublished` \| `draft` |
| `source` | enum | Y | `seed`（官方）\| `user`（UGC） |
| `source_design_id` | string | N | 對應「我的設計」ID；seed 可空 |
| `image_path` | string | Y | 預覽圖路徑，如 `/plaza/xxx.png` |
| `bead_product_ids` | string | N | 珠串配方：`productId` 按串序以 `\|` 分隔 |
| `published_at` | datetime | Y | 首次發佈（ISO 8601） |
| `updated_at` | datetime | Y | 最後更新（ISO 8601） |
| `likes` | number | N | 按讚數（預留） |
| `sort_weight` | number | N | 排序權重，越大越靠前 |
| `is_official` | 0\|1 | Y | `1` 官方示範；`0` 用戶 |
| `notes` | string | N | 營運備註 |

## 暱稱 vs 會員編號

- **`designer_name`**：發佈時填的暱稱，可與「我的」帳號名不同。
- **`designer_id`**：必須等於該設計師的**會員編號**（「我的」頁 `會員編號：xxxxxx`），詳情頁顯示為 `ID xxxxxx`，不可用暱稱代替。

## 維護流程

1. 官方示範：編輯 xlsx 中 `source=seed` 列（或先改 JSON 再留意勿被 UGC merge 覆蓋 seed）。
2. 用戶發佈：在 **`npm run dev`** 下操作 App；xlsx / ugc / 預覽圖會自動更新。
3. 預覽圖放入 `public/plaza/`，`image_path` 填 `/plaza/<檔名>`。
4. 僅 `status=published` 進廣場 feed，並依 **使用次數倒序**；首頁取前 6 名。
5. **使用次數**：訪客在廣場詳情點一次「立即購買」+1（非「使用設計」）。
6. 下架：App 刪 localStorage，並將主表該列 `status` 設為 `unpublished`（保留歷史）。
