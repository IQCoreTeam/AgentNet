# Integration Test Plan — wallet → claude/codex wrapper → encrypted synced sessions

3개 세션(runtime / vscode UI / storage)이 `contract.ts`로 합쳐진 뒤, 통합 동작을
레이어별로 검증한다. 각 단계는 **이전 단계가 통과해야** 다음으로 간다 (bottom-up).

## L0 — 이미 통과한 단위 (회귀 확인용)
- `pnpm test:run` (runtime): claude+codex 캡처 → append 암호화 → 복구, 공유 세션 grow. ✅
- `pnpm test:storage` (storage): icloud/custom put+append+restore, login 플로우. ✅
- vscode `pnpm build` + F5(mock 제거 후 real): 패널 오픈, 세션목록, 입력. ✅(빌드)

## L1 — 런타임 통합 (CLI 실물, 로컬 저장)
| # | 검증 | 방법 | 기대 |
|---|---|---|---|
| 1.1 | claude 1턴 캡처+저장 | test:run | assistant 메시지 .log에 암호화 저장 |
| 1.2 | codex 1턴 캡처+저장 | test:run | 〃 |
| 1.3 | 같은 세션 append | test:run turn2 | msgs 2→4, 파일 1개 (중복X) |
| 1.4 | 껐다 켜기 복구 | 새 SessionStore.load | 메시지 순서대로 재조립 |

## L2 — 저장소 교체 (manual → cloud)
| # | 검증 | 방법 | 기대 |
|---|---|---|---|
| 2.1 | icloud 폴더 저장 | initialize({kind:"icloud"}) → 세션 | iCloud Drive 경로에 .log |
| 2.2 | custom HTTP 저장 | initialize({kind:"custom"}) | 유저 엔드포인트에 PUT |
| 2.3 | gdrive (ID 발급 후) | GOOGLE_CLIENT_ID + initialize gdrive | appDataFolder 업로드 |
| 2.4 | 저장소 바꿔도 같은 세션 | config 교체 후 load | 복호화 동일 (지갑키 동일) |

## L3 — VSCode UI 통합 (눈으로)
| # | 검증 | 방법 | 기대 |
|---|---|---|---|
| 3.1 | 패널에서 실제 claude 대화 | F5 → 입력 | 진짜 claude 응답이 버블에 |
| 3.2 | 세션 목록 = 저장된 것 | 좌측 목록 | listSessions가 .log들 반영 |
| 3.3 | 세션 클릭 → resume | 목록 클릭 | 그 세션 이어서 대화 |
| 3.4 | 새 세션 → 별도 파일 | + New | 새 sessionId .log 추가 |

## L4 — 동기화 (끝목표: 기기·CLI 가로질러)
| # | 검증 | 방법 | 기대 |
|---|---|---|---|
| 4.1 | claude→codex 공유 | 같은 sessionId로 codex resume | claude 대화를 codex가 이어봄 |
| 4.2 | 기기 A→B (클라우드) | A에서 저장 → B에서 같은 지갑 login → load | B에서 세션 복구 |
| 4.3 | 같은 지갑 = 같은 복호화 | 다른 머신 deriveSessionKey | 동일 키로 복호화 성공 |

## L5 — 보안/엣지 (놓치기 쉬운 것)
- 다른 지갑으로 복호화 시도 → 실패해야 (남의 세션 못 봄)
- 동시 2턴 append 레이스 → 순서 안 깨지나
- CLI 비로그인/크래시 → 깔끔히 에러 (멈춤 X)
- 큰 세션(수백 메시지) append 성능 / load 시간
- OAuth 토큰은 로컬만 (우리 서버 0) 재확인

## 실행 순서
L1(지금 가능) → L3(F5, 지금 가능) → L2 cloud(icloud/custom 지금, gdrive는 ID 후)
→ L4 동기화 → L5 보안. 각 통과 시 체크.

## 미해결 (테스트가 드러낼 것)
- claude `--resume`이 우리가 만든 sessionId를 항상 찾나 (claude 내부 세션과 우리 id 매핑)
- codex `exec resume`의 thread 영속 위치 (CODEX_HOME) 가 우리 저장과 별개로 쌓이는지
- partial(타이핑 델타)은 아직 미구현 — UI는 완성단위로 받음 (나중 채움)
