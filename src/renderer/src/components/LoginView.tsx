import { useState } from 'react'

/**
 * Login gate (SVP-5 전 데모 인증) — the server validates credentials and
 * answers with the user's role; the app renders member/sheriff view from it.
 */
export default function LoginView() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || busy) return
    setBusy(true)
    setError(null)
    const result = await window.svp.login(username, password)
    if (!result.ok) {
      setError(result.error ?? '로그인에 실패했습니다')
      setBusy(false)
    }
    // Success: main flips authed and pushes state:refresh — App re-renders.
  }

  return (
    <div className="login">
      <span className="brand-star" aria-hidden="true" />
      <h1 className="login-title">Sheriff Avatar</h1>
      <p className="login-sub">서버 로그인 — 역할(당번/팀원)은 서버가 판정합니다</p>
      <form className="login-form" onSubmit={submit}>
        <input
          className="login-input"
          placeholder="아이디"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <input
          className="login-input"
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn btn-primary login-btn" type="submit" disabled={busy}>
          {busy ? '접속 중…' : '로그인'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}
