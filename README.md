# Driverpool24

Kurzanleitung zum Starten des Projekts

Voraussetzungen
- Node.js >= 18 (https://nodejs.org)

Schnellstart

1. Repository klonen

   git clone git@github.com:evento318/driverpool24.git
   cd driverpool24

2. Abhängigkeiten installieren

   npm install

3. Server starten

   npm start

   Der Server läuft standardmäßig auf PORT 3000 (oder `process.env.PORT`).

Hinweise
- Die Datei `.gitignore` schließt `node_modules/`, `.env` und `*.log` aus.
- Aktuell werden Nutzerdaten und Jobs nur im Arbeitsspeicher gehalten — bei jedem Neustart gehen sie verloren.
- JWT-Secret und andere sensible Werte sollten in einer `.env` liegen (nicht ins Repo committen).

Empfohlene nächste Schritte
- Optional: `npm install --save-dev nodemon` und `npm run dev` für automatisches Reload während der Entwicklung.
- Optional: `.env.example` hinzufügen, um benötigte Umgebungsvariablen zu dokumentieren.

Wenn du möchtest, füge ich noch eine `README`-Erweiterung, `.env.example` oder CI‑Workflow hinzu — sag kurz Bescheid.
