/* DriverPool24 – multilingual foundation
   Supported languages:
   de, fr, nl, es, en, pl, hu, bg, cs, ru
*/
window.DRIVERPOOL24_LANGUAGES = [
  { code: 'de', name: 'Deutsch', native: 'Deutsch' },
  { code: 'fr', name: 'Français', native: 'Français' },
  { code: 'nl', name: 'Nederlands', native: 'Nederlands' },
  { code: 'es', name: 'Español', native: 'Español' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'pl', name: 'Polski', native: 'Polski' },
  { code: 'hu', name: 'Magyar', native: 'Magyar' },
  { code: 'bg', name: 'Български', native: 'Български' },
  { code: 'cs', name: 'Čeština', native: 'Čeština' },
  { code: 'ru', name: 'Русский', native: 'Русский' }
];

window.DRIVERPOOL24_I18N = {
  de: {
    login: 'Anmelden', register: 'Konto erstellen', logout: 'Abmelden',
    driver: 'Fahrer', company: 'Unternehmen', admin: 'Administration',
    jobs: 'Aufträge', dashboard: 'Dashboard', sos: 'SOS',
    documents: 'Dokumente', invoices: 'Rechnungen', messages: 'Nachrichten',
    language: 'Sprache', loggedInAs: 'Angemeldet als'
  },
  fr: { login:'Se connecter', register:'Créer un compte', logout:'Se déconnecter', driver:'Chauffeur', company:'Entreprise', admin:'Administration', jobs:'Missions', dashboard:'Tableau de bord', sos:'SOS', documents:'Documents', invoices:'Factures', messages:'Messages', language:'Langue', loggedInAs:'Connecté en tant que' },
  nl: { login:'Inloggen', register:'Account aanmaken', logout:'Uitloggen', driver:'Chauffeur', company:'Bedrijf', admin:'Beheer', jobs:'Opdrachten', dashboard:'Dashboard', sos:'SOS', documents:'Documenten', invoices:'Facturen', messages:'Berichten', language:'Taal', loggedInAs:'Ingelogd als' },
  es: { login:'Iniciar sesión', register:'Crear cuenta', logout:'Cerrar sesión', driver:'Conductor', company:'Empresa', admin:'Administración', jobs:'Trabajos', dashboard:'Panel', sos:'SOS', documents:'Documentos', invoices:'Facturas', messages:'Mensajes', language:'Idioma', loggedInAs:'Sesión iniciada como' },
  en: { login:'Sign in', register:'Create account', logout:'Sign out', driver:'Driver', company:'Company', admin:'Administration', jobs:'Jobs', dashboard:'Dashboard', sos:'SOS', documents:'Documents', invoices:'Invoices', messages:'Messages', language:'Language', loggedInAs:'Signed in as' },
  pl: { login:'Zaloguj się', register:'Utwórz konto', logout:'Wyloguj się', driver:'Kierowca', company:'Firma', admin:'Administracja', jobs:'Zlecenia', dashboard:'Panel', sos:'SOS', documents:'Dokumenty', invoices:'Faktury', messages:'Wiadomości', language:'Język', loggedInAs:'Zalogowano jako' },
  hu: { login:'Bejelentkezés', register:'Fiók létrehozása', logout:'Kijelentkezés', driver:'Sofőr', company:'Cég', admin:'Adminisztráció', jobs:'Megbízások', dashboard:'Vezérlőpult', sos:'SOS', documents:'Dokumentumok', invoices:'Számlák', messages:'Üzenetek', language:'Nyelv', loggedInAs:'Bejelentkezve mint' },
  bg: { login:'Вход', register:'Създаване на акаунт', logout:'Изход', driver:'Шофьор', company:'Фирма', admin:'Администрация', jobs:'Заявки', dashboard:'Табло', sos:'SOS', documents:'Документи', invoices:'Фактури', messages:'Съобщения', language:'Език', loggedInAs:'Влезли сте като' },
  cs: { login:'Přihlásit se', register:'Vytvořit účet', logout:'Odhlásit se', driver:'Řidič', company:'Firma', admin:'Administrace', jobs:'Zakázky', dashboard:'Nástěnka', sos:'SOS', documents:'Dokumenty', invoices:'Faktury', messages:'Zprávy', language:'Jazyk', loggedInAs:'Přihlášen jako' },
  ru: { login:'Войти', register:'Создать аккаунт', logout:'Выйти', driver:'Водитель', company:'Компания', admin:'Администрирование', jobs:'Заказы', dashboard:'Панель управления', sos:'SOS', documents:'Документы', invoices:'Счета', messages:'Сообщения', language:'Язык', loggedInAs:'Вы вошли как' }
};

(function () {
  const key = 'driverpool24_language';
  const supported = window.DRIVERPOOL24_LANGUAGES.map(x => x.code);
  function browserLanguage() {
    const code = String(navigator.language || 'de').slice(0, 2).toLowerCase();
    return supported.includes(code) ? code : 'de';
  }
  window.driverPool24GetLanguage = function () {
    return localStorage.getItem(key) || browserLanguage();
  };
  window.driverPool24SetLanguage = function (lang) {
    if (!supported.includes(lang)) return false;
    localStorage.setItem(key, lang);
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent('driverpool24:languageChanged', { detail: { language: lang } }));
    return true;
  };
  document.documentElement.lang = window.driverPool24GetLanguage();
})();
