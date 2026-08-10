import { serializeDocument, type CollabDocument } from './document'
import { buildWebxdcPackageBlob, canPackWebxdcPackage } from './pack-webxdc'

const DOCUMENT_FILE_EXTENSION = '.collab-doc.json'

const sanitizeFilename = (name: string) =>
  name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'

export type ShareToChatResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'unavailable' | 'not-packaged' | 'pack-failed' }

function hasDocumentContent(doc: CollabDocument): boolean {
  return Object.values(doc.pages).some((page) =>
    page.blocks.some((block) => {
      if (block.type === 'divider') return true
      if (block.type === 'image') {
        const props = block.props as Record<string, unknown>
        return !!(props.src || props.url)
      }
      if (block.type === 'page') {
        const props = block.props as Record<string, unknown>
        return !!(props.pageId || props.title)
      }
      if (block.type === 'code') {
        return (block.props.code ?? '').trim().length > 0
      }
      if (block.type === 'table') {
        return true
      }
      return block.content.some((span) => (span.text ?? '').trim().length > 0)
    }),
  )
}

export function buildDocumentFilename(title?: string) {
  const safeTitle = sanitizeFilename(title?.trim() || 'document')
  return `${safeTitle}${DOCUMENT_FILE_EXTENSION}`
}

export async function shareWebxdcWithDocumentToChat(
  doc: CollabDocument,
  title?: string,
): Promise<ShareToChatResult> {
  if (!hasDocumentContent(doc)) {
    return { ok: false, reason: 'empty' }
  }

  const webxdc = window.webxdc
  if (!webxdc?.sendToChat) {
    return { ok: false, reason: 'unavailable' }
  }

  if (!(await canPackWebxdcPackage())) {
    return { ok: false, reason: 'not-packaged' }
  }

  const safeTitle = sanitizeFilename(title?.trim() || 'document')
  const xdcName = `${safeTitle}.xdc`

  try {
    const blob = await buildWebxdcPackageBlob(
      serializeDocument(doc),
      xdcName,
    )

    await webxdc.sendToChat({
      file: { name: xdcName, blob },
      text: 'XEditor document — open the attachment to start editing this page.',
    })

    return { ok: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg === 'pack-dev-index' || msg === 'pack-not-production') {
      return { ok: false, reason: 'not-packaged' }
    }
    return { ok: false, reason: 'pack-failed' }
  }
}

export async function shareDocumentFileToChat(
  doc: CollabDocument,
  title?: string,
): Promise<ShareToChatResult> {
  if (!hasDocumentContent(doc)) {
    return { ok: false, reason: 'empty' }
  }

  const webxdc = window.webxdc
  if (!webxdc?.sendToChat) {
    return { ok: false, reason: 'unavailable' }
  }

  const filename = buildDocumentFilename(title)
  const plainText = serializeDocument(doc)

  await webxdc.sendToChat({
    file: { name: filename, plainText },
    text: 'XEditor document — attach this app in the same chat, then import the document file.',
  })

  return { ok: true }
}