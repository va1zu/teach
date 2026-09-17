/**
 * ═══════════════════════════════════════════════════════════════
 *  НАСТРОЙКИ ДЛЯ УЧИТЕЛЯ — редактируйте этот файл
 * ═══════════════════════════════════════════════════════════════
 *
 *  adminPassword — пароль входа в админ-панель
 *  firebase      — настройки из Firebase Console (вкладка «Ваши приложения» → Web)
 *  dbPath        — имя «папки» в базе (можно не менять)
 *  dataFile      — резервный файл на GitHub, если Firebase недоступен
 *
 *  Инструкция по подключению: ИНСТРУКЦИЯ.txt
 */
window.QUIZ_CONFIG = {
    adminPassword: "teacher2024",
    dbPath: "quizData",
    dataFile: "data.json",

    firebase: {
        apiKey: "",
        authDomain: "",
        databaseURL: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: ""
    }
};
