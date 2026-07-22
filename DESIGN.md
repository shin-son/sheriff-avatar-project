---
omd: 0.1
brand: SVP (Sheriff aVatar Project)
bootstrapped_from: raycast
bootstrapped_at: "2026-07-22"
---

# Design System Inspiration of SVP

## 1. Visual Theme & Atmosphere

SVP's dashboard feels like the dark interior of a precision instrument — a Swiss watch case carved from obsidian. The background isn't just dark, it's an almost-black blue-tint (`#07080a`) that creates a sense of being inside a macOS native application rather than a web page. Every surface, every border, every shadow is calibrated to evoke the feeling of a high-performance desktop utility: fast, minimal, trustworthy.

The signature move is the layered shadow system borrowed from macOS window chrome: multi-layer box-shadows with inset highlights that simulate physical depth, as if issue cards and buttons are actual pressed or raised glass elements on a dark desk. Combined with Signal Red (`#FF6363`) — deployed almost exclusively for critical-severity issues and destructive moments — the palette creates a tool that reads as "powerful instrument with personality." The red doesn't dominate; it punctuates. The brass sheriff star remains the single warm brand mark on the cold canvas.

Inter is used everywhere — headings, body, buttons, captions — with extensive OpenType features (`calt`, `kern`, `liga`, `ss03`) creating a consistent, readable typographic voice. The positive letter-spacing (0.2px–0.4px on body text) is unusual for a dark UI and gives the text an airy, breathable quality that counterbalances the dense, dark surfaces. GeistMono appears for issue keys and log excerpts, reinforcing the developer-tool identity.

**Key Characteristics:**
- Near-black blue-tinted background (`#07080a`) — not pure black, subtly blue-shifted
- macOS-native shadow system with multi-layer inset highlights simulating physical depth
- Signal Red (`#FF6363`) as a punctuation color — critical issues, not pervasive
- Inter with positive letter-spacing (0.2px) for an airy, readable dark-mode experience
- Subtle rgba white borders (0.06–0.1 opacity) for containment on dark surfaces
- Keyboard shortcut styling with gradient key caps and heavy shadows

## 2. Color Palette & Roles

### Primary
- **Near-Black Blue** (`#07080a`): Primary window background — the foundational void with a subtle blue-cold undertone
- **Pure White** (`#ffffff`): Primary heading text, high-emphasis elements
- **Signal Red** (`#FF6363` / `hsl(0, 100%, 69%)`): Critical accent — critical severity, danger states, destructive highlights

### Secondary & Accent
- **Interactive Blue** (`hsl(202, 100%, 67%)` / ~`#55b3ff`): Interactive accent — links, focus states, selected rows
- **Success Green** (`hsl(151, 59%, 59%)` / ~`#5fc992`): Resolved issues, positive indicators
- **Warning Yellow** (`hsl(43, 100%, 60%)` / ~`#ffbc33`): Warning accents, attention states
- **Blue Transparent** (`hsla(202, 100%, 67%, 0.15)`): Blue tint overlay for interactive surfaces
- **Red Transparent** (`hsla(0, 100%, 69%, 0.15)`): Red tint overlay for danger/error surfaces
- **Brass Star Gold** (`#d9a441`, gradient `#eec25e` → `#b8842a`): The sole warm brand element on the cold canvas — used only for the sheriff star mark, titlebar wordmark, sheriff role badges, and unread dots. Never for interactive states (focus, selection, search use Interactive Blue)

### Surface & Background
- **Deep Background** (`#07080a`): Window canvas, the darkest surface
- **Surface 100** (`#101111`): Elevated surface, card backgrounds
- **Key Start** (`#121212`): Keyboard key gradient start
- **Key End** (`#0d0d0d`): Keyboard key gradient end
- **Card Surface** (`#1b1c1e`): Badge backgrounds, tag fills, elevated containers
- **Button Foreground** (`#18191a`): Dark surface for button text on light backgrounds

