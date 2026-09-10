const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let db;

async function initDatabase() {
    db = await open({
        filename: process.env.DATABASE_PATH || './driverpool24.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('fahrer','firma','admin')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            firma_id INTEGER NOT NULL,
            titel TEXT NOT NULL,
            beschreibung TEXT,
            preis REAL,
            status TEXT DEFAULT 'offen',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (firma_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            fahrer_id INTEGER NOT NULL,
            status TEXT DEFAULT 'offen',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id),
            FOREIGN KEY (fahrer_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            firma_id INTEGER NOT NULL,
            fahrer_id INTEGER NOT NULL,
            fahrerlohn REAL NOT NULL,
            gebuehr REAL NOT NULL,
            gesamt REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id),
            FOREIGN KEY (firma_id) REFERENCES users(id),
            FOREIGN KEY (fahrer_id) REFERENCES users(id)
        );
    `);

    console.log('✅ Datenbank initialisiert');
}

function getDb() {
    return db;
}

module.exports = { initDatabase, getDb };
