<script lang="ts">
import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up'
import ChevronLeft from '@lucide/svelte/icons/chevron-left'
import ChevronRight from '@lucide/svelte/icons/chevron-right'
import Info from '@lucide/svelte/icons/info'
import Keyboard from '@lucide/svelte/icons/keyboard'
import LayoutTemplate from '@lucide/svelte/icons/layout-template'
import Palette from '@lucide/svelte/icons/palette'
import RefreshCw from '@lucide/svelte/icons/refresh-cw'
import Users from '@lucide/svelte/icons/users'
import X from '@lucide/svelte/icons/x'
import { useJoinNotifications } from '../composables/useJoinNotifications'
import { useTheme } from '../composables/useTheme'
import { useVimMode } from '../composables/useVimMode'
import type { ThemeMode } from '../theme'
import { hoverTooltip } from '@xproeditor/svelte'
import type { CollabDocument, PageMeta } from '../collab/document'
import type { PeerPresence } from '../collab/presence'
import {
  copyCurrentPageHtml,
  copyCurrentPageMarkdown,
  copyCurrentPagePlainText,
  exportCurrentPageHtml,
  exportCurrentPageMarkdown,
  exportCurrentPagePlainText,
  exportWorkspaceJson,
  exportWorkspaceMarkdown,
  exportWorkspaceMarkdownZip,
  exportWorkspaceWebxdc,
  type ExportResult,
} from '../collab/export-document'
import type { ImportResult } from '../collab/import-document'
import {
  shareDocumentFileToChat,
  shareWebxdcWithDocumentToChat,
} from '../collab/share-to-chat'
import {
  collabModeDescription,
  isBrowserWebxdcMock,
  type CollabSyncMode,
} from '../collab/sync-mode'

import type { PageLayoutMode, SettingsTabId } from './settingsTypes'
export type { PageLayoutMode, SettingsTabId } from './settingsTypes'
import { computePhoneUi, watchPhoneUi } from '../lib/phoneUi'
import { portal } from '../lib/portal'

type ImportKind =
  | 'md-pages'
  | 'md-folder'
  | 'md-replace'
  | 'html-replace'
  | 'txt-replace'
  | 'json-workspace'
  | 'md-zip'


let {
  open = $bindable(false),
  peers = [] as PeerPresence[],
  pages = [] as PageMeta[],
  currentPageId = undefined as string | undefined,
  pageTitle = undefined as string | undefined,
  pageLayout = 'container' as PageLayoutMode,
  syncMode = null as CollabSyncMode | null,
  getDocument,
  onBeforeExport,
  initialTab = null as SettingsTabId | null,
  importMarkdownAsPages,
  importMarkdownFolder,
  importReplaceMarkdown,
  importReplaceHtml,
  importReplaceText,
  importWorkspaceJson,
  importMarkdownZip,
  boundFolderName = null,
  folderAutosave = false,
  canBindFolder = false,
  onbindFolder,
  onunbindFolder,
  onfolderAutosaveChange,
  onsaveBoundFolder,
  onpageLayoutChange,
  onsyncModeChange,
}: {
  open?: boolean
  peers?: PeerPresence[]
  pages?: PageMeta[]
  currentPageId?: string
  pageTitle?: string
  pageLayout?: PageLayoutMode
  syncMode?: CollabSyncMode | null
  getDocument?: () => CollabDocument
  onBeforeExport?: () => void
  initialTab?: SettingsTabId | null
  importMarkdownAsPages?: (files: File[]) => Promise<ImportResult>
  importMarkdownFolder?: (files: File[]) => Promise<ImportResult>
  importReplaceMarkdown?: (file: File) => Promise<ImportResult>
  importReplaceHtml?: (file: File) => Promise<ImportResult>
  importReplaceText?: (file: File) => Promise<ImportResult>
  importWorkspaceJson?: (file: File) => Promise<ImportResult>
  importMarkdownZip?: (file: File) => Promise<ImportResult>
  boundFolderName?: string | null
  folderAutosave?: boolean
  canBindFolder?: boolean
  onbindFolder?: () => void | Promise<ImportResult | void>
  onunbindFolder?: () => void
  onfolderAutosaveChange?: (enabled: boolean) => void
  onsaveBoundFolder?: () => void | Promise<void>
  onpageLayoutChange?: (mode: PageLayoutMode) => void
  onsyncModeChange?: (mode: CollabSyncMode) => void
} = $props()


const themeApi = useTheme()
const vimApi = useVimMode()
const joinApi = useJoinNotifications()
let theme = $state<ThemeMode>('system')
let vimEnabled = $state(false)
let joinNotificationsEnabled = $state(false)
$effect(() => {
  const u1 = themeApi.theme.subscribe((v) => { theme = v })
  const u2 = vimApi.vimEnabled.subscribe((v) => { vimEnabled = v })
  const u3 = joinApi.joinNotificationsEnabled.subscribe((v) => { joinNotificationsEnabled = v })
  return () => { u1(); u2(); u3() }
})
const updateTheme = themeApi.updateTheme
const setVimEnabled = vimApi.setVimEnabled
const setJoinNotificationsEnabled = joinApi.setJoinNotificationsEnabled
const selfName = window.webxdc?.selfName ?? '—'

let activeTab = $state<SettingsTabId>('appearance')
let transferBusy = $state(false)
let transferStatus = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
let importInput = $state<HTMLInputElement | null>(null)
let pendingImportKind = $state<ImportKind | null>(null)

/**
 * Snapshot peers/pages while the dialog is open so high-frequency collab
 * presence updates (cursors/peers) do not re-render the heavy Import/Export
 * list and jank scroll. Refresh only when viewing the People tab.
 */
let displayPeers = $state<PeerPresence[]>([])
let displayPages = $state<PageMeta[]>([])
let displayPageTitle = $state('')
let displayCurrentPageId = $state<string | undefined>(undefined)

function syncLivePeopleProps() {
  displayPeers = peers
  displayPages = pages ?? []
}

function snapshotDialogProps() {
  displayPeers = peers
  displayPages = pages ?? []
  displayPageTitle = pageTitle?.trim() || 'Untitled'
  displayCurrentPageId = currentPageId
}

function pageTitleFor(pageId?: string) {
  if (!pageId) return 'Unknown page'
  const page = displayPages.find((entry) => entry.id === pageId)
  return page?.title || 'Untitled'
}

const tabs: { id: SettingsTabId; label: string; icon: typeof Palette; tip: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, tip: 'Theme — light, dark, or match the device' },
  { id: 'layout', label: 'Layout', icon: LayoutTemplate, tip: 'Page width — container or full width' },
  { id: 'editor', label: 'Editor', icon: Keyboard, tip: 'Editor behavior such as Vim keybindings' },
  { id: 'sync', label: 'Sync', icon: RefreshCw, tip: 'How changes are shared with collaborators' },
  { id: 'transfer', label: 'Import / Export', icon: ArrowDownUp, tip: 'Import or export documents and pages' },
  { id: 'people', label: 'People', icon: Users, tip: 'Who is currently in this document' },
  { id: 'about', label: 'About', icon: Info, tip: 'App and account information' },
]

