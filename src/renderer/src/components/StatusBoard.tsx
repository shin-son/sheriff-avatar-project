import type { SheriffIssue } from '@shared/types'
import { deriveStats } from '../stats'

interface Props {
  issues: SheriffIssue[]
}

/** 당번 전용 전체 현황 — 처리 상태 · 모듈별 · 추정 중복. issues에서 파생만 한다. */
export default function StatusBoard({ issues }: Props) {
  const s = deriveStats(issues)
  const maxTotal = Math.max(1, ...s.modules.map((m) => m.total))

  return (
    <section className="statusboard" aria-label="전체 현황">
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
