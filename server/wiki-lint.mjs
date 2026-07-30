// Server-side wiki lint — read-only health check of the live vault (제안 4 Phase 1).
// Reports orphan notes and negative-feedback removal candidates with severity +
// health score. Writes NOTHING: index.md/log.md 재생성은 ingest 경로(ingest.mjs)
// 소유다. 예전 클라이언트 lint는 스스로 rebuild한 index.md가 전 노트를 언급해
// 고아가 항상 0건이던 무력화 상태 — 여기서는 index/README를 참조 소스에서 뺀다.
// 정리 후보 보고까지만 자동이고, 실제 수정·삭제는 사람 PR 전용 (vault 리뷰 경계).
import { readFileSync } from 'node:fs'
import { basename, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isUnhelpful, listMarkdownFiles, loadFeedback, parseFrontmatter, toTitle } from './wiki-query.mjs'

const VAULT_DIR =
  process.env.SVP_WIKI_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'wiki-vault')

// case-log은 참조 '소스'로만 쓰고 고아 판정 대상에서는 뺀다 — 자동 축적 파일이라
// 아무도 링크하지 않는 것이 정상이다.
const CASE_LOG = 'case-log.md'

const SEVERITY_PENALTY = { critical: 15, warn: 10, info: 3 }

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 고아 판정 — notes: [{file, body}] (vault-relative file). 순수 함수.
 * 고아 = 다른 노트(case-log 포함) 어디에도 파일 stem이 '단어'로 등장하지 않는 노트.
 * 단어 경계 매칭: 옛 substring 방식은 auth가 authorization에 묻혀 오판했다.
 */
export function findOrphans(notes) {
  return notes
    .filter((n) => basename(n.file) !== CASE_LOG)
    .filter((n) => {
      const stem = basename(n.file, '.md')
      const ref = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(stem)}([^A-Za-z0-9_-]|$)`, 'im')
      return !notes.some((other) => other.file !== n.file && ref.test(other.body))
    })
    .map((n) => n.file)
}

// 지식 노트 공통 frontmatter 필수 필드 (wiki-vault/README.md §Frontmatter).
const REQUIRED_FRONTMATTER = ['type', 'module', 'owner', 'tags', 'updated']

/**
 * 스키마 검증 — modules/ 노트의 필수 frontmatter 누락(critical)과
 * module ≠ 파일명 불일치(warn). 순수 함수.
 */
export function schemaIssues(notes) {
  const issues = []
  for (const n of notes) {
    if (!/^modules\/[^/]+\.md$/.test(n.file)) continue
    const fm = parseFrontmatter(n.body)
    // 블록 리스트 필드(owner: - a - b)는 배열로 온다 — 빈 배열만 누락으로 취급.
    const missing = REQUIRED_FRONTMATTER.filter((k) => {
      const v = fm[k]
      return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    })
    if (missing.length) {
      issues.push({
        severity: 'critical',
        note: n.file,
        message: `필수 frontmatter 누락: ${missing.join(', ')} — 스키마(wiki-vault/README.md) 위반, 담당자 라우팅 불가 가능`
      })
    }
    const stem = basename(n.file, '.md')
    if (fm.module && fm.module !== stem) {
      issues.push({
        severity: 'warn',
        note: n.file,
        message: `frontmatter module(${fm.module})이 파일명(${stem})과 다름 — 스키마 규칙 위반`
      })
    }
  }
  return issues
}

/**
 * 공백 탐지 (inverse lint) — 티켓은 오는데 대응하는 모듈 노트가 없는 카테고리.
 * tickets: [{key, module, category}], moduleNames: 노트가 있는 모듈명 집합. 순수 함수.
 * "어디를 채워야 자동 배정률이 오르는가"를 알려주는 검사 (제안 4 계층 C).
 */
export function gapIssues(tickets, moduleNames) {
  const groups = new Map() // 공백 모듈명(또는 'unknown') → 티켓 키 목록
  for (const t of tickets) {
    const known = t.category && t.category !== 'unknown' && moduleNames.has(t.category)
    if (known) continue
    const gap =
      t.category && t.category !== 'unknown'
        ? t.category
        : t.module && t.module !== 'unknown'
          ? t.module
          : 'unknown'
    if (moduleNames.has(gap)) continue
    if (!groups.has(gap)) groups.set(gap, [])
    groups.get(gap).push(t.key)
  }
  return [...groups.entries()].map(([gap, keys]) => ({
    severity: 'warn',
    note: gap === 'unknown' ? '(미분류)' : `modules/${gap}.md`,
    message:
      gap === 'unknown'
        ? `모듈을 특정하지 못한 티켓 ${keys.length}건 (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ' 외' : ''}) — 노트 공백, 자동 배정 불가`
        : `${gap} 티켓 ${keys.length}건이 오는데 노트가 없음 — 작성 시 자동 배정 후보`
  }))
}

/** severity별 감점 합산 → 0~100 헬스 스코어. 순수 함수. */
export function healthScore(issues) {
  return Math.max(0, 100 - issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0))
}

/**
 * 리포트 조립 — notes: [{file, title, body}], feedback: { <제목>: {up, down} },
 * tickets: [{key, module, category}] (공백 탐지 입력, 없으면 생략 가능).
 * 순수 함수 (테스트 대상). WikiLintReport(src/shared/types.ts) 형태를 돌려준다.
 */
export function lintVault({ notes, feedback, tickets = [], generatedAt }) {
  const knowledge = notes.filter((n) => basename(n.file) !== CASE_LOG)
  const orphanNotes = findOrphans(notes)
  const unhelpfulNotes = knowledge.filter((n) => isUnhelpful(feedback[n.title])).map((n) => n.title)
  const moduleNames = new Set(
    knowledge.filter((n) => /^modules\/[^/]+\.md$/.test(n.file)).map((n) => basename(n.file, '.md'))
  )

  const issues = [
    ...schemaIssues(knowledge),
    ...unhelpfulNotes.map((t) => ({
      severity: 'warn',
      note: t,
      message: '부정 피드백(원인 불일치) 누적 — 정리 후보. 수정·삭제는 사람이 PR로'
    })),
    ...gapIssues(tickets, moduleNames),
    ...orphanNotes.map((f) => ({
      severity: 'info',
      note: f,
      message: '참조하는 노트가 없음 — 관련 노트에서 링크하거나 통합을 검토할 것'
    }))
  ]

  return {
    generatedAt,
    noteCount: knowledge.length,
    orphanNotes,
    unhelpfulNotes,
    suggestions: issues.map((i) => `『${i.note}』 ${i.message}`),
    issues,
    healthScore: healthScore(issues)
  }
}

/** I/O 래퍼 — 서버 vault를 읽어 lintVault를 돌린다. vault에는 아무것도 쓰지 않는다.
 * tickets는 호출자(서버의 live issue 목록)가 넘긴다 — 공백 탐지(inverse lint) 입력. */
export function lintWiki(tickets = []) {
  let files = []
  try {
    files = listMarkdownFiles(VAULT_DIR)
  } catch {
    // no vault yet — empty report
  }
  const notes = files.map((file) => {
    const body = readFileSync(file, 'utf-8')
    return { file: relative(VAULT_DIR, file).replaceAll('\\', '/'), title: toTitle(file, body), body }
  })
  return lintVault({ notes, feedback: loadFeedback(), tickets, generatedAt: new Date().toISOString() })
}