const activeTabMeta = $derived.by(() => tabs.find((tab) => tab.id === activeTab) ?? tabs[0])

/** Phone: full-screen stack. `null` = root section list; otherwise open sub-page. */
let mobilePage = $state<SettingsTabId | null>(null)
let isPhone = $state(false)

const showMobileRoot = $derived(isPhone && mobilePage === null)
const showSettingsBody = $derived(!isPhone || mobilePage !== null)

function openMobileSection(id: SettingsTabId) {
  activeTab = id
  mobilePage = id
}

function mobileBack() {
  if (mobilePage !== null) {
    mobilePage = null
    return
  }
  open = false
}

function closeSettings() {
  open = false
  mobilePage = null
}

const themeOptions: { value: ThemeMode; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Match device light or dark mode' },
  { value: 'light', label: 'Light', description: 'Bright background, dark text' },
  { value: 'dark', label: 'Dark', description: 'Dark background, light text' },
]

const layoutOptions: { value: PageLayoutMode; label: string; description: string }[] = [
  { value: 'container', label: 'Container', description: 'Default centered width' },
  { value: 'full', label: 'Full width', description: 'Use the full content area' },
]

const syncModeOptions: { value: CollabSyncMode; label: string }[] = [
  { value: 'realtime', label: 'Realtime' },
  { value: 'chat', label: 'Chat + live' },
  { value: 'local', label: 'Local' },
]

const browserOnly = $derived(isBrowserWebxdcMock())
let deltaNeedOpen = $state(false)

const activeLayout = $derived.by(() => pageLayout ?? 'container')
const activeSyncMode = $derived.by(() => syncMode ?? null)

function setLayout(mode: PageLayoutMode) {
  if (mode === activeLayout) return
  onpageLayoutChange?.(mode)
}

function syncModeAllowed(mode: CollabSyncMode): boolean {
  if (!browserOnly) return true
  return mode === 'local'
}

function setSyncMode(mode: CollabSyncMode) {
  if (!syncModeAllowed(mode)) {
    deltaNeedOpen = true
    return
  }
  if (mode === activeSyncMode) return
  onsyncModeChange?.(mode)
}

function showDeltaNeed() {
  deltaNeedOpen = true
}

function toggleVim() {
  setVimEnabled(!vimEnabled)
}

function toggleJoinNotifications() {
  setJoinNotificationsEnabled(!joinNotificationsEnabled)
}

function toggleFolderAutosave() {
  onfolderAutosaveChange?.(!folderAutosave)
}

async function runBindFolder() {
  if (transferBusy) return
  transferBusy = true
  transferStatus = null
  try {
    const result = await onbindFolder?.()
    if (result && typeof result === 'object' && 'ok' in result) {
      showTransferResult(result)
    }
  } finally {
    transferBusy = false
  }
}

function emptyDocument(): CollabDocument {
  return { version: 2, pages: {} }
}

function resolveExportDoc(): CollabDocument {
  onBeforeExport?.()
  return getDocument?.() ?? emptyDocument()
}

function showTransferResult(result: ExportResult | ImportResult, okMessage?: string) {
  if (result.ok) {
    const text = 'message' in result && result.message ? result.message : (okMessage || 'Done.')
    transferStatus = { kind: 'ok', text }
  } else {
    transferStatus = { kind: 'error', text: result.reason }
  }
}

async function runTransfer(
  action: () => ExportResult | ImportResult | Promise<ExportResult | ImportResult>,
  okMessage?: string,
) {
  if (transferBusy) return
  transferBusy = true
  transferStatus = null
  try {
    const result = await action()
    showTransferResult(result, okMessage)
  } catch {
    transferStatus = { kind: 'error', text: 'Operation failed. Please try again.' }
  } finally {
    transferBusy = false
  }
}

function exportPageMarkdown() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return exportCurrentPageMarkdown(doc, currentPageId)
  }, 'Downloaded page as Markdown.')
}

function exportPagePlain() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return exportCurrentPagePlainText(doc, currentPageId)
  }, 'Downloaded page as plain text.')
}

function exportPageHtml() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return exportCurrentPageHtml(doc, currentPageId)
  }, 'Downloaded page as HTML.')
}

function copyPageMarkdown() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return copyCurrentPageMarkdown(doc, currentPageId)
  }, 'Copied page Markdown to clipboard.')
}

function copyPagePlain() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return copyCurrentPagePlainText(doc, currentPageId)
  }, 'Copied page text to clipboard.')
}

function copyPageHtml() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    if (!currentPageId) return { ok: false, reason: 'No page selected.' }
    return copyCurrentPageHtml(doc, currentPageId)
  }, 'Copied page HTML to clipboard.')
}

function exportAllMarkdown() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    return exportWorkspaceMarkdown(doc, pageTitle)
  }, 'Downloaded all pages as Markdown.')
}

function exportAllMarkdownZip() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    return exportWorkspaceMarkdownZip(doc, pageTitle)
  }, 'Downloaded Markdown ZIP of all pages.')
}

function exportAllJson() {
  void runTransfer(() => {
    const doc = resolveExportDoc()
    return exportWorkspaceJson(doc, pageTitle)
  }, 'Downloaded workspace JSON.')
}

function exportAllWebxdc() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    return exportWorkspaceWebxdc(doc, pageTitle)
  }, 'Downloaded WebXDC package.')
}

function shareAsWebxdc() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    const result = await shareWebxdcWithDocumentToChat(doc, pageTitle)
    if (result.ok) return { ok: true }
    switch (result.reason) {
      case 'empty':
        return { ok: false, reason: 'Add some content before sharing.' }
      case 'unavailable':
        return { ok: false, reason: 'Sharing is only available inside Delta Chat.' }
      case 'not-packaged':
        return {
          ok: false,
          reason: 'Share as WebXDC needs the packaged app (make build), not the bare dev server.',
        }
      case 'pack-failed':
        return { ok: false, reason: 'Could not build a WebXDC package. Rebuild and try again.' }
      default:
        return { ok: false, reason: 'Sharing failed. Please try again.' }
    }
  }, 'Shared WebXDC package to chat.')
}

function shareAsJson() {
  void runTransfer(async () => {
    const doc = resolveExportDoc()
    const result = await shareDocumentFileToChat(doc, pageTitle)
    if (result.ok) return { ok: true }
    switch (result.reason) {
      case 'empty':
        return { ok: false, reason: 'Add some content before sharing.' }
      case 'unavailable':
        return { ok: false, reason: 'Sharing is only available inside Delta Chat.' }
      default:
        return { ok: false, reason: 'Sharing failed. Please try again.' }
    }
  }, 'Shared document JSON to chat.')
}

function acceptForImport(kind: ImportKind): string {
  switch (kind) {
    case 'md-pages':
    case 'md-folder':
    case 'md-replace':
      return '.md,.markdown,.mdown,text/markdown,text/plain'
    case 'html-replace':
      return '.html,.htm,text/html'
    case 'txt-replace':
      return '.txt,.text,text/plain'
    case 'json-workspace':
      return '.json,.collab-doc.json,application/json'
    case 'md-zip':
      return '.zip,application/zip'
  }
}

