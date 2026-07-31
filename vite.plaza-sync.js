/**
 * Vite plugin: Design Plaza maintenance-table sync API (dev server only).
 *
 * POST /api/plaza/publish   — upsert UGC + rewrite xlsx/json + save preview
 * POST /api/plaza/unpublish — mark unpublished + rewrite
 * POST /api/plaza/use-count — update use_count + rewrite
 */
import {
  unpublishUgcDesign,
  incrementUgcUseCount,
  upsertUgcFromPublish,
} from './scripts/lib/plaza-table.mjs'

/**
 * @returns {import('vite').Plugin}
 */
export function plazaSyncPlugin() {
  return {
    name: 'pearl-plaza-sync',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (!url.startsWith('/api/plaza/')) return next()
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' })
          return
        }

        try {
          const body = await readJsonBody(req)

          if (url === '/api/plaza/publish') {
            if (!body?.id || !body?.title) {
              sendJson(res, 400, { ok: false, error: 'Missing id/title' })
              return
            }
            const { row } = upsertUgcFromPublish(body)
            sendJson(res, 200, { ok: true, row })
            return
          }

          if (url === '/api/plaza/unpublish') {
            const id = body?.id
            if (!id) {
              sendJson(res, 400, { ok: false, error: 'Missing id' })
              return
            }
            const result = unpublishUgcDesign(String(id))
            sendJson(res, 200, { ok: result.ok })
            return
          }

          if (url === '/api/plaza/use-count') {
            const id = body?.id
            if (!id) {
              sendJson(res, 400, { ok: false, error: 'Missing id' })
              return
            }
            const result = incrementUgcUseCount(String(id), body || {})
            sendJson(res, 200, { ok: result.ok, useCount: result.useCount })
            return
          }

          sendJson(res, 404, { ok: false, error: 'Unknown plaza API' })
        } catch (err) {
          console.error('[plaza-sync]', err)
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Sync failed',
          })
        }
      })
    },
  }
}

/** @param {import('http').IncomingMessage} req */
async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}