### Neutrals & Text
- **Near White** (`#f9f9f9` / `hsl(240, 11%, 96%)`): Primary body text, high-emphasis content
- **Light Gray** (`#cecece` / `#cdcdce`): Secondary body text, descriptions
- **Silver** (`#c0c0c0`): Tertiary text, subdued labels
- **Medium Gray** (`#9c9c9d`): Link default color, secondary navigation
- **Dim Gray** (`#6a6b6c`): Disabled text, low-emphasis labels
- **Dark Gray** (`#434345`): Muted borders, inactive navigation links
- **Border** (`hsl(195, 5%, 15%)` / ~`#252829`): Standard border color for cards and dividers
- **Dark Border** (`#2f3031`): Separator lines, table borders

### Semantic & Accent
- **Error Red** (`hsl(0, 100%, 69%)`): Error states, destructive actions
- **Success Green** (`hsl(151, 59%, 59%)`): Success confirmations, resolved states
- **Warning Yellow** (`hsl(43, 100%, 60%)`): Warnings, attention-needed states
- **Info Blue** (`hsl(202, 100%, 67%)`): Informational highlights, links

### Gradient System
- **Keyboard Key Gradient**: Linear gradient from `#121212` (top) to `#0d0d0d` (bottom) — simulates physical key depth
- **Warm Glow**: `rgba(215, 201, 175, 0.05)` radial spread — subtle warm ambient glow behind featured elements (pairs naturally with the brass star mark)

## 3. Typography Rules

### Font Family
- **Primary**: `Inter` — humanist sans-serif, used everywhere. Fallbacks: `Pretendard Variable` (Korean UI strings), `Inter Fallback`, system sans-serif
- **System**: `SF Pro Text` — Apple system font for select macOS-native UI elements. Fallbacks: `SF Pro Icons`, `Inter`, `Inter Fallback`
- **Monospace**: `GeistMono` — monospace font for issue keys, log excerpts. Fallbacks: `JetBrains Mono`, `ui-monospace`, `SFMono-Regular`, `Roboto Mono`, `Menlo`, `Monaco`
- **OpenType features**: `calt`, `kern`, `liga`, `ss03` enabled globally; `ss02`, `ss08` on display text; `liga` disabled (`"liga" 0`) on hero headings

### Hierarchy

| Role | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|--------|-------------|----------------|-------|
| Display Hero | 64px | 600 | 1.10 | 0px | OpenType: liga 0, ss02, ss08 |
| Section Display | 56px | 400 | 1.17 | 0.2px | OpenType: calt, kern, liga, ss03 |
| Section Heading | 24px | 500 | normal | 0.2px | OpenType: calt, kern, liga, ss03 |
| Card Heading | 22px | 400 | 1.15 | 0px | OpenType: calt, kern, liga, ss03 |
| Sub-heading | 20px | 500 | 1.60 | 0.2px | Relaxed line-height for readability |
| Body Large | 18px | 400 | 1.15 | 0.2px | OpenType: calt, kern, liga, ss03 |
| Body | 16px | 500 | 1.60 | 0.2px | Primary body text, relaxed rhythm |
| Body Tight | 16px | 400 | 1.15 | 0.1px | UI labels, compact contexts |
| Button | 16px | 600 | 1.15 | 0.3px | Semibold, slightly wider tracking |
| Nav Link | 16px | 500 | 1.40 | 0.3px | Links in navigation |
| Caption | 14px | 500 | 1.14 | 0.2px | Small labels, metadata |
| Caption Bold | 14px | 600 | 1.40 | 0px | Emphasized captions |
| Small | 12px | 600 | 1.33 | 0px | Badges, tags, micro-labels |
| Small Link | 12px | 400 | 1.50 | 0.4px | Footer links, fine print |
| Code | 14px (GeistMono) | 500 | 1.60 | 0.3px | Log blocks, technical content |
| Code Small | 12px (GeistMono) | 400 | 1.60 | 0.2px | Inline issue keys, terminal output |