function multipleForImport(kind: ImportKind): boolean {
  return kind === 'md-pages' || kind === 'md-folder'
}

function configureImportInput(kind: ImportKind) {
  const input = importInput
  if (!input) return
  input.accept = acceptForImport(kind)
  input.multiple = multipleForImport(kind)
  // Folder mode uses webkitdirectory; clear it for regular file picks.
  if (kind === 'md-folder') {
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    try {
      ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
    } catch {
      // ignore
    }
  } else {
    input.removeAttribute('webkitdirectory')
    input.removeAttribute('directory')
    try {
      ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = false
    } catch {
      // ignore
    }
  }
  input.value = ''
}

function openImportPicker(kind: ImportKind) {
  if (transferBusy) return
  pendingImportKind = kind
  configureImportInput(kind)
  importInput?.click()
}

async function onImportInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  const kind = pendingImportKind
  // Reset directory mode so the next file pick is not forced to folders.
  input.removeAttribute('webkitdirectory')
  input.removeAttribute('directory')
  try {
    ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = false
  } catch {
    // ignore
  }
  input.value = ''
  pendingImportKind = null
  if (!kind || files.length === 0) return

  void runTransfer(async () => {
    switch (kind) {
      case 'md-pages': {
        if (!importMarkdownAsPages) {
          return { ok: false, reason: 'Markdown import is unavailable.' }
        }
        return importMarkdownAsPages(files)
      }
      case 'md-folder': {
        if (!importMarkdownFolder) {
          return { ok: false, reason: 'Folder import is unavailable.' }
        }
        return importMarkdownFolder(files)
      }
      case 'md-replace': {
        if (!importReplaceMarkdown) {
          return { ok: false, reason: 'Markdown import is unavailable.' }
        }
        return importReplaceMarkdown(files[0])
      }
      case 'html-replace': {
        if (!importReplaceHtml) {
          return { ok: false, reason: 'HTML import is unavailable.' }
        }
        return importReplaceHtml(files[0])
      }
      case 'txt-replace': {
        if (!importReplaceText) {
          return { ok: false, reason: 'Text import is unavailable.' }
        }
        return importReplaceText(files[0])
      }
      case 'json-workspace': {
        if (!importWorkspaceJson) {
          return { ok: false, reason: 'Workspace import is unavailable.' }
        }
        return importWorkspaceJson(files[0])
      }
      case 'md-zip': {
        if (!importMarkdownZip) {
          return { ok: false, reason: 'ZIP import is unavailable.' }
        }
        return importMarkdownZip(files[0])
      }
    }
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open) return
  event.preventDefault()
  event.stopPropagation()
  // Phone: back out of a sub-page first, then close.
  if (isPhone && mobilePage !== null) {
    mobilePage = null
    return
  }
  closeSettings()
}

$effect(() => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    const tab = initialTab
    const resolved = tab && tabs.some((entry) => entry.id === tab) ? tab : 'appearance'
    activeTab = resolved
    transferStatus = null
    snapshotDialogProps()
    // Phone: open on root list, unless deep-linked via initialTab.
    // Use robust phone detection (iOS WebXDC often fails plain max-width MQ).
    if (computePhoneUi()) {
      isPhone = true
      mobilePage = tab && tabs.some((entry) => entry.id === tab) ? tab : null
    } else {
      isPhone = false
      mobilePage = null
    }
  } else {
    mobilePage = null
  }
})

$effect(() => {
  if (!open || typeof window === 'undefined') return
  isPhone = computePhoneUi()
  return watchPhoneUi((phone) => {
    isPhone = phone
    // Leaving phone mode while open: clear sub-page stack.
    if (!phone) mobilePage = null
  })
})

$effect(() => {
  if (activeTab === 'people' && open) syncLivePeopleProps()
})

$effect(() => {
  void peers
  if (open && activeTab === 'people') syncLivePeopleProps()
})

$effect(() => {
  // Capture so we back out of phone sub-pages before App closes Settings entirely.
  window.addEventListener('keydown', onKeydown, true)
  return () => {
    window.removeEventListener('keydown', onKeydown, true)
    document.body.style.overflow = ''
  }
})
</script>


