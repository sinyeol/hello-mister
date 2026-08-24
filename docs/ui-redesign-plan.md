# Hello Mister — UI 리디자인 계획서

> 멀티 에이전트 디자인 감사(2026-06-24) 결과를 바탕으로 작성. **이 문서는 계획서이며, 코드/스타일을 바꾸지 않습니다.**
> 방향: **Dark Pro Utility + Retro Console Accent** (장비를 다루는 사람의 전문가용 데스크톱 툴 느낌).

---

## 0. 현재 상태 (정직한 진단)

- **라이트 테마 + 시안 액센트(`#0891b2`)**, 그리고 **디자인 토큰이 0개**. `src/styles.css`(~2489줄) 전체가 하드코딩 hex/rgba이고, `:root` 커스텀 프로퍼티도 `var(--x)` 소비자도 전혀 없음.
- **스타일 시스템이 둘로 분리**되어 있음:
  - 손으로 쓴 CSS 셸(AppLayout + 네이티브 `/pages/*` 10개) — Segoe UI/Malgun Gothic
  - Tailwind 기반 스티커 모듈(`/stickers/*`) — Inter 폰트 + **다른 액센트(파랑 `#2563eb`)**
- **출력/캔버스 충실도**가 클래스명 계약(`.print-output-area`, `.print-ready-output-area`, `[data-print-sheet-a4]`, `@media print` 2블록, `print-color-adjust:exact`) + 계산된 스타일을 그대로 굽는 PNG/PDF 익스포트(`sheetDomExport.ts`)로 유지됨 → **부주의한 다크/색 리맵이 인쇄·스티커 색을 조용히 망가뜨림.**

**결론:** 다크 테마는 가능하지만 반드시 **앱 크롬에만 적용되는 토큰 레이어**로 도입하고, **스티커 캔버스/출력 서브트리는 명시적으로 제외**해야 함.

---

## 1. 가장 큰 위험 — 출력/캔버스 충실도 (WYSIWYG = 기능)

스티커 편집기·A4 시트·PDF/PNG·인쇄는 "보이는 색 = 출력되는 색"이 핵심 기능. 전역 다크/색 변경이 여기로 새면 **기능이 깨짐**. → 아래 **DO-NOT-TOUCH** 목록(섹션 6)을 토큰 적용에서 무조건 제외.

---

## 2. 디자인 토큰 (라이트 정제판 / 다크 목표판)

`:root`에 정의하고, `[data-theme="dark"]`에서 **같은 이름**을 재지정. **앱 크롬 전용** — 캔버스/출력 제외.

