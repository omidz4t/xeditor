#!/usr/bin/env node
/**
 * Semantic-release-style version bump (no extra deps).
 *
 * Reads conventional commits since the last version tag (or all commits),
 * decides major / minor / patch, then updates:
 *   - package.json
 *   - packages/core/package.json
 *   - packages/svelte/package.json
 *   - public/manifest.toml
 *
 * Usage:
 *   node scripts/bump-version.mjs              # apply bump + git commit (default)
 *   node scripts/bump-version.mjs --dry-run    # print only (no write / commit)
 *   node scripts/bump-version.mjs --force patch|minor|major
 *   node scripts/bump-version.mjs --from 0.2.0 # ignore git base version
 *   node scripts/bump-version.mjs --tag        # also create annotated git tag vX.Y.Z
 *   node scripts/bump-version.mjs --no-commit  # write files only, skip git commit
 *   node scripts/bump-version.mjs --changelog  # prepend CHANGELOG.md section
 *
 * Commit conventions (Angular / conventional commits):
 *   feat: …              → minor
 *   fix: / perf: …       → patch
 *   feat!: / BREAKING CHANGE → major
 *   chore/docs/ci/test/style → ignored (no bump) unless --include-chore
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function hasFlag(name) {
  return args.includes(name)
}
function flagValue(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? null
}

const dryRun = hasFlag('--dry-run') || hasFlag('-n')
// Commit is ON by default (semantic-release style). Opt out with --no-commit.
const doCommit = !hasFlag('--no-commit') && !dryRun
// Tag only when explicitly requested (or via --release which enables tag+changelog).
const doTag = (hasFlag('--tag') || hasFlag('--release')) && !hasFlag('--no-tag')
const doChangelog = hasFlag('--changelog') || hasFlag('--release')
const includeChore = hasFlag('--include-chore')
// Append [skip ci] to the release commit so CI does not re-trigger after pushing the tag/commit.
const skipCi = hasFlag('--skip-ci') || process.env.CI === 'true'
const forceLevel = flagValue('--force') // patch | minor | major
const fromVersion = flagValue('--from')
const prereleaseId = flagValue('--prerelease') // e.g. beta → 1.2.0-beta.0

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp()
  process.exit(0)
}

if (forceLevel && !['patch', 'minor', 'major'].includes(forceLevel)) {
  die(`Invalid --force ${forceLevel} (use patch|minor|major)`)
}

// ── Paths to bump ────────────────────────────────────────────────────────────

const VERSION_FILES = [
  { path: join(root, 'package.json'), kind: 'json' },
  { path: join(root, 'packages/core/package.json'), kind: 'json' },
  { path: join(root, 'packages/svelte/package.json'), kind: 'json' },
  // Keep lockfile root version in sync so `npm ci` does not fail in CI.
  { path: join(root, 'package-lock.json'), kind: 'package-lock' },
  { path: join(root, 'public/manifest.toml'), kind: 'toml-version' },
]

// ── Git helpers ──────────────────────────────────────────────────────────────

function git(argsList, { allowFail = false } = {}) {
  try {
    return execFileSync('git', argsList, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', allowFail ? 'pipe' : 'pipe'],
    }).trim()
  } catch (err) {
    if (allowFail) return ''
    die(`git ${argsList.join(' ')} failed:\n${err.stderr || err.message}`)
  }
}

function inGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) === 'true'
}

/** Latest semver tag like v1.2.3 or 1.2.3 */
function latestVersionTag() {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)

  for (const tag of tags) {
    const v = tag.replace(/^v/, '')
    if (parseSemver(v)) return { tag, version: v }
  }

  // Also accept unprefixed X.Y.Z tags
  const all = git(['tag', '--list', '--sort=-v:refname'], { allowFail: true })
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const tag of all) {
    if (parseSemver(tag)) return { tag, version: tag }
  }
  return null
}

function commitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD'
  // %H%x1f%s%x1f%b%x1e  → hash, subject, body; records separated by RS
  const raw = git(
    ['log', range, '--pretty=format:%H%x1f%s%x1f%b%x1e', '--no-merges'],
    { allowFail: true },
  )
  if (!raw) return []
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, subject, body = ''] = chunk.split('\x1f')
      return { hash: hash?.trim() || '', subject: subject?.trim() || '', body: body || '' }
    })
    .filter((c) => c.hash && c.subject)
}

// ── Semver ───────────────────────────────────────────────────────────────────

function parseSemver(input) {
  const m = String(input)
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || null,
    build: m[5] || null,
  }
}

