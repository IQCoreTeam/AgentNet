# AgentNet - 디자인 시스템 & 기본기 (Design Foundation)

> 정체: 실제 UI가 따라야 할 하드 룰 + 추상 컨셉 + **과학적 디자인 기본기(타입/간격/사이징/레이아웃/모션/상호작용)**를 토큰 값까지 잠근 문서.
> 색/무드 같은 껍데기가 아니라 "요소 크기와 배치, 시각적 상호작용"의 과학이 핵심.
> 코드 기준: 색 토큰은 `surfaces/webview/src/index.css`의 `--an-*`. 수치는 모바일 리서치(출처 §11)로 검증. 날짜: 2026-06-23.

---

## 1. 하드 룰 (UI 제약, 예외 없음)

1. **실제 화면에 이모지 금지.** 아이콘은 이모지 대신 **SVG**로. (본 문서 와이어프레임의 그림문자는 자리표시.) 체크/별 같은 표식도 글리프가 아니라 SVG.
2. **em-dash, en-dash 금지** (UI 카피). 쉼표, 콜론, 괄호, 일반 하이픈으로.
3. **폰트 크기는 중앙화 스케일(§3)만.** 임의 `text-[x.xxrem]` 금지.
4. **색은 `--an-*` 토큰(§6)만.** 생 hex 금지.
5. **간격/사이징도 정해진 스케일(§4, §5)만.** 임의 `p-[13px]` 금지.
6. **다크 우선.** 라이트는 후순위.
7. 위 규칙은 ESLint로 강제(§10): 임의 Tailwind 값, 생 hex, 이모지 차단.

---

## 2. 디자인 컨셉 (확정 방향)

한 줄: **"미니멀한 다크 코더 툴인데, 빛날 때는 애플 터미널이 축하해주듯 절제되고 고급스럽게, 내가 가진 게 기분 좋게 드러나는."**

**방향 D 확정 (조정 가능):** 차분한 베이스 + 빛나는 전리품.
- **평소(채팅, 마켓, 설정) = 조용한 터미널.** near-black, hairline 보더, 모노 디테일, 절제된 그린. 일할 땐 조용히 비켜준다.
- **자랑할 때(My Skills, Profile, 획득 순간) = 터미널 프레임 안의 화려한 축하.** 터미널은 *컨셉(틀)*일 뿐, 그 틀 안에서는 정말 화려하게 해도 된다 (파티클·강한 모션·글로우·진동 적극 사용 OK). 게이트는 *시각적 절제*가 아니라 **빈도/희귀도**: 흔한 행동엔 안 터뜨리고, 진짜 모먼트엔 아끼지 않는다(§8.4).
- **IQ 해커 감성은 매니악하지 않게:** 그린 액센트 + 모노스페이스(코드/주소/세션ID)로 무드를 주되, 비크립토 바이브코더도 편한 선.
- **듀오링고식 딜라이트는 정직하게:** 보유/성취가 기분 좋게 보이되 가짜 희소성/다크패턴 없이(가드레일은 game-plan.md).

레퍼런스(구현 때 참고): Linear/Raycast/Vercel(다크 미니멀), Things(차분), Duolingo(절제된 보상), Phantom(모던 크립토), ChatGPT/Claude(챗 친숙), IDE 다크 테마.

---

## 3. 타입 스케일 (리서치 검증, sp 기준)

> Android는 타입 sp, 그 외 dp. 기존 코드엔 폰트 토큰이 없고 임의값 9종 난립 -> 아래 7단으로 수렴.
> 유효 비율 약 1.2(Minor Third): 모바일/밀집 UI에 권장되는 저대비 스케일. (M3 / iOS HIG / Baymard 기준)

| 토큰 | sp | 웨이트 | line-height | 용도 |
|---|---|---|---|---|
| `text-caption` | 12 | 400 | 16 (1.33) | 타임스탬프, 메타, 헬퍼 (가독 하한) |
| `text-label` | 13 | 500 | 16 (1.23) | 칩, 탭 라벨, 밀집 서브텍스트 |
| `text-body-dense` | 15 | 400 | 22 (1.47) | 채팅 버블(밀집), 컴팩트 리스트 |
| `text-body` | 16 | 400 | 24 (1.5) | **기본 본문, 블로그/댓글, 입력값** (입력 16 미만이면 iOS 줌) |
| `text-title` | 20 | 600 | 26 (1.3) | 카드 제목, 섹션 헤더 |
| `text-heading` | 24 | 600 | 30 (1.25) | 화면 제목 |
| `text-display` | 28-32 | 700 | 36 (1.2) | 온보딩 히어로 |

