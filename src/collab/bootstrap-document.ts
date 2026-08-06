import { parseDocument, type CollabDocument } from './document'
import { PACKAGE_MANIFEST_FILENAME, type WebxdcPackageManifest } from './package-manifest'

export const BOOTSTRAP_DOCUMENT_FILENAME = 'document-bootstrap.json'

export async function hasBootstrapDocumentInPackage(): Promise<boolean> {
  try {
    // Always present in public/ (empty files[]) so we never 404 in dev or lean builds.
    const response = await fetch(
      new URL(`./${PACKAGE_MANIFEST_FILENAME}`, window.location.href).href,
    )
    if (!response.ok) return false
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/html')) return false

    const manifest = (await response.json()) as WebxdcPackageManifest
    return (
      Array.isArray(manifest.files)
      && manifest.files.includes(BOOTSTRAP_DOCUMENT_FILENAME)
    )
  } catch {
    return false
  }
}

export async function fetchBootstrapDocument(): Promise<CollabDocument | null> {
  try {
    // Only fetch the seed doc when the package manifest lists it (export path).
    const packaged = await hasBootstrapDocumentInPackage()
    if (!packaged) {
      return null
    }

    const response = await fetch(
      new URL(`./${BOOTSTRAP_DOCUMENT_FILENAME}`, window.location.href).href,
    )
    if (!response.ok) {
      return null
    }

    const text = (await response.text()).trim()
    // Missing bootstrap in dev often returns HTML (index) or empty body — not a doc.
    if (!text || text.startsWith('<') || text.startsWith('<!')) {
      return null
    }
    // Only parse JSON-looking payloads so corrupt/HTML does not spam parseDocument.
    if (text[0] !== '{' && text[0] !== '[') {
      return null
    }

    return parseDocument(text)
  } catch {
    return null
  }
}