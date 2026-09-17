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
    adminPassword: "1234",
    dbPath: "quizData",
    dataFile: "data.json",

    firebase: {
       apiKey: "AIzaSyAjAcC0nxKymaMaNDvgT_PjuYwg0F7SytY",
  authDomain: "tech-2d9f9.firebaseapp.com",
  databaseURL: "https://tech-2d9f9-default-rtdb.firebaseio.com",
  projectId: "tech-2d9f9",
  storageBucket: "tech-2d9f9.firebasestorage.app",
  messagingSenderId: "157768085420",
  appId: "1:157768085420:web:e1024035699908787cd409",
  measurementId: "G-WJ7MTFN2CL"
    }
};
