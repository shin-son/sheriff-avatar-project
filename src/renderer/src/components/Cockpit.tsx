import type { TeamMember, UserConfig, WsStatus } from '@shared/types'

const WS_LABEL: Record<WsStatus, string> = {
  connected: 'CI/CD 연결됨',
  connecting: '연결 중…',
  disconnected: '연결 끊김 — 재시도 중'
}

interface Props {
  team: TeamMember[]
  user: UserConfig
  wsStatus: WsStatus
  muted: boolean
  /** Lane counts — these three figures mirror the triage board below. */
  counts: { triage: number; stream: number; done: number }
  onToggleMuted: () => void
}

/**
 * Horizontal operator deck across the top of the workspace (replaces the old
 * left sidebar). Identity + team presence on the left, an oversized status deck
 * whose three figures mirror the board lanes, connection + notify controls right.
 */
export default function Cockpit({ team, user, wsStatus, muted, counts, onToggleMuted }: Props) {
  const me = team.find((m) => m.id === user.userId)
  return (
    <header className="cockpit">
      <div className="cockpit-id">
        <span className="brand-star cockpit-star" aria-hidden="true" />
        <div className="cockpit-who">
          <span className={`cockpit-role ${user.role}`}>
            {user.role === 'sheriff' ? '당번 · SHERIFF' : '팀원 · MEMBER'}
          </span>
          <span className="cockpit-name">{me?.name}</span>
          {/* 로그인이 신원을 결정한다 (v3) — 명단은 표시만, 전환 없음 */}
          <div className="cockpit-team">
            {team.map((m) => (
              <span
                key={m.id}
                className={`avatar ${m.role === 'sheriff' ? 'is-sheriff' : ''}`}
                title={`${m.name} — ${m.ownedModules.join(' · ')}`}
              >
                {m.name.charAt(0)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Oversized status deck — the first-class visual element, readable even at 0. */}
      <div className="cockpit-stats">
        <div className="stat-tile hero">
          <span className="stat-num">{counts.triage}</span>
          <span className="stat-label">확인 필요</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{counts.stream}</span>
          <span className="stat-label">자동 배정</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{counts.done}</span>
          <span className="stat-label">해결</span>
        </div>
      </div>

      <div className="cockpit-aside">
        <div className={`ws-status ${wsStatus}`}>
          <span className="dot" /> {WS_LABEL[wsStatus]}
        </div>
        <button
          className={`notify-toggle ${muted ? 'off' : ''}`}
          title={muted ? '알림 팝업 다시 켜기' : '알림 팝업 끄기 (이슈는 목록에 계속 쌓임)'}
          onClick={onToggleMuted}
        >
          <span className="dot" /> {muted ? '알림 꺼짐' : '알림 켜짐'}
        </button>
      </div>
    </header>
  )
}
