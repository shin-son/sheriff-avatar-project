// Server-side wiki lint — read-only health check of the live vault (제안 4 Phase 1).
// Reports orphan notes and negative-feedback removal candidates with severity +
// health score. Writes NOTHING: index.md/log.md 재생성은 ingest 경로(ingest.mjs)
// 소유다. 예전 클라이언트 lint는 스스로 rebuild한 index.md가 전 노트를 언급해
// 고아가 항상 0건이던 무력화 상태 — 여기서는 index/README를 참조 소스에서 뺀다.
// 정리 후보 보고까지만 자동이고, 실제 수정·삭제는 사람 PR 전용 (vault 리뷰 경계).
import { readFileSync } from 'node:fs'
import { basename, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isUnhelpful, listMarkdownFiles, loadFeedback, toTitle } from './wiki-query.mjs'

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

/** severity별 감점 합산 → 0~100 헬스 스코어. 순수 함수. */
export function healthScore(issues) {
  return Math.max(0, 100 - issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0))
}

/**
 * 리포트 조립 — notes: [{file, title, body}], feedback: { <제목>: {up, down} }.
 * 순수 함수 (테스트 대상). WikiLintReport(src/shared/types.ts) 형태를 돌려준다.
 */
export function lintVault({ notes, feedback, generatedAt }) {
  const knowledge = notes.filter((n) => basename(n.file) !== CASE_LOG)
  const orphanNotes = findOrphans(notes)
  const unhelpfulNotes = knowledge.filter((n) => isUnhelpful(feedback[n.title])).map((n) => n.title)

  const issues = [
    ...unhelpfulNotes.map((t) => ({
      severity: 'warn',
      note: t,
      message: '부정 피드백(원인 불일치) 누적 — 정리 후보. 수정·삭제는 사람이 PR로'
    })),
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

/** I/O 래퍼 — 서버 vault를 읽어 lintVault를 돌린다. vault에는 아무것도 쓰지 않는다. */
export function lintWiki() {
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
  return lintVault({ notes, feedback: loadFeedback(), generatedAt: new Date().toISOString() })
}
