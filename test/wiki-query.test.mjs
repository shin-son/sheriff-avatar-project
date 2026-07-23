// vault 검색·owner 해석 (server/wiki-query.mjs) — 임시 vault로 격리.
// SVP_WIKI_DIR은 모듈 로드 시점에 읽히므로 env 설정 후 dynamic import 한다.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const vault = mkdtempSync(join(tmpdir(), 'svp-vault-'))
process.env.SVP_WIKI_DIR = vault

let wiki
before(async () => {
  mkdirSync(join(vault, 'modules'), { recursive: true })
  writeFileSync(
    join(vault, 'modules', 'auth.md'),
    ['---', 'type: module', 'module: auth', 'owner: alice', '---', '', '# auth 모듈', '', 'LoginFlowTest 401 known-failure'].join('\n')
  )
  // 사내 vault에 실존하는 오염원: 스킬 지침 문서 (query 대상이면 안 된다)
  mkdirSync(join(vault, '.claude', 'skills', 'jql'), { recursive: true })
  writeFileSync(join(vault, '.claude', 'skills', 'jql', 'SKILL.md'), '# SKILL\nauth 관련 지침')
  // 자동 생성 인프라 파일도 제외 대상
  writeFileSync(join(vault, 'index.md'), '# Index\nauth')
  wiki = await import('../server/wiki-query.mjs')
})

test('queryWiki: module 키워드로 노트를 찾는다', () => {
  const r = wiki.queryWiki({ module: 'auth', title: 'LoginFlowTest token refresh 실패' })
  assert.deepEqual(r.map((m) => m.file), ['modules/auth.md'])
})

test('queryWiki: 숨김 폴더(.claude 등)와 index.md는 검색 대상이 아니다', () => {
  const r = wiki.queryWiki({ module: 'auth', title: 'auth' })
  assert.ok(r.every((m) => !m.file.includes('.claude')), '스킬 문서가 분류 근거로 새면 안 된다')
  assert.ok(r.every((m) => m.file !== 'index.md'))
})

test('resolveOwner: 노트 frontmatter의 owner를 해석한다', () => {
  assert.equal(wiki.resolveOwner('auth'), 'alice')
  assert.equal(wiki.resolveOwner('unknown-module'), null)
})
