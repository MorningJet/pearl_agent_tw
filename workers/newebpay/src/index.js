/**
 * Pearl Pearl — NewebPay MPG payment worker.
 *
 * Secrets (wrangler secret / .dev.vars):
 *   NEWEBPAY_MERCHANT_ID, NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV
 * Vars:
 *   NEWEBPAY_ENV=sandbox|production
 *   PUBLIC_API_BASE=https://your-worker.workers.dev
 *   H5_RETURN_URL=https://morningjet.github.io/pearl_agent_tw/?embed=1
 *   NEWEBPAY_DEFAULT_EMAIL=optional@example.com
 *   CORS_ORIGINS=comma-separated origins (optional; * in dev)
 */

const GATEWAYS = {
  sandbox: 'https://ccore.newebpay.com/MPG/mpg_gateway',
  production: 'https://core.newebpay.com/MPG/mpg_gateway',
}

const MPG_VERSION = '2.0'
const FREE_SHIPPING_MIN_TWD = 1000
const STANDARD_SHIPPING_TWD = 50

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   */
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      if (url.pathname === '/health') {
        return json({ ok: true }, 200, cors)
      }

      if (url.pathname === '/api/checkout' && request.method === 'POST') {
        return await handleCheckout(request, env, cors)
      }

      if (url.pathname === '/api/notify' && request.method === 'POST') {
        return await handleNotify(request, env)
      }

      if (
        (url.pathname === '/api/return' || url.pathname === '/api/return/') &&
        (request.method === 'GET' || request.method === 'POST')
      ) {
        return await handleReturn(request, env)
      }

      return json({ ok: false, error: 'Not found' }, 404, cors)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[newebpay]', msg)
      return json({ ok: false, error: msg }, 500, cors)
    }
  },
}

/**
 * @param {Request} request
 * @param {Record<string, string>} env
 * @param {Record<string, string>} cors
 */
async function handleCheckout(request, env, cors) {
  assertSecrets(env)
  /** @type {any} */
  const body = await request.json()
  const bom = Array.isArray(body?.bom) ? body.bom : []
  if (!bom.length) {
    return json({ ok: false, error: '設計中沒有珠子，無法下單' }, 400, cors)
  }

  const beadsSubtotal = Math.max(
    0,
    Math.round(Number(body?.beadsSubtotalTwd) || sumBom(bom)),
  )
  const designFee = Math.max(0, Math.round(Number(body?.designFeeTwd) || 0))
  const shipping =
    beadsSubtotal >= FREE_SHIPPING_MIN_TWD ? 0 : STANDARD_SHIPPING_TWD
  const amt = beadsSubtotal + designFee + shipping
  if (amt < 1) {
    return json({ ok: false, error: '金額無效' }, 400, cors)
  }

  const designName = clip(String(body?.designName || '手鍊設計'), 40)
  const merchantOrderNo = makeOrderNo()
  const publicBase = String(env.PUBLIC_API_BASE || '').replace(/\/$/, '')
  if (!publicBase) {
    return json(
      {
        ok: false,
        error: '伺服器未設定 PUBLIC_API_BASE（Notify/Return 需要公網網址）',
      },
      500,
      cors,
    )
  }

  const email =
    clip(String(body?.email || env.NEWEBPAY_DEFAULT_EMAIL || ''), 50) ||
    'buyer@pearl-diy.local'

  const tradePlain = {
    MerchantID: env.NEWEBPAY_MERCHANT_ID,
    RespondType: 'JSON',
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    Version: MPG_VERSION,
    MerchantOrderNo: merchantOrderNo,
    Amt: String(amt),
    ItemDesc: clip(`Pearl Pearl｜${designName}`, 50),
    Email: email,
    ReturnURL: `${publicBase}/api/return`,
    NotifyURL: `${publicBase}/api/notify`,
    ClientBackURL: String(env.H5_RETURN_URL || publicBase),
    CREDIT: '1',
    // Optional channels — NewebPay ignores if not enabled on the merchant
    VACC: '1',
    CVS: '1',
    LINEPAY: '1',
  }

  // Order comment for merchant (not all envs support; keep short in ItemDesc)
  const recipe = clip(String(body?.recipe || formatRecipe(bom)), 200)

  const tradeInfo = await encryptTradeInfo(tradePlain, env)
  const tradeSha = await tradeShaOf(tradeInfo, env)
  const envName = String(env.NEWEBPAY_ENV || 'sandbox').toLowerCase()
  const gatewayUrl =
    GATEWAYS[envName] || GATEWAYS.sandbox

  console.log('[newebpay] checkout', {
    merchantOrderNo,
    amt,
    beadsSubtotal,
    designFee,
    shipping,
    recipe: recipe.slice(0, 80),
  })

  return json(
    {
      ok: true,
      gatewayUrl,
      MerchantID: env.NEWEBPAY_MERCHANT_ID,
      TradeInfo: tradeInfo,
      TradeSha: tradeSha,
      Version: MPG_VERSION,
      merchantOrderNo,
      amountTwd: amt,
      breakdown: { beadsSubtotal, designFee, shipping },
    },
    200,
    cors,
  )
}

