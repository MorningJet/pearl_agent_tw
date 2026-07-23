/**
 * Design Plaza maintenance table helpers (xlsx + runtime JSON + UGC mirror).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const PLAZA_COLUMNS = [
  'id',
  'title',
  'designer_name',
  'designer_id',
  'blurb',
  'use_price_twd',
  'use_count',
  'status',
  'source',
  'source_design_id',
  'image_path',
  'bead_product_ids',
  'published_at',
  'updated_at',
  'likes',
  'sort_weight',
  'is_official',
  'notes',
]

export const FIELD_DOCS = [
  { field: 'id', type: 'string', required: 'Y', description: '廣場設計唯一 ID（seed 用 u-*；用戶發佈用 pub-*）' },
  { field: 'title', type: 'string', required: 'Y', description: '設計名稱（詳情頁標題 / 卡片標題）' },
  { field: 'designer_name', type: 'string', required: 'Y', description: '發佈暱稱（詳情頁主名稱，可不與帳號名一致）' },
  { field: 'designer_id', type: 'string', required: 'Y', description: '設計師 ID＝會員編號（與「我的」會員編號一致；詳情頁顯示 ID xxxxxx）' },
  { field: 'blurb', type: 'string', required: 'N', description: '設計簡介（選填；用戶發佈上限 10 字；卡片副標）' },
  { field: 'use_price_twd', type: 'number', required: 'Y', description: '使用價格（TWD/次）；0=免費' },
  { field: 'use_count', type: 'number', required: 'Y', description: '已使用次數（廣場卡片「N 次使用」）' },
  { field: 'status', type: 'enum', required: 'Y', description: 'published | unpublished | draft' },
  { field: 'source', type: 'enum', required: 'Y', description: 'seed=官方示範 | user=用戶發佈' },
  { field: 'source_design_id', type: 'string', required: 'N', description: '對應「我的設計」savedDesign.id；seed 可空' },
  { field: 'image_path', type: 'string', required: 'Y', description: '預覽圖路徑（如 /plaza/xxx.png）' },
  { field: 'bead_product_ids', type: 'string', required: 'N', description: '珠串配方：productId 按串序以 | 分隔' },
  { field: 'published_at', type: 'datetime', required: 'Y', description: '首次發佈時間（ISO 8601）' },
  { field: 'updated_at', type: 'datetime', required: 'Y', description: '最後更新 / 再發佈時間（ISO 8601）' },
  { field: 'likes', type: 'number', required: 'N', description: '按讚數（預留）' },
  { field: 'sort_weight', type: 'number', required: 'N', description: '排序權重，越大越靠前（seed 用）' },
  { field: 'is_official', type: '0|1', required: 'Y', description: '1=官方示範；0=用戶 UGC' },
  { field: 'notes', type: 'string', required: 'N', description: '營運備註' },
]

export const paths = {
  root,
  xlsx: path.join(root, 'data', 'plaza_designs.xlsx'),
  ugc: path.join(root, 'data', 'plaza_ugc.json'),
  runtimeJson: path.join(root, 'src', 'shared', 'data', 'plazaDesigns.json'),
  plazaPublic: path.join(root, 'public', 'plaza'),
}

/** @param {string} dir */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/** @returns {Record<string, unknown>[]} */
export function readMasterDesigns() {
  if (!fs.existsSync(paths.xlsx)) return []
  const wb = XLSX.readFile(paths.xlsx)
  const sheet =
    wb.Sheets.plaza_designs ||
    wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeRow)
}

/** @returns {Record<string, unknown>[]} */
export function readUgcDesigns() {
  if (!fs.existsSync(paths.ugc)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(paths.ugc, 'utf8'))
    const list = Array.isArray(raw?.designs) ? raw.designs : Array.isArray(raw) ? raw : []
    return list.map(normalizeRow)
  } catch {
    return []
  }
}

/** @param {Record<string, unknown>[]} designs */
export function writeUgcDesigns(designs) {
  ensureDir(path.dirname(paths.ugc))
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    description:
      'User-published Design Plaza rows (source=user). Merged into plaza_designs.xlsx by sync:plaza / Vite API.',
    designs: designs.map(normalizeRow),
  }
  fs.writeFileSync(paths.ugc, JSON.stringify(payload, null, 2) + '\n')
}

/**
 * Keep seed/official rows from master; replace all user rows with UGC mirror.
 * @returns {Record<string, unknown>[]}
 */
export function mergeMasterAndUgc() {
  const master = readMasterDesigns()
  const seeds = master.filter((d) => String(d.source) !== 'user')
  const ugc = readUgcDesigns()
  const byId = new Map()
  for (const row of seeds) byId.set(String(row.id), row)
  for (const row of ugc) byId.set(String(row.id), { ...row, source: 'user', is_official: 0 })
  return [...byId.values()].sort((a, b) => {
    const ao = Number(a.is_official) ? 1 : 0
    const bo = Number(b.is_official) ? 1 : 0
    if (ao !== bo) return bo - ao
    return Number(b.sort_weight || 0) - Number(a.sort_weight || 0)
  })
}