- **하한:** 본문 14sp 절대 하한, 16sp 선호. 캡션/라벨 11-12sp 밑으로 금지.
- **웨이트 3종:** 400 / 500 / 600. Light(300) 금지(특히 다크).
- **다크 보정(리서치):** 다크에선 글자가 번져 굵게 보임 -> 강조 웨이트를 한 단계 낮추고(예: 라이트 500 -> 다크 400~500), 본문에 letter-spacing +0.01em, 순백#FFF/순흑#000 금지(이미 fg #ececee 사용 = OK).
- **모노스페이스:** 코드/인라인 code/로그/주소/해시/토큰수에만. 본문 카피엔 금지. 모노는 시각적으로 커 보여 본문보다 1sp 작게(14-15) 균형.

---

## 4. 간격 · 그리드 (8pt 베이스 + 4pt 서브)

> 레이아웃/구조 간격은 8 배수, 인트라 컴포넌트 미세 간격에 4와 12 허용. 타입 line-height는 4 배수.

| 토큰 | dp | 용도 |
|---|---|---|
| `space-1` | 4 | 아이콘-라벨, 칩 패딩, 인트라 컴포넌트 |
| `space-2` | 8 | 베이스 단위, 타이트 스택, 리스트 행 내부 |
| `space-3` | 12 | 컴팩트 갭, 채팅 버블 패딩 |
| `space-4` | 16 | **화면 좌우 마진, 그리드 거터, 카드 패딩** |
| `space-5` | 24 | 섹션 분리, 다이얼로그 패딩 |
| `space-6` | 32 | 큰 블록 분리 |
| `space-7` | 48 | 큰 세로 리듬, 빈 상태 패딩 |
| `space-8` | 64 | 히어로 / 최상위 여백 |

- **마진/거터:** 폰 좌우 마진 16dp, 그리드 컬럼 거터 16dp.
- **근접 규칙(Gestalt):** 그룹 내부 4-8dp, 그룹 사이 16-24dp. 내부 간격보다 사이 간격이 최소 2배 -> 그게 그룹핑을 만든다. 선이 아니라 여백으로.

---

## 5. 요소 크기 · 밀도

| 토큰/요소 | 값 | 비고 |
|---|---|---|
| `touch-min` | **48dp** (44 절대하한) | Material 48. 시각 요소는 작아도(24 아이콘) 탭 영역 48 |
| 리스트 행 1줄/2줄/3줄 | 56 / 72 / 88dp | M3 list |
| 버튼 높이 | 40dp(기본), 48dp(주요 탭타깃) | M3 |
| 텍스트 필드 높이 | 56dp (내부 아이콘 24) | M3 |
| 아이콘 기본/밀집/디스플레이 | **24 / 20 / 40-48dp** | 18, 22는 그리드 이탈 -> 20, 24로 |
| radius | sm 8 / **md 12** / lg 16 / xl 28 / full 9999 | 기존 11 -> 12로 보정(16, 999는 유지) |
| 컬렉션 그리드 | 폰 **2열**, 카드 비율 1:1 또는 3:4 고정, 거터 16, 카드 패딩 12-16 | |

- **밀도:** 기본은 comfortable(위 값). compact(행 4dp 축소, 아이콘 20, body-dense 15sp)는 채팅 히스토리/데이터 밀집 뷰에만 opt-in.

---

## 6. 컬러 토큰 (다크 우선, `index.css`의 `--an-*` 정본)

**Surface:** `--an-bg-0` #0a0b0d(페이지) / `--an-bg-1` #141519(헤더·카드·드로어) / `--an-bg-2` #1c1e23(입력·활성·버블) / `--an-bg-glass` rgba(16,17,21,.82)(떠다니는 바·블러).
**글래스 재질:** 떠다니는 요소(컴포저, New chat FAB, 캡슐 탭바)는 `--an-bg-glass` 기반 **frosted glass + progressive blur(가변 블러 mask) + 하단 gradient scrim** 조합으로 "판떼기 아닌, 가장자리가 녹는" 느낌. 셋을 한 재질로 통일. 명칭·구현 키워드는 screen-rearrangement.md §3.
**Text:** `--an-fg` #ececee / `--an-fg-dim` #9a9aa3 / `--an-fg-mute` #66666e.
**Line:** `--an-line` rgba(255,255,255,.085) / `--an-line-soft` .05.
**Accent/Semantic:** `--an-green` #3ac07a(브랜드, refined not neon; +soft/line/dim) / `--an-amber` #e0a23a(경고) / `--an-red` #e5484d(위험, 신규 토큰화) / `--an-violet` #a98bff(발행).

