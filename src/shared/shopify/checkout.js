/**
 * Shopify checkout from design BOM (all details modes: normal / plaza / plaza-edit).
 *
 * Cart lines:
 * 1. Each bead/accessory SKU × qty (catalog id = Shopify variant SKU)
 * 2. Optional design fee: NT$1「設計費用」× fee TWD from H5
 *
 * Shipping: Shopify shipping rates only (never a cart line).
 */

import {
  designFeeUnitVariantGid,
  isShopifyConfigured,
  shopDomain,
} from './config.js'
import { storefrontGraphql } from './storefront.js'
import { ensureVariantsForSkus, getVariantGidForSku } from './variantMap.js'

/**
 * @typedef {{
 *   designName: string,
 *   wristCm: string,
 *   detailsMode: string,
 *   designId?: string,
 *   plazaPublishId?: string,
 *   designerId?: string,
 *   designFeeTwd?: number,
 *   designImageUrl?: string,
 *   beadsSubtotalTwd?: number,
 * }} CheckoutMeta
 */

/**
 * @param {Array<{ productId: string, name: string, diameterMm: number, qty: number, unitPrice?: number, lineTotal?: number }>} bom
 * @param {CheckoutMeta} meta
 * @returns {Promise<{ ok: true, checkoutUrl: string } | { ok: false, error: string }>}
 */
export async function createCheckoutFromBom(bom, meta) {
  if (!bom?.length) {
    return { ok: false, error: '設計中沒有珠子，無法下單' }
  }
  if (!isShopifyConfigured()) {
    return {
      ok: false,
      error: '尚未連接 Shopify（請設定 Storefront Domain / Token）',
    }
  }

  const skus = bom.map((r) => r.productId)
  const ensured = await ensureVariantsForSkus(skus)
  if (!ensured.ok) {
    const sample = ensured.missing.slice(0, 3).join(', ')
    return {
      ok: false,
      error: `Shopify 找不到對應商品 SKU：${sample}${ensured.missing.length > 3 ? '…' : ''}`,
    }
  }

  const beadsSubtotal = resolveBeadsSubtotal(bom, meta)
  const fee = Math.max(0, Math.round(Number(meta.designFeeTwd) || 0))
  const imageUrl = publicDesignImageUrl(meta.designImageUrl || '')
  const recipe = formatRecipe(bom)

  /** @type {{ merchandiseId: string, quantity: number, attributes?: { key: string, value: string }[] }[]} */
  const lines = bom.map((row) => ({
    merchandiseId: getVariantGidForSku(row.productId),
    quantity: row.qty,
    attributes: [
      { key: '設計名稱', value: clip(meta.designName || '', 100) },
      { key: 'SKU', value: row.productId },
      { key: '尺寸', value: `${row.diameterMm}mm` },
    ].filter((a) => a.value),
  }))

  if (fee > 0) {
    const feeUnitGid = designFeeUnitVariantGid()
    if (!feeUnitGid) {
      return {
        ok: false,
        error:
          '有設計費時請設定 VITE_SHOPIFY_DESIGN_FEE_UNIT_VARIANT_GID（售價 NT$1 的「設計費用」變體）',
      }
    }
    lines.push({
      merchandiseId: feeUnitGid,
      quantity: fee,
      attributes: [
        { key: '項目', value: '設計費用' },
        { key: '設計名稱', value: clip(meta.designName || '', 100) },
        { key: '設計師ID', value: clip(meta.designerId || '', 64) },
        { key: '設計費金額', value: `NT$${fee}` },
      ].filter((a) => a.value),
    })
  }

  const attributes = [
    { key: 'pearl_design_name', value: clip(meta.designName || '手鍊設計', 100) },
    { key: 'pearl_wrist_cm', value: clip(meta.wristCm || '', 32) },
    { key: 'pearl_details_mode', value: clip(meta.detailsMode || 'normal', 32) },
    { key: 'pearl_design_id', value: clip(meta.designId || '', 64) },
    { key: 'pearl_plaza_publish_id', value: clip(meta.plazaPublishId || '', 64) },
    { key: 'pearl_designer_id', value: clip(meta.designerId || '', 64) },
    { key: 'pearl_beads_subtotal_twd', value: String(beadsSubtotal) },
    { key: 'pearl_design_fee_twd', value: String(fee) },
    { key: 'pearl_design_image', value: clip(imageUrl, 500) },
    { key: 'pearl_recipe', value: clip(recipe, 500) },
  ].filter((a) => a.value)

  const note = [
    `設計：${meta.designName || ''}`,
    meta.wristCm ? `腕圍 ≈ ${meta.wristCm}cm` : '',
    `珠款 NT$${beadsSubtotal}`,
    fee > 0 ? `設計費 NT$${fee}` : '',
    imageUrl ? `預覽：${imageUrl}` : '',
    recipe ? `配方：${recipe}` : '',
  ]
    .filter(Boolean)
    .join('｜')

  const mutation = `
    mutation CartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { checkoutUrl }
        userErrors { field message }
      }
    }
  `

  try {
    const data = await storefrontGraphql(mutation, {
      input: {
        lines,
        attributes,
        note: clip(note, 5000),
      },
    })
    const payload = data?.cartCreate
    const err = payload?.userErrors?.[0]?.message
    if (err) return { ok: false, error: err }
    const url = payload?.cart?.checkoutUrl
    if (!url) return { ok: false, error: '未取得結帳連結' }
    return { ok: true, checkoutUrl: url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || '下單失敗')
    return { ok: false, error: msg }
  }
}

/**
 * @param {Array<{ lineTotal?: number, unitPrice?: number, qty: number }>} bom
 * @param {CheckoutMeta} meta
 */
function resolveBeadsSubtotal(bom, meta) {
  if (Number.isFinite(meta.beadsSubtotalTwd)) {
    return Math.max(0, Math.round(Number(meta.beadsSubtotalTwd)))
  }
  return Math.round(
    bom.reduce((sum, row) => {
      if (Number.isFinite(row.lineTotal)) return sum + Number(row.lineTotal)
      return sum + Number(row.unitPrice || 0) * row.qty
    }, 0),
  )
}

/** @param {Array<{ productId: string, name: string, diameterMm: number, qty: number }>} bom */
function formatRecipe(bom) {
  return bom
    .map((r) => `${r.name} ${r.diameterMm}mm×${r.qty}(${r.productId})`)
    .join(', ')
}

/**
 * Prefer http(s) preview for order attributes. Skip huge data-URLs.
 * @param {string} url
 */
export function publicDesignImageUrl(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  if (/^data:/i.test(u)) return ''
  if (/^https?:\/\//i.test(u)) return u
  try {
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin)
    return new URL(u.replace(/^\//, ''), base).href
  } catch {
    return u
  }
}

/**
 * Leave the GitHub Pages / Shopify iframe and open checkout.
 * @param {string} url
 */
export function navigateToCheckout(url) {
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url
      return
    }
  } catch {
    /* cross-origin top — fall through */
  }
  window.location.href = url
}

/** Permalink helper when numeric variant ids are known. */
export function buildCartPermalink(lines) {
  const domain = shopDomain()
  if (!domain || !lines.length) return ''
  const path = lines.map((l) => `${l.variantId}:${l.quantity}`).join(',')
  return `https://${domain}/cart/${path}`
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '')
  return t.length <= n ? t : t.slice(0, n)
}