### Principles
- **Positive tracking on dark**: Unlike most dark UIs that use tight or neutral letter-spacing, SVP applies +0.2px to +0.4px — creating an airy, readable feel that compensates for the dark background
- **Weight 500 as baseline**: Most body text uses medium weight (500), not regular (400) — subtle extra heft improves legibility on dark surfaces
- **Display restraint**: Hero text at 64px/600 is confident but not oversized — SVP avoids typographic spectacle in favor of functional elegance
- **OpenType everywhere**: `ss03` (stylistic set 3) is enabled globally across Inter, giving the typeface a slightly more geometric, tool-like quality

## 4. Component Stylings

### Buttons

**Primary Pill**
- Background: transparent
- Text: `#ffffff`
- Radius: 86px (pill)
- Padding: 10px 16px
- Shadow: `rgba(255, 255, 255, 0.1) 0px 1px 0px 0px inset`
- Hover: opacity 0.6
- Use: Primary pill button on dark surfaces

**Secondary**
- Background: transparent
- Text: `#ffffff`
- Border: 1px solid `rgba(255, 255, 255, 0.1)`
- Radius: 6px
- Padding: 8px 14px
- Shadow: `rgba(0, 0, 0, 0.03) 0px 7px 3px`
- Hover: opacity 0.6
- Use: Secondary action

**Ghost**
- Background: transparent
- Text: `#6a6b6c`
- Radius: 86px
- Padding: 10px 16px
- Shadow: `rgba(255, 255, 255, 0.1) 0px 1px 0px 0px inset`
- Hover: opacity 0.6, text brightens to `#ffffff`
- Use: Tertiary action — gray text

**CTA**
- Background: `hsla(0, 0%, 100%, 0.815)`
- Text: `#18191a`
- Radius: 86px (pill)
- Padding: 10px 16px
- Hover: `hsl(0, 0%, 100%)` (full white)
- Use: Primary confirm CTA (배정 확인, 해결 완료) on dark surfaces

### Inputs

**Default**
- Background: `#07080a`
- Text: `#f9f9f9`
- Border: 1px solid `rgba(255, 255, 255, 0.08)`
- Radius: 8px
- Padding: 10px 12px
- Placeholder: `#6a6b6c`
- Focus: border brightens, blue glow `hsla(202, 100%, 67%, 0.15)` ring
- Label: `#9c9c9d` 14px / 500
- Use: Search / login input on dark theme

### Cards

**Standard**
- Background: `#101111`
- Text: `#ffffff`
- Border: 1px solid `rgba(255, 255, 255, 0.06)`
- Radius: 12px
- Padding: 16px
- Use: Default dark card (issue card)

**Elevated**
- Background: `#101111`
- Radius: 16px
- Padding: 20px
- Shadow: `rgb(27, 28, 30) 0px 0px 0px 1px, rgb(7, 8, 10) 0px 0px 0px 1px inset`
- Use: Double-ring elevated card

**Feature**
- Background: `#101111`
- Radius: 20px
- Padding: 24px
- Shadow: `rgba(215, 201, 175, 0.05) 0px 0px 20px 5px` (subtle warm glow)
- Use: Detail panel / featured card with warm glow

### Badges

**Neutral**
- Background: `#1b1c1e`
- Text: `#ffffff`
- Radius: 6px
- Padding: 0px 6px
- Font: 14px / 500
- Use: Issue type / severity badge — compact pill-like treatment

### Keyboard Shortcut Keys
- Key cap: gradient `#121212` → `#0d0d0d`, multi-layer shadow `rgba(0, 0, 0, 0.4) 0px 1.5px 0.5px 2.5px` + inset shadows
- Radius: 4-6px
- Use: Realistic physical key cap rendering for app shortcuts

### Image Treatment
- Log excerpts: macOS window chrome style — rounded corners (12px), deep shadows simulating floating windows
- Full-bleed sections: Dark panels blend seamlessly into the dark background
- App UI embeds: actual issue ledger and detail panel — product as content

### Navigation
- Title bar: Dark background blending with window, white text at 16px weight 500
- Nav links: Gray text (`#9c9c9d`) → white on hover, underline on hover
- CTA: Semi-transparent white pill at nav end
- Sticky: Fixed at top with subtle border separator

## 5. Layout Principles