| 토큰 | 역할 | Light | Dark |
|---|---|---|---|
| `--bg` | 페이지 배경 | `#eef2f7` | `#0f1419` |
| `--surface` | 카드/사이드바/모달 표면 | `#ffffff` | `#1a2029` |
| `--surface-2` | 중첩 표면/표 헤더/로그 박스 | `#f8fafc` | `#222a35` |
| `--border` | 기본 테두리/구분선 | `#d1d5db` | `#323b48` |
| `--border-strong` | 강조 테두리/입력 포커스 | `#94a3b8` | `#4a5568` |
| `--text` | 본문/제목 | `#111827` | `#e6edf3` |
| `--text-muted` | 보조 텍스트(.muted) | `#64748b` | `#9aa7b5` |
| `--accent` | 브랜드 액센트(nav active/primary/선택 링) | `#0891b2` | `#22d3ee` |
| `--accent-hover` | 액센트 hover/pressed | `#0e7490` | `#67e8f9` |
| `--accent-contrast` | 액센트 위 텍스트/아이콘 | `#ffffff` | `#06121a` |
| `--accent-soft` | 소프트 액센트 배경(nav hover/선택 행) | `#ecfeff` | `rgba(34,211,238,0.12)` |
| `--accent-ring` | 선택 링/포커스 글로우 | `rgba(8,145,178,0.16)` | `rgba(34,211,238,0.28)` |
| `--retro-accent` | 보조 레트로 액센트(배지/하이라이트, 크롬 전용) | `#d97706` | `#fbbf24` |
| `--success-text` / `--success-soft` | 성공 | `#166534` / `#dcfce7` | `#86efac` / `rgba(34,197,94,0.16)` |
| `--warning-text` / `--warning-soft` | 경고 | `#92400e` / `#fef3c7` | `#fcd34d` / `rgba(217,119,6,0.18)` |
| `--danger-text` / `--danger-soft` | 위험 | `#991b1b` / `#fee2e2` | `#fca5a5` / `rgba(220,38,38,0.18)` |
| `--info-text` / `--info-soft` | 정보/dry-run | `#075985` / `#e0f2fe` | `#7dd3fc` / `rgba(8,145,178,0.18)` |
| `--code-bg` / `--code-text` | 코드/로그 표면 | `#0f172a` / `#e2e8f0` | `#0b0f14` / `#cbd5e1` |
| `--row-armed` | 컨트롤러 armed 행(인라인 `#fef08a` 대체) | `#fef08a` | `rgba(251,191,36,0.28)` |
| `--row-pressed` | 컨트롤러 live-pressed 행(인라인 `#dcfce7` 대체) | `#dcfce7` | `rgba(34,197,94,0.28)` |
| `--radius-sm/md/lg` | 반경 | `6 / 8 / 12px` | (동일) |
| `--space-1..6` | 간격 스케일 | `4/8/12/16/24px` | (동일) |
| `--content-max` | 최대 가독 폭(현재 없음) | `1280px` | (동일) |

> **권장:** 우선 **라이트 정제판부터** 출시(토큰 이름의 light 값 = 현재 팔레트). 토큰화 자체는 "보이는 변화 없음"으로 검증 가능 → 다크/출력 리스크를 분리해서 다룸. 그 후 `[data-theme="dark"]`를 토글 뒤에 붙임.

---

## 3. 컴포넌트 정규화 (이미 있는 건 재사용)

| 컴포넌트 | 문제 | 조치 |
|---|---|---|
| **토큰 레이어** (`:root` + `[data-theme="dark"]`) | 토큰 0개, 셸/Tailwind 분리 | `:root` 토큰 블록 + 다크 오버라이드 추가, 크롬 리터럴만 `var()`로 치환 (DO-NOT-TOUCH 제외) |
| **버튼 변형** (`.button.*`) | `.button.secondary` 13곳 사용하나 **CSS 규칙 없음**(기본 버튼처럼 렌더) | `.button` / `.primary` / `.secondary` / `.danger` / `.ghost` 한곳에 토큰 기반 정의 → 13개 자동 수정 |
| **Callout 톤** (`.callout`) | `callout warning` 쓰는데 규칙 없어 **녹색으로 렌더**(잘못된 심각도) | `.callout.warning`(앰버) + `.callout.info` 추가, `<Callout tone>` 래퍼 고려 |
| **StatusBadge** | 배지 시스템 2개 병존(`.badge-*` vs 죽은 `.status-text`) | StatusBadge를 단일 프리미티브로, ControllerManagementPage를 이전 후 `.status-text` 삭제 |
| **선택 가능 행/카드** (`.table-row` 등) | `.preset-card`/`.ini-file-row`/`.table-row`/스티커 카드가 각자 "시안 링" 재구현, `.table-row` 81곳에 인라인 grid/하이라이트 | 공유 `.selectable(.selected)` + `.table-row.armed/.pressed` + `.table-list.scroll`로 인라인 hex 회수 |
| **EmptyState / StatusMessage / Modal / Spinner** | 287개 임시 `<p class="muted">` 상태 블록, 페이지마다 모달 재구현, 토스트·스피너 없음 | 기존 클래스 감싼 `<EmptyState>`, 톤 있는 `<StatusMessage>`, `<Modal>`, `<Spinner>` 추가 |
| **공유 ErrorBoundary** | 현재 sticker-v1 라우트만 보호, 네이티브 페이지 크래시는 앱 전체 블랭크 | AppLayout `<Outlet/>` 감싸는 공유 ErrorBoundary 승격(sticker-v1 패턴 재사용) |
| **tailwind 토큰** | 시맨틱 토큰 8개 정의하나 raw 유틸 727회, 액센트 충돌 | tailwind 시맨틱 토큰을 같은 CSS 변수로 연결. **white/neutral/red 리터럴은 절대 리맵 금지**(출력으로 샘) |

