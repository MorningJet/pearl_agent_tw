/**
 * Quick regression check for bracelet drag reorder math.
 * Run: node scripts/test-gap-insert.mjs
 */

function normalizeAngle(a) {
  let x = a
  while (x <= -Math.PI) x += Math.PI * 2
  while (x > Math.PI) x -= Math.PI * 2
  return x
}

function clampIndex(i, max) {
  if (max < 0) return 0
  return Math.max(0, Math.min(i, max))
}

function trackMmOf(p) {
  return p.diameterMm ?? 8
}

function layoutBeads(resolved, geo) {
  const { pathRadius, mmToPx } = geo
  const halves = resolved.map((b) => {
    const t = trackMmOf(b.product)
    return { left: t / 2, right: t / 2 }
  })
  const totalMm = halves.reduce((sum, h) => sum + h.left + h.right, 0)
  const scale = (Math.PI * 2) / ((totalMm * mmToPx) / pathRadius)
  let angle = -Math.PI / 2
  const out = []
  for (let i = 0; i < resolved.length; i++) {
    const halfLeft = ((halves[i].left * mmToPx) / pathRadius) * scale
    angle += halfLeft
    const halfRight = ((halves[i].right * mmToPx) / pathRadius) * scale
    out.push({
      instanceId: resolved[i].instanceId,
      name: resolved[i].name,
      angle,
      halfLeftRad: halfLeft,
      halfRightRad: halfRight,
    })
    angle += halfRight
  }
  return out
}

function shortArcMid(start, end) {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
  return start + delta / 2
}
function shortAngleDist(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function gapInsertIndex(layout, angle, dragIndex) {
  const n = layout.length
  if (n <= 1) return 0
  const others = []
  for (let i = 0; i < n; i++) {
    if (i === dragIndex) continue
    others.push({ bead: layout[i], index: i })
  }
  if (others.length === 1) {
    const delta = normalizeAngle(angle - others[0].bead.angle)
    return delta < 0 ? others[0].index : others[0].index + 1
  }
  let bestInsertBefore = others[0].index
  let bestDist = Infinity
  for (let i = 0; i < others.length; i++) {
    const left = others[i].bead
    const right = others[(i + 1) % others.length].bead
    const insertBefore = others[(i + 1) % others.length].index
    const gapStart = left.angle + left.halfRightRad
    const gapEnd = right.angle - right.halfLeftRad
    const mid = shortArcMid(gapStart, gapEnd)
    const d = shortAngleDist(angle, mid)
    if (d < bestDist) {
      bestDist = d
      bestInsertBefore = insertBefore
    }
  }
  return clampIndex(bestInsertBefore, n)
}

function reorderInsertIndex(fromIndex, insertBefore) {
  if (fromIndex === insertBefore) return fromIndex
  if (fromIndex < insertBefore) return insertBefore - 1
  return insertBefore
}

function reorderBead(arr, from, insertBefore) {
  const to = reorderInsertIndex(from, insertBefore)
  if (from === to) return [...arr]
  const copy = [...arr]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function gapMid(layout, a, b) {
  const left = layout[a]
  const right = layout[b]
  const gapStart = left.angle + left.halfRightRad
  const gapEnd = right.angle - right.halfLeftRad
  return shortArcMid(gapStart, gapEnd)
}

const bead = (mm) => ({ diameterMm: mm, highMm: mm })
const ring = { diameterMm: 2, highMm: 6 }

const resolved = [
  { instanceId: '0', name: 'B10', product: bead(10) },
  { instanceId: '1', name: 'ring', product: ring },
  { instanceId: '2', name: 'B8', product: bead(8) },
  { instanceId: '3', name: 'ring2', product: ring },
  { instanceId: '4', name: 'B10b', product: bead(10) },
]
const layout = layoutBeads(resolved, { pathRadius: 100, mmToPx: 2.2 })
const names = resolved.map((r) => r.name)

const cases = [
  { from: 1, gap: [2, 3], want: ['B10', 'B8', 'ring', 'ring2', 'B10b'] },
  { from: 1, gap: [0, 2], want: names },
  { from: 3, gap: [1, 2], want: ['B10', 'ring', 'ring2', 'B8', 'B10b'] },
  { from: 0, gap: [3, 4], want: ['ring', 'B8', 'ring2', 'B10', 'B10b'] },
  // Wrap gap between last and first bead — must not jump to opposite side.
  { from: 1, gap: [4, 0], want: ['ring', 'B10', 'B8', 'ring2', 'B10b'] },
]

let pass = 0
for (const t of cases) {
  const [a, b] = t.gap
  const angle = gapMid(layout, a, b)
  const insertBefore = gapInsertIndex(layout, angle, t.from)
  const got = reorderBead(names, t.from, insertBefore)
  const ok = JSON.stringify(got) === JSON.stringify(t.want)
  console.log(ok ? 'PASS' : 'FAIL', `from=${t.from} gap=${a}-${b}`, 'insertBefore=', insertBefore, got)
  if (ok) pass++
}

console.log(`${pass}/${cases.length} passed`)
process.exit(pass === cases.length ? 0 : 1)
