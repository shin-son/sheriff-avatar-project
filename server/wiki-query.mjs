// Server-side wiki query — port of src/main/modules/wiki/index.ts queryWiki()
// without the Electron dependency. Scores vault notes against a CI event and
// resolves owners from module-note frontmatter (wiki-vault/README.md schema):
// the `owner:` field is the error→module→담당자 mapping the classifier acts on.
// TODO(SVP-8): apply feedback-based demotion once server-side feedback lands.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VAULT_DIR =
  process.env.SVP_WIKI_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'wiki-vault')

// Schema/auto-generated files and raw/ originals are not query targets (README.md).
const INFRA_FILES = new Set(['README.md', 'index.md', 'log.md'])

function listMarkdownFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    // 숨김 폴더 제외: 사내 vault에는 .obsidian/, .claude/(스킬) 등이 함께 있다 —
    // 스킬 지침·설정 파일이 wiki 노트로 검색되어 분류 프롬프트에 섞이면 안 된다.
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'raw') out.push(...listMarkdownFiles(full))
    } else if (name.endsWith('.md') && !INFRA_FILES.has(name)) {
      out.push(full)
    }
  }
  return out
}

/** Minimal frontmatter reader: `key: value` lines between the two --- fences. */
function parseFrontmatter(content) {
  const fields = {}
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return fields
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break
    const sep = lines[i].indexOf(': ')
    if (sep > 0) fields[lines[i].slice(0, sep).trim()] = lines[i].slice(sep + 2).trim()
  }
  return fields
}

function toTitle(file, content) {
  const heading = content.split('\n').find((l) => l.startsWith('# '))
  return heading ? heading.slice(2).trim() : basename(file, '.md')
}

/** All module notes: [{module, owner, file}] — source of the category enum and owner map. */
export function listModules() {
  const modulesDir = join(VAULT_DIR, 'modules')
  const out = []
  try {
    for (const name of readdirSync(modulesDir)) {
      if (!name.endsWith('.md')) continue
      const fm = parseFrontmatter(readFileSync(join(modulesDir, name), 'utf-8'))
      if (fm.module && fm.owner) out.push({ module: fm.module, owner: fm.owner, file: `modules/${name}` })
    }
  } catch {
    // no vault / no modules dir: classifier will run with an empty enum → unknown only
  }
  return out
}

/** Owner (= Jira username) for a classified category, from note frontmatter only. */
export function resolveOwner(category) {
  return listModules().find((m) => m.module === category)?.owner ?? null
}

/**
 * Same scorer as the Electron adapter: keywords = module + title words >3 chars;
 * module match +3, other keyword substring +1; top 3 with score > 0.
 * Returns matches extended with body/module/owner so the classifier can build
 * its prompt without re-reading files.
 */
export function queryWiki(event) {
  const keywords = new Set(
    [event.module, ...event.title.toLowerCase().split(/[^a-z0-9가-힣_.-]+/)].filter(
      (w) => w && w.length > 3
    )
  )
  const matches = []
  let files = []
  try {
    files = listMarkdownFiles(VAULT_DIR)
  } catch {
    return []
  }
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const haystack = content.toLowerCase()
    let score = 0
    for (const keyword of keywords) {
      if (!haystack.includes(keyword)) continue
      score += keyword === event.module ? 3 : 1
    }
    if (score > 0) {
      const fm = parseFrontmatter(content)
      matches.push({
        file: relative(VAULT_DIR, file).replaceAll('\\', '/'),
        title: toTitle(file, content),
        score,
        body: content,
        module: fm.module ?? null,
        owner: fm.owner ?? null
      })
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 3)
}