---

## 4. 화면별 계획 (실제 라우트 기준 — "홈/동기화" 화면은 없음)

| 라우트 | 화면 | 핵심 조치 | 출력 리스크 |
|---|---|---|---|
| `/settings` | 앱 설정 | **파일럿**: 토큰화 + `--content-max` + 톤 `<StatusMessage>` | 없음 |
| `/mister` | MiSTer 연결 | 인라인 상태 pill → `<StatusBadge>`, `.button.secondary` 적용, SSH 대기 `<Spinner>` | 낮음 |
| `/sd-card` | SD 카드 관리 | busy 플래그+비활성화+`<Spinner>`, 무톤 log-box → 톤 메시지 (해시 출력은 그대로) | 낮음 |
| `/games` | ROM 파일 관리 | 행 테이블을 `.table-list/.table-row`로, full-bleed 유지(`--content-max` 예외) | 낮음 |
| `/scripts` | 스크립트 관리 | 인라인 선택행 30블록 → `.selectable`, 모달 → `<Modal>`, `.button.secondary` | 낮음 |
| `/ini` | INI 설정 | `.button.secondary` 7곳 적용, `.ini-file-row`→`.selectable`, 현재/변경 값 대비 | 낮음 |
| `/controllers` | 컨트롤러 관리 | 죽은 `.status-text`→`<StatusBadge>`(success→safe, info→dry) 후 규칙 삭제 | 낮음 |
| `/controller-setup` | 컨트롤러 매핑(베타) | 인라인 armed/pressed → `.table-row.armed/.pressed`, `.callout.warning` 추가, 폰트 스케일 정리 | 낮음(라이브 입력 시각 많음 → 파일럿 후) |
| `/backup` | 백업/복구 | 무톤 메시지 → 톤 `<StatusMessage>`, DangerZone 강화 (진단 출력은 그대로) | 낮음 |
| `/stickers/mister` | 게임 라이브러리(기본 진입) | **나중**: raw 유틸 255개 최다 + 캔버스 인접. Tailwind 토큰 연결 후 섹션별 마이그레이션 | 중 |
| `/stickers/*` | 스티커 스튜디오 | **마지막·최고 리스크. 크롬만.** 캔버스/프리뷰/ColorSelector/익스포트는 DO-NOT-TOUCH | 높음 |

---

## 5. 파일럿 추천: `/settings`

- **고임팩트**: 라이트 정제·다크 양쪽에서 토큰 레이어가 동작함을 앱 전체 커밋 없이 증명.
- **저리스크**: 캔버스/프리뷰/익스포트 없음, 라이브 장치 I/O 없음.
- **자기완결**: 네이티브 손코딩 CSS 페이지(= styles.css 토큰 경로를 검증, 더 어려운 Tailwind 경로 아님)인데 한 번에 전부 변환 가능.
- 보너스: `--content-max`로 가독 폭 정리 + 무톤 메시지 채널 → 톤 메시지로 교체.

(차순위 `/mister`는 라이브 SSH I/O와 인라인 pill, 컨트롤러 페이지는 라이브 입력 시각 때문에 첫 타깃으로는 시끄러움.)

---

## 6. DO-NOT-TOUCH (출력/캔버스 — 토큰화 절대 제외)

1. **카드/스티커 색 해석 (렌더 계약, WYSIWYG 단일 원천)** — `getCardBackgroundColor/getStickerBackgroundColor`, `#111111` 기본값, fallback 팔레트 `{#111111,#F5F5F5,#F36C21,#D9D9D9}`(3파일 동일 유지).
   - `src/features/sticker-v1/utils/cardGeometry.ts`, `.../components/cards/EditableCardTemplatePreview.tsx`, `CardPreview.tsx`, `TemplateShapeLayer.tsx`, `EditableImageCanvas.tsx`, `src/components/stickers/StickerCardPreview.tsx`
