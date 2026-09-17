document.addEventListener("contextmenu", (event) => event.preventDefault());

const STORAGE_KEY = "quiz_platform_data";
const OPTION_MARKS = ["A", "B", "C", "D", "E", "F"];

const DEFAULT_SITE_SETTINGS = {
    siteName: "Квиз-платформа",
    tagline: "Интерактивный квиз",
    subtitle: "Выберите тему и проверьте свои знания",
    logoUrl: "",
    bodyBackgroundUrl: "",
    heroBackgroundUrl: "",
    faviconUrl: "",
    timeLimit: 60,
    colors: {
        primary: "#2563eb",
        primaryDark: "#1e40af",
        gold: "#475569",
        accent: "#059669"
    },
    texts: {
        menuKicker: "Быстрый старт",
        menuTitle: "Выберите тему",
        menuCopy: "Темы запускаются в один клик. На каждый вопрос даётся ограниченное время, а при ошибке открывается окно с пояснением.",
        menuHint: "Сначала выберите тему, затем отвечайте на вопросы подряд. Итоговый результат можно сохранить в рейтинг.",
        navKicker: "Навигация",
        navTitle: "Что можно сделать",
        factLabel: "Пояснение",
        defaultFact: "Пояснение для этого вопроса пока не добавлено.",
        leaderboardKicker: "Рейтинг игроков",
        leaderboardTitle: "Доска почёта",
        feedbackKicker: "Диалог с посетителями",
        feedbackTitle: "Обратная связь",
        statThemesLabel: "тем",
        statTimeLabel: "сек/вопрос",
        statLeadersLabel: "в рейтинге"
    }
};

let siteSettings = structuredClone(DEFAULT_SITE_SETTINGS);
let myGames = [];
let leaders = [];
let feedbacks = [];

let activeGame = null;
let currentQuestionIndex = 0;
let score = 0;
let currentEditingGameId = null;
let currentEditingQuestionIndex = null;

let timerInterval = null;
let timeLeft = 0;

function getQuizConfig() {
    return window.QUIZ_CONFIG && typeof window.QUIZ_CONFIG === "object" ? window.QUIZ_CONFIG : {};
}

function getDataFileName() {
    const name = String(getQuizConfig().dataFile || "data.json").trim();
    return name || "data.json";
}

function getAdminPassword() {
    const pass = getQuizConfig().adminPassword;
    return pass != null && String(pass).length > 0 ? String(pass) : "admin";
}

function updateConfigLabelsInUI() {
    const fileLabel = document.getElementById("config-data-file-label");
    const fileName = getDataFileName();
    if (fileLabel) fileLabel.textContent = fileName;

    document.querySelectorAll("[data-export-filename]").forEach((el) => {
        el.textContent = fileName;
    });
}

let firebaseApp = null;
let firebaseDbRef = null;
let firebaseSyncTimer = null;
let suppressFirebaseListener = false;
let firebaseListenerAttached = false;

function isFirebaseConfigured() {
    const fb = getQuizConfig().firebase;
    return Boolean(fb?.databaseURL?.trim() && fb?.apiKey?.trim());
}

function getFirebaseDbPath() {
    const path = String(getQuizConfig().dbPath || "quizData").trim();
    return path || "quizData";
}

function initFirebase() {
    if (!isFirebaseConfigured()) return false;
    if (typeof firebase === "undefined") {
        console.warn("Firebase SDK не загружен.");
        return false;
    }

    if (!firebaseApp) {
        firebaseApp = firebase.apps?.length ? firebase.app() : firebase.initializeApp(getQuizConfig().firebase);
        firebaseDbRef = firebase.database().ref(getFirebaseDbPath());
    }

    return Boolean(firebaseDbRef);
}

function setCloudStatus(text) {
    const el = document.getElementById("cloud-status");
    if (el) el.innerText = text || "";
}

function updateCloudSyncIndicator() {
    const el = document.getElementById("cloud-sync-indicator");
    if (!el) return;

    el.classList.remove("cloud-sync-badge--ok", "cloud-sync-badge--warn", "cloud-sync-badge--off");

    if (!isFirebaseConfigured()) {
        el.classList.add("cloud-sync-badge--off");
        el.textContent =
            "Firebase не настроен. Вставьте настройки из Firebase Console в config.js → firebase и залейте на GitHub.";
        return;
    }

    if (initFirebase()) {
        el.classList.add("cloud-sync-badge--ok");
        el.textContent = `Firebase подключён (${getFirebaseDbPath()}). Автосохранение и синхронизация для всех посетителей активны.`;
        return;
    }

    el.classList.add("cloud-sync-badge--warn");
    el.textContent = "Настройки Firebase указаны, но подключение не удалось. Нажмите «Проверить Firebase».";
}

function updateDatabaseStatusUI() {
    updateCloudSyncIndicator();
}

function getDbSnapshot() {
    return {
        settings: siteSettings,
        games: myGames,
        leaders,
        feedback: feedbacks
    };
}

function applyDbSnapshot(snapshot) {
    siteSettings = mergeSettings(snapshot?.settings);
    myGames = normalizeCollection(snapshot?.games);
    leaders = normalizeCollection(snapshot?.leaders);
    feedbacks = normalizeCollection(snapshot?.feedback);
}

function refreshAllUI() {
    applySiteSettings();
    populateSettingsForm();
    renderGameList();
    renderAdminGames();
    updateLeaderboardUI();
    renderFeedbackList();
    updateMenuStats();

    if (currentEditingGameId) {
        const currentGame = myGames.find((game) => game.id === currentEditingGameId);
        if (currentGame) renderQuestionsList();
        else currentEditingGameId = null;
    }
}

function saveData(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getDbSnapshot()));

    if (options.skipCloud) return;

    if (isFirebaseConfigured()) {
        scheduleFirebaseSync();
        return;
    }

    if (!options.silentCloudWarning) {
        setCloudStatus("Данные сохранены локально. Настройте Firebase в config.js для общей базы на GitHub Pages.");
    }
}