function formatSemver(v) {
  let s = `${v.major}.${v.minor}.${v.patch}`
  if (v.prerelease) s += `-${v.prerelease}`
  if (v.build) s += `+${v.build}`
  return s
}

function bumpSemver(current, level, preId) {
  const next = { ...current, build: null }
  if (preId) {
    // Enter or bump prerelease channel
    if (current.prerelease && current.prerelease.startsWith(preId)) {
      const parts = current.prerelease.split('.')
      const n = Number(parts[parts.length - 1])
      if (Number.isFinite(n)) {
        parts[parts.length - 1] = String(n + 1)
        next.prerelease = parts.join('.')
      } else {
        next.prerelease = `${preId}.0`
      }
      return next
    }
    // Bump base version first for a new prerelease line
    if (level === 'major') {
      next.major += 1
      next.minor = 0
      next.patch = 0
    } else if (level === 'minor') {
      next.minor += 1
      next.patch = 0
    } else {
      next.patch += 1
    }
    next.prerelease = `${preId}.0`
    return next
  }

  next.prerelease = null
  if (level === 'major') {
    next.major += 1
    next.minor = 0
    next.patch = 0
  } else if (level === 'minor') {
    next.minor += 1
    next.patch = 0
  } else {
    next.patch += 1
  }
  return next
}

// ── Conventional commits ─────────────────────────────────────────────────────

/**
 * Parse "type(scope)!: subject"
 * @returns {{ type: string, scope: string|null, breaking: boolean, subject: string } | null}
 */
function parseConventional(subject) {
  const m = subject.match(
    /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<break>!)?:\s*(?<rest>.+)$/,
  )
  if (!m?.groups) return null
  return {
    type: m.groups.type.toLowerCase(),
    scope: m.groups.scope || null,
    breaking: Boolean(m.groups.break),
    subject: m.groups.rest.trim(),
  }
}

function hasBreakingFooter(body) {
  return /^(BREAKING CHANGE|BREAKING-CHANGE):/m.test(body || '')
}

const RELEASE_TYPES = new Set(['feat', 'fix', 'perf', 'revert'])
// Optionally treated as patch when --include-chore
const CHORE_TYPES = new Set(['chore', 'docs', 'style', 'refactor', 'test', 'build', 'ci'])

/**
 * @returns {'major'|'minor'|'patch'|null}
 */
function releaseLevelFromCommits(commits) {
  let level = null // null < patch < minor < major
  const rank = { patch: 1, minor: 2, major: 3 }

  function raise(next) {
    if (!next) return
    if (!level || rank[next] > rank[level]) level = next
  }

  for (const c of commits) {
    const parsed = parseConventional(c.subject)
    const breaking = (parsed?.breaking ?? false) || hasBreakingFooter(c.body)
    if (breaking) {
      raise('major')
      continue
    }
    if (!parsed) continue
    const { type } = parsed
    if (type === 'feat') raise('minor')
    else if (type === 'fix' || type === 'perf' || type === 'revert') raise('patch')
    else if (includeChore && CHORE_TYPES.has(type)) raise('patch')
  }
  return level
}

function classifyCommit(c) {
  const parsed = parseConventional(c.subject)
  if ((parsed?.breaking) || hasBreakingFooter(c.body)) return 'breaking'
  if (!parsed) return 'other'
  if (parsed.type === 'feat') return 'feat'
  if (parsed.type === 'fix' || parsed.type === 'perf' || parsed.type === 'revert') return 'fix'
  return parsed.type
}

// ── File updates ─────────────────────────────────────────────────────────────

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Replace only the top-level "version" field — keep existing JSON formatting. */
function updateJsonVersion(path, version) {
  const text = readFileSync(path, 'utf8')
  if (!/"version"\s*:\s*"[^"]*"/.test(text)) {
    die(`${relative(root, path)} has no "version" field`)
  }
  const next = text.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`)
  writeFileSync(path, next, 'utf8')
}

/**
 * Sync root package-lock.json versions with package.json.
 * npm ci requires package.json and package-lock.json versions to match.
 */
function updatePackageLockVersion(path, version) {
  const text = readFileSync(path, 'utf8')
  // Top-level lock "version" and packages[""].version
  let next = text.replace(
    /^(\s*"name":\s*"[^"]+",\s*\n\s*"version":\s*")([^"]*)(")/m,
    `$1${version}$3`,
  )
  // Fallback: first "version" after opening brace of lockfile
  if (next === text) {
    next = text.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`)
  }
  // packages[""] entry
  next = next.replace(
    /("":\s*\{\s*\n\s*"name":\s*"[^"]+",\s*\n\s*"version":\s*")([^"]*)(")/,
    `$1${version}$3`,
  )
  writeFileSync(path, next, 'utf8')
}

