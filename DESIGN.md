---
omd: 0.1
brand: SVP (Sheriff aVatar Project)
bootstrapped_from: raycast
bootstrapped_at: "2026-07-22"
verified_against_implementation: "2026-07-30"
---

# SVP Design System — "Glass Ledger"

실제 구현 기준 문서. 소스는 `src/renderer/src/styles/global.css`(메인 창), `styles/toast.css`(토스트 창),
`src/main/index.ts`(창 크기·글래스 모드). 코드와 어긋나면 코드가 정답 — 이 문서를 그 PR에서 고친다.

## 1. Visual Theme

Floating translucent panels over the window's acrylic material (Windows 11 desktop
blur-behind). The canvas is a blue-cold near-black (`#07080a` undertone); panels are
glass tones separated by hairlines, not boxed groups. Two faint light sources give the
void its atmosphere: a warm lamplight halo top-left (home of the brass star) and a cold
blue bloom bottom-right.

The brass sheriff star is the single warm mark on the cold canvas: confidence > 80 wears
a filled brass badge (auto-routed), <= 80 stays unstamped (the sheriff steps in).
Signal Red (`--vermilion`) punctuates — critical severity and disconnects only.

## 2. Color Palette (`global.css :root`)

### Text & ink
- `--lamplight` `#f9f9f9` — primary text
- `--paper` `#cecece` — secondary text
- `--dust` `#9c9c9d` — tertiary text, labels, placeholders
- `--ink-deep` `#18191a` — dark text on light surfaces (primary CTA text)

### Accents
- `--brass` `#d9a441`, gradient `#eec25e → #b8842a` (160deg) — the sole warm brand
  element: star mark/badge, titlebar wordmark, sheriff role, unread dots. Never for
  interactive states.
- `--brass-dim` `rgba(217, 164, 65, 0.16)` — toast-focus highlight tint on rows
- `--vermilion` `#ff6363` — critical severity, disconnected, errors
- `--sky` `#55b3ff` — interactive: focus rings, selection, search glow, wiki refs
- `--turquoise` `#5fc992` — resolved, connected (green despite the name)

### Glass layers (over the acrylic void)
- `--glass` `rgba(9, 10, 13, 0.55)` — sheet material (workspace, compact, palette)
- `--glass-raised` `rgba(255, 255, 255, 0.06)` — raised tiles, cards, inputs
- `--glass-hover` `rgba(255, 255, 255, 0.09)` — hover tone
- `--hair` `rgba(255, 255, 255, 0.09)` / `--hair-faint` `rgba(255, 255, 255, 0.055)` —
  hairline borders; the only section dividers inside a sheet
- Canvas: `body` paints `rgba(7, 8, 10, 0.4)` over the acrylic; solid mode window is
  `#161618`; frameless panels use a denser `rgba(10, 11, 14, 0.94)`

### StatusBoard (당번 전용 현황판)
- warn `#f5b23a` · info `--sky` · good `#6fcf7f` — module status segments/counts
- source badges: gerrit `#ffa500`, wiki `--sky`, case-log `#78dc78` (case-log는 타입 예약값 — 현재 런타임 미발생)

## 3. Typography

Fonts are **bundled** (`src/renderer/src/assets/fonts/`, offline-safe):

- `--font-body`: `'Pretendard Variable'` (variable 45–920) → `'Segoe UI'`, `'Malgun Gothic'`
- `--font-mono`: `'JetBrains Mono'` (400/700) → `'Cascadia Mono'`, `Consolas`

Global body: letter-spacing `+0.2px`, `font-feature-settings: 'calt','kern','liga','ss03'`,
antialiased. Positive tracking on dark is deliberate — airy, readable. Large display
figures reverse it (negative tracking) to stay dense.

### Actual type scale