2. **컬러 피커 UI (색공간/드래그/투명 계약)** — `ColorSelector.tsx`(HSV/HSL/RGB, 채널색 `#ef4444/#22c55e/#3b82f6`, 체커보드=투명, 빨간 대각선=no-fill, 드래그 MIME/이벤트).
3. **PNG/PDF 계산스타일 익스포트 (테마 누수 1차 벡터)** — `sheetDomExport.ts`, `exportPdf.ts`, `exportPng.ts`, `PrintSheetPreview.tsx`, `ExportPreviewPage.tsx` (`#ffffff` 종이, 297×210mm 기하).
4. **시스템 인쇄 경로** — `ExportPreviewPage.tsx`(`@page A4`, `print-color-adjust:exact`, 10장=1p/20장=2p, object-fit:fill).
5. **전역 `@media print` 블록 + 클래스명 계약** — `globals.css`(53–148), `styles.css`(~1856–1872). 클래스명(`.print-output-area`, `.print-ready-output-area`, `.print-sheet-page`, `.print-sheet-title`, `.print-hidden`, `.sheet-preview-wrap`, `[data-print-sheet-a4]`)은 JSX↔CSS 계약 → 변경/토큰화 금지.
6. **Tailwind 리터럴 white/neutral/red** — `tailwind.config.js` (시맨틱 토큰만 확장, 빌트인 리터럴 절대 오버라이드 금지).
7. **사용자 콘텐츠 색(인라인)** — 카드/템플릿 배경색, RGB 슬라이더, 휴 스펙트럼(~99 인라인 hex 중 동적 값). 토큰 find/replace에서 제외.

---

## 7. 롤아웃 (점진·검증 가능 — 현재 Playwright/시각 diff 없음 → 단계마다 수동 스크린샷)

- **Phase 0 — 결정 게이트**: 출시 순서 선택. **권장: 라이트 정제 먼저**(light 값 = 현 팔레트 + 새 스케일), 그 다음 `[data-theme="dark"]`.
- **Phase 1 — 토큰**: `:root` 토큰/스케일 추가, **크롬 리터럴만** `var()`로 치환. DO-NOT-TOUCH 무접촉. 네이티브 10라우트 전/후 수동 비교(보이는 변화 없어야 함).
- **Phase 2 — 프리미티브**: `.button.secondary/.ghost`, `.callout.warning/.info`, `.table-row.armed/.pressed`, `.selectable`, `<EmptyState>/<StatusMessage>/<Modal>/<Spinner>`, 공유 `<ErrorBoundary>`. ControllerManagementPage를 `.status-text`에서 이전.
- **Phase 3 — 파일럿**: `/settings` 전체 변환 + `--content-max`, `[data-theme="dark"]` 추가 후 /settings에서만 토글 ON. 라이트·다크 양쪽 대비(WCAG AA) 확인.
- **Phase 4 — 다크 계약 검증(go/no-go)**: 다크 상태로 `/stickers/output`에서 PNG·PDF·시스템 인쇄 → 종이 순백·카드색 불변·10=1p/20=2p·말미 빈 페이지 없음. 캔버스/출력 서브트리에 `color-scheme:light` + 리터럴 white 강제(이중 안전장치).
- **Phase 5 — 네이티브 확장**: `/mister`, `/sd-card`, `/games`, `/scripts`, `/ini`, `/controllers`, `/controller-setup`, `/backup` 한 화면씩(라이트·다크 스크린샷).
- **Phase 6 — 스티커/Tailwind 마지막**: tailwind 시맨틱 토큰을 CSS 변수로 연결(액센트·폰트 통일), raw 유틸 페이지별 마이그레이션 — **크롬만**. 각 스티커 페이지 후 Phase 4 회귀 재실행. (참고: CardAlbumPage `setFeedback` 3회 호출로 영어만 보이는 **기존 버그**가 있음 — 별도 처리.)
- **Phase 7 — 정리·가드**: DO-NOT-TOUCH 파일/셀렉터에 `var(--…)`/테마 셀렉터가 들어오면 실패하는 CI grep 가드, 토큰/출력 제외 규칙 문서화. 안정화 후 최소 Playwright 스크린샷 하니스 도입 검토.

