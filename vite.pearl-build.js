/**
 * Stamp each Pages build so the Shopify iframe can detect stale HTML
 * and reload once with a cache-busting query (?v=<build>).
 */
export function pearlBuildIdPlugin() {
  const buildId = (
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    `t${Date.now().toString(36)}`
  ).slice(0, 12)

  return {
    name: 'pearl-build-id',
    config() {
      return {
        define: {
          __PEARL_BUILD__: JSON.stringify(buildId),
        },
      }
    },
    transformIndexHtml(html) {
      return html.replaceAll('%PEARL_BUILD%', buildId)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(
          {
            build: buildId,
            at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      })
    },
  }
}