**정리 부채:** `#00E673`(네온) 23곳, `#00d068` 등 생 hex -> 위 토큰으로 치환.
**3티어 권장(§10):** primitive(#0a0b0d) -> semantic(`--an-bg-0`) -> component(`--btn-primary-bg`). AI는 의미 토큰을 더 정확히 다룸.

---

## 7. 레이아웃 · 시각 위계 (표면별)

**공통 위계:** 끌어당기는 순서 = 크기 > 대비 > 색 > 간격 > 위치. 위계 단계는 화면당 3단 이내(크기 S/M/L, 타입 2-3단). 긴 구조 콘텐츠(긴 AI 답변, 블로그, 상세)는 **layer-cake**(제목 위주 스캔) 노리고, 텍스트벽 F패턴은 피한다. 주요 액션은 항상 **하단(엄지존)**.

**채팅 스레드**
- 유저 버블: 우정렬, 콘텐츠폭 75-85%. 어시스턴트: 좌정렬, 거의 풀폭(버블 약하게). 텍스트 measure 약 45자 이내로 캡.
- 발신자 구분은 **정렬**로(색에만 의존 금지). 같은 턴 버블 사이 4-8dp, 턴 사이 16-24dp.
- 컴포저 하단 고정(safe area), 전송 버튼 우하단. 툴/코드/승인 카드는 스레드 흐름 안에 풀폭 카드로(8-16dp inset, 내부 16dp 패딩, 승인 버튼 하단 48dp 나란히).
- 긴 답변: 제목/짧은 문단/불릿/코드블록으로 강제 구조화.

**소셜/피드(Profile)**
- 피드 글 = 카드, 댓글/팔로워 = 리스트 행. 카드 사이 16-24(32) dp(내부보다 크게).
- 프로필 위계(위->아래): 정체성(아바타+이름, 최대) > 통계/명성(컴팩트 행) > 주요 액션 > 콘텐츠 피드.
- 통계/뱃지: 정체성 아래 한 클러스터로, 숫자 볼드/라벨 뮤트로 각 항목 구분.

**아이템/컬렉션 그리드**
- 폰 2열, 카드엔 썸네일+이름(강조)+핵심속성 1개+상태표식만, 나머지는 상세로(점진 공개). **모든 카드에 같은 속성**을 같은 위치에.
- 희귀/보유/상태는 **색이 아니라 위치+아이콘+뱃지 슬롯**으로(예: 우상단 희귀 뱃지존, 고정 위치 owned 칩, 잠금은 딤+자물쇠). 일관된 "상태 존".
- 상세/마켓 뷰: 단일 컬럼 layer-cake(히어로 -> 이름 -> 통계/가격 -> 설명 -> CTA), Buy/Install 하단 고정.

**크로스 표면 일관성:** 세 표면 모두 같은 8pt 스케일·같은 위계 램프·주요액션 하단·16dp 마진. 스티키 헤더는 맥락이 필요한 곳에만.

---

## 8. 모션 · 상호작용 · 셀러브레이션

> 원칙: 기본은 100-300ms productive(차분, 비켜줌), 400ms+ / emphasized 이징은 드문 expressive·축하에만. 이게 "차분 베이스 + 프리미엄 축하"를 그대로 구현.

### 8.1 지속 토큰 (M3 검증)
`short1` 50 / `short2` 100(누름·토글 피드백 하한) / `short3` 150 / `short4` 200(소형 enter, 중형 exit) / `medium2` 300(**기본 화면/시트 전환**) / `medium4` 400(큰 컨테이너) / `long2` 500(기능 모션 상한) / `extraLong` 700-1000(**축하 전용**).

### 8.2 이징 토큰 (M3 cubic-bezier)
`standard` (.2,0,0,1) 화면 잔류 / `decelerate` (0,0,0,1) **진입** / `accelerate` (.3,0,1,1) **퇴장** / `emphasized` (히어로·축하·핵심 내비 전용) / `linear` 진행바·스피너.
- enter != exit: 진입이 약간 길고 감속, 퇴장은 짧고 가속. 지속은 이동거리/면적에 비례.

### 8.3 마이크로 인터랙션 · 피드백
- 직접 피드백은 **100ms 이내**(아니면 버벅임). 누름: tap-down에 scale 0.96-0.98 + ripple.
- **낙관적 UI**(전송/좋아요/장착): 즉시 반영 후 서버로 보정. 스피너는 실패/롤백에만.
- **스켈레톤**(피드/마켓/컬렉션 등 레이아웃 로딩) vs **스피너**(짧고 한정된 작업: 저장/인증/결제/장착).
- 컨테이너 트랜스폼(카드 -> 상세, FAB -> 시트)로 z축 위계 전달(medium4/long2 + emphasized).
- 하단 바 스크롤 자동숨김(§재배치 문서), 리스트 enter 감속+stagger.

### 8.4 셀러브레이션 패턴
> **게이트 = 빈도/희귀도, 시각 절제가 아님.** 터미널은 *틀*이고, 그 안에서는 화려하게 가도 된다. 흔한 행동엔 안 터뜨려 무게를 지키되, 진짜 모먼트엔 파티클·강한 모션·진동을 아끼지 않는다. (over-confetti 연구가 경계하는 건 "아무 때나 터뜨리기"지 "크게 터뜨리기"가 아니다.)

| 패턴 | 트리거 | 사양 |
|---|---|---|
| **TerminalConfirm** (중간 강도, 비교적 잦음) | 스킬 획득/장착 | 모노 "acquired" + **SVG 체크** emphasized-decelerate 타이핑/페이드(약 700ms) + success 햅틱 + 아이템 글로우. 터미널 무드 유지하되 또렷하게 |
| **MilestoneBurst** (풀 스펙터클, 드물게) | 드문 성취/레벨/첫 발행/희귀 획득 | **여기선 아끼지 않는다.** 파티클·스케일·강한 모션·글로우 emphasized 700ms-1.2s(extraLong), 강한/다단 햅틱, 사운드 옵션, 논블로킹·탭 dismiss. 터미널 프레임 안에서 화려하게 |
| **QuietGrant** (햅틱만) | 아주 흔한 컬렉션 추가 | short4 카운트업 + light/selection 햅틱 (작은 건 작게) |

- **진동(햅틱) 적극 사용:** 모먼트 피크에 success(또는 다단) 햅틱. 화려한 시각 + 햅틱을 같이 터뜨려 "축하받는" 감각을 키운다.
- **reduce-motion 폴백:** 파티클/큰 모션 끄고 정적 뱃지 + 햅틱으로 대체(접근성 §8.6). 화려함은 모션이 켜진 사용자에게만, 의미 전달은 모두에게.

### 8.5 햅틱
- iOS: success(획득/성취), light/selection(루틴). Android: `performHapticFeedback` CONFIRM/CLOCK_TICK/REJECT(권한 불필요, graceful fallback). 햅틱은 시각 피크에 1회.
### 8.6 접근성(하드 룰)
OS Reduce Motion 존중(이동 대신 크로스페이드, 속도만 줄이지 말 것). 모션이 유일한 신호여서는 안 됨(텍스트/햅틱 병행). 축하 reduce-motion 폴백 = 정적 뱃지 + 햅틱. 모션이 콘텐츠 접근을 막지 않기.

---

## 9. 아이콘
- **SVG only.** stroke 라인 아이콘, 두께 약 1.5px 일관. 사이즈 24/20/40 토큰. 색은 `currentColor`로 텍스트 토큰 상속.

---

## 10. AI로 구현하는 법 (anti-slop 플레이북)

> AI는 "디자인"하지 않고 학습 평균(Inter + indigo-600 + 가운데 히어로 + 카드 3개)을 뱉는다. **토큰을 하드 제약으로 먹이는 것**이 평균을 우리 브랜드로 바꾸는 단 하나의 레버.

- **토큰 먼저, 단일 소스:** 3티어(primitive -> semantic -> component)를 Tailwind theme + 다크에 배선. **Tailwind 기본 `colors`를 우리 토큰으로 통째 교체**(indigo-600 차단).
- **AI 규칙 파일:** `CLAUDE.md`(또는 skill)에 "의미 토큰만, 임의값 금지, 모션 토큰, 이모지 금지" + **복붙용 예시 컴포넌트**(AI는 산문보다 구조를 더 잘 따라함). 규모 커지면 디자인시스템 MCP 서버 고려.
- **프롬프트:** 레퍼런스 스크린샷 + 현재 렌더 스크린샷 같이(자기교정), "이 승인된 화면/컴포넌트에 맞춰라", 화면 통째 말고 컴포넌트 단위, 3안 요청 후 수렴, 피드백은 토큰 이름으로 구체적으로.
- **하드 게이트(ESLint):** `tailwindcss/no-arbitrary-value`, 생 hex 금지, `bg-indigo-*`/그라데이션 히어로 금지, 이모지 금지. 자동 검사 없으면 디자인 시스템은 "제안"으로 전락.
- **워크플로:** 토큰 -> 컴포넌트 라이브러리 -> AI가 토큰+스크린샷에 맞춰 한 컴포넌트씩 -> **스크린샷 diff 리뷰**(Playwright/Percy) -> 토큰 이름으로 리파인. N화면 일관성: 단일 토큰 소스 + 승인된 화면을 레퍼런스로 + 커밋마다 lint + 비주얼 회귀 베이스라인 누적.
- 슬롭 텔: Inter 기본폰트, AI 퍼플, 가운데 히어로+카드3, 임의 간격/색, 이모지 아이콘, "Empower/Unlock" 카피 -> 각각 토큰/레퍼런스/lint로 차단.

---

## 11. 출처 (sources)

**타입/간격/사이징:** [M3 Typography](https://m3.material.io/styles/typography/applying-type) · [M3 Shape](https://m3.material.io/styles/shape/corner-radius-scale) · [M3 Lists](https://m3.material.io/components/lists/overview) · [M3 Density](https://m3.material.io/foundations/layout/understanding-layout/density) · [Baymard Line Length](https://baymard.com/blog/line-length-readability) · [TetraLogical Target Size](https://tetralogical.com/blog/2022/12/20/foundations-target-size/) · [Cieden Type Scale](https://cieden.com/book/sub-atomic/typography/different-type-scale-types) · [CSS-Tricks Dark Mode & Variable Fonts](https://css-tricks.com/dark-mode-and-variable-fonts/) · [CHI 2023 font grade x polarity](https://dl.acm.org/doi/10.1145/3544548.3581552)
**레이아웃/위계:** [NN/g Visual Design Principles](https://www.nngroup.com/articles/principles-visual-design/) · [NN/g Layer-Cake Scanning](https://www.nngroup.com/articles/layer-cake-pattern-scanning/) · [NN/g Cards vs List](https://www.nngroup.com/videos/card-view-vs-list-view/) · [M3 Responsive Grid](https://m2.material.io/design/layout/responsive-layout-grid.html) · [Baymard Product List](https://baymard.com/blog/list-item-design-ecommerce) · [CometChat Chat UX](https://www.cometchat.com/blog/chat-app-design-best-practices) · [Android Touch Target](https://support.google.com/accessibility/android/answer/7101858)
**모션/상호작용/셀러브레이션:** [M3 Easing & Duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [material-components-android Motion.md](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) · [M3 Transitions](https://m3.material.io/styles/motion/transitions) · [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [NN/g Animation Duration](https://www.nngroup.com/articles/animation-duration/) · [NN/g Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/) · [Carbon Motion](https://carbondesignsystem.com/elements/motion/overview/) · [Android Haptics](https://developer.android.com/develop/ui/views/haptics/haptics-principles) · [Over-confetti-ing (UX Collective)](https://uxdesign.cc/the-over-confetti-ing-of-digital-experiences-af523745db19)
**AI로 UI:** [Braingrid Design Systems for AI](https://www.braingrid.ai/blog/design-system-optimized-for-ai-coding) · [Typeform Design-to-Code with MCP](https://medium.com/typeforms-engineering-blog/design-to-code-with-mcp-our-journey-to-teaching-ai-our-design-system-e88e8f8854d4) · [Builder.io Prompting Tips](https://www.builder.io/blog/prompting-tips) · [Why AI builds purple gradients](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) · [Fixing the AI-generated look](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh) · [v0 vs Lovable vs Bolt](https://uibakery.io/blog/lovable-vs-bolt-vs-v0)

---

## 12. 다음 단계
1. **토큰 코드화:** §3-§8 값을 `index.css` + Tailwind theme에 토큰으로 박고, 생 hex/임의값 정리 + ESLint 게이트.
2. **핵심 컴포넌트 구현:** 떠다니는 캡슐 바, 스킬 카드, FAB, 채팅 버블, Profile, SVG 아이콘 세트(토큰 위에서).
3. **4탭 셸 구현**(screen-rearrangement.md §9) + 화면별 스크린샷 diff 리뷰 루프.
</content>
