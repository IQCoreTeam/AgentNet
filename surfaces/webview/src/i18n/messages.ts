import type { Msg } from "./index";

// Single source of truth for every user-facing string on the onboarding + settings surfaces.
// Components import `M` and render with `t(M.surface.key)` (from ./index), so all copy lives
// here in one file: easy to review, hand to a translator, or extend. Each entry is m(en, ko, ru);
// add a language by adding its arg to m() and filling it across the entries below. Missing keys
// fall back to English.
//
// Terminal tokens that stay identical in every language (e.g. ">FIRST_BOOT_", ">WELCOME_SEQ",
// ">STEP_01/03", reward labels, "Solana Mainnet", engine names) are left inline in the JSX and
// are intentionally NOT collected here.
const m = (en: string, ko: string, ru: string): Msg => ({ en, ko, ru });

export const M = {
  welcome: {
    titleBar: m("Welcome_Aboard", "환영합니다", "Добро_Пожаловать"),
    connect: m("Connect", "연결", "Подключить"),
    notNow: m("Not now", "지금은 연결 안 할래요", "Не сейчас"),
    next: m("Next >", "다음 >", "Далее >"),
    dontShowAgain: m("Do not show this again", "다시 보지 않기", "Больше не показывать"),
    cards: {
      developer: {
        title: m("You are a developer now", "이제부터 당신은 개발자입니다", "Теперь вы разработчик"),
        body: m(
          "Your phone is now a computer with a genius developer friend inside. You can build anything. Ask that friend to do anything for you.",
          "이제 이 폰은 천재 개발자 친구가 들어있는 컴퓨터예요. 무엇이든 만들 수 있어요. 당신이 그 친구에게 무엇이든 시켜봐요.",
          "Ваш телефон теперь компьютер, внутри которого живёт гениальный друг-разработчик. Можно создать что угодно. Поручите этому другу любое дело.",
        ),
        footnote: m("No new account needed to start chatting.", "채팅을 시작하는 데 새 계정은 필요 없어요.", "Чтобы начать чат, новый аккаунт не нужен."),
      },
      sync: {
        title: m("Leave off here, pick up anywhere", "여기서 멈추고, 어디서든 이어서", "Прервитесь здесь, продолжите где угодно"),
        body: m(
          "Every chat session is encrypted and picks up on any device: your PC too, even over remote access.",
          "모든 대화 세션이 암호화되어 어떤 기기에서든 이어서 할 수 있어요. PC에서도, 원격접속으로도요.",
          "Каждая сессия чата зашифрована и продолжается на любом устройстве: и на вашем ПК, даже через удалённый доступ.",
        ),
        footnote: m(
          "All of this and more: just hit Full unlock in Settings later. Cloud backup and the PC install guide are covered there.",
          "이런 것도 되니까, 나중에 설정에서 '풀 기능 언락'을 누르세요. 클라우드 백업부터 PC 설치 가이드까지 거기서 다 안내해요.",
          "Всё это и не только: позже нажмите 'Полная разблокировка' в настройках. Облачная синхронизация и гайд по установке на ПК тоже там.",
        ),
      },
      earn: {
        title: m("Make prompts, earn money", "당신이 프롬프트를 만들어서 돈을 버세요", "Создавайте промты, зарабатывайте"),
        body: m(
          "Skills teach your agent new tricks: making videos, trading, anything. Sell your best ones and get paid every time someone collects them.",
          "스킬은 에이전트에게 새로운 재주를 가르칩니다. 영상 제작, 트레이딩, 무엇이든요. 최고의 스킬을 판매하고 누군가 수집할 때마다 수익을 받으세요.",
          "Скиллы дают вашему агенту новые возможности: создание видео, торговля, что угодно. Продавайте лучшие и получайте оплату каждый раз, когда их покупают.",
        ),
        caption: m("Every skill is minted on-chain under your name.", "모든 스킬은 당신의 이름으로 온체인에 민팅됩니다.", "Каждый скилл выпускается в блокчейне под вашим именем."),
        advanceLabel: m("OK", "OK", "OK"),
        footnote: m(
          "Setup can wait. When you want to do something, drop by the market and set up then.",
          "설정은 나중에 해도 돼요. 하고 싶은 게 생기면 마켓에 들러서 그때 설정하세요.",
          "Настройка подождёт. Когда захотите что-то сделать, загляните в маркет и настройте тогда.",
        ),
      },
      gettingStarted: {
        title: m("Connect your coding engine", "코딩 엔진을 연결하세요", "Подключите кодинг-движок"),
        body: m(
          "This is the only setup: connect claude or codex and you can start coding right away.",
          "설정은 이거 딱 하나. claude나 codex 중 하나만 연결하면 바로 코딩을 시작할 수 있어요.",
          "Это вся настройка: подключите claude или codex и можно сразу начинать кодить.",
        ),
      },
    },
  },

  unlock: {
    titleBar: m("AgentNet Full Unlock", "에이전트넷 풀 언락", "AgentNet Полная Разблокировка"),
    progress: m("Unlock_Progress", "잠금해제_진행도", "Прогресс_Разблокировки"),
    creatingTitle: m("Setting up", "준비 중", "Подготовка"),
    creatingBody: m(
      "Creating your wallet. No signature, no payment. This just takes a moment.",
      "지갑을 만들고 있어요. 서명도, 결제도 없어요. 잠깐이면 됩니다.",
      "Создаём ваш кошелёк. Без подписи, без оплаты. Это займёт мгновение.",
    ),
    locked: m("Locked", "잠김", "Заблокировано"),
    fund: {
      title: m("Fund_Wallet", "지갑_충전", "Пополнить_Кошелёк"),
      status: m("Optional", "선택사항", "Опционально"),
      detail: m(
        "Your wallet was created to encrypt every chat session and to buy and sell skills. There is no need to add funds now.",
        "당신의 모든 대화 세션을 암호화하고, 스킬을 사고팔 수 있게 지갑을 만들었어요. 이 지갑을 기억해 두세요.",
        "Кошелёк создан, чтобы шифровать каждую сессию чата и покупать и продавать скиллы. Пополнять сейчас не нужно.",
      ),
    },
    cloud: {
      title: m("Cloud_Backup", "클라우드_백업", "Облачная_Синхронизация"),
      status: m("Needed_for_Sync", "동기화_필수", "Нужно_для_синка"),
      detail: m(
        "Back up encrypted sessions to your own Google Drive. This is what lets another device pick up your work. Your wallet key encrypts everything before upload; nobody else can read it.",
        "암호화된 세션을 내 Google Drive에 백업합니다. 다른 기기가 작업을 이어받는 방법이에요. 업로드 전에 지갑 키로 모두 암호화되어 다른 누구도 읽을 수 없습니다.",
        "Бэкап зашифрованных сессий в ваш собственный Google Drive. Именно это позволяет другому устройству продолжить вашу работу. Ключ кошелька шифрует всё перед загрузкой; никто другой не сможет это прочитать.",
      ),
      note: m(
        "Sessions stay on this device until you connect. You can do this later in Settings.",
        "연결 전까지 세션은 이 기기에만 저장됩니다. 나중에 설정에서 할 수 있어요.",
        "Пока не подключите, сессии остаются на этом устройстве. Можно сделать позже в настройках.",
      ),
    },
    rpc: {
      title: m("Market_RPC", "마켓_RPC", "Маркет_RPC"),
      status: m("Optional_Module", "선택_모듈", "Опциональный_Модуль"),
      detail: m(
        "Completely optional. The public RPC works by default. Paste a Helius key for faster market indexing.",
        "완전 선택사항입니다. 기본은 퍼블릭 RPC로 그대로 동작해요. 더 빠른 마켓 인덱싱을 원하면 Helius 키를 붙여넣으세요.",
        "Полностью опционально. По умолчанию работает публичный RPC. Вставьте ключ Helius для более быстрой индексации маркета.",
      ),
    },
    skipForNow: m("Skip for now", "지금은 건너뛰기", "Пока пропустить"),
    fundControls: {
      addressLabel: m("YOUR_WALLET_ADDRESS", "내_지갑_주소", "АДРЕС_КОШЕЛЬКА"),
      copy: m("[copy]", "[복사]", "[СКОПИРОВАТЬ]"),
      copied: m("[copied]", "[복사됨]", "[СКОПИРОВАНО]"),
      alsoInMenu: m("Also in the agent menu and Settings, any time.", "에이전트 메뉴와 설정에서도 언제든 볼 수 있어요.", "Также в меню агента и в настройках, в любой момент."),
      linkLabel: m("HOW_TO_ADD_FUNDS", "충전_방법", "КАК_ПОПОЛНИТЬ"),
      linkSub: m("Buy SOL and send it here · phantom guide", "SOL 구매 · phantom 가이드", "Купить SOL · гайд phantom"),
      fundLater: m("I will fund later", "나중에 충전할게요", "Пополнить позже"),
      caption: m("Your wallet is always in the agent menu and Settings.", "지갑은 언제나 에이전트 메뉴와 설정에 있어요.", "Ваш кошелёк всегда в меню агента и в настройках."),
    },
    reason: {
      skills: { title: m("Build your skill collection", "내 스킬 컬렉션 만들기", "Соберите свою коллекцию скиллов"), returnLabel: m("Open my skills", "내 스킬 열기", "Открыть мои скиллы") },
      buy: { title: m("Collect this skill", "이 스킬 수집하기", "Получить этот скилл"), returnLabel: m("Continue purchase", "구매 계속하기", "Продолжить покупку") },
      publish: { title: m("Publish your work", "내 작업 게시하기", "Опубликовать вашу работу"), returnLabel: m("Continue publishing", "게시 계속하기", "Продолжить публикацию") },
      comment: { title: m("Join the conversation", "대화에 참여하기", "Присоединиться к обсуждению"), returnLabel: m("Continue to comment", "댓글 계속 작성", "Продолжить комментарий") },
      identity: { title: m("Claim your agent identity", "에이전트 정체성 만들기", "Создайте айдентику агента"), returnLabel: m("Open my agent", "내 에이전트 열기", "Открыть моего агента") },
      sync: { title: m("Take your sessions anywhere", "세션을 어디서든 이어가기", "Берите сессии куда угодно"), returnLabel: m("Set up sync", "동기화 설정", "Настроить синхронизацию") },
    },
  },

  templates: {
    picker: {
      title: m("Start from a template", "탬플릿으로 바로 시작해요", "Начните с шаблона"),
      body: m("Engine connected. Pick your first build.", "엔진이 연결됐어요. 첫 작업을 골라볼까요?", "Движок подключён. Выберите первый проект."),
      justStart: m("Just start", "그냥 시작하기", "Просто начать"),
    },
    confirm: m("Confirm", "확인", "Подтвердить"),
    back: m("Back", "뒤로", "Назад"),
    aboutme: {
      titleBar: m("About_Me_Page", "자기소개 페이지", "Страница_О_Себе"),
      title: m("A one-page site about you", "나를 소개하는 원페이지 사이트", "Одностраничный сайт о вас"),
      body: m("All it takes: one public link the agent can read, plus a short intro.", "에이전트가 볼 수 있는 공개 링크 하나와 짧은 소개만 있으면 돼요.", "Всё, что нужно: одна публичная ссылка, которую агент может прочитать, плюс короткое интро."),
      caption: m(
        "Confirm sends this into the chat, and the agent reads your link and starts building the page.",
        "확인을 누르면 이 내용이 채팅에 바로 전송되고, 에이전트가 링크를 읽고 페이지를 만들기 시작해요.",
        "Кнопка Подтвердить отправляет это в чат, агент читает вашу ссылку и начинает собирать страницу.",
      ),
      menuLabel: m("01_ABOUT_ME_PAGE", "01_자기소개_페이지", "01_СТРАНИЦА_О_СЕБЕ"),
      menuSub: m("A one-page site introducing you", "나를 소개하는 원페이지 사이트", "Одностраничный сайт о вас"),
      workLinkLabel: m("YOUR_WORK_LINK", "작업_링크", "ССЫЛКА_НА_РАБОТЫ"),
      workLinkPlaceholder: m(
        "https:// a public link to your work (drive, github, blog)",
        "https:// 공개 드라이브 · 깃허브 · 블로그 등 내 작업이 모인 링크 (에이전트가 확인할 수 있게)",
        "https:// публичная ссылка на ваши работы · drive, github, блог (чтобы агент мог посмотреть)",
      ),
      aboutYouLabel: m("ABOUT_YOU", "자기소개", "О_СЕБЕ"),
      aboutYouPlaceholder: m(
        "e.g. I love taking photos and live with two cats. Currently starting a cooking channel.",
        "예: 사진 찍는 걸 좋아하고, 고양이 두 마리와 삽니다. 지금은 요리 유튜브를 준비 중이에요.",
        "напр. Люблю фотографировать, живу с двумя котами. Начинаю кулинарный канал.",
      ),
    },
    game: {
      titleBar: m("Mini_Game", "미니 게임", "Мини_Игра"),
      title: m("A mini game of your own", "나만의 미니 게임", "Ваша собственная мини-игра"),
      body: m("Pick a type and name a hero. The agent handles the rest.", "종류 하나 고르고 주인공만 정하면 돼요. 나머지는 에이전트가 알아서 만들어요.", "Выберите тип и назовите героя. Остальное сделает агент."),
      caption: m(
        "Confirm sends this into the chat, and the agent starts building the game.",
        "확인을 누르면 이 내용이 채팅에 바로 전송되고, 에이전트가 게임을 만들기 시작해요.",
        "Кнопка Подтвердить отправляет это в чат, и агент начинает собирать игру.",
      ),
      menuLabel: m("02_MINI_GAME", "02_미니_게임", "02_МИНИ_ИГРА"),
      menuSub: m("A simple tap-to-play game of your own", "탭해서 노는 나만의 심플 게임", "Ваша собственная тап-игра"),
      typeLabel: m("GAME_TYPE", "게임_종류", "ТИП_ИГРЫ"),
      tap: { label: m("Tap game", "탭 게임", "Тап-игра"), hint: m("tap fast to score", "빠르게 연타해 점수 올리기", "тапай быстро, набирай очки") },
      puzzle: { label: m("Puzzle", "퍼즐", "Пазл"), hint: m("match blocks to clear", "블록을 맞춰서 없애기", "соединяй блоки") },
      reflex: { label: m("Reflex", "반응속도", "Реакция"), hint: m("tap right on time", "타이밍 맞춰 탭하기", "успей нажать вовремя") },
      heroLabel: m("HERO_OR_THEME", "주인공_또는_테마", "ГЕРОЙ_ИЛИ_ТЕМА"),
      heroPlaceholder: m("e.g. a cat running while eating kimbap", "예: 김밥을 먹으며 달리는 고양이", "напр. кот бежит и ест кимбап"),
    },
    // Appended to the agent prompt for a non-English locale, so the built page/game and the
    // agent's replies come back in that language. English keeps the prompt as-is.
    promptLangDirective: m(
      "",
      "\n\nWrite the page's visible text and your replies to me in Korean.",
      "\n\nWrite the page's visible text and your replies to me in Russian.",
    ),
  },

  agentProfile: {
    blog: {
      postTitle: m("Blog Post", "블로그 글", "Пост блога"),
      viewAll: m("view all", "전체 보기", "все записи"),
      listTitle: m("All posts", "전체 글", "Все записи"),
    },
  },

  menu: {
    myAgent: m("My Agent", "내 에이전트", "Мой Агент"),
    myAgentSub: m("Profile, skills, identity", "프로필, 스킬, 아이덴티티", "Профиль, скиллы, айдентика"),
    settings: m("Settings", "설정", "Настройки"),
    settingsSub: m("Storage, RPC, GitHub, wallet", "저장소, RPC, GitHub, 지갑", "Хранилище, RPC, GitHub, кошелёк"),
    recents: m("Recents", "최근 항목", "Недавние"),
    offlineSaved: m("Offline · showing saved chats", "오프라인 · 저장된 채팅 표시", "Оффлайн · показаны сохранённые чаты"),
    cloudSignedOut: m("Cloud sync signed out · showing this device only · reconnect in Storage", "클라우드 동기화 로그아웃됨 · 이 기기만 표시 · 저장소에서 재연결", "Облачная синхронизация вышла · показано только это устройство · переподключите в Хранилище"),
    cloudUnreachable: m("Cloud unreachable · showing this device only", "클라우드 연결 불가 · 이 기기만 표시", "Облако недоступно · показано только это устройство"),
    youreOffline: m("You're offline", "오프라인 상태예요", "Вы оффлайн"),
    recentChatsSync: m("Recent chats sync when you reconnect.", "다시 연결되면 최근 채팅이 동기화돼요.", "Недавние чаты синхронизируются при переподключении."),
    syncing: m("syncing…", "동기화 중…", "синхронизация…"),
    noChats: m("No chats yet.", "아직 채팅이 없어요.", "Пока нет чатов."),
    untitled: m("(untitled)", "(제목 없음)", "(без названия)"),
    newChat: m("New chat", "새 채팅", "Новый чат"),
    deleteChat: m("Delete chat", "채팅 삭제", "Удалить чат"),
  },

  settings: {
    header: m("Settings", "설정", "Настройки"),
    back: m("Back", "뒤로", "Назад"),
    mySkills: m("My Skills", "내 스킬", "Мои Скиллы"),
    owned: m("owned", "개 보유", "своих"),
    connectWalletForSkills: m("Connect a wallet to equip skills", "스킬을 장착하려면 지갑 연결", "Подключите кошелёк, чтобы ставить скиллы"),
    myWallet: m("My Wallet", "내 지갑", "Мой Кошелёк"),
    addFunds: m("add funds", "충전", "пополнить"),
    setUp: m("Set up AgentNet", "에이전트넷 세팅하기", "Настроить AgentNet"),
    setUpSub: m("Wallet · cloud backup · market, one unlock", "지갑 · 클라우드 백업 · 마켓, 한 번에 언락", "Кошелёк · облако · маркет, одна разблокировка"),
    storage: m("Storage", "저장소", "Хранилище"),
    localOnly: m("Local only", "로컬 전용", "Только локально"),
    customCloud: m("Custom Cloud", "커스텀 클라우드", "Своё Облако"),
    synced: m("synced", "동기화됨", "синхронизировано"),
    syncError: m("sync error", "동기화 오류", "ошибка синка"),
    marketRpc: m("Market RPC", "마켓 RPC", "Маркет RPC"),
    heliusRecommended: m("Helius key recommended", "Helius 키 권장", "Ключ Helius по желанию"),
    githubConnected: m("connected", "연결됨", "подключён"),
    githubTokenSet: m("token set", "토큰 설정됨", "токен задан"),
    githubPrivateRepo: m("Private repo access", "비공개 저장소 접근", "Доступ к приватным репо"),
    aiConnections: m("AI Connections", "AI 연결", "AI Подключения"),
    connectedSuffix: m("connected", "연결됨", "подключены"),
    notSignedIn: m("Not signed in", "로그인 안 됨", "Не выполнен вход"),
    connectedCap: m("CONNECTED", "연결됨", "ПОДКЛЮЧЕНО"),
    online: m("ONLINE", "온라인", "ОНЛАЙН"),
    notSetUp: m("NOT_SET_UP", "미설정", "НЕ_НАСТРОЕНО"),
    language: m("Language", "언어", "Язык"),
    languageHint: m("Defaults to your device language. Applies across onboarding and settings.", "기본값은 기기 언어를 따라가요. 온보딩과 설정 전반에 적용됩니다.", "По умолчанию язык устройства. Применяется к онбордингу и настройкам."),
    bgRun: m("Background run", "백그라운드 실행", "Фоновый запуск"),
    bgRunOn: m("Runs in the background only while a task is active", "작업이 진행 중일 때만 백그라운드에서 실행돼요", "Работает в фоне только пока задача активна"),
    bgRunOff: m("Agent stops when you leave the app", "앱을 나가면 에이전트가 멈춰요", "Агент останавливается, когда вы выходите из приложения"),
    bgRunNote: m("Uses more battery while a task runs in the background. No task = nothing runs.", "백그라운드에서 작업이 돌 때 배터리를 더 써요. 작업이 없으면 아무것도 안 돌아요.", "Больше расходует батарею, пока задача идёт в фоне. Нет задачи = ничего не работает."),
    bgOffToast: m("Background off: task keeps running while the app is open.", "백그라운드 꺼짐: 앱이 열려 있는 동안엔 작업이 계속 실행돼요.", "Фон выключен: задача продолжает работать, пока приложение открыто."),
    runWhileLocked: m("Run while locked", "잠금 상태에서 실행", "Работать при блокировке"),
    runWhileLockedNeedBg: m("Turn on background execution first", "먼저 백그라운드 실행을 켜세요", "Сначала включите фоновый запуск"),
    runWhileLockedOn: m("Keeps active tasks running with the screen off", "화면이 꺼져도 진행 중인 작업을 계속 실행해요", "Продолжает активные задачи при выключенном экране"),
    runWhileLockedOff: m("Pauses may occur after the screen turns off", "화면이 꺼진 뒤 멈출 수 있어요", "После выключения экрана возможны паузы"),
    runWhileLockedNote: m("Uses more battery during active tasks. Approval requests and completed turns vibrate on the lock screen.", "작업 중에는 배터리를 더 써요. 승인 요청과 완료된 턴은 잠금화면에서 진동으로 알려줘요.", "Больше расходует батарею во время задач. Запросы подтверждения и завершённые ходы вибрируют на экране блокировки."),
  },

  wallet: {
    header: m("My Wallet", "내 지갑", "Мой Кошелёк"),
    addressLabel: m("YOUR_WALLET_ADDRESS", "내_지갑_주소", "АДРЕС_КОШЕЛЬКА"),
    copy: m("[copy]", "[복사]", "[СКОПИРОВАТЬ]"),
    copied: m("[copied]", "[복사됨]", "[СКОПИРОВАНО]"),
    addFundsLabel: m("ADD_FUNDS", "충전하기", "ПОПОЛНИТЬ"),
    addFundsSub: m("Buy SOL and send it here · phantom guide", "SOL을 구매해 이 주소로 전송 · phantom 가이드", "Купить SOL и отправить сюда · гайд phantom"),
    explorerLabel: m("VIEW_ON_EXPLORER", "익스플로러에서_보기", "СМОТРЕТЬ_В_ЭКСПЛОРЕРЕ"),
    explorerSub: m("solscan.io/account · opens in browser", "solscan.io/account · 브라우저에서 열림", "solscan.io/account · откроется в браузере"),
    network: m("Network", "네트워크", "Сеть"),
    disconnect: m("Disconnect_Wallet", "지갑_연결해제", "Отключить_Кошелёк"),
    disconnectSub: m("Clears the saved session on this device", "이 기기에 저장된 세션을 지웁니다", "Удаляет сохранённую сессию на этом устройстве"),
    confirmDisconnect: m("CONFIRM_DISCONNECT", "연결해제_확인", "ПОДТВЕРДИТЬ_ОТКЛЮЧЕНИЕ"),
    confirmWarning: m(
      "Make sure you can recover this wallet first. This clears its key from this device, and there is no in-app backup. If you have not saved a way to restore it, you could lose access to this wallet and any funds in it.",
      "먼저 이 지갑을 복구할 수 있는지 확인하세요. 이 기기에서 키가 지워지고, 앱 내 백업은 없어요. 복원할 방법을 저장해두지 않았다면 이 지갑과 그 안의 자금에 접근하지 못할 수 있어요.",
      "Сначала убедитесь, что можете восстановить этот кошелёк. Это удалит его ключ с устройства, и резервной копии в приложении нет. Если вы не сохранили способ восстановления, вы можете потерять доступ к этому кошельку и средствам в нём.",
    ),
    keepWallet: m("Keep wallet", "지갑 유지", "Оставить кошелёк"),
    disconnectAction: m("Disconnect", "연결해제", "Отключить"),
  },

  storagePicker: {
    thisDevice: m("This device only", "이 기기만", "Только это устройство"),
    thisDeviceSub: m("Sessions stay local. No cloud mirror.", "세션이 로컬에만 저장됩니다. 클라우드 미러 없음.", "Сессии остаются локально. Без облачного зеркала."),
    connected: m("Connected", "연결됨", "Подключено"),
    gdriveSub: m("Mirror sessions to your own Google account", "내 Google 계정으로 세션 미러링", "Зеркалить сессии в ваш Google аккаунт"),
    icloudSub: m("Mirror to your iCloud Drive folder. No sign in.", "iCloud Drive 폴더로 미러링. 로그인 불필요.", "Зеркалить в папку iCloud Drive. Без входа."),
    customStorage: m("Custom Storage", "커스텀 저장소", "Своё Хранилище"),
    customStorageSub: m("Mirror to an S3 / WebDAV / HTTP endpoint", "S3 / WebDAV / HTTP 엔드포인트로 미러링", "Зеркалить в S3 / WebDAV / HTTP endpoint"),
    done: m("Done", "완료", "Готово"),
  },

  engines: {
    connected: m("Connected", "연결됨", "Подключён"),
    notSignedIn: m("Not signed in", "로그인 안 됨", "Не выполнен вход"),
    updatingLong: m("Updating, this can take a minute", "업데이트 중, 1분 정도 걸릴 수 있어요", "Обновление, это может занять минуту"),
    available: m("available", "사용 가능", "доступно"),
    updating: m("Updating", "업데이트 중", "Обновление"),
    update: m("Update", "업데이트", "Обновить"),
    logOut: m("Log out", "로그아웃", "Выйти"),
    connect: m("Connect", "연결", "Подключить"),
    note: m(
      "Connect opens that engine's sign-in. Signing out removes its credentials from this device; chat locks until an engine is connected again. Updates install straight from the official npm registry.",
      "연결을 누르면 해당 엔진의 로그인이 열려요. 로그아웃하면 이 기기에서 자격 증명이 제거되고, 엔진을 다시 연결할 때까지 채팅이 잠깁니다. 업데이트는 공식 npm 레지스트리에서 바로 설치돼요.",
      "Подключение открывает вход этого движка. Выход удаляет его учётные данные с устройства; чат блокируется, пока движок не подключён снова. Обновления ставятся прямо из официального реестра npm.",
    ),
  },

  custom: {
    header: m("Custom Cloud", "커스텀 클라우드", "Своё Облако"),
    endpointUrl: m("Endpoint URL", "엔드포인트 URL", "URL эндпоинта"),
    authHeader: m("Auth Header (optional)", "인증 헤더 (선택)", "Заголовок авторизации (опционально)"),
    bearerPlaceholder: m("Bearer token...", "Bearer 토큰...", "Bearer токен..."),
    connectStorage: m("Connect Storage", "저장소 연결", "Подключить хранилище"),
    cancel: m("Cancel", "취소", "Отмена"),
  },

  gdrive: {
    startingLogin: m("Starting Login…", "로그인 시작 중…", "Запуск входа…"),
    signIn: m("Sign in to Google Drive", "Google Drive 로그인", "Войти в Google Drive"),
    instructions: m("Google sign-in opened in your browser. Approve Drive access, then return to AgentNet.", "브라우저에서 Google 로그인이 열렸어요. Drive 접근을 승인한 뒤 AgentNet으로 돌아오세요.", "Вход Google открылся в браузере. Одобрите доступ к Drive и вернитесь в AgentNet."),
    openAgain: m("Open Google Again", "Google 다시 열기", "Открыть Google снова"),
    hideManual: m("Hide manual code entry", "수동 코드 입력 숨기기", "Скрыть ручной ввод кода"),
    useManual: m("Having trouble? Use code manually", "문제가 있나요? 코드를 직접 입력하세요", "Проблемы? Введите код вручную"),
    openAuthUrl: m("Open Authorization URL", "인증 URL 열기", "Открыть URL авторизации"),
    copied: m("Copied!", "복사됨!", "Скопировано!"),
    copyLink: m("Copy link", "링크 복사", "Копировать ссылку"),
    pastePlaceholder: m("Paste URL or code here", "URL이나 코드를 붙여넣으세요", "Вставьте URL или код сюда"),
    confirm: m("Confirm", "확인", "Подтвердить"),
    cancel: m("Cancel", "취소", "Отмена"),
  },
};