### Spacing System
- **Base unit**: 8px
- **Scale**: 1px, 2px, 3px, 4px, 8px, 10px, 12px, 16px, 20px, 24px, 32px, 40px
- **Section padding**: 80px–120px vertical between major sections
- **Card padding**: 16px–32px internal spacing
- **Component gaps**: 8px–16px between related elements

### Grid & Container
- **Max width**: ~1200px container, centered
- **Column patterns**: Sidebar + ledger main split, detail panel as detached floating window
- **App showcase**: Product UI presented in centered window frames

### Whitespace Philosophy
- **Dramatic negative space**: Panels float in vast dark void, creating cinematic pacing between zones
- **Dense product, sparse chrome**: The issue ledger is information-dense, but surrounding chrome uses minimal text with generous spacing
- **Vertical rhythm**: Consistent 24px–32px gaps between elements within sections

### Border Radius Scale
- **2px–3px**: Micro-elements, code spans, tiny indicators
- **4px–5px**: Keyboard keys, small interactive elements
- **6px**: Buttons, badges, tags — the workhorse radius
- **8px**: Input fields, inline components
- **9px–11px**: Images, medium containers
- **12px**: Standard cards, panels
- **16px**: Large cards, feature sections
- **20px**: Hero cards, prominent containers
- **24px / 32px / 40px (glass sheets)**: Structural exception above the 20px cap — acrylic glass-sheet silhouettes: 24px for toast and login gate, 32px for workspace/compact/detail sheets, 40px in frameless mode
- **86px+ (999px in CSS)**: Pill buttons, nav CTAs, search fields, badges — full pill shape; `border-radius: 999px` is the standard CSS idiom for this entry

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Level 0 (Void) | No shadow, `#07080a` surface | Window background |
| Level 1 (Subtle) | `rgba(0, 0, 0, 0.28) 0px 1.189px 2.377px` | Minimal lift, inline elements |
| Level 2 (Ring) | `rgb(27, 28, 30) 0px 0px 0px 1px` outer + `rgb(7, 8, 10) 0px 0px 0px 1px inset` inner | Card containment, double-ring technique |
| Level 3 (Button) | `rgba(255, 255, 255, 0.05) 0px 1px 0px 0px inset` + `rgba(255, 255, 255, 0.25) 0px 0px 0px 1px` + `rgba(0, 0, 0, 0.2) 0px -1px 0px 0px inset` | macOS-native button press — white highlight top, dark inset bottom |
| Level 4 (Key) | 5-layer shadow stack with inset press effects | Keyboard shortcut key caps — physical 3D appearance |
| Level 5 (Floating) | `rgba(0, 0, 0, 0.5) 0px 0px 0px 2px` + `rgba(255, 255, 255, 0.19) 0px 0px 14px` + insets | Detail panel, toast — heavy depth with glow |

### Shadow Philosophy
SVP's shadow system is macOS-native. Multi-layer shadows combine:
- **Outer rings** for containment (replacing traditional borders)
- **Inset top highlights** (`rgba(255, 255, 255, 0.05–0.25)`) simulating light source from above
- **Inset bottom darks** (`rgba(0, 0, 0, 0.2)`) simulating shadow underneath
- The effect is physical: elements feel like glass or brushed metal, not flat rectangles

### Decorative Depth
- **Warm glow**: `rgba(215, 201, 175, 0.05) 0px 0px 20px 5px` behind featured elements — a subtle warm aura on the cold dark canvas
- **Blue info glow**: `rgba(0, 153, 255, 0.15)` for interactive state emphasis
- **Red danger glow**: `rgba(255, 99, 99, 0.15)` for error/destructive state emphasis

## 7. Do's and Don'ts

### Do
- Use `#07080a` (not pure black) as the background — the blue-cold tint is essential to the feel
- Apply positive letter-spacing (+0.2px) on body text — this is deliberately different from most dark UIs
- Use multi-layer shadows with inset highlights for interactive elements — the macOS-native depth is signature
- Keep Signal Red (`#FF6363`) as punctuation, not pervasive — reserve it for critical severity and error states
- Use `rgba(255, 255, 255, 0.06)` borders for card containment — barely visible, structurally essential
- Apply weight 500 as the body text baseline — medium weight improves dark-mode legibility
- Use pill shapes (86px+ radius) for primary CTAs, rectangular shapes (6px–8px) for secondary actions
- Enable OpenType features `calt`, `kern`, `liga`, `ss03` on all Inter text
- Use opacity transitions (hover: opacity 0.6) for button interactions, not color changes