{#if open}
  <div
    use:portal
    class="settings-root"
    class:settings-root--phone={isPhone}
  >
    <button
      class="settings-backdrop"
      type="button"
      aria-label="Close settings"
      onclick={closeSettings}
    ></button>

    <div
      class="settings-panel"
      class:settings-panel--phone={isPhone}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <!-- Desktop close (top-right) -->
      {#if !isPhone}
        <button
          class="settings-close"
          type="button"
          aria-label="Close"
          title="Close"
          onclick={closeSettings}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}

      <!-- Phone: full-page chrome (root list or sub-page with back) -->
      {#if isPhone}
        <header class="settings-phone-bar">
          {#if mobilePage !== null}
            <button
              type="button"
              class="settings-phone-bar__back"
              aria-label="Back to Settings"
              onclick={mobileBack}
            >
              <ChevronLeft size={22} strokeWidth={2} aria-hidden="true" />
              <span>Settings</span>
            </button>
            <h1 class="settings-phone-bar__title" id="settings-title">{activeTabMeta.label}</h1>
            <span class="settings-phone-bar__spacer" aria-hidden="true"></span>
          {:else}
            <span class="settings-phone-bar__spacer" aria-hidden="true"></span>
            <h1 class="settings-phone-bar__title" id="settings-title">Settings</h1>
            <button
              type="button"
              class="settings-phone-bar__done"
              aria-label="Close settings"
              onclick={closeSettings}
            >
              Done
            </button>
          {/if}
        </header>
      {/if}

      <!-- Desktop sidebar / phone root section list -->
      {#if !isPhone || showMobileRoot}
        <aside
          class="settings-nav"
          class:settings-nav--phone-root={showMobileRoot}
          aria-label="Settings sections"
        >
          {#if !isPhone}
            <p class="settings-nav-title">Settings</p>
          {/if}
          <div
            class="settings-tabs"
            class:settings-tabs--phone-list={showMobileRoot}
            role={isPhone ? 'navigation' : 'tablist'}
            aria-orientation="vertical"
          >
            {#each tabs as tab (tab.id)}
              <button
                type="button"
                class="settings-tab"
                class:settings-tab--phone-row={showMobileRoot}
                class:settings-tab--active={!isPhone && activeTab === tab.id}
                role={isPhone ? 'button' : 'tab'}
                aria-selected={!isPhone ? activeTab === tab.id : undefined}
                id={`settings-tab-${tab.id}`}
                aria-controls={isPhone ? undefined : `settings-panel-${tab.id}`}
                use:hoverTooltip={tab.tip}
                onclick={() => {
                  if (isPhone) openMobileSection(tab.id)
                  else activeTab = tab.id
                }}
              >
                {#if tab.id === 'appearance'}
                  <Palette class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else if tab.id === 'layout'}
                  <LayoutTemplate class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else if tab.id === 'editor'}
                  <Keyboard class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else if tab.id === 'sync'}
                  <RefreshCw class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else if tab.id === 'transfer'}
                  <ArrowDownUp class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else if tab.id === 'people'}
                  <Users class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {:else}
                  <Info class="settings-tab__icon" size={showMobileRoot ? 20 : 16} strokeWidth={2} />
                {/if}
                <span class="settings-tab__label">{tab.label}</span>
                {#if showMobileRoot}
                  <ChevronRight class="settings-tab__chevron" size={18} strokeWidth={2} aria-hidden="true" />
                {/if}
              </button>
            {/each}
          </div>
        </aside>
      {/if}

      {#if showSettingsBody}
      <div
        class="settings-main"
        class:settings-main--phone={isPhone}
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={isPhone ? 'settings-title' : `settings-tab-${activeTab}`}
      >
        {#if !isPhone}
          <header class="settings-main-header">
            <h2 class="settings-main-title">{activeTabMeta.label}</h2>
          </header>
        {/if}

        <div class="settings-main-body">
          {#if activeTab === 'appearance'}
            <section class="settings-section">
              <p class="settings-hint">Choose how the app looks on this device.</p>
              <div
                class="settings-select-cards settings-select-cards--horizontal"
                role="radiogroup"
                aria-label="Theme"
              >
                {#each themeOptions as option (option.value)}
                  <button
                    type="button"
                    class="settings-select-card settings-select-card--tile settings-select-card--theme"
                    role="radio"
                    class:settings-select-card--selected={theme === option.value}
                    aria-checked={theme === option.value}
                    use:hoverTooltip={`${option.label} — ${option.description}`}
                    onclick={() => updateTheme(option.value)}
                  >
                    <span
                      class="settings-select-card__preview settings-select-card__preview--tile theme-card-preview theme-card-preview--{option.value}"
                      aria-hidden="true"
                    >
                      {#if option.value === 'system'}
                        <span class="theme-card-preview__split">
                          <span class="theme-card-preview__half theme-card-preview__half--light">
                            <span class="theme-card-preview__bar"></span>
                            <span class="theme-card-preview__line"></span>
                            <span class="theme-card-preview__line theme-card-preview__line--short"></span>
                          </span>
                          <span class="theme-card-preview__half theme-card-preview__half--dark">
                            <span class="theme-card-preview__bar"></span>
                            <span class="theme-card-preview__line"></span>
                            <span class="theme-card-preview__line theme-card-preview__line--short"></span>
                          </span>
                        </span>
                      {:else}
                        <span class="theme-card-preview__window">
                          <span class="theme-card-preview__bar"></span>
                          <span class="theme-card-preview__line"></span>
                          <span class="theme-card-preview__line theme-card-preview__line--short"></span>
                          <span class="theme-card-preview__line"></span>
                        </span>
                      {/if}
                    </span>
                    <span class="settings-select-card__copy settings-select-card__copy--center">
                      <span class="settings-select-card__title">{option.label}</span>
                      <span class="settings-select-card__desc">{option.description}</span>
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {:else if activeTab === 'layout'}
            <section class="settings-section">
              <p class="settings-hint">Applies to the current page. Default is Container.</p>
              <div
                class="settings-select-cards settings-select-cards--horizontal"
                role="radiogroup"
                aria-label="Page layout"
              >
                {#each layoutOptions as option (option.value)}
                  <button
                    type="button"
                    class="settings-select-card settings-select-card--tile settings-select-card--theme"
                    role="radio"
                    class:settings-select-card--selected={activeLayout === option.value}
                    aria-checked={activeLayout === option.value}
                    use:hoverTooltip={`${option.label} — ${option.description}`}
                    onclick={() => setLayout(option.value)}
                  >
                    <span
                      class="settings-select-card__preview settings-select-card__preview--tile layout-card-preview layout-card-preview--{option.value}"
                      aria-hidden="true"
                    >
                      <span class="layout-card-preview__canvas">
                        <span
                          class={
                            'layout-card-preview__page ' +
                            (option.value === 'full'
                              ? 'layout-card-preview__page--full'
                              : 'layout-card-preview__page--container')
                          }
                        >
                          <span class="layout-card-preview__title"></span>
                          <span class="layout-card-preview__line"></span>
                          <span class="layout-card-preview__line layout-card-preview__line--short"></span>
                          <span class="layout-card-preview__line"></span>
                        </span>
                      </span>
                    </span>
                    <span class="settings-select-card__copy settings-select-card__copy--center">
                      <span class="settings-select-card__title">{option.label}</span>
                      <span class="settings-select-card__desc">{option.description}</span>
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {:else if activeTab === 'editor'}
            <section class="settings-section">
              <p class="settings-hint">
                Vim mode uses normal / insert / visual keybindings on the page body.
                Press Esc for normal mode, <kbd>i</kbd> to insert. Preference is saved on this device.
              </p>
              <button
                type="button"
                class="settings-toggle-row"
                aria-pressed={vimEnabled}
                use:hoverTooltip={'Vim keybindings — Esc for normal mode, i to insert. Saved on this device.'}
                onclick={toggleVim}
              >
                <span class="settings-toggle-copy">
                  <span class="settings-toggle-title">Vim keybindings</span>
                  <span class="settings-toggle-desc">
                    {vimEnabled ? 'Enabled — modal editing' : 'Disabled'}
                  </span>
                </span>
                <span class="settings-switch" class:settings-switch--on={vimEnabled} aria-hidden="true">
                  <span class="settings-switch__knob"></span>
                </span>
              </button>
            </section>
          {:else if activeTab === 'sync'}
            <section class="settings-section">
              <p class="settings-hint">
                {#if browserOnly}
                  Browser demo: only <strong>Local</strong> works here. Hover or click
                  Realtime / Chat + live to learn about Delta Chat.
                {:else}
                  Shared with everyone in this chat (silent update, no notification). You can change it anytime.
                {/if}
              </p>
              <div class="theme-toggle theme-toggle--3" role="group" aria-label="Sync mode">
                {#each syncModeOptions as option (option.value)}
                  {@const allowed = syncModeAllowed(option.value)}
                  <button
                    type="button"
                    class="theme-toggle-btn"
                    class:active={activeSyncMode === option.value}
                    class:theme-toggle-btn--locked={!allowed}
                    aria-pressed={activeSyncMode === option.value}
                    aria-disabled={!allowed}
                    use:hoverTooltip={allowed
                      ? collabModeDescription(option.value)
                      : 'Requires Delta Chat — click for details'}
                    onmouseenter={() => {
                      if (!allowed) showDeltaNeed()
                    }}
                    onclick={() => setSyncMode(option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
              {#if activeSyncMode}
                <p class="settings-hint settings-hint--tight">
                  {collabModeDescription(activeSyncMode)}
                </p>
              {/if}
              <button
                type="button"
                class="settings-toggle-row"
                aria-pressed={joinNotificationsEnabled}
                use:hoverTooltip={'Join notifications — optional chat line when you open the editor'}
                onclick={toggleJoinNotifications}
              >
                <span class="settings-toggle-copy">
                  <span class="settings-toggle-title">Join notifications</span>
                  <span class="settings-toggle-desc">
                    {joinNotificationsEnabled
                      ? 'Post a chat info line when you open the editor'
                      : 'Off — updates sync silently (recommended)'}
                  </span>
                </span>
                <span
                  class="settings-switch"
                  class:settings-switch--on={joinNotificationsEnabled}
                  aria-hidden="true"
                >
                  <span class="settings-switch__knob"></span>
                </span>
              </button>
            </section>
          {:else if activeTab === 'transfer'}

            <section class="settings-section settings-section--export">
              <p class="settings-hint">
                Bind a local folder to save Markdown with Ctrl+S, import files, or export the workspace.
              </p>

              {#if transferStatus}
                <p
                  class={
                    'export-status ' +
                    (transferStatus.kind === 'ok' ? 'export-status--ok' : 'export-status--error')
                  }
                  role="status"
                >
                  {transferStatus.text}
                </p>
              {/if}

              <h3 class="settings-subtitle">Bound folder</h3>
              <div class="export-list">
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy || !canBindFolder}
                  onclick={() => { void runBindFolder() }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">{boundFolderName ? 'Re-bind folder' : 'Bind folder'}</span>
                    <span class="export-row__desc">
                      {#if boundFolderName}
                        Linked to “{boundFolderName}” — Ctrl+S writes .md files back
                      {:else if canBindFolder}
                        Link a local folder (Chrome/Edge) for open + save
                      {:else}
                        Not available in this browser
                      {/if}
                    </span>
                  </span>
                </button>
                {#if boundFolderName}
                  <button
                    type="button"
                    class="export-row"
                    disabled={transferBusy}
                    onclick={() => { void onsaveBoundFolder?.() }}
                  >
                    <span class="export-row__copy">
                      <span class="export-row__title">Save current page to folder</span>
                      <span class="export-row__desc">Same as Ctrl+S — write this page’s Markdown</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="export-row"
                    disabled={transferBusy}
                    onclick={() => onunbindFolder?.()}
                  >
                    <span class="export-row__copy">
                      <span class="export-row__title">Unbind folder</span>
                      <span class="export-row__desc">Stop writing to “{boundFolderName}”</span>
                    </span>
                  </button>
                {/if}
              </div>
              <button
                type="button"
                class="settings-toggle-row"
                aria-pressed={folderAutosave}
                disabled={!boundFolderName}
                use:hoverTooltip={'Autosave bound folder — write Markdown shortly after you edit'}
                onclick={toggleFolderAutosave}
              >
                <span class="settings-toggle-copy">
                  <span class="settings-toggle-title">Autosave to bound folder</span>
                  <span class="settings-toggle-desc">
                    {#if !boundFolderName}
                      Bind a folder first
                    {:else if folderAutosave}
                      On — saves .md after you stop typing
                    {:else}
                      Off — only save with Ctrl+S
                    {/if}
                  </span>
                </span>
                <span
                  class="settings-switch"
                  class:settings-switch--on={folderAutosave && !!boundFolderName}
                  aria-hidden="true"
                >
                  <span class="settings-switch__knob"></span>
                </span>
              </button>

              <h3 class="settings-subtitle">Import</h3>
              <div class="export-list">
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('md-pages') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Markdown as new pages</span>
                    <span class="export-row__desc">One or more .md files under the current page</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy || !canBindFolder}
                  onclick={() => { void runBindFolder() }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Bind Markdown folder</span>
                    <span class="export-row__desc">Open + link a directory (save with Ctrl+S)</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('md-replace') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Replace page with Markdown</span>
                    <span class="export-row__desc">Overwrite this page from a .md file</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('html-replace') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Replace page with HTML</span>
                    <span class="export-row__desc">Overwrite this page from .html</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('txt-replace') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Replace page with text</span>
                    <span class="export-row__desc">Overwrite this page from .txt</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('json-workspace') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Workspace JSON</span>
                    <span class="export-row__desc">Merge a .collab-doc.json tree under this page</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="export-row"
                  disabled={transferBusy}
                  onclick={() => { openImportPicker('md-zip') }}
                >
                  <span class="export-row__copy">
                    <span class="export-row__title">Markdown ZIP</span>
                    <span class="export-row__desc">Import nested pages from an exported .zip</span>
                  </span>
                </button>
              </div>

              <h3 class="settings-subtitle">Export this page</h3>
              <p class="settings-hint settings-hint--tight">
                {displayPageTitle || pageTitleFor(displayCurrentPageId)}
              </p>
              <div class="export-grid">
                <button type="button" class="export-btn" disabled={transferBusy} onclick={exportPageMarkdown}>
                  <span class="export-btn__title">Markdown</span>
                  <span class="export-btn__desc">Download .md</span>
                </button>
                <button type="button" class="export-btn" disabled={transferBusy} onclick={exportPagePlain}>
                  <span class="export-btn__title">Plain text</span>
                  <span class="export-btn__desc">Download .txt</span>
                </button>
                <button type="button" class="export-btn" disabled={transferBusy} onclick={exportPageHtml}>
                  <span class="export-btn__title">HTML</span>
                  <span class="export-btn__desc">Download .html</span>
                </button>
                <button type="button" class="export-btn" disabled={transferBusy} onclick={copyPageMarkdown}>
                  <span class="export-btn__title">Copy Markdown</span>
                  <span class="export-btn__desc">Clipboard</span>
                </button>
                <button type="button" class="export-btn" disabled={transferBusy} onclick={copyPagePlain}>
                  <span class="export-btn__title">Copy text</span>
                  <span class="export-btn__desc">Clipboard</span>
                </button>
                <button type="button" class="export-btn" disabled={transferBusy} onclick={copyPageHtml}>
                  <span class="export-btn__title">Copy HTML</span>
                  <span class="export-btn__desc">Clipboard</span>
                </button>
              </div>

              <h3 class="settings-subtitle">Export all pages</h3>
              <div class="export-list">
                <button type="button" class="export-row" disabled={transferBusy} onclick={exportAllMarkdown}>
                  <span class="export-row__copy">
                    <span class="export-row__title">Combined Markdown</span>
                    <span class="export-row__desc">One .md file with every page</span>
                  </span>
                </button>
                <button type="button" class="export-row" disabled={transferBusy} onclick={exportAllMarkdownZip}>
                  <span class="export-row__copy">
                    <span class="export-row__title">Markdown ZIP</span>
                    <span class="export-row__desc">One .md per page, nested folders</span>
                  </span>
                </button>
                <button type="button" class="export-row" disabled={transferBusy} onclick={exportAllJson}>
                  <span class="export-row__copy">
                    <span class="export-row__title">Workspace JSON</span>
                    <span class="export-row__desc">Full collab document (.collab-doc.json)</span>
                  </span>
                </button>
                <button type="button" class="export-row" disabled={transferBusy} onclick={exportAllWebxdc}>
                  <span class="export-row__copy">
                    <span class="export-row__title">WebXDC package</span>
                    <span class="export-row__desc">Self-contained .xdc with this document</span>
                  </span>
                </button>
              </div>

              <h3 class="settings-subtitle">Share to chat</h3>
              <div class="export-list">
                <button type="button" class="export-row" disabled={transferBusy} onclick={shareAsWebxdc}>
                  <span class="export-row__copy">
                    <span class="export-row__title">Send WebXDC</span>
                    <span class="export-row__desc">Packaged app + document into another chat</span>
                  </span>
                </button>
                <button type="button" class="export-row" disabled={transferBusy} onclick={shareAsJson}>
                  <span class="export-row__copy">
                    <span class="export-row__title">Send JSON file</span>
                    <span class="export-row__desc">Document file for import elsewhere</span>
                  </span>
                </button>
              </div>

              <input
                bind:this={importInput}
                type="file"
                class="settings-file-input"
                onchange={onImportInputChange}
              />
            </section>

            
          {:else if activeTab === 'people'}
            <section class="settings-section">
              <p class="settings-hint">
                Collaborators currently in this document (presence updates live).
              </p>
              {#if !displayPeers.length}
                <p class="settings-empty">No one else is here right now.</p>
              {:else}
                <ul class="settings-peer-list">
                  {#each displayPeers as peer (peer.addr)}
                    <li class="settings-peer">
                      <span class="settings-peer__avatar" style:background={peer.color}>{peer.name.slice(0, 1)}</span>
                      <span class="settings-peer__meta">
                        <span class="settings-peer__name">{peer.name}</span>
                        <span class="settings-peer__page">{pageTitleFor(peer.pageId)}</span>
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          {:else}
            <section class="settings-section">
              <div class="settings-row settings-row--card">
                <span class="settings-label">App</span>
                <span class="settings-value">XEditor</span>
              </div>
              <div class="settings-row settings-row--card">
                <span class="settings-label">Account</span>
                <span class="settings-value">{selfName}</span>
              </div>
            </section>
          {/if}
        </div>
      </div>
      {/if}
    </div>

    {#if deltaNeedOpen}
      <div class="delta-need-root" role="presentation">
        <button
          type="button"
          class="delta-need-backdrop"
          aria-label="Dismiss"
          onclick={() => (deltaNeedOpen = false)}
        ></button>
        <div
          class="delta-need-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-delta-need-title"
        >
          <h3 id="settings-delta-need-title" class="delta-need-title">Install Delta Chat</h3>
          <p class="delta-need-body">
            <strong>Realtime</strong> and <strong>Chat + live</strong> only work inside
            Delta Chat (WebXDC). This browser demo can use <strong>Local only</strong>.
          </p>
          <div class="delta-need-actions">
            <a
              class="delta-need-btn delta-need-btn--primary"
              href="https://delta.chat/"
              target="_blank"
              rel="noopener noreferrer"
            >Get Delta Chat</a>
            <a
              class="delta-need-btn"
              href="https://github.com/omidz4t/xeditor/releases"
              target="_blank"
              rel="noopener noreferrer"
            >Download .xdc</a>
            <button type="button" class="delta-need-btn" onclick={() => (deltaNeedOpen = false)}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}


<style>

.settings-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}

.settings-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--settings-backdrop);
  cursor: default;
}

.settings-panel {
  position: relative;
  display: flex;
  width: min(720px, 100%);
  height: min(520px, 86vh);
  max-height: 86vh;
  overflow: hidden;
  border-radius: 14px;
  background: var(--settings-panel-bg);
  box-shadow: var(--settings-panel-shadow);
  border: 1px solid var(--settings-panel-border);
}

/* Circle close — top right of the whole panel */
.settings-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--settings-control-border);
  border-radius: 50%;
  background: var(--settings-control-bg);
  color: var(--settings-muted);
  cursor: pointer;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.settings-close:hover {
  background: var(--settings-hover);
  color: var(--settings-text);
  border-color: color-mix(in srgb, var(--settings-muted) 40%, var(--settings-control-border));
}

.settings-nav {
  flex: 0 0 168px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 10px 16px 12px;
  border-right: 1px solid var(--settings-divider);
  background: color-mix(in srgb, var(--settings-control-bg) 70%, transparent);
  min-width: 0;
}

.settings-nav-title {
  margin: 0 8px 6px;
  font-size: 13px;
  font-weight: 650;
  color: var(--settings-text);
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--settings-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: start;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.settings-tab__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.settings-tab:hover {
  background: var(--settings-hover);
  color: var(--settings-text);
}

.settings-tab--active {
  background: var(--settings-control-active);
  color: var(--settings-text);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  font-weight: 600;
}

.settings-tab--active .settings-tab__icon {
  opacity: 1;
  color: #2383e2;
}

.settings-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* No right padding here — scroll container must reach the panel edge. */
  padding: 16px 0 0 20px;
  /* Keep settings chrome LTR so the scrollbar stays on the physical right. */
  direction: ltr;
}

.settings-main-header {
  flex-shrink: 0;
  margin-bottom: 4px;
  /* Room for the circle close button (overlaid on the panel). */
  padding-right: 48px;
}

.settings-main-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  color: var(--settings-text);
}

.settings-main-body {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* Content inset; scrollbar itself sits on the far right of this pane. */
  padding: 12px 14px 18px 0;
  scrollbar-gutter: stable;
  /* Isolate scroll layer from parent presence re-renders / paint thrash. */
  contain: layout paint style;
  content-visibility: auto;
  -webkit-overflow-scrolling: touch;
}

.settings-section {
  padding: 0;
  max-width: 420px;
}

.settings-section--export {
  max-width: 100%;
}

/* Selectable option cards (layout, etc.) */
.settings-select-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.settings-select-cards--horizontal {
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
}

.settings-select-card {
  display: grid;
  grid-template-columns: 56px 1fr 18px;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  color: var(--settings-text);
  text-align: start;
  font: inherit;
  cursor: pointer;
}

/* Tile cards: stacked preview + label, side-by-side in a row */
.settings-select-card--tile {
  flex: 1 1 0;
  min-width: 0;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto auto;
  justify-items: center;
  gap: 10px;
  padding: 14px 12px 12px;
  text-align: center;
}

.settings-select-card:hover {
  background: var(--settings-hover);
  border-color: color-mix(in srgb, #2383e2 28%, var(--settings-control-border));
}

.settings-select-card--selected {
  background: color-mix(in srgb, #2383e2 8%, var(--settings-control-bg));
  border-color: color-mix(in srgb, #2383e2 55%, var(--settings-control-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, #2383e2 35%, transparent);
}

.settings-select-card:focus-visible {
  outline: 2px solid #2383e2;
  outline-offset: 2px;
}

.settings-select-card__preview {
  display: grid;
  place-items: center;
  width: 56px;
  height: 40px;
  border-radius: 8px;
  background: var(--settings-panel-bg);
  border: 1px solid var(--settings-control-border);
}

.settings-select-card__preview--tile {
  width: 100%;
  max-width: 120px;
  height: 64px;
  border-radius: 10px;
}

.settings-select-card__preview-frame {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 40px;
  height: 26px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--settings-muted) 45%, var(--settings-control-border));
  background: color-mix(in srgb, var(--settings-muted) 8%, var(--settings-panel-bg));
  box-sizing: border-box;
}

.settings-select-card__preview--tile .settings-select-card__preview-frame {
  height: 40px;
  border-radius: 4px;
}

.settings-select-card__preview-frame--container {
  width: 26px;
}

.settings-select-card__preview--tile .settings-select-card__preview-frame--container {
  width: 42px;
}

.settings-select-card__preview-frame--full {
  width: 40px;
}

.settings-select-card__preview--tile .settings-select-card__preview-frame--full {
  width: 88px;
}

.settings-select-card__preview-col {
  display: block;
  flex: 1;
  margin: 4px 3px;
  border-radius: 2px;
  background: color-mix(in srgb, #2383e2 55%, var(--settings-muted));
  opacity: 0.85;
}

.settings-select-card__preview--tile .settings-select-card__preview-col {
  margin: 6px 5px;
}

.settings-select-card__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-select-card__copy--center {
  align-items: center;
  text-align: center;
  width: 100%;
}

.settings-select-card__title {
  font-size: 14px;
  font-weight: 650;
  color: var(--settings-text);
}

.settings-select-card__desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--settings-muted);
}

.settings-select-card__check {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--settings-muted) 55%, var(--settings-control-border));
  background: transparent;
  box-sizing: border-box;
  position: relative;
}

.settings-select-card__check--tile {
  margin-top: 2px;
}

.settings-select-card__check--on {
  border-color: #2383e2;
  background: #2383e2;
  box-shadow: inset 0 0 0 3px var(--settings-panel-bg);
}

@media (max-width: 560px) {
  .settings-select-cards--horizontal {
    flex-direction: column;
  }

  .settings-select-card--tile {
    grid-template-columns: 72px 1fr 18px;
    grid-template-rows: auto;
    justify-items: stretch;
    align-items: center;
    text-align: start;
    padding: 12px;
    gap: 12px;
  }

  .settings-select-card--theme {
    grid-template-columns: 72px 1fr;
  }

  .settings-select-card__preview--tile {
    width: 72px;
    max-width: none;
    height: 48px;
  }

  .settings-select-card__preview--tile .settings-select-card__preview-frame {
    height: 30px;
  }

  .settings-select-card__preview--tile .settings-select-card__preview-frame--container {
    width: 28px;
  }

  .settings-select-card__preview--tile .settings-select-card__preview-frame--full {
    width: 52px;
  }

  .settings-select-card__copy--center {
    align-items: flex-start;
    text-align: start;
  }

  .settings-select-card__check--tile {
    margin-top: 0;
  }
}

.export-status {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.export-status--ok {
  background: color-mix(in srgb, #2383e2 12%, transparent);
  color: var(--settings-text);
  border: 1px solid color-mix(in srgb, #2383e2 28%, transparent);
}

.export-status--error {
  background: color-mix(in srgb, #e03e3e 10%, transparent);
  color: var(--settings-text);
  border: 1px solid color-mix(in srgb, #e03e3e 28%, transparent);
}

.export-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.export-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  color: var(--settings-text);
  text-align: start;
  font: inherit;
  cursor: pointer;
  /* No transition — long Import/Export lists felt laggy while scrolling. */
}

.export-btn:hover:not(:disabled) {
  background: var(--settings-hover);
}

.export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-btn__title {
  font-size: 13px;
  font-weight: 600;
}

.export-btn__desc {
  font-size: 11px;
  color: var(--settings-muted);
}

.export-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.export-row {
  display: flex;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  color: var(--settings-text);
  text-align: start;
  font: inherit;
  cursor: pointer;
}

.export-row:hover:not(:disabled) {
  background: var(--settings-hover);
}

.export-row:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.export-row__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.export-row__title {
  font-size: 13px;
  font-weight: 600;
}

.export-row__desc {
  font-size: 11px;
  color: var(--settings-muted);
}

.settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.settings-subtitle {
  margin: 16px 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--settings-muted);
}

.settings-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--settings-muted);
}

.settings-hint--tight {
  margin: 10px 0 0;
}

.settings-hint kbd {
  display: inline-block;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--settings-text);
}

.settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  color: var(--settings-text);
  cursor: pointer;
  text-align: start;
  font: inherit;
}

.settings-toggle-row:hover {
  background: var(--settings-hover);
}

.settings-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-toggle-title {
  font-size: 14px;
  font-weight: 600;
}

.settings-toggle-desc {
  font-size: 12px;
  color: var(--settings-muted);
}

.settings-switch {
  position: relative;
  flex-shrink: 0;
  width: 40px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--settings-muted) 35%, transparent);
  transition: background 0.15s ease;
}

.settings-switch--on {
  background: #2383e2;
}

.settings-switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
  transition: transform 0.15s ease;
}

.settings-switch--on .settings-switch__knob {
  transform: translateX(16px);
}

/* Appearance / layout cards: preview + label only (no radio/bullet check) */
.settings-select-card--theme {
  grid-template-rows: auto auto;
}

.theme-card-preview {
  overflow: hidden;
  padding: 0;
}

/* Layout cards: mini page mockups (container vs full width) */
.layout-card-preview {
  overflow: hidden;
  padding: 0;
  background: color-mix(in srgb, var(--settings-muted) 10%, var(--settings-panel-bg));
}

.layout-card-preview__canvas {
  display: flex;
  align-items: stretch;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px 12px;
}

.layout-card-preview__page {
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-sizing: border-box;
  height: 100%;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--settings-muted) 35%, var(--settings-control-border));
  background: var(--settings-panel-bg);
  padding: 8px 7px;
  box-shadow: 0 1px 2px rgb(15 15 15 / 0.06);
}

.layout-card-preview__page--container {
  width: 48%;
  min-width: 36px;
}

.layout-card-preview__page--full {
  width: 100%;
}

.layout-card-preview__title {
  display: block;
  width: 52%;
  height: 6px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--settings-text) 78%, transparent);
  opacity: 0.9;
}

.layout-card-preview__line {
  display: block;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--settings-muted) 45%, var(--settings-panel-bg));
}

.layout-card-preview__line--short {
  width: 72%;
}

.theme-card-preview--light {
  background: #f7f6f3;
  border-color: #e3e2de;
}

.theme-card-preview--dark {
  background: #191919;
  border-color: #2f2f2f;
}

.theme-card-preview--system {
  background: transparent;
  border-color: var(--settings-control-border);
  padding: 0;
}

.theme-card-preview__window {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
}

.theme-card-preview--light .theme-card-preview__bar {
  background: #37352f;
}

.theme-card-preview--light .theme-card-preview__line {
  background: color-mix(in srgb, #37352f 22%, #f7f6f3);
}

.theme-card-preview--dark .theme-card-preview__bar {
  background: #ebebeb;
}

.theme-card-preview--dark .theme-card-preview__line {
  background: color-mix(in srgb, #ebebeb 22%, #191919);
}

.theme-card-preview__bar {
  display: block;
  width: 42%;
  height: 6px;
  border-radius: 2px;
  opacity: 0.9;
}

.theme-card-preview__line {
  display: block;
  width: 100%;
  height: 4px;
  border-radius: 2px;
}

.theme-card-preview__line--short {
  width: 68%;
}

.theme-card-preview__split {
  display: flex;
  width: 100%;
  height: 100%;
}

.theme-card-preview__half {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  padding: 10px 8px;
  min-width: 0;
}

.theme-card-preview__half--light {
  background: #f7f6f3;
  border-inline-end: 1px solid color-mix(in srgb, #37352f 12%, transparent);
}

.theme-card-preview__half--light .theme-card-preview__bar {
  background: #37352f;
}

.theme-card-preview__half--light .theme-card-preview__line {
  background: color-mix(in srgb, #37352f 22%, #f7f6f3);
}

.theme-card-preview__half--dark {
  background: #191919;
}

.theme-card-preview__half--dark .theme-card-preview__bar {
  background: #ebebeb;
}

.theme-card-preview__half--dark .theme-card-preview__line {
  background: color-mix(in srgb, #ebebeb 22%, #191919);
}

.theme-toggle {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--settings-control-bg);
  border: 1px solid var(--settings-control-border);
}

.theme-toggle--2 {
  grid-template-columns: repeat(2, 1fr);
}

.theme-toggle--3 {
  grid-template-columns: repeat(3, 1fr);
}

.theme-toggle-btn {
  border: none;
  border-radius: 7px;
  padding: 8px 12px;
  background: transparent;
  color: var(--settings-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.theme-toggle-btn.active {
  background: var(--settings-control-active);
  color: var(--settings-text);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}

.theme-toggle-btn--locked {
  opacity: 0.5;
  cursor: not-allowed;
}

.theme-toggle-btn--locked:hover {
  opacity: 0.72;
}

.delta-need-root {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}

.delta-need-backdrop {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: rgb(15 15 15 / 0.45);
  cursor: pointer;
}

.delta-need-panel {
  position: relative;
  width: min(400px, 100%);
  padding: 20px 20px 16px;
  border-radius: 14px;
  background: var(--settings-panel-bg, #fff);
  border: 1px solid var(--settings-panel-border, rgb(15 15 15 / 0.08));
  box-shadow: 0 28px 56px rgb(15 15 15 / 0.22);
  color: var(--settings-text, #37352f);
}

.delta-need-title {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 650;
}

.delta-need-body {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
}

.delta-need-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.delta-need-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--settings-control-border, #e9e9e7);
  background: var(--settings-control-bg, #f7f6f3);
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.delta-need-btn:hover {
  background: var(--settings-hover, #f1f1ef);
}

.delta-need-btn--primary {
  border-color: transparent;
  background: var(--xpe-primary, #2383e2);
  color: #fff;
}

.delta-need-btn--primary:hover {
  filter: brightness(1.05);
  background: var(--xpe-primary, #2383e2);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
}

.settings-row--card {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  margin-bottom: 8px;
}

.settings-label {
  color: var(--settings-muted);
}

.settings-value {
  color: var(--settings-text);
  font-weight: 500;
}

.settings-empty {
  margin: 0;
  font-size: 14px;
  color: var(--settings-muted);
}

.settings-peer-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings-peer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 14px;
  color: var(--settings-text);
}

.settings-peer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.settings-peer-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-peer-page {
  font-size: 12px;
  color: var(--settings-muted);
}

/*
 * Phone: full-page modal + root list / sub-pages.
 * Driven by --phone classes from robust phone detect (not max-width MQ alone —
 * iOS WebXDC often reports a wide CSS viewport so media queries never match).
 */
.settings-root--phone {
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
}

.settings-root--phone .settings-backdrop {
  /* Full-screen panel covers everything; keep for a11y close. */
  opacity: 0;
  pointer-events: none;
}

.settings-panel--phone {
  flex-direction: column;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  min-height: 100%;
  min-width: 100%;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.settings-phone-bar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 4px;
  min-height: 52px;
  padding: max(10px, env(safe-area-inset-top, 0px)) 12px 10px;
  border-bottom: 1px solid var(--settings-divider);
  background: color-mix(in srgb, var(--settings-control-bg) 55%, var(--settings-panel-bg));
}

.settings-phone-bar__title {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  color: var(--settings-text);
  text-align: center;
  line-height: 1.2;
}

.settings-phone-bar__back {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin: 0;
  padding: 6px 4px 6px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #2383e2;
  font: inherit;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  justify-self: start;
}

.settings-phone-bar__back:active {
  opacity: 0.7;
}

.settings-phone-bar__done {
  margin: 0;
  padding: 6px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #2383e2;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  justify-self: end;
}

.settings-phone-bar__done:active {
  opacity: 0.7;
}

.settings-phone-bar__spacer {
  width: 1px;
  min-width: 48px;
}

.settings-nav--phone-root {
  flex: 1 1 auto;
  min-height: 0;
  border-right: none;
  border-bottom: none;
  padding: 8px 12px max(16px, env(safe-area-inset-bottom, 0px));
  background: var(--settings-panel-bg);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.settings-tabs--phone-list {
  flex-direction: column;
  gap: 0;
  border-radius: 12px;
  border: 1px solid var(--settings-control-border);
  background: var(--settings-control-bg);
  overflow: hidden;
}

.settings-tab--phone-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 14px 14px;
  border: none;
  border-radius: 0;
  border-bottom: 1px solid var(--settings-divider);
  background: transparent;
  text-align: start;
  font-size: 16px;
  font-weight: 500;
}

.settings-tab--phone-row:last-child {
  border-bottom: none;
}

.settings-tab--phone-row:active {
  background: var(--settings-hover);
}

.settings-tab--phone-row .settings-tab__icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 4px;
  border-radius: 7px;
  background: color-mix(in srgb, #2383e2 12%, var(--settings-panel-bg));
  color: #2383e2;
  opacity: 1;
}

.settings-tab--phone-row .settings-tab__label {
  flex: 1 1 auto;
  min-width: 0;
}

.settings-tab--phone-row .settings-tab__chevron {
  flex-shrink: 0;
  color: var(--settings-muted);
  opacity: 0.85;
}

.settings-main--phone {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: none;
  padding: 0;
}

.settings-main--phone .settings-main-body {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  padding: 12px 12px max(20px, env(safe-area-inset-bottom, 0px));
}

/* Kill desktop container width (420px) — use full phone width. */
.settings-main--phone .settings-section,
.settings-main--phone .settings-section--export {
  width: 100%;
  max-width: none;
}

.settings-main--phone .settings-select-cards,
.settings-main--phone .settings-select-card,
.settings-main--phone .settings-row,
.settings-main--phone .settings-transfer-actions,
.settings-main--phone .settings-export-grid {
  width: 100%;
  max-width: none;
}

.settings-main--phone .settings-select-card__preview--tile {
  max-width: none;
}

/* Stack theme/layout tiles full-width on phones */
.settings-root--phone .settings-select-cards--horizontal {
  flex-direction: column;
}

/* Hide desktop corner close on phone panel (bar has Done). */
.settings-panel--phone .settings-close {
  display: none;
}

</style>