function scheduleFirebaseSync() {
    if (!isFirebaseConfigured()) return;

    if (firebaseSyncTimer) clearTimeout(firebaseSyncTimer);
    firebaseSyncTimer = window.setTimeout(() => {
        pushToFirebase(true);
    }, 700);
}

async function loadFromLocalFile() {
    try {
        const response = await fetch(getDataFileName(), { cache: "no-store" });
        if (!response.ok) return false;
        const data = await response.json();
        applyDbSnapshot(data);
        saveData({ skipCloud: true });
        return true;
    } catch {
        return false;
    }
}

async function reloadFromServer() {
    const loaded = await loadFromLocalFile();
    if (!loaded) {
        setCloudStatus(`Файл ${getDataFileName()} на сервере не найден.`);
        return;
    }
    refreshAllUI();
    setCloudStatus(`Данные обновлены с сервера (${getDataFileName()}).`);
}

function snapshotSignature(snapshot) {
    try {
        return JSON.stringify(snapshot);
    } catch {
        return "";
    }
}

async function pushToFirebase(silent = false) {
    if (!initFirebase()) {
        if (!silent) setCloudStatus("Firebase не настроен. Заполните config.js → firebase.");
        return false;
    }

    suppressFirebaseListener = true;

    try {
        if (!silent) setCloudStatus("Сохранение в Firebase...");
        await firebaseDbRef.set(getDbSnapshot());
        setCloudStatus(silent ? "Автосохранение в Firebase выполнено." : "Данные отправлены в Firebase.");
        updateCloudSyncIndicator();
        return true;
    } catch (error) {
        console.error(error);
        setCloudStatus(`Ошибка Firebase: ${error.message || "проверьте databaseURL и правила доступа"}.`);
        return false;
    } finally {
        window.setTimeout(() => {
            suppressFirebaseListener = false;
        }, 400);
    }
}

async function pullFromFirebase() {
    if (!initFirebase()) return null;

    const snap = await firebaseDbRef.once("value");
    return snap.val();
}

function setupFirebaseListener() {
    if (!initFirebase() || firebaseListenerAttached) return;

    firebaseDbRef.on("value", (snap) => {
        if (suppressFirebaseListener) return;

        const activeScreen = document.querySelector(".screen.active");
        if (activeScreen?.id === "game") return;

        const value = snap.val();
        if (!value) return;

        const nextSig = snapshotSignature(value);
        const currentSig = snapshotSignature(getDbSnapshot());
        if (nextSig === currentSig) return;

        applyDbSnapshot(value);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getDbSnapshot()));
        refreshAllUI();
    });

    firebaseListenerAttached = true;
}

async function loadData() {
    if (isFirebaseConfigured()) {
        try {
            if (!initFirebase()) throw new Error("Не удалось инициализировать Firebase");

            const remote = await pullFromFirebase();

            if (remote) {
                applyDbSnapshot(remote);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(getDbSnapshot()));
            } else {
                const loadedFile = await loadFromLocalFile();
                if (!loadedFile) {
                    const local = localStorage.getItem(STORAGE_KEY);
                    if (local) {
                        try {
                            applyDbSnapshot(JSON.parse(local));
                        } catch {
                            localStorage.removeItem(STORAGE_KEY);
                        }
                    }
                }
                await pushToFirebase(true);
            }

            setupFirebaseListener();
            updateCloudSyncIndicator();
            return;
        } catch (error) {
            console.warn("Firebase недоступен, используем резервные данные.", error);
            setCloudStatus("Firebase недоступен. Проверьте config.js и правила базы.");
        }
    }

    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
        try {
            applyDbSnapshot(JSON.parse(local));
            return;
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    await loadFromLocalFile();
}

async function loadFromFirebase() {
    if (!isFirebaseConfigured()) {
        setCloudStatus("Заполните firebase в config.js (скопируйте из Firebase Console).");
        return;
    }

    try {
        setCloudStatus("Загрузка из Firebase...");
        const remote = await pullFromFirebase();
        if (!remote) throw new Error("База пуста");

        applyDbSnapshot(remote);
        saveData({ skipCloud: true });
        refreshAllUI();
        setCloudStatus("Данные загружены из Firebase.");
    } catch (error) {
        console.error(error);
        setCloudStatus(`Не удалось загрузить Firebase: ${error.message || "ошибка"}.`);
    }
}

async function testFirebaseConnection() {
    if (!isFirebaseConfigured()) {
        setCloudStatus("В config.js не заполнен блок firebase. Смотрите ИНСТРУКЦИЯ.txt.");
        updateCloudSyncIndicator();
        return;
    }

    try {
        setCloudStatus("Проверка подключения...");
        if (!initFirebase()) throw new Error("SDK или настройки");

        await firebaseDbRef.once("value");
        updateCloudSyncIndicator();
        setCloudStatus("Firebase подключён успешно. Автосохранение работает.");
    } catch (error) {
        console.error(error);
        updateCloudSyncIndicator();
        setCloudStatus(`Ошибка подключения: ${error.message}. Проверьте databaseURL и правила в firebase-rules.json.`);
    }
}

async function pushToFirebaseNow() {
    const ok = await pushToFirebase(false);
    if (ok) refreshAllUI();
}

function exportData() {
    const blob = new Blob([JSON.stringify(getDbSnapshot(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = getDataFileName();
    link.click();
    URL.revokeObjectURL(link.href);
    setCloudStatus(`Файл ${getDataFileName()} скачан. Положите его в папку сайта на хостинге.`);
}

function importDataFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            applyDbSnapshot(data);
            saveData();
            refreshAllUI();
            setCloudStatus("Данные импортированы из файла.");
        } catch {
            alert("Не удалось прочитать файл. Убедитесь, что это корректный data.json.");
        }
    };
    reader.readAsText(file, "utf-8");
}

function updateImagePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    const url = input.value.trim();
    if (!url) {
        preview.hidden = true;
        preview.removeAttribute("src");
        return;
    }

    preview.src = url;
    preview.hidden = false;
    preview.onerror = () => {
        preview.hidden = true;
    };
}

function bindImagePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("input", () => updateImagePreview(inputId, previewId));
}

function getTimeLimit() {
    const limit = Number(siteSettings?.timeLimit);
    return Number.isFinite(limit) && limit >= 5 ? limit : 60;
}