/**
 * @param {Request} request
 * @param {Record<string, string>} env
 */
async function handleNotify(request, env) {
  assertSecrets(env)
  const form = await request.formData()
  const tradeInfo = String(form.get('TradeInfo') || '')
  const tradeSha = String(form.get('TradeSha') || '')
  if (!tradeInfo || !tradeSha) {
    return new Response('MISSING', { status: 400 })
  }

  const expectSha = await tradeShaOf(tradeInfo, env)
  if (expectSha !== tradeSha.toUpperCase()) {
    console.error('[newebpay] notify bad sha')
    return new Response('FAIL', { status: 400 })
  }

  const raw = await decryptTradeInfo(tradeInfo, env)
  /** @type {any} */
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    console.error('[newebpay] notify bad json', raw)
    return new Response('FAIL', { status: 400 })
  }

  console.log('[newebpay] notify', {
    Status: payload?.Status,
    MerchantOrderNo: payload?.Result?.MerchantOrderNo,
    TradeNo: payload?.Result?.TradeNo,
    Amt: payload?.Result?.Amt,
    PaymentType: payload?.Result?.PaymentType,
  })

  // MVP: acknowledge only. Persist via KV/DB later if needed.
  return new Response('OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/**
 * @param {Request} request
 * @param {Record<string, string>} env
 */
async function handleReturn(request, env) {
  const h5 = String(env.H5_RETURN_URL || '/').trim() || '/'
  let status = 'unknown'
  let orderNo = ''
  let amt = ''

  try {
    assertSecrets(env)
    let tradeInfo = ''
    let tradeSha = ''
    if (request.method === 'POST') {
      const form = await request.formData()
      tradeInfo = String(form.get('TradeInfo') || '')
      tradeSha = String(form.get('TradeSha') || '')
    } else {
      const url = new URL(request.url)
      tradeInfo = url.searchParams.get('TradeInfo') || ''
      tradeSha = url.searchParams.get('TradeSha') || ''
    }
    if (tradeInfo && tradeSha) {
      const expectSha = await tradeShaOf(tradeInfo, env)
      if (expectSha === tradeSha.toUpperCase()) {
        const raw = await decryptTradeInfo(tradeInfo, env)
        const payload = JSON.parse(raw)
        status = payload?.Status === 'SUCCESS' ? 'success' : 'failed'
        orderNo = String(payload?.Result?.MerchantOrderNo || '')
        amt = String(payload?.Result?.Amt || '')
      } else {
        status = 'bad_signature'
      }
    }
  } catch (e) {
    console.error('[newebpay] return', e)
    status = 'error'
  }

  const dest = new URL(h5, 'https://example.invalid')
  // If H5_RETURN_URL is absolute, URL() keeps it; if relative, fall back below.
  let redirectTo = h5
  try {
    if (/^https?:\/\//i.test(h5)) {
      const u = new URL(h5)
      u.searchParams.set('pay', status)
      if (orderNo) u.searchParams.set('order', orderNo)
      if (amt) u.searchParams.set('amt', amt)
      redirectTo = u.toString()
    }
  } catch {
    /* keep h5 */
  }

  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>付款結果</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafaf9;color:#1c1917}
.card{max-width:22rem;padding:1.5rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
a{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;background:#1c1917;color:#fff;border-radius:999px;text-decoration:none;font-size:.875rem}</style></head>
<body><div class="card"><h1 style="font-size:1.125rem;margin:0 0 .5rem">${
    status === 'success' ? '付款成功' : '付款結束'
  }</h1>
<p style="margin:0;font-size:.875rem;color:#78716c">${
    status === 'success'
      ? `訂單 ${escapeHtml(orderNo)}｜NT$${escapeHtml(amt)}`
      : '若已扣款，請稍後在「我的訂單」確認，或聯繫客服。'
  }</p>
<a href="${escapeHtml(redirectTo)}">返回商店</a>
<script>setTimeout(function(){location.replace(${JSON.stringify(
    redirectTo,
  )})},1600)</script>
</div></body></html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** @param {Record<string, string>} env */
function assertSecrets(env) {
  if (!env.NEWEBPAY_MERCHANT_ID || !env.NEWEBPAY_HASH_KEY || !env.NEWEBPAY_HASH_IV) {
    throw new Error('缺少 NEWEBPAY_MERCHANT_ID / HASH_KEY / HASH_IV')
  }
}

/**
 * @param {Record<string, string>} fields
 * @param {Record<string, string>} env
 */
async function encryptTradeInfo(fields, env) {
  const query = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const key = await importAesKey(env.NEWEBPAY_HASH_KEY)
  const iv = te().encode(env.NEWEBPAY_HASH_IV)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    te().encode(query),
  )
  return bufferToHex(encrypted)
}

/**
 * @param {string} tradeInfoHex
 * @param {Record<string, string>} env
 */
async function decryptTradeInfo(tradeInfoHex, env) {
  const key = await importAesKey(env.NEWEBPAY_HASH_KEY)
  const iv = te().encode(env.NEWEBPAY_HASH_IV)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    key,
    hexToBuffer(tradeInfoHex),
  )
  return td().decode(decrypted)
}

/**
 * @param {string} tradeInfo
 * @param {Record<string, string>} env
 */
async function tradeShaOf(tradeInfo, env) {
  const raw = `HashKey=${env.NEWEBPAY_HASH_KEY}&${tradeInfo}&HashIV=${env.NEWEBPAY_HASH_IV}`
  const digest = await crypto.subtle.digest('SHA-256', te().encode(raw))
  return bufferToHex(digest).toUpperCase()
}

/** @param {string} hashKey */
async function importAesKey(hashKey) {
  return crypto.subtle.importKey(
    'raw',
    te().encode(hashKey),
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt'],
  )
}

function makeOrderNo() {
  const t = Date.now().toString(36).toUpperCase()
  const r = Math.random().toString(36).slice(2, 8).toUpperCase()
  return clip(`P${t}${r}`, 30)
}

/** @param {Array<{ lineTotal?: number, unitPrice?: number, qty: number }>} bom */
function sumBom(bom) {
  return Math.round(
    bom.reduce((sum, row) => {
      if (Number.isFinite(row.lineTotal)) return sum + Number(row.lineTotal)
      return sum + Number(row.unitPrice || 0) * Number(row.qty || 0)
    }, 0),
  )
}

/** @param {Array<{ name?: string, diameterMm?: number, qty?: number, productId?: string }>} bom */
function formatRecipe(bom) {
  return bom
    .map(
      (r) =>
        `${r.name || ''} ${r.diameterMm || ''}mm×${r.qty || 0}(${r.productId || ''})`,
    )
    .join(', ')
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '')
  return t.length <= n ? t : t.slice(0, n)
}

function te() {
  return new TextEncoder()
}
function td() {
  return new TextDecoder()
}

/** @param {ArrayBuffer} buf */
function bufferToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** @param {string} hex */
function hexToBuffer(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out.buffer
}

/**
 * @param {Request} request
 * @param {Record<string, string>} env
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allow = String(env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  let value = '*'
  if (allow.includes('*')) value = origin || '*'
  else if (origin && allow.includes(origin)) value = origin
  else if (allow[0] && allow[0] !== '*') value = allow[0]

  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

/**
 * @param {unknown} data
 * @param {number} status
 * @param {Record<string, string>} [cors]
 */
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors,
    },
  })
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