| Role | Font | Size / Weight | Notes |
|---|---|---|---|
| Stat figure (cockpit) | body | 44px / 600 | tabular-nums, tracking −1.5px |
| Login title | body | 30px / 650 | tracking −0.5px |
| Empty-state title | body | 26px / 600 | watchtower |
| Lane count | body | 22px / 650 | tabular-nums |
| Cockpit name | body | 20px / 650 | |
| Detail title | body | 16px / 650 | |
| Palette input | body | 15px / 400 | |
| Card title | body | 14px / 600 | 2-line clamp; is-new → 700 |
| Compact item title | body | 13px / 500 | |
| Body / detail text | body | 12.5px / 400 | line-height 1.6 |
| Buttons | body | 12px / 600 | |
| Section labels | mono | 9.5–11px / 700 | UPPERCASE, tracking +1.4–1.6px |
| Ticket key, timestamps | mono | 10–10.5px | issue identity everywhere |
| Star badge number | mono | 10.5–14px / 700 | confidence score |

Mono carries all "instrument" text: titlebar wordmark, lane titles, roles, detail
labels, ws-status, key caps. UI strings are Korean; identifiers/comments English.

## 4. Components

**Buttons (`.btn`)** — glass pill: radius 999px, `--glass-raised` bg, hair border,
inset top highlight `rgba(255,255,255,0.1) 0 1px 0 inset`. Hover = opacity 0.6 (no
color swap). `.btn-primary` (로그인, "티켓 확인 ↗"): `rgba(255,255,255,0.815)` bg,
`--ink-deep` text, hover to full white.

**Search (`.search`)** — quiet glass pill; focus blooms the signature blue:
border `rgba(85,179,255,0.4)` + ring `0 0 0 3px rgba(85,179,255,0.12)`.

**Issue card (`.row-line`)** — floating glass tile in a lane: radius 14px,
`--glass-raised`, hair border, inset top light. Hover lifts (`translateY(-1px)` + drop
shadow); selection tints blue (`rgba(85,179,255,0.12)` + sky ring). Resolved: opacity
0.45 + strike-through. New: bold title + brass unread dot.

**Star badge (`.star-badge`)** — clip-path star, mono score inside. `.high` = brass
gradient + brass drop-shadow halo (clip-path swallows box-shadow, so `filter:
drop-shadow`); `.low` = unstamped `rgba(255,255,255,0.1)`.

**Key caps (`.kbd`)** — gradient `#121212 → #0d0d0d`, press shadow pair (outer dark +
inset top light/bottom dark), radius 5px. Used for ⌘K affordance and palette hints.

**Command palette (`.cmdk`)** — Ctrl+K overlay; Level 5 floating sheet, blue active row.

## 5. Layout — role is the layout

창 두 종(고정 컨셉, 웹 브레이크포인트 없음). 로그인 시 서버가 role을 판정하고 창이 전환된다
(`src/main/index.ts WINDOW_SIZE`):

- **Member — CompactView, 420×640** (min 380×520): single glass sheet companion.
  Header (connection + notify toggle) → 배정된 이슈 feed. Sheriff-only actions are
  hidden, not grayed. Login gate uses this size.
- **Sheriff — dashboard, 1440×700** (min 1080×560): no outer sheet — the canvas bleeds
  edge-to-edge. Top-down: **Cockpit** deck (brass star + identity, 3 oversized stat
  tiles mirroring the lanes, connection/notify) → toolbar (search + palette + wiki) →
  **triage board**: three lanes (확인 필요 / auto-routed / resolved), tone-only
  distinction. **StatusBoard** (전체 현황) collapses above the board. **DetailPanel**
  is the single detached floating element — fixed right, 340px, overlaying the board.
- **Toast** — separate frameless always-on-top window, 384×136, stacked bottom-right
  above the taskbar, 9s TTL, brass left border (`toast.css`).

**Glass modes** (`SVP_GLASS`, `src/main/index.ts`): `acrylic` (default on Win11 —
desktop blur-behind), `solid` (pre-Win11 fallback / screen recording, `#161618`),
`frameless` (transparent window experiment — panels get denser tint + 40px radius,
pill titlebar). One internal media query (≤900px) stacks the board to one column.