function getDefaultFactText() {
    return siteSettings?.texts?.defaultFact || DEFAULT_SITE_SETTINGS.texts.defaultFact;
}

function mergeSettings(raw) {
    if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_SITE_SETTINGS);

    return {
        ...DEFAULT_SITE_SETTINGS,
        ...raw,
        colors: { ...DEFAULT_SITE_SETTINGS.colors, ...(raw.colors || {}) },
        texts: { ...DEFAULT_SITE_SETTINGS.texts, ...(raw.texts || {}) }
    };
}

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.textContent = value;
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.value = value;
}

function applySiteSettings() {
    const root = document.documentElement;
    const s = siteSettings;
    const colors = s.colors || DEFAULT_SITE_SETTINGS.colors;
    const texts = s.texts || DEFAULT_SITE_SETTINGS.texts;

    root.style.setProperty("--red", colors.primary);
    root.style.setProperty("--red-dark", colors.primaryDark);
    root.style.setProperty("--gold", colors.gold);
    root.style.setProperty("--olive", colors.accent);
    root.style.setProperty("--green", colors.accent);

    if (s.bodyBackgroundUrl) {
        root.style.setProperty("--site-body-bg-image", `url("${s.bodyBackgroundUrl}")`);
    } else {
        root.style.setProperty("--site-body-bg-image", "none");
    }

    if (s.heroBackgroundUrl) {
        root.style.setProperty("--site-hero-bg-image", `url("${s.heroBackgroundUrl}")`);
    } else {
        root.style.setProperty("--site-hero-bg-image", "none");
    }

    document.title = s.siteName || DEFAULT_SITE_SETTINGS.siteName;

    const favicon = document.getElementById("site-favicon");
    if (favicon && s.faviconUrl) favicon.href = s.faviconUrl;

    setTextContent("site-tagline", s.tagline);
    setTextContent("site-title", s.siteName || DEFAULT_SITE_SETTINGS.siteName);
    setTextContent("site-subtitle", s.subtitle);

    const logoBox = document.getElementById("logo-box");
    const logoImg = document.getElementById("site-logo");
    if (logoBox && logoImg) {
        if (s.logoUrl) {
            logoBox.classList.remove("logo-box--hidden");
            logoImg.src = s.logoUrl;
            logoImg.alt = s.siteName || "Логотип";
        } else {
            logoBox.classList.add("logo-box--hidden");
        }
    }

    setTextContent("menu-kicker", texts.menuKicker);
    setTextContent("menu-section-title", texts.menuTitle);
    setTextContent("menu-section-copy", texts.menuCopy);
    setTextContent("nav-kicker", texts.navKicker);
    setTextContent("nav-title", texts.navTitle);
    setTextContent("stat-themes-label", texts.statThemesLabel);
    setTextContent("stat-time-label", texts.statTimeLabel);
    setTextContent("stat-leaders-label", texts.statLeadersLabel);
    setTextContent("leaderboard-kicker", texts.leaderboardKicker);
    setTextContent("leaderboard-title", texts.leaderboardTitle);
    setTextContent("feedback-kicker", texts.feedbackKicker);
    setTextContent("feedback-title", texts.feedbackTitle);
    setTextContent("answer-modal-fact-label", texts.factLabel);

    const menuHint = document.getElementById("menu-hint");
    if (menuHint && texts.menuHint) {
        menuHint.innerHTML = `<strong>Подсказка:</strong> ${escapeHtml(texts.menuHint)}`;
    }

    updateMenuStats();
}

function populateSettingsForm() {
    const s = siteSettings;
    const colors = s.colors || DEFAULT_SITE_SETTINGS.colors;
    const texts = s.texts || DEFAULT_SITE_SETTINGS.texts;

    setInputValue("set-site-name", s.siteName);
    setInputValue("set-tagline", s.tagline);
    setInputValue("set-subtitle", s.subtitle);
    setInputValue("set-time-limit", s.timeLimit);
    setInputValue("set-logo-url", s.logoUrl);
    setInputValue("set-body-bg-url", s.bodyBackgroundUrl);
    setInputValue("set-hero-bg-url", s.heroBackgroundUrl);
    setInputValue("set-favicon-url", s.faviconUrl);
    setInputValue("set-color-primary", colors.primary);
    setInputValue("set-color-primary-dark", colors.primaryDark);
    setInputValue("set-color-gold", colors.gold);
    setInputValue("set-color-accent", colors.accent);
    setInputValue("set-menu-copy", texts.menuCopy);
    setInputValue("set-menu-hint", texts.menuHint);
    setInputValue("set-fact-label", texts.factLabel);

    updateImagePreview("set-logo-url", "preview-logo");
    updateImagePreview("set-body-bg-url", "preview-body-bg");
    updateImagePreview("set-hero-bg-url", "preview-hero-bg");
    updateDatabaseStatusUI();
    updateConfigLabelsInUI();
}

function saveSiteSettings() {
    const siteName = document.getElementById("set-site-name")?.value.trim();
    if (!siteName) {
        alert("Введите название сайта.");
        return;
    }

    const timeLimit = Number(document.getElementById("set-time-limit")?.value);
    if (!Number.isFinite(timeLimit) || timeLimit < 5 || timeLimit > 300) {
        alert("Время на вопрос должно быть от 5 до 300 секунд.");
        return;
    }

    siteSettings = {
        siteName,
        tagline: document.getElementById("set-tagline")?.value.trim() || "",
        subtitle: document.getElementById("set-subtitle")?.value.trim() || "",
        logoUrl: document.getElementById("set-logo-url")?.value.trim() || "",
        bodyBackgroundUrl: document.getElementById("set-body-bg-url")?.value.trim() || "",
        heroBackgroundUrl: document.getElementById("set-hero-bg-url")?.value.trim() || "",
        faviconUrl: document.getElementById("set-favicon-url")?.value.trim() || "",
        timeLimit,
        colors: {
            primary: document.getElementById("set-color-primary")?.value || DEFAULT_SITE_SETTINGS.colors.primary,
            primaryDark: document.getElementById("set-color-primary-dark")?.value || DEFAULT_SITE_SETTINGS.colors.primaryDark,
            gold: document.getElementById("set-color-gold")?.value || DEFAULT_SITE_SETTINGS.colors.gold,
            accent: document.getElementById("set-color-accent")?.value || DEFAULT_SITE_SETTINGS.colors.accent
        },
        texts: {
            ...siteSettings.texts,
            menuCopy: document.getElementById("set-menu-copy")?.value.trim() || DEFAULT_SITE_SETTINGS.texts.menuCopy,
            menuHint: document.getElementById("set-menu-hint")?.value.trim() || DEFAULT_SITE_SETTINGS.texts.menuHint,
            factLabel: document.getElementById("set-fact-label")?.value.trim() || DEFAULT_SITE_SETTINGS.texts.factLabel
        }
    };

    saveData();
    applySiteSettings();
    alert(
        isFirebaseConfigured()
            ? "Настройки сохранены в Firebase — все посетители сайта увидят их."
            : "Настройки сохранены локально. Подключите Firebase в config.js для общей базы."
    );
}

