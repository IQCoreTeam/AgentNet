import type { Msg } from "./index";

// Single source of truth for every user-facing string on the onboarding + settings surfaces.
// Components import `M` and render with `t(M.surface.key)` (from ./index), so all copy lives
// here in one file: easy to review, hand to a translator, or extend. Add a language by adding
// its key to `m()` and filling it across the entries below; missing keys fall back to English.
//
// Terminal tokens that stay identical in every language (e.g. ">FIRST_BOOT_", ">WELCOME_SEQ",
// ">STEP_01/03", reward labels, "Solana Mainnet", engine names) are left inline in the JSX and
// are intentionally NOT collected here.
const m = (en: string, ko: string): Msg => ({ en, ko });

export const M = {
  welcome: {
    titleBar: m("Welcome_Aboard", "환영합니다"),
    connect: m("Connect", "연결"),
    notNow: m("Not now", "지금은 연결 안 할래요"),
    next: m("Next >", "다음 >"),
    dontShowAgain: m("Do not show this again", "다시 보지 않기"),
    cards: {
      developer: {
        title: m("You are a developer now", "이제부터 당신은 개발자입니다"),
        body: m(
          "Your phone is now a computer with a genius developer friend inside. You can build anything. Ask that friend to do anything for you.",
          "이제 이 폰은 천재 개발자 친구가 들어있는 컴퓨터예요. 무엇이든 만들 수 있어요. 당신이 그 친구에게 무엇이든 시켜봐요.",
        ),
        footnote: m("No new account needed to start chatting.", "채팅을 시작하는 데 새 계정은 필요 없어요."),
      },
      sync: {
        title: m("Leave off here, pick up anywhere", "여기서 멈추고, 어디서든 이어서"),
        body: m(
          "Every chat session is encrypted and picks up on any device: your PC too, even over remote access.",
          "모든 대화 세션이 암호화되어 어떤 기기에서든 이어서 할 수 있어요. PC에서도, 원격접속으로도요.",
        ),
        footnote: m(
          "All of this and more: just hit Full unlock in Settings later. Cloud backup and the PC install guide are covered there.",
          "이런 것도 되니까, 나중에 설정에서 '풀 기능 언락'을 누르세요. 클라우드 백업부터 PC 설치 가이드까지 거기서 다 안내해요.",
        ),
      },
      earn: {
        title: m("Make prompts, earn money", "당신이 프롬프트를 만들어서 돈을 버세요"),
        body: m(
          "Skills teach your agent new tricks: making videos, trading, anything. Sell your best ones and get paid every time someone collects them.",
          "스킬은 에이전트에게 새로운 재주를 가르칩니다. 영상 제작, 트레이딩, 무엇이든요. 최고의 스킬을 판매하고 누군가 수집할 때마다 수익을 받으세요.",
        ),
        caption: m("Every skill is minted on-chain under your name.", "모든 스킬은 당신의 이름으로 온체인에 민팅됩니다."),
        advanceLabel: m("OK", "OK"),
        footnote: m(
          "Setup can wait. When you want to do something, drop by the market and set up then.",
          "설정은 나중에 해도 돼요. 하고 싶은 게 생기면 마켓에 들러서 그때 설정하세요.",
        ),
      },
      gettingStarted: {
        title: m("Connect your coding engine", "코딩 엔진을 연결하세요"),
        body: m(
          "This is the only setup: connect claude or codex and you can start coding right away.",
          "설정은 이거 딱 하나. claude나 codex 중 하나만 연결하면 바로 코딩을 시작할 수 있어요.",
        ),
      },
    },
  },

  unlock: {
    titleBar: m("AgentNet Full Unlock", "에이전트넷 풀 언락"),
    progress: m("Unlock_Progress", "잠금해제_진행도"),
    creatingTitle: m("Setting up", "준비 중"),
    creatingBody: m(
      "Creating your wallet. No signature, no payment. This just takes a moment.",
      "지갑을 만들고 있어요. 서명도, 결제도 없어요. 잠깐이면 됩니다.",
    ),
    locked: m("Locked", "잠김"),
    fund: {
      title: m("Fund_Wallet", "지갑_충전"),
      status: m("Optional", "선택사항"),
      detail: m(
        "Your wallet was created to encrypt every chat session and to buy and sell skills. There is no need to add funds now.",
        "당신의 모든 대화 세션을 암호화하고, 스킬을 사고팔 수 있게 지갑을 만들었어요. 이 지갑을 기억해 두세요.",
      ),
    },
    cloud: {
      title: m("Cloud_Backup", "클라우드_백업"),
      status: m("Needed_for_Sync", "동기화_필수"),
      detail: m(
        "Back up encrypted sessions to your own Google Drive. This is what lets another device pick up your work. Your wallet key encrypts everything before upload; nobody else can read it.",
        "암호화된 세션을 내 Google Drive에 백업합니다. 다른 기기가 작업을 이어받는 방법이에요. 업로드 전에 지갑 키로 모두 암호화되어 다른 누구도 읽을 수 없습니다.",
      ),
      note: m(
        "Sessions stay on this device until you connect. You can do this later in Settings.",
        "연결 전까지 세션은 이 기기에만 저장됩니다. 나중에 설정에서 할 수 있어요.",
      ),
    },
    rpc: {
      title: m("Market_RPC", "마켓_RPC"),
      status: m("Optional_Module", "선택_모듈"),
      detail: m(
        "Completely optional. The public RPC works by default. Paste a Helius key for faster market indexing.",
        "완전 선택사항입니다. 기본은 퍼블릭 RPC로 그대로 동작해요. 더 빠른 마켓 인덱싱을 원하면 Helius 키를 붙여넣으세요.",
      ),
    },
    skipForNow: m("Skip for now", "지금은 건너뛰기"),
    fundControls: {
      addressLabel: m("YOUR_WALLET_ADDRESS", "내_지갑_주소"),
      copy: m("[copy]", "[복사]"),
      copied: m("[copied]", "[복사됨]"),
      alsoInMenu: m("Also in the agent menu and Settings, any time.", "에이전트 메뉴와 설정에서도 언제든 볼 수 있어요."),
      linkLabel: m("HOW_TO_ADD_FUNDS", "충전_방법"),
      linkSub: m("Buy SOL and send it here · phantom guide", "SOL 구매 · phantom 가이드"),
      fundLater: m("I will fund later", "나중에 충전할게요"),
      caption: m("Your wallet is always in the agent menu and Settings.", "지갑은 언제나 에이전트 메뉴와 설정에 있어요."),
    },
    reason: {
      skills: { title: m("Build your skill collection", "내 스킬 컬렉션 만들기"), returnLabel: m("Open my skills", "내 스킬 열기") },
      buy: { title: m("Collect this skill", "이 스킬 수집하기"), returnLabel: m("Continue purchase", "구매 계속하기") },
      publish: { title: m("Publish your work", "내 작업 게시하기"), returnLabel: m("Continue publishing", "게시 계속하기") },
      comment: { title: m("Join the conversation", "대화에 참여하기"), returnLabel: m("Continue to comment", "댓글 계속 작성") },
      identity: { title: m("Claim your agent identity", "에이전트 정체성 만들기"), returnLabel: m("Open my agent", "내 에이전트 열기") },
      sync: { title: m("Take your sessions anywhere", "세션을 어디서든 이어가기"), returnLabel: m("Set up sync", "동기화 설정") },
    },
  },

  templates: {
    picker: {
      title: m("Start from a template", "탬플릿으로 바로 시작해요"),
      body: m("Engine connected. Pick your first build.", "엔진이 연결됐어요. 첫 작업을 골라볼까요?"),
      justStart: m("Just start", "그냥 시작하기"),
    },
    confirm: m("Confirm", "확인"),
    back: m("Back", "뒤로"),
    aboutme: {
      titleBar: m("About_Me_Page", "자기소개 페이지"),
      title: m("A one-page site about you", "나를 소개하는 원페이지 사이트"),
      body: m("All it takes: one public link the agent can read, plus a short intro.", "에이전트가 볼 수 있는 공개 링크 하나와 짧은 소개만 있으면 돼요."),
      caption: m(
        "Confirm sends this into the chat, and the agent reads your link and starts building the page.",
        "확인을 누르면 이 내용이 채팅에 바로 전송되고, 에이전트가 링크를 읽고 페이지를 만들기 시작해요.",
      ),
      menuLabel: m("01_ABOUT_ME_PAGE", "01_자기소개_페이지"),
      menuSub: m("A one-page site introducing you", "나를 소개하는 원페이지 사이트"),
      workLinkLabel: m("YOUR_WORK_LINK", "작업_링크"),
      workLinkPlaceholder: m(
        "https:// a public link to your work (drive, github, blog)",
        "https:// 공개 드라이브 · 깃허브 · 블로그 등 내 작업이 모인 링크 (에이전트가 확인할 수 있게)",
      ),
      aboutYouLabel: m("ABOUT_YOU", "자기소개"),
      aboutYouPlaceholder: m(
        "e.g. I love taking photos and live with two cats. Currently starting a cooking channel.",
        "예: 사진 찍는 걸 좋아하고, 고양이 두 마리와 삽니다. 지금은 요리 유튜브를 준비 중이에요.",
      ),
    },
    game: {
      titleBar: m("Mini_Game", "미니 게임"),
      title: m("A mini game of your own", "나만의 미니 게임"),
      body: m("Pick a type and name a hero. The agent handles the rest.", "종류 하나 고르고 주인공만 정하면 돼요. 나머지는 에이전트가 알아서 만들어요."),
      caption: m(
        "Confirm sends this into the chat, and the agent starts building the game.",
        "확인을 누르면 이 내용이 채팅에 바로 전송되고, 에이전트가 게임을 만들기 시작해요.",
      ),
      menuLabel: m("02_MINI_GAME", "02_미니_게임"),
      menuSub: m("A simple tap-to-play game of your own", "탭해서 노는 나만의 심플 게임"),
      typeLabel: m("GAME_TYPE", "게임_종류"),
      tap: { label: m("Tap game", "탭 게임"), hint: m("tap fast to score", "빠르게 연타해 점수 올리기") },
      puzzle: { label: m("Puzzle", "퍼즐"), hint: m("match blocks to clear", "블록을 맞춰서 없애기") },
      reflex: { label: m("Reflex", "반응속도"), hint: m("tap right on time", "타이밍 맞춰 탭하기") },
      heroLabel: m("HERO_OR_THEME", "주인공_또는_테마"),
      heroPlaceholder: m("e.g. a cat running while eating kimbap", "예: 김밥을 먹으며 달리는 고양이"),
    },
    // Appended to the agent prompt when the user is on Korean, so the built page/game and the
    // agent's replies come back in Korean. English keeps the prompt as-is.
    promptLangDirective: m("", "\n\nWrite the page's visible text and your replies to me in Korean."),
  },

  menu: {
    myAgent: m("My Agent", "내 에이전트"),
    myAgentSub: m("Profile, skills, identity", "프로필, 스킬, 아이덴티티"),
    settings: m("Settings", "설정"),
    settingsSub: m("Storage, RPC, GitHub, wallet", "저장소, RPC, GitHub, 지갑"),
    recents: m("Recents", "최근 항목"),
    offlineSaved: m("Offline · showing saved chats", "오프라인 · 저장된 채팅 표시"),
    cloudSignedOut: m("Cloud sync signed out · showing this device only · reconnect in Storage", "클라우드 동기화 로그아웃됨 · 이 기기만 표시 · 저장소에서 재연결"),
    cloudUnreachable: m("Cloud unreachable · showing this device only", "클라우드 연결 불가 · 이 기기만 표시"),
    youreOffline: m("You're offline", "오프라인 상태예요"),
    recentChatsSync: m("Recent chats sync when you reconnect.", "다시 연결되면 최근 채팅이 동기화돼요."),
    syncing: m("syncing…", "동기화 중…"),
    noChats: m("No chats yet.", "아직 채팅이 없어요."),
    untitled: m("(untitled)", "(제목 없음)"),
    newChat: m("New chat", "새 채팅"),
    deleteChat: m("Delete chat", "채팅 삭제"),
  },

  settings: {
    header: m("Settings", "설정"),
    back: m("Back", "뒤로"),
    mySkills: m("My Skills", "내 스킬"),
    owned: m("owned", "개 보유"),
    connectWalletForSkills: m("Connect a wallet to equip skills", "스킬을 장착하려면 지갑 연결"),
    myWallet: m("My Wallet", "내 지갑"),
    addFunds: m("add funds", "충전"),
    setUp: m("Set up AgentNet", "에이전트넷 세팅하기"),
    setUpSub: m("Wallet · cloud backup · market, one unlock", "지갑 · 클라우드 백업 · 마켓, 한 번에 언락"),
    storage: m("Storage", "저장소"),
    localOnly: m("Local only", "로컬 전용"),
    customCloud: m("Custom Cloud", "커스텀 클라우드"),
    synced: m("synced", "동기화됨"),
    syncError: m("sync error", "동기화 오류"),
    marketRpc: m("Market RPC", "마켓 RPC"),
    heliusRecommended: m("Helius key recommended", "Helius 키 권장"),
    githubConnected: m("connected", "연결됨"),
    githubTokenSet: m("token set", "토큰 설정됨"),
    githubPrivateRepo: m("Private repo access", "비공개 저장소 접근"),
    aiConnections: m("AI Connections", "AI 연결"),
    connectedSuffix: m("connected", "연결됨"),
    notSignedIn: m("Not signed in", "로그인 안 됨"),
    connectedCap: m("CONNECTED", "연결됨"),
    online: m("ONLINE", "온라인"),
    notSetUp: m("NOT_SET_UP", "미설정"),
    language: m("Language", "언어"),
    languageHint: m("Defaults to your device language. Applies across onboarding and settings.", "기본값은 기기 언어를 따라가요. 온보딩과 설정 전반에 적용됩니다."),
    bgRun: m("Background run", "백그라운드 실행"),
    bgRunOn: m("Runs in the background only while a task is active", "작업이 진행 중일 때만 백그라운드에서 실행돼요"),
    bgRunOff: m("Agent stops when you leave the app", "앱을 나가면 에이전트가 멈춰요"),
    bgRunNote: m("Uses more battery while a task runs in the background. No task = nothing runs.", "백그라운드에서 작업이 돌 때 배터리를 더 써요. 작업이 없으면 아무것도 안 돌아요."),
    bgOffToast: m("Background off: task keeps running while the app is open.", "백그라운드 꺼짐: 앱이 열려 있는 동안엔 작업이 계속 실행돼요."),
    runWhileLocked: m("Run while locked", "잠금 상태에서 실행"),
    runWhileLockedNeedBg: m("Turn on background execution first", "먼저 백그라운드 실행을 켜세요"),
    runWhileLockedOn: m("Keeps active tasks running with the screen off", "화면이 꺼져도 진행 중인 작업을 계속 실행해요"),
    runWhileLockedOff: m("Pauses may occur after the screen turns off", "화면이 꺼진 뒤 멈출 수 있어요"),
    runWhileLockedNote: m("Uses more battery during active tasks. Approval requests and completed turns vibrate on the lock screen.", "작업 중에는 배터리를 더 써요. 승인 요청과 완료된 턴은 잠금화면에서 진동으로 알려줘요."),
  },

  wallet: {
    header: m("My Wallet", "내 지갑"),
    addressLabel: m("YOUR_WALLET_ADDRESS", "내_지갑_주소"),
    copy: m("[copy]", "[복사]"),
    copied: m("[copied]", "[복사됨]"),
    addFundsLabel: m("ADD_FUNDS", "충전하기"),
    addFundsSub: m("Buy SOL and send it here · phantom guide", "SOL을 구매해 이 주소로 전송 · phantom 가이드"),
    explorerLabel: m("VIEW_ON_EXPLORER", "익스플로러에서_보기"),
    explorerSub: m("solscan.io/account · opens in browser", "solscan.io/account · 브라우저에서 열림"),
    network: m("Network", "네트워크"),
    disconnect: m("Disconnect_Wallet", "지갑_연결해제"),
    disconnectSub: m("Clears the saved session on this device", "이 기기에 저장된 세션을 지웁니다"),
    confirmDisconnect: m("CONFIRM_DISCONNECT", "연결해제_확인"),
    confirmWarning: m(
      "Make sure you can recover this wallet first. This clears its key from this device, and there is no in-app backup. If you have not saved a way to restore it, you could lose access to this wallet and any funds in it.",
      "먼저 이 지갑을 복구할 수 있는지 확인하세요. 이 기기에서 키가 지워지고, 앱 내 백업은 없어요. 복원할 방법을 저장해두지 않았다면 이 지갑과 그 안의 자금에 접근하지 못할 수 있어요.",
    ),
    keepWallet: m("Keep wallet", "지갑 유지"),
    disconnectAction: m("Disconnect", "연결해제"),
  },

  storagePicker: {
    thisDevice: m("This device only", "이 기기만"),
    thisDeviceSub: m("Sessions stay local. No cloud mirror.", "세션이 로컬에만 저장됩니다. 클라우드 미러 없음."),
    connected: m("Connected", "연결됨"),
    gdriveSub: m("Mirror sessions to your own Google account", "내 Google 계정으로 세션 미러링"),
    customStorage: m("Custom Storage", "커스텀 저장소"),
    customStorageSub: m("Mirror to an S3 / WebDAV / HTTP endpoint", "S3 / WebDAV / HTTP 엔드포인트로 미러링"),
    done: m("Done", "완료"),
  },

  engines: {
    connected: m("Connected", "연결됨"),
    notSignedIn: m("Not signed in", "로그인 안 됨"),
    updatingLong: m("Updating, this can take a minute", "업데이트 중, 1분 정도 걸릴 수 있어요"),
    available: m("available", "사용 가능"),
    updating: m("Updating", "업데이트 중"),
    update: m("Update", "업데이트"),
    logOut: m("Log out", "로그아웃"),
    connect: m("Connect", "연결"),
    note: m(
      "Connect opens that engine's sign-in. Signing out removes its credentials from this device; chat locks until an engine is connected again. Updates install straight from the official npm registry.",
      "연결을 누르면 해당 엔진의 로그인이 열려요. 로그아웃하면 이 기기에서 자격 증명이 제거되고, 엔진을 다시 연결할 때까지 채팅이 잠깁니다. 업데이트는 공식 npm 레지스트리에서 바로 설치돼요.",
    ),
  },

  custom: {
    header: m("Custom Cloud", "커스텀 클라우드"),
    endpointUrl: m("Endpoint URL", "엔드포인트 URL"),
    authHeader: m("Auth Header (optional)", "인증 헤더 (선택)"),
    bearerPlaceholder: m("Bearer token...", "Bearer 토큰..."),
    connectStorage: m("Connect Storage", "저장소 연결"),
    cancel: m("Cancel", "취소"),
  },

  gdrive: {
    startingLogin: m("Starting Login…", "로그인 시작 중…"),
    signIn: m("Sign in to Google Drive", "Google Drive 로그인"),
    instructions: m("Google sign-in opened in your browser. Approve Drive access, then return to AgentNet.", "브라우저에서 Google 로그인이 열렸어요. Drive 접근을 승인한 뒤 AgentNet으로 돌아오세요."),
    openAgain: m("Open Google Again", "Google 다시 열기"),
    hideManual: m("Hide manual code entry", "수동 코드 입력 숨기기"),
    useManual: m("Having trouble? Use code manually", "문제가 있나요? 코드를 직접 입력하세요"),
    openAuthUrl: m("Open Authorization URL", "인증 URL 열기"),
    copied: m("Copied!", "복사됨!"),
    copyLink: m("Copy link", "링크 복사"),
    pastePlaceholder: m("Paste URL or code here", "URL이나 코드를 붙여넣으세요"),
    confirm: m("Confirm", "확인"),
    cancel: m("Cancel", "취소"),
  },
};
