// Jenkins 소스 어댑터의 순수 추출 로직 (server/jenkins.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractBuildUrl, shardLinksIn, tcSectionIn } from '../server/jenkins.mjs'

test('extractBuildUrl: 빌드 URL 형태만 뽑는다', () => {
  assert.equal(
    extractBuildUrl('build: https://jenkins.example.com/job/team-ci/1234/ failed'),
    'https://jenkins.example.com/job/team-ci/1234/'
  )
  // Jira wiki markup [텍스트|url]
  assert.equal(
    extractBuildUrl('[빌드|https://jenkins.example.com/job/team-ci/1234/console]'),
    'https://jenkins.example.com/job/team-ci/1234/'
  )
  // 중첩 폴더 잡 + 뒤 슬래시 없음
  assert.equal(
    extractBuildUrl('see https://j.example.com/job/platform/job/ci/567'),
    'https://j.example.com/job/platform/job/ci/567'
  )
  // 빌드 번호 없는 링크·browse 링크는 무시
  assert.equal(extractBuildUrl('https://jira.example.com/browse/KITT-1'), null)
  assert.equal(extractBuildUrl('no links here'), null)
})

test('shardLinksIn: CI TEST RESULT 링크만, 자기 자신 제외', () => {
  const desc = [
    'CI_MAIN_JOB Resource: n132',
    'CI TEST RESULT : http://10.0.0.1:8100/job/CI_TEST/163871/',
    '- CI TEST REPORT URL : http://10.0.0.1/ci/tc/reportUrl/163871',
    'CI TEST RESULT : http://10.0.0.1:8100/job/CI_TEST/163867/'
  ].join('\n')
  assert.deepEqual(shardLinksIn(desc, 'http://10.0.0.1:8100/job/CI_MAIN_JOB/176924'), [
    'http://10.0.0.1:8100/job/CI_TEST/163871/',
    'http://10.0.0.1:8100/job/CI_TEST/163867/'
  ])
})

test('shardLinksIn: HTML 앵커로 감싸이면 일반 /job/ URL 폴백 (히스토리 링크 제외)', () => {
  const html =
    "CI TEST RESULT : <a href='http://h:8100/job/CI_TEST/1/'>report</a>" +
    "<a href='http://h:8100/job/CI_MAIN_JOB/8/'>#8</a>"
  const links = shardLinksIn(html, 'http://h:8100/job/CI_MAIN_JOB/9/')
  assert.ok(links.includes('http://h:8100/job/CI_TEST/1/'))
  // 같은 잡(CI_MAIN_JOB)의 다른 빌드는 자기 자신이 아니므로 여기서는 남는다 —
  // 호출부(fetchFailureLog)가 sameJob 필터를 추가로 적용한다.
  assert.ok(!links.includes('http://h:8100/job/CI_MAIN_JOB/9/'), '자기 자신은 제외')
})

// 실콘솔 구조: [ENABLE] 마커로 TC들이 직렬 실행되고 실패 판정은 구간 끝
const CONSOLE = [
  '[ENABLE] [190 /380] power-cpufreq-009.sh',
  'Test Result: PASS',
  '[ENABLE] [191 /380] power-dtm-160.sh',
  '=====',
  './power-dtm-160.sh',
  'Test Result: FAIL',
  'Fail Log: unsupported SOC.',
  '[ENABLE] [192 /380] power-ect-281.sh',
  'Test Result: PASS'
].join('\n')

test('tcSectionIn: 티켓 TC명으로 해당 구간만 (다음 마커 직전까지)', () => {
  const section = tcSectionIn(CONSOLE, 'linux.power-dtm-160.sh') // linux. 접두사는 콘솔에 없음
  assert.ok(section.startsWith('[ENABLE] [191'))
  assert.ok(section.includes('Fail Log: unsupported SOC.'))
  assert.ok(!section.includes('power-ect-281'), '다음 TC 구간이 섞이면 안 된다')
  assert.ok(!section.includes('power-cpufreq-009'), '이전 TC 구간이 섞이면 안 된다')
})

test('tcSectionIn: python. 접두사 + 콘솔의 I- 접두사 조합도 매칭된다', () => {
  const c = '[ENABLE] [58 / 86] I-sfi_eth_24303.py\nTest Result: FAIL\nFail Log: timeout'
  const section = tcSectionIn(c, 'python.sfi_eth_24303.py')
  assert.ok(section?.includes('Fail Log: timeout'))
})

test('tcSectionIn: TC명 없음/마커 없음 → null (호출부가 꼬리 폴백)', () => {
  assert.equal(tcSectionIn(CONSOLE, undefined), null)
  assert.equal(tcSectionIn(CONSOLE, 'linux.not-in-console-000.sh'), null)
  assert.equal(tcSectionIn('no markers at all', 'linux.power-dtm-160.sh'), null)
})

test('tcSectionIn: 병리적으로 긴 구간(>500KB)은 머리+꼬리로 압축, 판정부 보존', () => {
  const huge =
    '[ENABLE] [1 /1] big-tc-001.sh\n' + 'noise\n'.repeat(120000) + 'Test Result: FAIL\nFail Log: at the very end'
  const section = tcSectionIn(huge, 'linux.big-tc-001.sh')
  assert.ok(section.length < huge.length)
  assert.ok(section.includes('(중략'))
  assert.ok(section.startsWith('[ENABLE]'), '머리(실행 시작부) 보존')
  assert.ok(section.includes('Fail Log: at the very end'), '꼬리(실패 판정부) 보존')
})
