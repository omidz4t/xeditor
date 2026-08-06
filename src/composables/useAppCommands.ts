import { derived, type Readable } from 'svelte/store'
import { useTheme } from './useTheme'

export type AppCommand = {
  id: string
  label: string
  keywords: string[]
  shortcut?: string
  run: () => void
}

type CommandSources = {
  onOpenSettings: () => void
  onToggleSidebar: () => void
  onToggleComments: () => void
  onCreatePage: () => void
  onOpenShortcuts?: () => void
  sidebarOpen: Readable<boolean>
  commentsOpen: Readable<boolean>
  /** Open Settings → Import / Export. */
  onOpenImportExport?: () => void
  // Export
  onExportPageMarkdown?: () => void
  onExportPagePlainText?: () => void
  onExportPageHtml?: () => void
  onCopyPageMarkdown?: () => void
  onCopyPagePlainText?: () => void
  onCopyPageHtml?: () => void
  onExportAllMarkdown?: () => void
  onExportAllMarkdownZip?: () => void
  onExportWorkspaceJson?: () => void
  onExportWebxdc?: () => void
  onShareWebxdc?: () => void
  onShareJson?: () => void
  // Import
  onImportMarkdownPages?: () => void
  onImportReplaceMarkdown?: () => void
  onImportReplaceHtml?: () => void
  onImportReplaceText?: () => void
  onImportWorkspaceJson?: () => void
  onImportMarkdownZip?: () => void
  onImportMarkdownFolder?: () => void
}

function isApplePlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac')
}

/** Display string for modifier shortcuts (⌘ on Apple, Ctrl elsewhere). */
export function formatShortcut(...parts: string[]): string {
  const mod = isApplePlatform() ? '⌘' : 'Ctrl'
  return parts
    .map((part) => {
      if (part === 'Mod' || part === 'Ctrl' || part === 'Cmd') return mod
      if (part === 'Shift') return isApplePlatform() ? '⇧' : 'Shift'
      return part
    })
    .join(isApplePlatform() ? '' : '+')
}