**Radius scale**: 999px pills · 5px key caps · 8–10px small controls · 14px cards ·
16px tiles/plaques · 18px lanes · 22px toast · 24px detail/palette/login · 32px
compact sheet · 40px frameless silhouettes.

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| 0 Void | no shadow, acrylic canvas | window background |
| 1 Raised | `--glass-raised` + hair border + `inset 0 1px 0 rgba(255,255,255,0.04–0.06)` | tiles, cards, inputs |
| 2 Sheet | `0 24px 60px rgba(0,0,0,0.45)` + inset top light, `blur(28px) saturate(1.25)` | compact sheet, frameless workspace |
| 3 Hover | `translateY(-1px)`, `0 10px 22px rgba(0,0,0,0.32)` + hair ring | card hover lift |
| 4 Floating | ring `0 0 0 1px rgba(255,255,255,0.09)` + `0 40px 90px rgba(0,0,0,0.65)` + glow `0 0 24px rgba(255,255,255,0.07)` + inset top, `blur(36px)` | detail panel, command palette |
| Brass halo | `drop-shadow(0 0 7–14px rgba(238,194,94,0.32–0.4))` | star badge/high, cockpit star |

Shadows come in pairs: outer depth + inset top highlight (light from above). Elements
read as glass, not flat rectangles.

## 7. Do's and Don'ts

### Do
- Keep the blue-cold near-black canvas — never pure black
- Positive letter-spacing (+0.2px) on body text; negative only on large figures
- Pair every outer shadow with an inset top highlight
- Keep brass for brand/identity only; `--sky` owns every interactive state
- Keep `--vermilion` as punctuation — critical severity and disconnects
- Hairlines (`--hair-faint`) as dividers inside sheets — no boxed sub-groups
- Hover via opacity 0.6, not color swaps
- Use the bundled fonts (Pretendard Variable / JetBrains Mono) — offline-safe by design

### Don't
- Add warm tones beyond brass — the star is the sole warm exception
- Use box-shadow on clip-path stars (swallowed) — use `filter: drop-shadow`
- Distinguish lanes/tiles with color — tone (alpha) and label only
- Add decorative gradients beyond the two ambient light blooms

## 8. Voice & Tone

Prosumer-confident, keyboard-first. Concise, capability-driven, never marketing-fluff.
UI strings Korean; identifiers/comments English (project rule).

| Context | Tone |
|---|---|
| CTA | Verb. "확인", "해결 완료", "배정" |
| Dashboard | Dense facts, no filler |
| Error | Specific. "서버에 연결할 수 없습니다 — 서버 상태를 확인하세요" |

Forbidden: "혁신적인 자동화", vague reassurances without a specific cause.

## 9. States (as implemented)

| State | Treatment |
|---|---|
| Empty board | watchtower: breathing star + "감시 중 — 이슈 대기" |
| Empty search | "『검색어』 결과 없음" + "다른 키워드를 시도해보세요" |
| Empty lane / compact | mono caption ("배정된 이슈가 없습니다") |
| Connection | ws dot: `--turquoise` connected · brass pulse connecting · `--vermilion` disconnected |
| New issue | bold title + brass dot (pulses ×3); high-confidence gets the star-stamp animation |
| Resolved | strike-through + fade to opacity 0.45 |
| Member view | sheriff-only actions hidden, not grayed |

## 10. Motion

| Duration | Use |
|---|---|
| 120ms | micro (window buttons, palette rows) |
| 150ms | hover/focus — **opacity 0.6 hover is signature** |
| 250ms | panel slide-in, star stamp (overshoot bezier `0.34, 1.56, 0.64, 1`) |
| 280ms | card reveal, staggered 30ms/row (capped at 10) |
| 300ms | resolve fade, toast slide-in |
| ambient | star breathe 4.5–5s, connecting pulse 1.2s |

`prefers-reduced-motion: reduce` kills all animation/transition globally. Card reveal
is failsafe: cards are visible by default and only animate when JS marks `html.js-ready`
— a JS failure never leaves the board blank.
