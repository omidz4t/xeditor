export const PACKAGE_MANIFEST_FILENAME = 'package-manifest.json'

export type WebxdcPackageManifest = {
  version: 1
  files: string[]
}

export const REQUIRED_PACKAGE_FILES = [
  'index.html',
  'manifest.toml',
  'icon.png',
] as const

/** Host injects this; never ship or require it inside re-exported .xdc packages. */
export const HOST_PROVIDED_PACKAGE_FILES = ['webxdc.js'] as const

export const extractAssetPathsFromHtml = (html: string): string[] => {
  const paths = new Set<string>(REQUIRED_PACKAGE_FILES)
  const pattern = /(?:src|href)=["']([^"']+)["']/gi

  for (const match of html.matchAll(pattern)) {
    const ref = match[1]
    if (
      !ref
      || ref.startsWith('data:')
      || ref.startsWith('http')
      || ref.startsWith('//')
      // Vite dev absolute paths (/src/main.ts, /@vite/client) — never package.
      || ref.startsWith('/')
      || ref.includes('@vite')
      || ref.endsWith('.ts')
    ) {
      continue
    }
    const path = ref.replace(/^\.\//, '')
    // Delta Chat provides webxdc.js; omit from package file lists.
    if ((HOST_PROVIDED_PACKAGE_FILES as readonly string[]).includes(path)) {
      continue
    }
    paths.add(path)
  }

  return [...paths]
}