---

## 8. 리스크 (요약)

1. **출력 누수(최고)** — `sheetDomExport.ts`가 계산 스타일을 구움 → `<html>` 다크가 특히 위험. 완화: 토큰을 크롬 셀렉터에 한정 + 캔버스/출력에 `color-scheme:light`+리터럴 white + Phase 4 게이트.
2. **Tailwind white/neutral 리맵** → 시트로 직행. 완화: 새 시맨틱 토큰만 추가, 빌트인 리터럴 미오버라이드, CI grep.
3. **라이트→다크 결정의 비가역성** — 셸/Tailwind 양쪽 배선 필요, raw 유틸 727개는 마이그레이션 전엔 안 따라옴. 완화: 라이트 정제 먼저.
4. **자동 시각 검증 부재** — 단계마다 수동 스크린샷. 완화: 체크리스트 + Phase 7 하니스.
5. **다크 대비 회귀** — light용 soft 배경이 다크에서 WCAG AA 실패 가능. 완화: 다크 soft = 저알파 액센트 오버레이 + 컨트롤러 페이지 대비 검증.
6. **스코프 크리프** — 인라인 hex 토큰화가 사용자 콘텐츠 색을 잡으면 카드 렌더 손상. 완화: 리터럴별 크롬/데이터 분류(섹션 6).
7. **액센트 통일 = 브랜드 변화** — 스티커 파랑→시안. 완화: Phase 6에서 승인 후, 카드/프리뷰로 안 새는지 확인.

---

## 9. 도구 조합 (ChatGPT 조언을 이 앱에 맞춰 보정)

- **`ui-redesign` 스킬** = "디자인 감독"(작업 규칙·순서·출력 안전 가드 고정). → `.claude/skills/ui-redesign/SKILL.md` 생성됨.
- **CLAUDE.md UI 규칙** = 매 세션 같은 방향 유지. → 추가됨.
- **Playwright MCP**(권장, 미설치) = "눈" — 화면 실제 렌더 검증. 설치: `claude mcp add playwright npx @playwright/mcp@latest`. ⚠️ `browser_run_code_unsafe`는 RCE급이니 신뢰 프로젝트에서만.
- **Codex 등 2차 리뷰어**(권장) = "검수자" — 한 브랜치에서 구현/리뷰 역할 분리. 동시 수정 금지.
- **hooks**(권장) = 작업 후 `npm run build` / `lint` 자동 검증.
- 이미 있는 것: AppShell·사이드바·basic/advanced 모드 → 새로 안 만들고 다듬으면 됨.

---

## 10. Figma 연동으로 디자인 완성하기

목표: Figma를 **디자인 시스템의 단일 원천**으로 삼아(토큰값·컴포넌트 스펙·핵심 프레임), MCP로 Claude Code에 전달하고, Claude가 이 앱의 토큰 레이어/컴포넌트로 **앱 크롬만** 구현. **1:1 픽셀 복제 아님** — 사용성은 실제 앱 우선, 출력/캔버스(§6)는 그대로 제외.

### 10.1 연결 방식 3택

| 방식 | 필요 조건 | 특징 |
|---|---|---|
| **A. 이 Claude 세션의 Figma 플러그인** | 인증(OAuth)만 | 가장 쉬움. 추가 설치 없음. Claude가 인증 시작 → 사용자가 브라우저에서 승인. |
| **B. Framelink(커뮤니티 figma-developer-mcp)** | Figma 개인 액세스 토큰(읽기) | view-only 파일도 OK, 무료. 파일/프레임 URL을 주면 읽어서 구현. |
| **C. 공식 Figma Dev Mode MCP** | Figma **데스크톱 앱** + **Dev/Full 시트(유료)** | 가장 정밀(코드 커넥트/변수). 데스크톱에서 프레임 선택 → "선택 영역 구현". |

