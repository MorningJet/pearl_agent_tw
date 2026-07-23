# Pearl Agent TW

台灣市場 DIY 串珠手鍊 **H5**，可嵌入電商官網（Shopify 等）。

**建置方案：** 電商站台 + 輕量 H5 嵌入  
**MVP：** DIY 頁 + 設計詳情（結帳串接後續）  
**在地化：** 繁體中文（台灣用語）· 幣別 NT$

## 技術棧

| 工具 | 角色 |
|------|------|
| Cursor | AI 輔助開發 |
| Tailwind CSS | 簡潔、留白充足的介面 |
| HTML5 Canvas | 手鍊軌道 + 手勢操作 |
| Vanilla JS | 業務邏輯（ES modules）|
| Shopify 等 | 電商後端（後續）|

## 快速開始

```bash
npm install
npm run dev
```

建議以手機尺寸視窗開啟本機網址，體驗最佳。

### GitHub Pages（推薦託管）

推到 GitHub 後由 Actions 建置並發布（無需 Vercel）：

1. 建立空倉庫（建議名 `pearl_agent_tw`），本機初始化並推送：

```bash
git init
git add .
git commit -m "Initial commit: Pearl Agent TW"
git branch -M main
git remote add origin https://github.com/MorningJet/pearl_agent_tw.git
git push -u origin main
```

2. 倉庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 推送 `main` 後等待 workflow **Deploy GitHub Pages** 成功。
4. 站點網址：`https://MorningJet.github.io/pearl_agent_tw/`（倉庫名不同則改路徑）。
5. Shopify 頁面 iframe 改為該 URL。

本機預覽 Pages 路徑前綴：

```bash
VITE_BASE=/pearl_agent_tw/ npm run build && npx vite preview
```

## 目錄結構

```text
index.html                 Studio 外殼（#app 掛載點）
src/main.js                啟動 — 串接 DIY ↔ 設計詳情
src/pages/diy/             DIY 頁 + canvas + ui
src/pages/details/         設計詳情頁 + BOM
src/shared/                state、domain、data、nav、studio
src/styles/main.css
data/ + new_input/         Excel + 圖片投放區（`npm run sync:catalog`）
public/brand|icons|products
docs/                      產品與 Shopify 慣例
```

## MVP 檢查清單

- [x] 頂部：腕圍、價格、說明
- [x] Canvas：軌道、加入、排序、拖出刪除
- [x] 中部：清除 / 推薦 stub / 立即製作 → 設計詳情
- [x] 貨架：雙層導覽 + 商品卡
- [x] 設計詳情：快照、BOM、重新命名、繼續
- [x] 目錄來自 Excel + 商品圖
- [x] 台灣繁體介面 + NT$ 幣別
- [ ] 飛入加入動畫打磨
- [ ] Shopify Storefront 目錄 + 結帳橋接

## 新增 / 更新商品

1. 將**本批次**的 `commodity_idx.xlsx` + 商品 `.png` 放入 `new_input/`
2. `npm run sync:catalog`（合併至 `data/commodity_idx.xlsx`；投放區 xlsx 重置為僅表頭）
3. 重新整理 DIY 頁

完整目錄在 `data/`；UI logo／圖示在 `public/brand` 與 `public/icons`（不在 `new_input`）。

詳見 [docs/asset-naming.md](docs/asset-naming.md)。

## 文件

- [產品流程](docs/product-flow.md)
- [Shopify metafields](docs/shopify-metafields.md)
- [素材命名](docs/asset-naming.md)
