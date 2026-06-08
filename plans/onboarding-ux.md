# Onboarding + Model-Select + Storage UX (설계)

이 세션(runtime/설계)이 정한 그림. no2(UI) / no3(storage/oauth)가 이걸 기준으로 작업.
계약은 contract.ts (../src/runtime/contract.ts) — 새 API 필요하면 여기 먼저 합의.

## 1. 첫 진입 (init/onboarding) — 순서
```
A. 지갑 연결 (Phantom)
B. CLI 체크: codex / claude 설치+로그인 됐나?
   - 둘 다 없음 -> "설치 안내" (codex/claude 설치 링크/명령)
   - 설치됐는데 미로그인 -> "로그인 안내" (claude login / codex login)
   - 기본 선호 = codex (없으면 claude)
C. 저장소 선택 (init): "세션을 어디에 저장할까요?"
   - 기기 감지: macOS면 애플(iCloud) 추천 디폴트 제시
   - 옵션: iCloud / Google Drive / 로컬 / 커스텀
   - 선택 -> OAuth/폴더설정 -> config.json 저장
D. 이후 진입: config 읽어 자동 login -> 세션 목록 (다시 안 물음)
```

## 2. claude/codex = 모델 선택 (세션은 하나처럼)
- 대화 화면 상단에 모델 드롭다운: [codex] / [claude]. 기본 codex.
- 전환해도 같은 sessionId 유지 -> 한 대화에 codex/claude 섞여 이어짐 (런타임 이미 공유 지원).
- startSession({cli})의 cli만 바뀜. UI가 현재 선택된 cli를 send마다 넘김.
- 즉 "모델 고르듯" 전환, 로그는 하나.

## 3. 저장소 보기 / 바꾸기
- 내 저장소 보기: 현재 config.kind 표시 ("Google Drive에 저장 중" 등) + 실제 위치.
- 저장소 바꾸기: 애플->구글 등. 새 kind로 initialize 재실행 -> config 교체.
  - 기존 세션 이전? v1은 "새 저장소부터 적용"(과거는 옛 저장소). 마이그레이션은 나중.

## 4. CLI 없을 때 정책 (정하기)
- codex/claude 미설치: 앱에서 깔라고 강제 못 함 -> 안내만 (설치 명령/링크 + 설치 후 재시도 버튼).
- 미로그인: 마찬가지로 claude/codex login 안내.
- 둘 중 하나만 있으면 그걸 기본으로.

## 5. OAuth "이미 로그인됨" 의심 → **조사 완료: 버그 아님** (no3)
조사 결과 (`~/.agentnet/` 실제 상태):
- `tokens/` = **없음** (OAuth 토큰 0). `config.json` = **없음** (저장소 미설정). `sessions/`만 존재.
- 즉 OAuth는 실제로 안 돼있음. `isInitialized()`도 config 없으면 `false` 반환 — 정상.

**원인:** vscode가 지금 `manualStorage()`(로컬, OAuth 불필요)로 돌아가서 "로그인 없이 바로 됨"
처럼 보인 것. 진짜 구글 연결은 `initialize({kind:"gdrive"})`를 골라야만 토큰이 생김.
→ 첫 사용자가 gdrive를 고르면 그때 consent가 뜸. 지금 안 뜨는 건 manual이라서지 버그 아님.

## 6. 새로 필요한 contract API
- detectCli(): { codex: "ok"|"no-login"|"missing", claude: ... } -- onboarding B단계용 (런타임 세션 담당)
- **getStorageInfo(): { kind, location?, connected } -- ✅ 완료 (no3, src/index.ts에서 export)**
  - "내 저장소 보기" 패널용. gdrive면 connected=토큰 유무, 나머진 설정되면 true. null=미설정.
  - 관련 export (전부 src/index.ts): isInitialized, initialize, login/connect, switchStorage,
    logout, currentStorageKind, getStorageInfo, STORAGE_OPTIONS. 상세 흐름은 ↓ "Storage API" 절.
- 모델 전환: startSession이 이미 cli 받으니 추가 API 불필요 (UI가 cli 토글)

---

## Storage API (no3) — 화면이 호출하는 함수들

자세한 흐름/머메이드는 이 절 기준. 모두 `import { ... } from "../src/index.js"`.

```ts
// 첫 진입
if (!(await isInitialized())) {
  const cfg = await showPicker(STORAGE_OPTIONS);     // {kind,label,needs}[]
  await initialize(cfg, (url) => openBrowser(url));  // gdrive면 consent 뜸
}
const runtime = await connect(wallet);               // = login()+createRuntime()

// 내 저장소 보기 (설정 패널)
const info = await getStorageInfo();   // { kind, location?, connected } | null

// 저장소 바꾸기
const next = await switchStorage(wallet, newCfg, openBrowser);
const runtime2 = createRuntime(next.wallet, next.storage);

// 연결 해제 (이 기기의 config+구글토큰만 삭제, 원격 데이터는 그대로)
await logout();
```

`StorageConfig = { kind:"local"|"gdrive"|"icloud"|"custom", location?, authHeader? }`
- icloud: location=폴더(없으면 iCloud Drive/AgentNet). custom: location=base URL(+authHeader).
- gdrive 실연결은 env `GOOGLE_CLIENT_ID`(Desktop-app) 필요. icloud/custom/local은 불필요.

검증: `scripts/test-storage.ts` PASS (icloud·custom·login 저장/복구/append/중복방지).

## 분담
- 이 세션(설계/runtime): 위 contract API 추가 + 말풍선2개 버그 + onboarding 상태머신 골격.
- no3(storage/oauth): ✅ 5번 OAuth 조사(버그 아님) + getStorageInfo + switchStorage/logout +
  STORAGE_OPTIONS 모두 완료, src/index.ts에서 export. UI는 위 "Storage API" 절대로 호출하면 됨.
- no2(UI): onboarding 화면(A~C) + 모델 드롭다운 + 저장소 보기/바꾸기 패널.
