# Asset & catalog workflow

## Storage map

| What | Where | Notes |
|------|-------|-------|
| Full SKU workbook | `data/commodity_idx.xlsx` | Master table — always complete |
| Incremental upload | `new_input/` | Only this batch’s xlsx + product `.png` |
| Product images | `public/products/` | Filename = Excel `picture` |
| Brand logo | `public/brand/logo.png` | Not via `new_input` |
| UI icons | `public/icons/*.svg` | Not via `new_input` |
| Runtime catalog | `src/shared/data/catalog.json` | Generated — do not hand-edit |

## Excel schema

| Column | Meaning |
|--------|---------|
| `id` | Unique SKU id |
| `category1` | `珠子` or `配件` (L1) |
| `category2` | Sub-category (L2)，例如 水晶 / 珍珠 / 銀飾 |
| `name` | Display name — one name ↔ one picture（繁體）|
| `size_mm` | Diameter; same picture + different size = different SKU |
| `price_twd` | Unit price in TWD (NT$) |
| `picture` | Filename only, e.g. `pearl_baroque.png` |

## Add new products

1. Put **only** the new rows xlsx + matching png into `new_input/`
2. Run:

```bash
npm run sync:catalog
```

3. Script will:
   - copy images → `public/products/`
   - **normalize each product PNG** (crop/pad so the bead fills ~90% of a square — fixes uneven source padding)
   - merge rows by `id` into `data/commodity_idx.xlsx`
   - regenerate `catalog.json`
   - clear product images from `new_input/`
   - reset `new_input/commodity_idx.xlsx`: `catalog` sheet headers only + `categories` sheet listing existing category1/category2

Re-normalize all existing product images anytime:

```bash
npm run normalize:products
```

Shelf thumbs are uniform size; bracelet canvas scales beads by `diameterMm` relative to track circumference (`max(sum, 13cm)`).

4. Refresh `npm run dev`