function updateTomlVersion(path, version) {
  const text = readFileSync(path, 'utf8')
  if (!/^version\s*=/m.test(text)) {
    die(`${relative(root, path)} has no version = … line`)
  }
  const next = text.replace(/^version\s*=\s*".*?"/m, `version = "${version}"`)
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
}

function readCurrentVersionFromPackage() {
  const pkg = readJson(join(root, 'package.json'))
  const v = parseSemver(pkg.version)
  if (!v) die(`Invalid version in package.json: ${pkg.version}`)
  return formatSemver(v)
}

function readFileVersion(path, kind) {
  if (kind === 'json' || kind === 'package-lock') {
    return readJson(path).version
  }
  const text = readFileSync(path, 'utf8')
  return text.match(/^version\s*=\s*"(.*?)"/m)?.[1] ?? null
}

function applyVersion(version) {
  const changed = []
  for (const file of VERSION_FILES) {
    if (!existsSync(file.path)) {
      console.warn(`skip missing ${relative(root, file.path)}`)
      continue
    }
    const prev = readFileVersion(file.path, file.kind)
    if (prev === version) continue
    if (!dryRun) {
      if (file.kind === 'json') updateJsonVersion(file.path, version)
      else if (file.kind === 'package-lock') updatePackageLockVersion(file.path, version)
      else updateTomlVersion(file.path, version)
    }
    changed.push(relative(root, file.path))
  }
  return changed
}

function prependChangelog(version, commits, level) {
  const path = join(root, 'CHANGELOG.md')
  const date = new Date().toISOString().slice(0, 10)
  const groups = {
    breaking: [],
    feat: [],
    fix: [],
    other: [],
  }
  for (const c of commits) {
    const kind = classifyCommit(c)
    const line = `- ${c.subject} (${c.hash.slice(0, 7)})`
    if (kind === 'breaking') groups.breaking.push(line)
    else if (kind === 'feat') groups.feat.push(line)
    else if (kind === 'fix') groups.fix.push(line)
    else if (RELEASE_TYPES.has(parseConventional(c.subject)?.type || '') || includeChore) {
      groups.other.push(line)
    }
  }

  const sections = []
  sections.push(`## ${version} (${date})`, '')
  sections.push(`Release type: **${level}**`, '')
  if (groups.breaking.length) {
    sections.push('### Breaking changes', '', ...groups.breaking, '')
  }
  if (groups.feat.length) {
    sections.push('### Features', '', ...groups.feat, '')
  }
  if (groups.fix.length) {
    sections.push('### Fixes', '', ...groups.fix, '')
  }
  if (groups.other.length) {
    sections.push('### Other', '', ...groups.other, '')
  }
  if (
    !groups.breaking.length &&
    !groups.feat.length &&
    !groups.fix.length &&
    !groups.other.length
  ) {
    sections.push('_No conventional commits in this range._', '')
  }

  const block = `${sections.join('\n')}\n`
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n\n'
  const next = prev.startsWith('# Changelog')
    ? prev.replace(/^# Changelog\s*/, `# Changelog\n\n${block}`)
    : `# Changelog\n\n${block}${prev}`

  if (!dryRun) writeFileSync(path, next, 'utf8')
  return relative(root, path)
}

// ── Main ─────────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function printHelp() {
  console.log(`Usage: node scripts/bump-version.mjs [options]

By default the script writes version files and creates a git commit
  "chore(release): X.Y.Z". Use --dry-run to preview, --no-commit to skip commit.

Options:
  --dry-run, -n         Show what would happen without writing or committing
  --force <level>       Ignore commits; bump patch|minor|major
  --from <version>      Base version (default: latest tag or package.json)
  --prerelease <id>     e.g. beta → X.Y.Z-beta.0
  --include-chore       Treat chore/docs/ci/… as patch
  --changelog           Prepend a CHANGELOG.md section
  --release             Changelog + annotated tag (still auto-commits)
  --no-commit           Write files only; do not git commit
  --tag                 Create annotated tag vX.Y.Z
  --no-tag              Do not tag even with --release
  --help, -h            This help

Examples:
  node scripts/bump-version.mjs --dry-run
  node scripts/bump-version.mjs                 # bump + commit
  node scripts/bump-version.mjs --release       # bump + changelog + commit + tag
  node scripts/bump-version.mjs --force minor --dry-run
`)
}

