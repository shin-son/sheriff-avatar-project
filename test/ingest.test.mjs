// F7 ingest 멱등성 (server/ingest.mjs) — raw/jira/<key>.md 존재가 멱등 키.
// SVP_WIKI_DIR은 모듈 로드 시점에 읽히므로 env 설정 후 dynamic import 한다.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const vault = mkdtempSync(join(tmpdir(), 'svp-vault-'))
process.env.SVP_WIKI_DIR = vault

let ingest
before(async () => {
  ingest = await import('../server/ingest.mjs')
})

test('alreadyIngested: raw/jira 동결본 존재 여부가 멱등 키다 (재시작에도 유지)', () => {
  assert.equal(ingest.alreadyIngested('KITT-1'), false)
  mkdirSync(join(vault, 'raw', 'jira'), { recursive: true })
  writeFileSync(join(vault, 'raw', 'jira', 'KITT-1.md'), '---\ntype: raw\n---\n')
  assert.equal(ingest.alreadyIngested('KITT-1'), true)
  assert.equal(ingest.alreadyIngested('KITT-2'), false)
})

test('INGEST_MODE: 기본은 dry-run (vault 보호)', () => {
  assert.equal(ingest.INGEST_MODE, 'dry-run')
})