### Don't
- Use pure black (`#000000`) as the background — the blue tint differentiates from generic dark themes
- Apply negative letter-spacing on body text — positive spacing is deliberate, for readability
- Use Interactive Blue as the primary accent for everything — blue is for interactive/info, red is the alarm color
- Create single-layer flat shadows — the multi-layer inset system is core to the macOS-native aesthetic
- Use regular weight (400) for body text when 500 is available — the extra weight prevents dark-mode text from feeling thin
- Mix warm and cool borders — stick to the cool gray (`hsl(195, 5%, 15%)`) border palette (the brass star is the sole warm exception)
- Apply heavy drop shadows without inset companions — shadows always come in pairs (outer + inset)
- Use decorative elements, gradients, or colorful backgrounds — the dark void is the stage, content is the performer

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Compact | <600px | Compact member view — single column, stacked issue items |
| Small | 600px–768px | 2-column grid begins |
| Medium | 768px–1024px | Sidebar + ledger, detail panel overlays |
| Desktop | 1024px–1200px | Full layout, all zones visible |
| Large Desktop | >1200px | Max-width container centered, generous side margins |

### Touch Targets
- Pill buttons: 86px radius with 20px padding — well above 44px minimum
- Secondary buttons: 8px padding minimum, but border provides visual target expansion
- Nav links: 16px text with surrounding padding for accessible touch targets

### Collapsing Strategy
- **Navigation**: Full title bar → compact pill title bar in frameless mode
- **Feature grids**: 3-column → 2-column → single-column stack
- **Detail panel**: Detached floating panel → full-overlay at narrow widths
- **Keyboard shortcut displays**: Simplify or hide where keyboard shortcuts are irrelevant

### Image Behavior
- Panels scale responsively within fixed-ratio containers
- macOS window chrome rounded corners maintained at all sizes

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary Background: Near-Black Blue (`#07080a`)
- Primary Text: Near White (`#f9f9f9`)
- Alarm Accent: Signal Red (`#FF6363`)
- Interactive Blue: (`hsl(202, 100%, 67%)` / ~`#55b3ff`)
- Secondary Text: Medium Gray (`#9c9c9d`)
- Card Surface: Surface 100 (`#101111`)
- Border: Dark Border (`hsl(195, 5%, 15%)` / ~`#252829`)
- Brand Mark: brass star gradient (`#eec25e` → `#b8842a`) — sole warm element

### Example Component Prompts
- "Create an issue ledger row on #07080a background with Inter 16px weight 500, near-white text (#f9f9f9), +0.2px letter-spacing, and a 1px rgba(255,255,255,0.06) bottom border"
- "Design an issue card with #101111 background, 1px solid rgba(255,255,255,0.06) border, 12px border-radius, double-ring shadow (rgb(27,28,30) 0px 0px 0px 1px outer), and #9c9c9d meta text"
- "Build a title bar on dark background (#07080a), Inter links at 16px weight 500 in #9c9c9d, hover to white, and a translucent white pill button at the right end"
- "Create a keyboard shortcut display with key caps using gradient background (#121212→#0d0d0d), 5-layer shadow for physical depth, 4px radius, Inter 12px weight 600 text"
- "Design a critical issue card with #101111 surface, Signal Red (#FF6363) left border accent, translucent red glow (hsla(0,100%,69%,0.15)), white heading, and #cecece description text"

### Iteration Guide
When refining existing screens generated with this design system:
1. Check the background is `#07080a` not pure black — the blue tint is critical
2. Verify letter-spacing is positive (+0.2px) on body text — negative spacing breaks the aesthetic
3. Ensure shadows have both outer and inset layers — single-layer shadows look flat and wrong
4. Confirm Inter has OpenType features `calt`, `kern`, `liga`, `ss03` enabled
5. Test that hover states use opacity transitions (0.6) not color swaps — this is a core interaction pattern

