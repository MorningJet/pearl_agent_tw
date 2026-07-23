# Product flow — DIY MVP

## Scope

H5 app shell (Home + tabs) + DIY studio + Design Details. Shopify checkout later.

## Navigation

- **Entry**: Home
- **Custom Bracelet** → DIY; DIY back → Home
- **Tabs**: Home / Design Plaza / My Designs / Me (tab bar hidden on DIY & Design Details)
- **Make Now** → Design Details; Details back → DIY

## Page regions (DIY)

1. **Top** — wrist circumference (`sum(diameterMm)` → cm), status (Too short / Standard / Too long), price, Help modal
2. **Main** — fixed circular track + logo; add from shelf; auto layout; drag reorder; drag-out delete
3. **Middle** — Clear, Recommend (stub), Make Now → Design Details
4. **Shelf** — L1 Beads / Accessories; L2 category sidebar; cards with name, mm, price
5. **Design Details** — canvas snapshot, share stubs, rename, price, wrist guide, BOM, notes, Continue / Make Now stub

## Acceptance (MVP)

- [x] Empty track with brand mark
- [x] Tap product adds bead and updates wrist + price
- [x] Drag on ring reorders
- [x] Drag away deletes one bead
- [x] Clear resets design
- [x] Help explains gestures
- [x] Make Now opens Design Details (requires ≥1 bead)
- [x] Design Details shows BOM, editable name, wrist check; Continue returns to DIY
- [x] Home shell: banner, services, DIY CTAs, plaza preview (6), 4 tabs
- [x] DIY back returns to Home
- [ ] Recommend loads fixed templates
- [ ] Design Details Make Now opens Shopify checkout

## Later phases

- Replace `src/shared/data/products.js` with Shopify Storefront
- Persist design + cart attributes (see `docs/shopify-metafields.md`)
- Embed H5 in Shopify theme (iframe or app proxy)
- Wire share / submit / real product photos on Design Details
- Phone-charm designer; Design Plaza apply-template; My Designs cloud save