/** @param {Record<string, unknown>[]} designs */
export function writeMasterWorkbook(designs) {
  ensureDir(path.dirname(paths.xlsx))
  const rows = designs.map(normalizeRow)
  const wb = XLSX.utils.book_new()
  const wsDesigns = XLSX.utils.json_to_sheet(rows, { header: PLAZA_COLUMNS })
  wsDesigns['!cols'] = PLAZA_COLUMNS.map((k) => ({
    wch: Math.min(28, Math.max(12, k.length + 2)),
  }))
  XLSX.utils.book_append_sheet(wb, wsDesigns, 'plaza_designs')
  const wsFields = XLSX.utils.json_to_sheet(FIELD_DOCS)
  wsFields['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 64 }]
  XLSX.utils.book_append_sheet(wb, wsFields, 'fields')
  XLSX.writeFile(wb, paths.xlsx)
}

/** @param {Record<string, unknown>[]} designs */
export function writeRuntimeJson(designs) {
  ensureDir(path.dirname(paths.runtimeJson))
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    description:
      'Design Plaza master mirror (seed + user). designer_id = 會員編號. User rows also in data/plaza_ugc.json.',
    fields: FIELD_DOCS,
    designs: designs.map(normalizeRow),
  }
  fs.writeFileSync(paths.runtimeJson, JSON.stringify(payload, null, 2) + '\n')
}

/** Rebuild xlsx + runtime JSON from seeds(master) + plaza_ugc.json */
export function rebuildPlazaTable() {
  const designs = mergeMasterAndUgc()
  writeMasterWorkbook(designs)
  writeRuntimeJson(designs)
  return designs
}

/**
 * @param {object} pub Client publish snapshot
 * @param {{ imagePath?: string, status?: string }} [opts]
 */
export function publishedToTableRow(pub, opts = {}) {
  const author = String(pub.author || '').replace(/^@/, '')
  const beads = Array.isArray(pub.beads) ? pub.beads : []
  const publishedAt = pub.publishedAt
    ? new Date(pub.publishedAt).toISOString()
    : new Date().toISOString()
  const imagePath =
    opts.imagePath ||
    (typeof pub.imageDataUrl === 'string' && pub.imageDataUrl.startsWith('/')
      ? pub.imageDataUrl
      : '')
  return normalizeRow({
    id: pub.id,
    title: pub.title || '',
    designer_name: author || 'designer',
    designer_id: String(pub.designerId || ''),
    blurb: pub.tags || '',
    use_price_twd: Number(pub.usePriceTwd) || 0,
    use_count: Number(pub.useCount) || 0,
    status: opts.status || 'published',
    source: 'user',
    source_design_id: pub.sourceDesignId || '',
    image_path: imagePath,
    bead_product_ids: beads.map((b) => b.productId).filter(Boolean).join('|'),
    published_at: publishedAt,
    updated_at: new Date().toISOString(),
    likes: 0,
    sort_weight: 0,
    is_official: 0,
    notes: '',
  })
}

/**
 * Persist data-URL preview under public/plaza/.
 * @param {string} id
 * @param {string} [dataUrl]
 * @returns {string | null} public path like /plaza/xxx.png
 */
export function savePlazaPreviewImage(id, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  if (dataUrl.startsWith('/plaza/')) return dataUrl
  const m = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = mime.includes('png')
    ? 'png'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : 'png'
  ensureDir(paths.plazaPublic)
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_')
  const file = `${safe}.${ext}`
  fs.writeFileSync(path.join(paths.plazaPublic, file), Buffer.from(m[2], 'base64'))
  return `/plaza/${file}`
}

/**
 * Upsert one user design into UGC mirror and rebuild master table.
 * @param {object} pub
 */
export function upsertUgcFromPublish(pub) {
  const imagePath = savePlazaPreviewImage(pub.id, pub.imageDataUrl) || ''
  const row = publishedToTableRow(pub, { imagePath, status: 'published' })
  const list = readUgcDesigns().slice()
  const i = list.findIndex((d) => String(d.id) === String(row.id))
  if (i >= 0) {
    const prev = list[i]
    list[i] = {
      ...row,
      published_at: prev.published_at || row.published_at,
      use_count: Number(pub.useCount ?? prev.use_count) || 0,
      likes: Number(prev.likes) || 0,
    }
  } else {
    list.unshift(row)
  }
  writeUgcDesigns(list)
  const designs = rebuildPlazaTable()
  return { row: list.find((d) => String(d.id) === String(row.id)), designs }
}

/**
 * Mark user design unpublished (keep history) and rebuild.
 * @param {string} id
 */
export function unpublishUgcDesign(id) {
  const list = readUgcDesigns().slice()
  const i = list.findIndex((d) => String(d.id) === String(id))
  if (i >= 0) {
    list[i] = {
      ...list[i],
      status: 'unpublished',
      updated_at: new Date().toISOString(),
    }
    writeUgcDesigns(list)
    return { ok: true, designs: rebuildPlazaTable() }
  }

  const master = readMasterDesigns()
  const existing = master.find(
    (d) => String(d.id) === String(id) && String(d.source) === 'user',
  )
  if (existing) {
    list.push(
      normalizeRow({
        ...existing,
        status: 'unpublished',
        updated_at: new Date().toISOString(),
      }),
    )
    writeUgcDesigns(list)
    return { ok: true, designs: rebuildPlazaTable() }
  }

  return { ok: false, designs: rebuildPlazaTable() }
}

/**
 * @param {string} id
 * @param {number} useCount
 */
export function updateUgcUseCount(id, useCount) {
  const list = readUgcDesigns().slice()
  const i = list.findIndex((d) => String(d.id) === String(id))
  if (i < 0) return { ok: false, designs: mergeMasterAndUgc() }
  list[i] = {
    ...list[i],
    use_count: Number(useCount) || 0,
    updated_at: new Date().toISOString(),
  }
  writeUgcDesigns(list)
  return { ok: true, designs: rebuildPlazaTable() }
}

/** @param {Record<string, unknown>} row */
function normalizeRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of PLAZA_COLUMNS) {
    const v = row[key]
    if (key === 'use_price_twd' || key === 'use_count' || key === 'likes' || key === 'sort_weight') {
      out[key] = Number(v) || 0
    } else if (key === 'is_official') {
      out[key] = Number(v) ? 1 : 0
    } else {
      out[key] = v == null ? '' : v
    }
  }
  return out
}