## 10. Voice & Tone

SVP's voice is **prosumer-confident and keyboard-first.** Concise, capability-driven, never marketing-fluff. Dark prosumer canvas signals "desktop native, designed for engineers on duty." UI strings are Korean; identifiers and comments are English (project rule).

| Context | Tone |
|---|---|
| CTA | Verb. "확인", "해결 완료", "배정" |
| Dashboard | Capability-list. Dense facts, no filler |
| Documentation | Keyboard-shortcut-heavy, code-block-friendly |
| Error | Specific. "서버 연결이 끊어졌습니다. 재연결 중..." |

**Voice samples**
- Tagline: *"이슈가 당신을 찾아갑니다"* <!-- project working tagline; replace if the team adopts an official one -->

**Forbidden phrases.** "혁신적인 자동화". Vague reassurances without a specific cause.

## 11. Brand Narrative

SVP (Sheriff aVatar Project) started **2026** as an internal 3-person project by **손신, 김병재, 김민석** — engineers sharing a rotation-duty ("sheriff") burden of triaging CI/CD failures by hand. The thesis: **let an LLM classify incoming issues against the team's own LLM-WIKI** (`wiki-vault/`, Obsidian-compatible markdown) and score its confidence 0–100. Confidence above 80 routes the issue straight to the feature owner; at or below 80 the sheriff steps in (human-in-the-loop). Every resolved issue is written back into the wiki, so the next classification has better evidence. The whole team installs the Electron desktop app as an EXE; members see only their own issues, the sheriff sees everything. Implementation deadline **2026-08-01**.

## 12. Principles

1. **Keyboard is the interface.** *UI implication:* every action has a keyboard shortcut documented inline.
2. **Inter with OpenType features.** `calt`, `kern`, `liga`, `ss03`. *UI implication:* don't substitute system fonts (Korean text falls back to Pretendard Variable).
3. **Hover via opacity, not color swap.** *UI implication:* preserve opacity-transition pattern.
4. **Dark prosumer canvas.** *UI implication:* default to dark theme; light theme as secondary.
5. **The wiki is first-class.** *UI implication:* wiki references and confidence evidence get prominent placement in the detail panel, not buried metadata.

## 13. Personas

*Personas are fictional archetypes informed by SVP user roles (sheriff on duty, feature owners), not individual people.*

**당번 (Sheriff).** This week's rotation duty. Sees all issues; handles everything the classifier scored ≤ 80. Lives in the full dashboard view.

**팀원 (Feature owner).** Sees only issues assigned to them. Uses the compact view + toast notifications; wants zero noise.

**신규 합류자.** Reads case-logs in the wiki to learn past failures; relies on the classifier's cited evidence to build context fast.

## 14. States

| State | Treatment |
|---|---|
| **Empty (no issues)** | "이슈가 없습니다" + subdued star mark |
| **Empty (search)** | "검색 결과가 없습니다. 다른 키워드를 시도해보세요." |
| **Loading (classifying)** | Subtle skeleton with maintained dimensions |
| **Loading (wiki query)** | Per-item streaming inline |
| **Error (server)** | Specific error + reconnect indicator |
| **Error (auth)** | Specific cause + re-login flow |
| **Success (assigned)** | Implicit; row appears in ledger |
| **Success (resolved)** | Subtle strike-through + fade to 0.45 opacity |
| **Skeleton (rows)** | Dark-tone placeholders |
| **Disabled (member view)** | Sheriff-only actions hidden, not grayed |
| **Loading (long task)** | Persistent progress |

## 15. Motion & Easing

| Token | Value | Use |
|---|---|---|
| `motion-instant` | 0ms | Selection |
| `motion-fast` | 150ms | Hover opacity |
| `motion-standard` | 250ms | Modal, panel |

Standard cubic-bezier; minimal bounce. **Hover via opacity 0.6** is signature. `prefers-reduced-motion: reduce` removes hover transitions.