설치 예시(버전·옵션은 공식 문서 확인):
```bash
# B. Framelink
claude mcp add figma npx -y figma-developer-mcp --figma-api-key=YOUR_TOKEN --stdio
# C. 공식 Dev Mode (Figma 데스크톱에서 Preferences → Enable Dev Mode MCP Server 먼저)
claude mcp add --transport sse figma-dev-mode http://127.0.0.1:3845/sse
```
> 권장: 이 앱 규모면 **A(세션 플러그인)** 또는 **B(Framelink)** 로 충분. 공식 Dev Mode는 유료 시트가 있을 때.

### 10.2 Figma 파일 구성 (당신이 만들 것)

1. **Variables(토큰)**: 계획서 §2 토큰을 Figma Variables로 그대로 입력. Mode 2개(`Light`/`Dark`)로 만들면 `[data-theme]`와 1:1 매핑됨. 색·radius·space 다 변수화.
2. **컴포넌트**: Button(primary/secondary/danger/ghost), StatusBadge(neutral/safe/warning/danger/dry/info), Card(SectionCard), Table row(default/armed/pressed/selected), Callout(success/warning/danger/info), Input/Select/Toggle, Modal, EmptyState, StatusMessage, Spinner, DangerZone. → §3 정규화 목록과 1:1.
3. **핵심 프레임 3~5개**(전체 말고): `/settings`(파일럿), `/mister` 연결, `/games` ROM 관리, `/controller-setup`. 사이드바는 현재 것 기준.
4. **만들지 말 것**: 스티커 캔버스/카드 프리뷰/A4 시트/익스포트 화면 — 출력 충실도는 코드가 원천이라 Figma로 재정의하면 안 됨(§6).

> 빠르게 시작: v0나 디자이너에게 위 스펙 + §2 토큰을 주고 프레임을 뽑은 뒤 Figma로 가져와도 됨.

### 10.3 워크플로 (연결 후)

1. Figma에서 파일럿 프레임(`/settings`)을 선택/링크 → MCP로 Claude에 전달.
2. Claude: 프레임의 **토큰·레이아웃·컴포넌트 스펙**을 읽어 `:root` 토큰 + 공통 컴포넌트로 구현(크롬만). 픽셀 복제보다 토큰/구조 일치 우선.
3. 검증: 수동 스크린샷(Playwright 붙이면 자동) → Figma와 비교.
4. OK면 다음 프레임으로 확장. 스티커/Tailwind는 마지막(§7 Phase 6) + 매번 인쇄/익스포트 회귀.

예시 프롬프트:
```
/ui-redesign
Figma MCP로 선택한 [Settings] 프레임의 토큰·레이아웃·컴포넌트 스펙을 읽고,
이 앱의 :root 토큰 레이어와 공통 컴포넌트로 /settings 화면을 구현해줘.
- Figma Variables는 docs/ui-redesign-plan.md §2 토큰 이름과 매핑
- 1:1 픽셀 복제보다 토큰/구조 일치 + 실제 앱 사용성 우선
- 출력/캔버스 표면(§6 DO-NOT-TOUCH)은 절대 건드리지 말 것
- 하드코딩 색 금지, 빌드/린트 통과
```

### 10.4 주의

- Figma 토큰은 **셸 CSS와 Tailwind 양쪽**에 연결해야 함(같은 CSS 변수 가리키게). Tailwind 리터럴 white/neutral/red는 절대 리맵 금지(§6).
- 공식 Dev Mode MCP의 일부 기능/Playwright MCP의 `*_unsafe`는 임의 코드 실행급 → 신뢰 환경에서만.
- Figma 파일·프레임 제작은 사용자 계정에서 해야 함(내가 Figma 파일을 직접 만들지는 못함). 대신 위 스펙·토큰·프롬프트는 내가 상세히 제공.
