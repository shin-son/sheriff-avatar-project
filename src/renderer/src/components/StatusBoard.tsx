import { useState } from 'react'
import type { SheriffIssue } from '@shared/types'
import { deriveStats } from '../stats'

interface Props {
  issues: SheriffIssue[]
}

const OPEN_KEY = 'svp.dashboard.open'

/** 당번 전용 전체 현황 — 처리 상태 · 모듈별 · 추정 중복. issues에서 파생만 한다. */
export default function StatusBoard({ issues }: Props) {
  const s = deriveStats(issues)
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
    <section className="statusboard" aria-label="전체 현황">
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
        {!open && (
          <span className="sb-head-summary">
            당번 {s.sheriffWaiting} · 자동 {s.autoAssigned} · 해결 {s.resolved}
            {s.dupIssueCount > 0 ? ` · 중복 ${s.dupIssueCount}` : ''}
          </span>
        )}
      </div>

      {open && (
        <>
          <div className="sb-tiles">
        <Tile label="전체" value={s.total} />
        <Tile label="당번 대기" value={s.sheriffWaiting} tone="warn" />
        <Tile label="자동 배정" value={s.autoAssigned} tone="info" />
        <Tile label="해결" value={s.resolved} tone="good" />
        <Tile
          label="추정 중복"
          value={s.dupIssueCount}
          sub={s.dupGroups.length ? `${s.dupGroups.length}그룹` : undefined}
          tone={s.dupGroups.length ? 'warn' : undefined}
        />
        {s.critical > 0 && <Tile label="critical" value={s.critical} tone="crit" />}
      </div>

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
        </>
      )}
    </section>
  )
}

function Tile({
  label,
  value,
  sub,
  tone
}: {
  label: string
  value: number
  sub?: string
  tone?: string
}) {
  return (
    <div className={`sb-tile${tone ? ` tone-${tone}` : ''}`}>
      <span className="sb-tile-val">{value}</span>
      <span className="sb-tile-label">
        {label}
        {sub ? <em> · {sub}</em> : null}
      </span>
    </div>
  )
}