export function useAppCommands(sources: CommandSources): { commands: Readable<AppCommand[]> } {
  const { resolvedTheme, updateTheme, toggleTheme } = useTheme()

  const commands = derived(
    [sources.sidebarOpen, sources.commentsOpen, resolvedTheme],
    ([$sidebarOpen, $commentsOpen, $resolvedTheme]) => {
      const list: AppCommand[] = [
        {
          id: 'toggle-sidebar',
          label: $sidebarOpen ? 'Close left sidebar' : 'Open left sidebar',
          keywords: [
            'sidebar',
            'panel',
            'left',
            'toggle',
            'collapse',
            'expand',
            'navigation',
            'pages',
            'hide',
            'show',
          ],
          shortcut: formatShortcut('Mod', 'B'),
          run: sources.onToggleSidebar,
        },
        {
          id: 'create-page',
          label: 'Create new page',
          keywords: ['page', 'new', 'create', 'note', 'add', 'document'],
          shortcut: formatShortcut('Mod', 'N'),
          run: sources.onCreatePage,
        },
        {
          id: 'toggle-comments',
          label: $commentsOpen ? 'Close comments' : 'Open comments',
          keywords: ['comment', 'comments', 'discuss', 'feedback', 'panel', 'right'],
          shortcut: formatShortcut('Mod', 'Shift', 'C'),
          run: sources.onToggleComments,
        },
        {
          id: 'keyboard-shortcuts',
          label: 'Keyboard shortcuts',
          keywords: ['shortcut', 'shortcuts', 'keyboard', 'hotkey', 'help', 'cheatsheet', '?'],
          shortcut: '?',
          run: () => sources.onOpenShortcuts?.(),
        },
        {
          id: 'theme-toggle',
          label: $resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
          keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'night'],
          run: toggleTheme,
        },
        {
          id: 'theme-system',
          label: 'Use system theme',
          keywords: ['theme', 'system', 'auto', 'appearance', 'os'],
          run: () => updateTheme('system'),
        },
        {
          id: 'theme-dark',
          label: 'Dark mode',
          keywords: ['theme', 'dark', 'night', 'appearance'],
          run: () => updateTheme('dark'),
        },
        {
          id: 'theme-light',
          label: 'Light mode',
          keywords: ['theme', 'light', 'day', 'appearance'],
          run: () => updateTheme('light'),
        },
        {
          id: 'settings',
          label: 'Settings',
          keywords: ['settings', 'preferences', 'options', 'config'],
          run: sources.onOpenSettings,
        },
        {
          id: 'import-export',
          label: 'Import / Export…',
          keywords: [
            'import',
            'export',
            'download',
            'upload',
            'transfer',
            'backup',
            'markdown',
            'json',
            'share',
          ],
          run: () => sources.onOpenImportExport?.() ?? sources.onOpenSettings(),
        },
        // —— Export ——
        {
          id: 'export-page-markdown',
          label: 'Export page as Markdown',
          keywords: ['export', 'download', 'markdown', 'md', 'page', 'file'],
          run: () => sources.onExportPageMarkdown?.(),
        },
        {
          id: 'export-page-plain',
          label: 'Export page as plain text',
          keywords: ['export', 'download', 'text', 'txt', 'plain', 'page'],
          run: () => sources.onExportPagePlainText?.(),
        },
        {
          id: 'export-page-html',
          label: 'Export page as HTML',
          keywords: ['export', 'download', 'html', 'web', 'page'],
          run: () => sources.onExportPageHtml?.(),
        },
        {
          id: 'copy-page-markdown',
          label: 'Copy page as Markdown',
          keywords: ['copy', 'clipboard', 'markdown', 'md', 'export'],
          run: () => sources.onCopyPageMarkdown?.(),
        },
        {
          id: 'copy-page-plain',
          label: 'Copy page as plain text',
          keywords: ['copy', 'clipboard', 'text', 'plain', 'export'],
          run: () => sources.onCopyPagePlainText?.(),
        },
        {
          id: 'copy-page-html',
          label: 'Copy page as HTML',
          keywords: ['copy', 'clipboard', 'html', 'export'],
          run: () => sources.onCopyPageHtml?.(),
        },
        {
          id: 'export-all-markdown',
          label: 'Export all pages as Markdown',
          keywords: ['export', 'download', 'markdown', 'all', 'workspace', 'combined'],
          run: () => sources.onExportAllMarkdown?.(),
        },
        {
          id: 'export-all-markdown-zip',
          label: 'Export all pages as Markdown ZIP',
          keywords: ['export', 'download', 'zip', 'markdown', 'all', 'workspace', 'archive'],
          run: () => sources.onExportAllMarkdownZip?.(),
        },
        {
          id: 'export-workspace-json',
          label: 'Export workspace JSON',
          keywords: ['export', 'download', 'json', 'workspace', 'collab', 'backup'],
          run: () => sources.onExportWorkspaceJson?.(),
        },
        {
          id: 'export-webxdc',
          label: 'Export WebXDC package',
          keywords: ['export', 'download', 'webxdc', 'xdc', 'package', 'app'],
          run: () => sources.onExportWebxdc?.(),
        },
        {
          id: 'share-webxdc',
          label: 'Share as WebXDC to chat',
          keywords: ['share', 'send', 'webxdc', 'chat', 'export'],
          run: () => sources.onShareWebxdc?.(),
        },
        {
          id: 'share-json',
          label: 'Share JSON file to chat',
          keywords: ['share', 'send', 'json', 'chat', 'export', 'file'],
          run: () => sources.onShareJson?.(),
        },
        // —— Import ——
        {
          id: 'import-open',
          label: 'Import…',
          keywords: [
            'import',
            'upload',
            'markdown',
            'md',
            'folder',
            'directory',
            'zip',
            'json',
            'workspace',
            'pages',
            'files',
          ],
          run: () => sources.onImportMarkdownPages?.(),
        },
        {
          id: 'import-replace-html',
          label: 'Replace page with HTML',
          keywords: ['import', 'replace', 'html', 'overwrite', 'page'],
          run: () => sources.onImportReplaceHtml?.(),
        },
        {
          id: 'import-replace-text',
          label: 'Replace page with text',
          keywords: ['import', 'replace', 'text', 'txt', 'plain', 'overwrite'],
          run: () => sources.onImportReplaceText?.(),
        },
      ]
      return list
    },
  )

  return { commands }
}