function normalizeCollection(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object") return Object.values(value).filter(Boolean);
    return [];
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function truncateText(value, maxLength) {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function pluralize(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function getQuestionCountLabel(count) {
    return `${count} ${pluralize(count, "вопрос", "вопроса", "вопросов")}`;
}

function getDurationLabel(questionCount) {
    if (!questionCount) return "вопросы ещё не добавлены";

    const timeLimit = getTimeLimit();
    const totalSeconds = questionCount * timeLimit;
    if (totalSeconds < 60) {
        return `примерно ${totalSeconds} сек`;
    }

    const totalMinutes = Math.ceil(totalSeconds / 60);
    return `примерно ${totalMinutes} ${pluralize(totalMinutes, "минута", "минуты", "минут")}`;
}

function getQuestionTypeLabel(type) {
    if (type === "choice") return "Угадай ответ";
    if (type === "photo") return "Угадай по фото";
    if (type === "date") return "Сопоставь дату";
    return "Найди ошибку в тексте";
}

function getQuestionHint(type) {
    if (type === "choice") return "Выберите один правильный ответ и уложитесь во время.";
    if (type === "photo") return "Посмотрите на изображение и выберите один правильный ответ.";
    if (type === "date") return "Сопоставьте событие и нужную дату.";
    return "Выберите утверждение, в котором допущена ошибка.";
}

function getQuestionCorrectIndex(question) {
    const rawIndex = Number(question?.correct);
    const options = normalizeCollection(question?.options);

    if (Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < options.length) {
        return rawIndex;
    }

    return 0;
}

function getQuestionFact(question) {
    const fact = String(question?.fact ?? question?.explanation ?? "").trim();
    return fact || getDefaultFactText();
}

function getCorrectAnswerText(question) {
    const options = normalizeCollection(question?.options);
    return options[getQuestionCorrectIndex(question)] || "Правильный ответ не указан";
}

function getResultMessage(correctAnswers, totalQuestions) {
    if (!totalQuestions) {
        return {
            title: "Квиз завершён",
            text: "Результат пока нельзя оценить, потому что в теме нет вопросов."
        };
    }

    const percent = Math.round((correctAnswers / totalQuestions) * 100);

    if (percent === 100) {
        return {
            title: "Блестящий результат",
            text: "Вы ответили правильно на все вопросы. Такой результат точно заслуживает места на доске почёта."
        };
    }

    if (percent >= 75) {
        return {
            title: "Очень сильное прохождение",
            text: "Вы отлично ориентируетесь в материале. Осталось совсем немного, чтобы пройти тему без ошибок."
        };
    }

    if (percent >= 45) {
        return {
            title: "Хороший задел",
            text: "У вас уже есть база знаний. Попробуйте пройти тему ещё раз и улучшить итоговый счёт."
        };
    }

    return {
        title: "Есть куда расти",
        text: "Не страшно ошибаться. Можно вернуться в меню, выбрать тему заново и пройти её ещё раз."
    };
}

function getPhotoPlaceholder(label) {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
            <defs>
                <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stop-color="#f4ecde"/>
                    <stop offset="100%" stop-color="#ded0bb"/>
                </linearGradient>
            </defs>
            <rect width="900" height="520" rx="36" fill="url(#bg)"/>
            <rect x="40" y="40" width="820" height="440" rx="28" fill="none" stroke="#8e7b69" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="12 12"/>
            <circle cx="240" cy="190" r="48" fill="#c6ae85" fill-opacity="0.55"/>
            <path d="M180 370L310 230L420 330L515 260L650 370H180Z" fill="#9d8466" fill-opacity="0.55"/>
            <text x="450" y="440" text-anchor="middle" font-family="Verdana, sans-serif" font-size="32" font-weight="700" fill="#6b5745">${escapeHtml(label)}</text>
        </svg>
    `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function shuffleArray(items) {
    const array = [...items];

    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

/* ИЗМЕНЕНО: Скроллим теперь активный экран, а не весь контейнер */
function scrollMainWrapToTop() {
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen) activeScreen.scrollTo({ top: 0, behavior: "smooth" });
}

function updateMenuStats() {
    const gameCountEl = document.getElementById("menu-game-count");
    const leaderCountEl = document.getElementById("menu-leader-count");
    const timeLimitEl = document.getElementById("menu-time-limit");

    if (gameCountEl) gameCountEl.innerText = myGames.length;
    if (leaderCountEl) leaderCountEl.innerText = leaders.length;
    if (timeLimitEl) timeLimitEl.innerText = getTimeLimit();
}

function updateTimerVisual(seconds) {
    const timeDisplay = document.getElementById("timer-seconds");
    const timerContainer = document.querySelector(".timer-box");
    const timeLimit = getTimeLimit();

    if (timeDisplay) timeDisplay.innerText = seconds;

    if (timerContainer) {
        const fill = Math.max(0, Math.min(100, (seconds / timeLimit) * 100));
        timerContainer.style.setProperty("--timer-fill", `${fill}%`);
    }
}

function updateGameProgress() {
    const fill = document.getElementById("game-progress-fill");
    const text = document.getElementById("game-progress-text");

    if (!activeGame || !activeGame.questions || !activeGame.questions.length) {
        if (fill) fill.style.width = "0%";
        if (text) text.innerText = "Прогресс: 0 из 0";
        return;
    }

    const percent = ((currentQuestionIndex + 1) / activeGame.questions.length) * 100;

    if (fill) fill.style.width = `${percent}%`;
    if (text) text.innerText = `Прогресс: ${currentQuestionIndex + 1} из ${activeGame.questions.length}`;
}

function getPlayerInitial(name) {
    return String(name || "А")
        .trim()
        .charAt(0)
        .toUpperCase() || "А";
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;

    const timerContainer = document.querySelector(".timer-box");
    if (timerContainer) timerContainer.classList.remove("time-low");
}

function closeAnswerModal() {
    const modal = document.getElementById("answer-modal");
    const wrap = document.querySelector(".main-wrap");

    if (modal) modal.hidden = true;
    if (wrap) wrap.classList.remove("modal-open");
}

function openAnswerModal({ title, status, correctAnswer, fact, showCorrectAnswer = true }) {
    const modal = document.getElementById("answer-modal");
    const wrap = document.querySelector(".main-wrap");
    if (!modal) return;

    const correctBlock = document.getElementById("answer-modal-correct-block");
    document.getElementById("answer-modal-title").innerText = title;
    document.getElementById("answer-modal-status").innerText = status;
    document.getElementById("answer-modal-correct").innerText = correctAnswer;
    document.getElementById("answer-modal-fact").innerText = fact;
    if (correctBlock) correctBlock.hidden = !showCorrectAnswer;

    modal.hidden = false;
    if (wrap) wrap.classList.add("modal-open");
}

function goToNextQuestion() {
    closeAnswerModal();
    currentQuestionIndex += 1;

    if (activeGame && currentQuestionIndex < activeGame.questions.length) {
        showQuestion();
        return;
    }

    finishGame();
}

function switchScreen(screenId) {
    if (screenId !== "game") {
        closeAnswerModal();
        resetTimer();
    }

    const screens = document.querySelectorAll(".screen");
    screens.forEach((screen) => screen.classList.remove("active"));

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) targetScreen.classList.add("active");

    scrollMainWrapToTop();
}

function showMenu() {
    switchScreen("menu");
}

function showLogin() {
    switchScreen("login");
}

function showLeaderboard() {
    updateLeaderboardUI();
    switchScreen("lider");
}

function showFeedbackScreen() {
    switchScreen("feedback-screen");
}

function applyScreenFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get("screen");
    if (!screen) return;

    const target = document.getElementById(screen);
    if (target && target.classList.contains("screen")) {
        switchScreen(screen);
    }
}

function applyFigmaExportMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("figma") !== "all") return;

    document.body.classList.add("figma-export");

    const wrap = document.querySelector(".main-wrap");
    if (wrap) wrap.classList.add("figma-export-wrap");

    const screens = document.querySelectorAll(".screen");
    screens.forEach((screen) => {
        screen.classList.add("active");
    });

    const modal = document.getElementById("answer-modal");
    if (modal) modal.hidden = false;
}

function submitFeedback() {
    const nameInput = document.getElementById("fb-name");
    const messageInput = document.getElementById("fb-message");
    const name = nameInput.value.trim() || "Анонимный пользователь";
    const message = messageInput.value.trim();

    if (!message) {
        alert("Пожалуйста, напишите сообщение.");
        return;
    }

    const newMessage = {
        name,
        message,
        date: new Date().toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        })
    };

    feedbacks.push(newMessage);
    saveData();
    renderFeedbackList();

    nameInput.value = "";
    messageInput.value = "";

    alert("Сообщение отправлено. Спасибо за обратную связь!");
    showMenu();
}

function checkLogin() {
    const input = document.getElementById("admin-pass");

    if (input.value === getAdminPassword()) {
        input.value = "";
        switchScreen("admin");
        switchAdminTab("settings");
        populateSettingsForm();
        return;
    }

    alert("Неверный код доступа.");
}

function switchAdminTab(tabName) {
    const btnSettings = document.getElementById("tab-settings");
    const btnGames = document.getElementById("tab-games");
    const btnFeedback = document.getElementById("tab-feedback");
    const secSettings = document.getElementById("admin-section-settings");
    const secGames = document.getElementById("admin-section-games");
    const secFeedback = document.getElementById("admin-section-feedback");

    [btnSettings, btnGames, btnFeedback].forEach((btn) => btn?.classList.remove("tab-active"));
    [secSettings, secGames, secFeedback].forEach((sec) => {
        if (sec) sec.style.display = "none";
    });

    if (tabName === "settings") {
        btnSettings?.classList.add("tab-active");
        if (secSettings) secSettings.style.display = "block";
        populateSettingsForm();
        return;
    }

    if (tabName === "games") {
        btnGames?.classList.add("tab-active");
        if (secGames) secGames.style.display = "block";
        return;
    }

    btnFeedback?.classList.add("tab-active");
    if (secFeedback) secFeedback.style.display = "block";
}

function renderFeedbackList() {
    const countEl = document.getElementById("fb-count");
    const container = document.getElementById("admin-feedback-list");

    if (countEl) countEl.innerText = feedbacks.length;
    if (!container) return;

    if (!feedbacks.length) {
        container.innerHTML = "<div class='empty-state'>Пожеланий пока нет. Когда пользователи начнут оставлять сообщения, они появятся здесь.</div>";
        return;
    }

    let html = "";

    for (let i = feedbacks.length - 1; i >= 0; i--) {
        const feedback = feedbacks[i];
        const name = feedback.name || "Анонимный пользователь";

        html += `
            <article class="feedback-card">
                <div class="feedback-card__head">
                    <div class="feedback-avatar">${escapeHtml(getPlayerInitial(name))}</div>
                    <p class="fb-info"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(feedback.date || "Без даты")}</p>
                </div>
                <p class="fb-text">${escapeHtml(feedback.message || "")}</p>
                <button type="button" class="fb-delete" onclick="window.deleteFeedback(${i})">Удалить сообщение</button>
            </article>`;
    }

    container.innerHTML = html;
}

function deleteFeedback(index) {
    if (!confirm("Удалить это сообщение?")) return;

    feedbacks.splice(index, 1);
    saveData();
    renderFeedbackList();
}

function renderAdminGames() {
    const container = document.getElementById("admin-games-list");
    if (!container) return;

    if (!myGames.length) {
        container.innerHTML = "<div class='empty-state'>Тем пока нет. Создайте первую тему и добавьте в неё вопросы.</div>";
        return;
    }

    container.innerHTML = myGames.map((game) => {
        const questions = normalizeCollection(game.questions);
        const questionCount = questions.length;

        return `
            <div class="list-item">
                <div class="list-item__meta">
                    <span class="list-item__title">${escapeHtml(game.title || "Без названия")}</span>
                    <span class="list-item__sub">${getQuestionCountLabel(questionCount)} • ${getDurationLabel(questionCount)}</span>
                </div>
                <div class="list-item__actions">
                    <button type="button" onclick="window.manageQuestions(${game.id})" class="mini-action btn-red">Вопросы</button>
                    <button type="button" onclick="window.renameGame(${game.id})" class="mini-action btn-gold">Переименовать</button>
                    <button type="button" onclick="window.deleteGame(${game.id})" class="mini-action btn-dark">Удалить</button>
                </div>
            </div>`;
    }).join("");
}

function createNewGame() {
    const title = prompt("Введите название новой темы:");
    if (!title) return;

    const cleanTitle = title.trim();
    if (!cleanTitle) {
        alert("Название темы не должно быть пустым.");
        return;
    }

    myGames.push({
        id: Date.now(),
        title: cleanTitle,
        questions: []
    });

    saveData();
    renderAdminGames();
    renderGameList();
    updateMenuStats();
}

function renameGame(id) {
    const game = myGames.find((item) => item.id === id);
    if (!game) return;

    const title = prompt("Новое название темы:", game.title || "");
    if (title == null) return;

    const cleanTitle = title.trim();
    if (!cleanTitle) {
        alert("Название темы не должно быть пустым.");
        return;
    }

    game.title = cleanTitle;

    if (currentEditingGameId === id) {
        document.getElementById("manager-title").innerText = cleanTitle;
        document.getElementById("manager-current-theme").innerText =
            `Вы редактируете тему «${cleanTitle}». Здесь собраны все вопросы и быстрые действия для них.`;
    }

    saveData();
    renderAdminGames();
    renderGameList();
}

function deleteGame(id) {
    if (!confirm("Удалить эту тему и все её вопросы?")) return;

    myGames = myGames.filter((game) => game.id !== id);

    if (currentEditingGameId === id) {
        currentEditingGameId = null;
        currentEditingQuestionIndex = null;
    }

    saveData();
    renderAdminGames();
    renderGameList();
    updateMenuStats();
}

function manageQuestions(id) {
    currentEditingGameId = id;

    const game = myGames.find((item) => item.id === id);
    if (!game) return;

    document.getElementById("manager-title").innerText = game.title;
    document.getElementById("manager-current-theme").innerText = `Вы редактируете тему «${game.title}». Здесь собраны все вопросы и быстрые действия для них.`;

    renderQuestionsList();
    switchScreen("manager");
}

function renderQuestionsList() {
    const game = myGames.find((item) => item.id === currentEditingGameId);
    const container = document.getElementById("admin-questions-list");

    if (!container || !game) return;

    const questions = normalizeCollection(game.questions);

    if (!questions.length) {
        container.innerHTML = "<div class='empty-state'>В этой теме пока нет вопросов. Нажмите «Добавить вопрос», чтобы начать наполнение.</div>";
        return;
    }

    container.innerHTML = questions.map((question, index) => {
        const optionsCount = normalizeCollection(question.options).length;

        return `
            <div class="list-item">
                <div class="list-item__meta">
                    <span class="type-pill" data-type="${escapeHtml(question.type || "error")}">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
                    <span class="list-item__title">${escapeHtml(truncateText(question.q || "Без текста вопроса", 72))}</span>
                    <span class="list-item__sub">${optionsCount} ${pluralize(optionsCount, "вариант", "варианта", "вариантов")} ответа</span>
                </div>
                <div class="list-item__actions">
                    <button type="button" onclick="window.openEditor(${index})" class="mini-action btn-red">Изменить</button>
                    <button type="button" onclick="window.deleteQuestion(${index})" class="mini-action btn-dark">Удалить</button>
                </div>
            </div>`;
    }).join("");
}

function toggleEditorFields() {
    const type = document.getElementById("edit-type").value;
    const imageBlock = document.getElementById("div-edit-img");
    const imageInput = document.getElementById("edit-img");
    const shouldShowImage = type === "photo";

    imageBlock.style.display = shouldShowImage ? "block" : "none";
    imageInput.disabled = !shouldShowImage;
    if (shouldShowImage) updateImagePreview("edit-img", "preview-edit-img");
}

function openEditor(index = null) {
    currentEditingQuestionIndex = index;

    const typeEl = document.getElementById("edit-type");
    const questionEl = document.getElementById("edit-q");
    const imageEl = document.getElementById("edit-img");
    const correctEl = document.getElementById("edit-correct");
    const factEl = document.getElementById("edit-fact");
    const opt0 = document.getElementById("edit-opt0");
    const opt1 = document.getElementById("edit-opt1");
    const opt2 = document.getElementById("edit-opt2");
    const opt3 = document.getElementById("edit-opt3");
    const editorTitle = document.getElementById("editor-title");

    if (index !== null) {
        const game = myGames.find((item) => item.id === currentEditingGameId);
        if (!game) return;

        const question = normalizeCollection(game.questions)[index];
        if (!question) return;

        typeEl.value = question.type || "choice";
        questionEl.value = question.q || "";
        imageEl.value = question.img || "";
        correctEl.value = String(getQuestionCorrectIndex(question));
        factEl.value = getQuestionFact(question) === getDefaultFactText() ? "" : getQuestionFact(question);
        opt0.value = question.options?.[0] || "";
        opt1.value = question.options?.[1] || "";
        opt2.value = question.options?.[2] || "";
        opt3.value = question.options?.[3] || "";
        editorTitle.innerText = "Редактирование вопроса";
    } else {
        typeEl.value = "choice";
        questionEl.value = "";
        imageEl.value = "";
        correctEl.value = "0";
        factEl.value = "";
        opt0.value = "";
        opt1.value = "";
        opt2.value = "";
        opt3.value = "";
        editorTitle.innerText = "Новый вопрос";
    }

    toggleEditorFields();
    updateImagePreview("edit-img", "preview-edit-img");
    switchScreen("editor");
}

function saveQuestion() {
    const game = myGames.find((item) => item.id === currentEditingGameId);
    if (!game) return;

    if (!game.questions) game.questions = [];

    const type = document.getElementById("edit-type").value;
    const questionText = document.getElementById("edit-q").value.trim();
    const imagePath = document.getElementById("edit-img").value.trim();
    const factText = document.getElementById("edit-fact").value.trim();
    const correctIndex = Number(document.getElementById("edit-correct").value);

    const optionsArray = [];
    for (let i = 0; i <= 3; i++) {
        const value = document.getElementById(`edit-opt${i}`).value.trim();
        if (value) optionsArray.push(value);
    }

    if (!questionText) {
        alert("Введите текст вопроса.");
        return;
    }

    if (type === "photo" && !imagePath) {
        alert("Для вопроса «Угадай по фото» вставьте ссылку на изображение.");
        return;
    }

    if (!factText) {
        alert("Добавьте пояснение для окна объяснения.");
        return;
    }

    if (optionsArray.length < 2) {
        alert("Добавьте минимум два варианта ответа.");
        return;
    }

    const loweredOptions = optionsArray.map((item) => item.toLowerCase());
    if (new Set(loweredOptions).size !== loweredOptions.length) {
        alert("Варианты ответа должны отличаться друг от друга.");
        return;
    }

    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= optionsArray.length) {
        alert("Выберите корректный номер правильного варианта.");
        return;
    }

    const newQuestion = {
        type,
        q: questionText,
        img: imagePath,
        options: optionsArray,
        correct: correctIndex,
        fact: factText
    };

    if (currentEditingQuestionIndex !== null) {
        game.questions[currentEditingQuestionIndex] = newQuestion;
    } else {
        game.questions.push(newQuestion);
    }

    renderQuestionsList();
    saveData();
    switchScreen("manager");
}

function deleteQuestion(index) {
    if (!confirm("Удалить этот вопрос?")) return;

    const game = myGames.find((item) => item.id === currentEditingGameId);
    if (!game || !game.questions) return;

    game.questions.splice(index, 1);
    renderQuestionsList();
    saveData();
}

function renderGameList() {
    const container = document.getElementById("game-list-container");
    if (!container) return;

    if (!myGames.length) {
        container.innerHTML = "<div class='empty-state'>Темы ещё не загружены или пока не созданы. Добавьте первую тему через админ-панель.</div>";
        return;
    }

    container.innerHTML = myGames.map((game, index) => {
        const questionCount = normalizeCollection(game.questions).length;
        const isLocked = questionCount === 0;

        return `
            <button type="button" onclick="window.playGame(${game.id})" class="theme-card ${isLocked ? "theme-card--locked" : ""}">
                <span class="theme-card__order">${String(index + 1).padStart(2, "0")}</span>
                <span class="theme-card__content">
                    <strong class="theme-card__title">${escapeHtml(game.title || "Без названия")}</strong>
                    <span class="theme-card__description">${getQuestionCountLabel(questionCount)} • ${getDurationLabel(questionCount)}</span>
                </span>
                <span class="theme-card__arrow">${isLocked ? "Пусто" : "Начать"}</span>
            </button>`;
    }).join("");
}

function playGame(id) {
    activeGame = myGames.find((game) => game.id === id);

    if (!activeGame) return;
    if (!activeGame.questions || !activeGame.questions.length) {
        alert("В этой теме пока нет вопросов.");
        return;
    }

    currentQuestionIndex = 0;
    score = 0;
    closeAnswerModal();
    stopTimer();

    switchScreen("game");
    showQuestion();
}

function resetTimer() {
    stopTimer();
    timeLeft = getTimeLimit();
    updateTimerVisual(getTimeLimit());
}

function startTimer() {
    stopTimer();
    timeLeft = getTimeLimit();
    updateTimerVisual(timeLeft);

    const timerContainer = document.querySelector(".timer-box");

    timerInterval = setInterval(() => {
        timeLeft -= 1;
        updateTimerVisual(timeLeft);

        if (timeLeft <= 5 && timerContainer) {
            timerContainer.classList.add("time-low");
        }

        if (timeLeft <= 0) {
            stopTimer();
            timeOut();
        }
    }, 1000);
}

function timeOut() {
    checkAnswer(null, null, { timedOut: true });
}

function showQuestion() {
    const question = activeGame.questions[currentQuestionIndex];
    if (!question) {
        finishGame();
        return;
    }

    document.getElementById("game-title-display").innerText = activeGame.title;
    document.getElementById("game-step").innerText = `${currentQuestionIndex + 1} / ${activeGame.questions.length}`;
    document.getElementById("game-question").innerText = question.q;
    document.getElementById("game-support-text").innerText = getQuestionHint(question.type);

    updateGameProgress();
    closeAnswerModal();

    const badge = document.getElementById("game-format-label");
    badge.innerText = getQuestionTypeLabel(question.type);
    badge.dataset.type = question.type || "choice";

    const photoContainer = document.getElementById("photo-container");
    const photoEl = document.getElementById("game-photo");

    if (question.type === "photo") {
        photoContainer.style.display = "block";
        photoEl.src = question.img || getPhotoPlaceholder(question.photoLabel || "Фото скоро будет добавлено");
        photoEl.alt = question.q ? `Иллюстрация к вопросу: ${question.q}` : "Иллюстрация к вопросу";
    } else {
        photoContainer.style.display = "none";
    }

    const optionsContainer = document.getElementById("game-options");
    optionsContainer.innerHTML = "";

    const answers = shuffleArray(
        normalizeCollection(question.options).map((option, index) => ({
            text: option,
            isCorrect: index === getQuestionCorrectIndex(question)
        }))
    );

    answers.forEach((answer, index) => {
        const button = document.createElement("button");
        const mark = document.createElement("span");
        const text = document.createElement("span");

        button.type = "button";
        button.className = "btn-answer";
        button.dataset.correct = String(answer.isCorrect);
        button.dataset.answerText = answer.text;
        button.onclick = function () {
            checkAnswer(button, answer);
        };

        mark.className = "btn-answer__index";
        mark.innerText = OPTION_MARKS[index] || String(index + 1);

        text.className = "btn-answer__text";
        text.innerText = answer.text;

        button.append(mark, text);
        optionsContainer.appendChild(button);
    });

    startTimer();
}

function checkAnswer(clickedButton, answer, { timedOut = false } = {}) {
    stopTimer();
    const supportText = document.getElementById("game-support-text");
    const allButtons = document.getElementById("game-options").children;
    const question = activeGame?.questions?.[currentQuestionIndex];
    const isCorrect = Boolean(answer?.isCorrect);

    for (let i = 0; i < allButtons.length; i++) {
        allButtons[i].disabled = true;
        if (allButtons[i].dataset.correct === "true") {
            allButtons[i].classList.add("correct");
        }
    }

    if (clickedButton) {
        if (isCorrect) {
            score += 1;
            if (supportText) supportText.innerText = "Верно. Отличный ответ, переходим к следующему вопросу.";
        } else {
            clickedButton.classList.add("wrong");
            if (supportText) supportText.innerText = "Неверно. Таймер остановлен, прочитайте пояснение и продолжите квиз.";
        }
    } else if (timedOut && supportText) {
        supportText.innerText = "Время вышло. Таймер остановлен, прочитайте пояснение и продолжите квиз.";
    }

    if (isCorrect) {
        window.setTimeout(goToNextQuestion, 1000);
        return;
    }

    if (!question) return;

    openAnswerModal({
        title: timedOut ? "Время вышло" : "Неверный ответ",
        status: timedOut
            ? "Время истекло. Ответ не засчитан. Прочитайте пояснение и продолжите квиз."
            : "Ответ неверный. Прочитайте пояснение и продолжите квиз.",
        correctAnswer: getCorrectAnswerText(question),
        fact: getQuestionFact(question),
        showCorrectAnswer: false
    });
}

function finishGame() {
    switchScreen("result");

    const totalQuestions = activeGame?.questions?.length || 0;
    const result = getResultMessage(score, totalQuestions);

    document.getElementById("final-score").innerText = `${score} из ${totalQuestions}`;
    document.getElementById("result-title").innerText = result.title;
    document.getElementById("result-caption").innerText = result.text;
}

function submitScore() {
    if (!activeGame) return;

    const input = document.getElementById("player-name");
    const name = input.value.trim() || "Гость";

    leaders.push({
        name,
        score,
        game: activeGame.title
    });

    leaders = leaders
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

    saveData();
    updateLeaderboardUI();
    updateMenuStats();
    input.value = "";
    showLeaderboard();
}

function updateLeaderboardUI() {
    const container = document.getElementById("leader-data");
    const totalEl = document.getElementById("leaderboard-total");
    if (!container) return;

    const sortedLeaders = [...leaders].sort((a, b) => b.score - a.score).slice(0, 20);
    if (totalEl) totalEl.innerText = sortedLeaders.length;

    if (!sortedLeaders.length) {
        container.innerHTML = "<div class='empty-state'>Пока нет сохранённых результатов. Пройдите тему и станьте первым участником рейтинга.</div>";
        return;
    }

    container.innerHTML = sortedLeaders.map((leader, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

        return `
            <div class="leader-card" data-rank="${rank}">
                <div class="medal-icon">${medal}</div>
                <div class="leader-info">
                    <span class="leader-name">${escapeHtml(leader.name || "Гость")}</span>
                    <span class="leader-game">${escapeHtml(leader.game || "Без темы")}</span>
                </div>
                <div class="leader-score">${leader.score ?? 0}</div>
            </div>`;
    }).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadData();
    refreshAllUI();
    toggleEditorFields();
    applyScreenFromQuery();
    applyFigmaExportMode();

    bindImagePreview("set-logo-url", "preview-logo");
    bindImagePreview("set-body-bg-url", "preview-body-bg");
    bindImagePreview("set-hero-bg-url", "preview-hero-bg");
    bindImagePreview("edit-img", "preview-edit-img");

    const adminPass = document.getElementById("admin-pass");
    if (adminPass) {
        adminPass.addEventListener("keydown", (event) => {
            if (event.key === "Enter") checkLogin();
        });
    }

    const continueButton = document.getElementById("answer-modal-continue");
    if (continueButton) {
        continueButton.addEventListener("click", goToNextQuestion);
    }

    document.getElementById("import-data-file")?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) importDataFromFile(file);
        event.target.value = "";
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && isFirebaseConfigured()) loadFromFirebase();
    });
});

window.showMenu = showMenu;
window.showLogin = showLogin;
window.showLeaderboard = showLeaderboard;
window.showFeedbackScreen = showFeedbackScreen;
window.checkLogin = checkLogin;
window.switchAdminTab = switchAdminTab;
window.saveSiteSettings = saveSiteSettings;
window.testFirebaseConnection = testFirebaseConnection;
window.loadFromFirebase = loadFromFirebase;
window.pushToFirebaseNow = pushToFirebaseNow;
window.exportData = exportData;
window.reloadFromServer = reloadFromServer;
window.createNewGame = createNewGame;
window.deleteGame = deleteGame;
window.renameGame = renameGame;
window.manageQuestions = manageQuestions;
window.openEditor = openEditor;
window.deleteQuestion = deleteQuestion;
window.toggleEditorFields = toggleEditorFields;
window.saveQuestion = saveQuestion;
window.switchScreen = switchScreen;
window.playGame = playGame;
window.checkAnswer = checkAnswer;
window.submitScore = submitScore;
window.submitFeedback = submitFeedback;
window.deleteFeedback = deleteFeedback;