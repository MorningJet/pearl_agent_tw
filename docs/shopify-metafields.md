# Shopify metafields & catalog conventions

**MVP:** catalog lives in `src/shared/data/products.js`.  
**Later:** map Storefront products into the same shape via a thin adapter (do not leak GraphQL into canvas/UI).

Target JS shape:

```js
{ id, type: 'bead'|'accessory', category, name, diameterMm, price, color, image? }
```

## Namespace

Use namespace: `pearl`

| Key | Owner | Type | Required | Description |
|-----|-------|------|----------|-------------|
| `pearl.diameter_mm` | Product variant | `number_decimal` | Yes | Outer diameter in millimeters; drives circumference |
| `pearl.material_type` | Product | `single_line_text_field` | Yes | `bead` or `accessory` |
| `pearl.category_handle` | Product | `single_line_text_field` | Yes | Sub-category handle (e.g. `white-crystal`, `spacer`) |
| `pearl.canvas_image` | Product / variant | `file_reference` or `url` | Yes | Transparent PNG/WebP for canvas |
| `pearl.thickness_mm` | Product variant | `number_decimal` | No | For non-spherical accessories along the string |
| `pearl.hole_mm` | Product variant | `number_decimal` | No | Cord hole diameter (fulfillment / UX later) |

## Collections

| Collection handle | Purpose |
|-------------------|---------|
| `diy-beads` | All bead materials |
| `diy-accessories` | All accessories |
| `cat-{handle}` | Optional per-category collections mirroring `pearl.category_handle` |

Alternatively use product tags: `diy:bead` / `diy:accessory`, `cat:white-crystal`, …

## Variant rules

- Each sellable size (6mm / 8mm / 10mm) is a **variant**
- `pearl.diameter_mm` on the **variant** when sizes differ
- Price/inventory from the variant

## Cart attributes (phase 2+)

| Attribute key | Value |
|---------------|--------|
| `pearl_design_id` | Saved design id |
| `pearl_recipe` | Ordered variant GIDs / compact JSON |

## Markets & currency

Rely on Shopify Markets. H5 displays Storefront `amount` + `currencyCode` — do not hard-code `¥`.
