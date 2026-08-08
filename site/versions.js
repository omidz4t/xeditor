/**
 * Minimal versions table from versions.json (all releases).
 * Falls back to server-rendered markup in #versions-root.
 */
;(() => {
  const root = document.getElementById('versions-root')
  if (!root) return

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function rowHtml(v, latest) {
    const isLatest = v.version === latest
    const ver = escapeHtml(v.version)
    const app = escapeHtml(v.assets?.app || '#')
    const full = escapeHtml(v.assets?.full || '#')
    const lite = escapeHtml(v.assets?.lite || '#')
    const notes = escapeHtml(v.releaseUrl || '#')
    const latestMark = isLatest ? ' <span class="ver-latest">latest</span>' : ''
    return `<tr class="ver-row${isLatest ? ' ver-row--latest' : ''}" data-version="${ver}">
  <th scope="row" class="ver-row__tag">v${ver}${latestMark}</th>
  <td><a href="${app}">app.xdc</a></td>
  <td><a href="${full}">full</a></td>
  <td><a href="${lite}">lite</a></td>
  <td class="ver-row__notes"><a href="${notes}" target="_blank" rel="noopener">notes</a></td>
</tr>`
  }

  function render(versions, latest) {
    if (!versions.length) {
      root.innerHTML = `<p class="versions-empty">No published versions yet.</p>`
      return
    }
    root.innerHTML = `<div class="ver-table-wrap">
<table class="ver-table">
  <thead>
    <tr>
      <th scope="col">Version</th>
      <th scope="col">app.xdc</th>
      <th scope="col">full</th>
      <th scope="col">lite</th>
      <th scope="col"></th>
    </tr>
  </thead>
  <tbody>
${versions.map((v) => rowHtml(v, latest)).join('\n')}
  </tbody>
</table>
</div>`
  }

  ;(async () => {
    try {
      const res = await fetch('./versions.json', { cache: 'no-cache' })
      if (!res.ok) throw new Error('no json')
      const data = await res.json()
      const versions = Array.isArray(data.versions) ? data.versions : []
      const latest = data.latest?.version || versions[0]?.version
      render(versions, latest)
    } catch {
      // keep SSR table
    }
  })()
})()