function main() {
  if (!inGitRepo()) die('not a git repository')

  const pkgVersion = readCurrentVersionFromPackage()
  const tagInfo = latestVersionTag()
  const baseVersion = fromVersion || tagInfo?.version || pkgVersion
  const baseParsed = parseSemver(baseVersion)
  if (!baseParsed) die(`Cannot parse base version: ${baseVersion}`)

  const sinceRef = fromVersion ? null : tagInfo?.tag || null
  const commits = forceLevel ? [] : commitsSince(sinceRef)

  let level = forceLevel || releaseLevelFromCommits(commits)

  console.log('── Version bump ──────────────────────────────')
  console.log(`package.json : ${pkgVersion}`)
  console.log(`base version : ${baseVersion}${tagInfo ? ` (tag ${tagInfo.tag})` : ' (no tag)'}`)
  console.log(`commits      : ${forceLevel ? '(forced)' : commits.length} since ${sinceRef || 'repo start'}`)

  if (!forceLevel && commits.length) {
    const summary = { breaking: 0, feat: 0, fix: 0, other: 0 }
    for (const c of commits) {
      const k = classifyCommit(c)
      if (k === 'breaking') summary.breaking++
      else if (k === 'feat') summary.feat++
      else if (k === 'fix') summary.fix++
      else summary.other++
    }
    console.log(
      `  types       : feat=${summary.feat} fix=${summary.fix} breaking=${summary.breaking} other=${summary.other}`,
    )
    // Show a short list
    for (const c of commits.slice(0, 12)) {
      const k = classifyCommit(c)
      console.log(`  · [${k}] ${c.subject}`)
    }
    if (commits.length > 12) console.log(`  · … +${commits.length - 12} more`)
  }

  if (!level) {
    console.log('\nNo releasable conventional commits found (feat/fix/perf/BREAKING).')
    console.log('Use --force patch|minor|major or --include-chore, or write conventional commits.')
    process.exit(0)
  }

  // If package.json is ahead of tag, still bump from baseVersion (tag) unless --from package
  const nextParsed = bumpSemver(baseParsed, level, prereleaseId || null)
  const nextVersion = formatSemver(nextParsed)

  if (nextVersion === baseVersion && !prereleaseId) {
    die(`Computed version ${nextVersion} equals base — nothing to do`)
  }

  console.log(`\nbump         : ${level}${prereleaseId ? ` (prerelease ${prereleaseId})` : ''}`)
  console.log(`new version  : ${baseVersion} → ${nextVersion}`)
  if (dryRun) console.log('(dry-run — no files written)')

  const changed = applyVersion(nextVersion)
  console.log(`files        : ${changed.length ? changed.join(', ') : '(already at version)'}`)

  const extraFiles = []
  if (doChangelog) {
    const cl = prependChangelog(nextVersion, commits, level)
    extraFiles.push(cl)
    console.log(`changelog    : ${cl}`)
  }

  const versionPaths = VERSION_FILES
    .filter((f) => existsSync(f.path))
    .map((f) => relative(root, f.path))
  const commitPaths = [...new Set([...changed, ...extraFiles, ...versionPaths])]

  if (dryRun) {
    if (doCommit || !hasFlag('--no-commit')) {
      console.log(`commit       : would commit "chore(release): ${nextVersion}"`)
    } else {
      console.log('commit       : skipped (--no-commit)')
    }
    if (doTag) console.log(`tag          : would create v${nextVersion}`)
  } else if (doCommit) {
    git(['add', '--', ...commitPaths])
    const pending = git(['status', '--porcelain', '--', ...commitPaths], { allowFail: true })
    if (!pending) {
      console.log('commit       : nothing to commit (working tree clean for version files)')
    } else {
      const msg = skipCi
        ? `chore(release): ${nextVersion} [skip ci]`
        : `chore(release): ${nextVersion}`
      try {
        execFileSync('git', ['commit', '-m', msg], {
          cwd: root,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        console.log(`commit       : ${msg}`)
      } catch (err) {
        const detail = String(err.stderr || err.stdout || err.message || err)
        die(`git commit failed:\n${detail}`)
      }
    }
  } else {
    console.log('commit       : skipped (--no-commit)')
  }

  if (!dryRun && doTag) {
    const tag = `v${nextVersion}`
    const exists = git(['rev-parse', '--verify', `refs/tags/${tag}`], { allowFail: true })
    if (exists) {
      console.log(`tag          : ${tag} already exists — skipped`)
    } else {
      git(['tag', '-a', tag, '-m', `Release ${nextVersion}`])
      console.log(`tag          : ${tag}`)
    }
  }

  console.log('\nDone.')
}

main()
