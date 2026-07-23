#!/usr/bin/env node
/**
 * Rebuild Design Plaza maintenance table:
 *   - Keep source≠user rows from data/plaza_designs.xlsx (official seeds)
 *   - Overlay data/plaza_ugc.json (user publishes)
 *   - Write data/plaza_designs.xlsx + src/shared/data/plazaDesigns.json
 *
 * Usage: npm run sync:plaza
 */
import { mergeMasterAndUgc, rebuildPlazaTable, paths } from './lib/plaza-table.mjs'

const designs = rebuildPlazaTable()
const seeds = designs.filter((d) => String(d.source) !== 'user').length
const users = designs.filter((d) => String(d.source) === 'user').length
const published = designs.filter((d) => String(d.status) === 'published').length

console.log(`plaza sync ok`)
console.log(`  master: ${paths.xlsx}`)
console.log(`  ugc:    ${paths.ugc}`)
console.log(`  json:   ${paths.runtimeJson}`)
console.log(`  rows:   ${designs.length} (seed ${seeds}, user ${users}, published ${published})`)

// Touch merge for clarity when ugc empty
if (!mergeMasterAndUgc().length) {
  console.warn('  warning: no designs in master table')
}
