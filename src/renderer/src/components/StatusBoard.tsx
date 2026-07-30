import { useState } from 'react'
import type { WikiLintReport } from '@shared/types'
import type { DashboardStats } from '../stats'

interface Props {
  stats: DashboardStats
  /** 서버 lint 결과 — 로그인 시 자동 실행, null이면 아직 점검 중이거나 실패. */
  lint: WikiLintReport | null
  lintFailed: boolean
  onLintRefresh: () => void
}

const OPEN_KEY = 'svp.dashboard.open'

function healthTone(score: number): string {
  return score >= 80 ? 'good' : score >= 50 ? 'warn' : 'crit'
}

/** 당번 전용 상세 현황 — 모듈별 상태 · 추정 중복 · 위키 헬스. 요약 수치는 Cockpit 데크가 담당한다. */
export default function StatusBoard({ stats: s, lint, lintFailed, onLintRefresh }: Props) {
  const maxTotal = Math.max(1, ...s.modules.map((m) => m.total))
  // 접힘 상태는 localStorage에 저장 — 당번이 한번 접으면 유지된다. 기본 펼침.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const toggle = (): void =>
    setOpen((v) => {
      const next = !v
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      } catch {
        /* localStorage 불가 환경 — 무시 */
      }
      return next
    })

  return (
    <section className="statusboard" aria-label="모듈 · 중복 현황">
      <div className="sb-head">
        <button
          className="sb-toggle"
          onClick={toggle}
          aria-expanded={open}
          title={open ? '현황 접기' : '현황 펼치기'}
        >
          <span className={`sb-chev${open ? ' open' : ''}`} aria-hidden="true">
            ▾
          </span>
          <span className="sb-head-title">전체 현황</span>
        </button>
        {lint?.healthScore !== undefined && (
          <span
            className={`sb-health ${healthTone(lint.healthScore)}`}
            title={`위키 헬스 스코어 — 노트 ${lint.noteCount}개 기준 (스키마·고아·부정 신호 종합)`}
          >
            위키 {lint.healthScore}/100
          </span>
        )}
        {!open && (
          <span className="sb-head-summary">
            모듈 {s.modules.length}개
            {s.dupGroups.length > 0 ? ` · 추정 중복 ${s.dupGroups.length}그룹` : ''}
          </span>
        )}
      </div>

      {open && (
        <>
          {s.modules.length > 0 && (
            <div className="sb-block">
              <div className="sb-modhead">
                <span className="sb-sub">모듈별 현황</span>
                <span className="sb-legend">
                  <span className="lg">
                    <i className="dot warn" />당번 대기
                  </span>
                  <span className="lg">
                    <i className="dot info" />자동 배정
                  </span>
                  <span className="lg">
                    <i className="dot good" />해결
                  </span>
                </span>
              </div>
              <div className="sb-modules">
                {s.modules.map((m) => (
                  <div className="sb-mod" key={m.module}>
                    <span className="sb-mod-name" title={m.module}>
                      {m.module}
                    </span>
                    <span className="sb-track" title={`전체 ${m.total}`}>
                      <span className="sb-fill" style={{ width: `${(m.total / maxTotal) * 100}%` }}>
                        {m.sheriffWaiting > 0 && (
                          <span className="seg warn" style={{ flexGrow: m.sheriffWaiting }} />
                        )}
                        {m.autoAssigned > 0 && (
                          <span className="seg info" style={{ flexGrow: m.autoAssigned }} />
                        )}
                        {m.resolved > 0 && (
                          <span className="seg good" style={{ flexGrow: m.resolved }} />
                        )}
                      </span>
                    </span>
                    <span className="sb-counts">
                      <b className={`c warn${m.sheriffWaiting ? '' : ' zero'}`}>{m.sheriffWaiting}</b>
                      <b className={`c info${m.autoAssigned ? '' : ' zero'}`}>{m.autoAssigned}</b>
                      <b className={`c good${m.resolved ? '' : ' zero'}`}>{m.resolved}</b>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.dupGroups.length > 0 && (
            <div className="sb-block">
              <div className="sb-sub">추정 중복 — 같은 실패 서명</div>
              <div className="sb-dups">
                {s.dupGroups.map((g) => (
                  <div className="sb-dup" key={g.signature}>
                    <span className="sb-dup-badge">{g.keys.length}건</span>
                    <span className="sb-dup-mod">{g.module}</span>
                    <span className="sb-dup-keys" title={g.keys.join(', ')}>
                      {g.keys.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
              <p className="sb-note">
                서명 기반 추정 — flaky·별개 회귀일 수 있어 병합은 당번이 확인 후 Jira에서 처리
              </p>
            </div>
          )}

          <div className="sb-block">
            <div className="sb-modhead">
              <span className="sb-sub">
                위키 점검{lint ? ` — 노트 ${lint.noteCount}개` : ''}
              </span>
              <button className="sb-refresh" onClick={onLintRefresh} title="서버 vault 재점검">
                ↻
              </button>
            </div>
            {lintFailed ? (
              <p className="sb-note">서버 응답 없음 — 연결 상태 확인 후 ↻로 재시도</p>
            ) : !lint ? (
              <p className="sb-note">점검 중…</p>
            ) : (lint.issues ?? []).length === 0 ? (
              <p className="sb-note">정리할 노트 없음</p>
            ) : (
              <ul className="lint-list">
                {(lint.issues ?? []).map((it, idx) => (
                  <li key={`${it.note}-${idx}`}>
                    <span className={`lint-sev lint-sev-${it.severity}`}>{it.severity}</span>{' '}
                    <button className="lint-note" onClick={() => window.svp.openWiki(it.note)}>
                      {it.note}
                    </button>{' '}
                    — {it.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}
