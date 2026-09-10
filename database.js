import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'driverpool24.db');

let db = null;

export async function initDatabase() {
  try {
    db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    await db.exec('PRAGMA foreign_keys = ON');

    // Create users table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'fahrer',
        name TEXT NOT NULL,
        region TEXT,
        plan TEXT DEFAULT 'Starter',
        agbAcceptedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Create jobs table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_loc TEXT NOT NULL,
        to_loc TEXT NOT NULL,
        region TEXT NOT NULL,
        date TEXT NOT NULL,
        cargo TEXT NOT NULL,
        drivers_needed INTEGER NOT NULL,
        pay REAL NOT NULL,
        req TEXT,
        posted_by TEXT NOT NULL,
        plan TEXT,
        status TEXT DEFAULT 'open',
        drivers_hired INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Create applications table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        driver_name TEXT NOT NULL,
        driver_email TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      )
    `);

    // Create invoices table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        job_id INTEGER NOT NULL,
        route TEXT NOT NULL,
        date TEXT NOT NULL,
        driver_name TEXT NOT NULL,
        driver_email TEXT NOT NULL,
        driver_pay REAL NOT NULL,
        platform_fee REAL DEFAULT 150,
        total REAL NOT NULL,
        posted_by TEXT NOT NULL,
        payer_name TEXT,
        paid_at TEXT NOT NULL,
        status TEXT DEFAULT 'paid',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      )
    `);

    console.log('✅ SQLite Datenbank initialisiert:', DB_PATH);
    return db;
  } catch (error) {
    console.error('❌ Fehler beim Initialisieren der Datenbank:', error);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error('Datenbank nicht initialisiert!');
  }
  return db;
}

// User functions
export async function createUser(email, hashedPassword, role, name, region, plan, agbAcceptedAt) {
  const db = getDatabase();
  const now = new Date().toISOString();
  return await db.run(
    `INSERT INTO users (email, password, role, name, region, plan, agbAcceptedAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [email, hashedPassword, role, name, region, plan, agbAcceptedAt, now, now]
  );
}

export async function getUserByEmail(email) {
  const db = getDatabase();
  return await db.get('SELECT * FROM users WHERE email = ?', [email]);
}

export async function getUserById(id) {
  const db = getDatabase();
  return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

// Job functions
export async function createJob(from_loc, to_loc, region, date, cargo, drivers_needed, pay, req, posted_by, plan) {
  const db = getDatabase();
  const now = new Date().toISOString();
  return await db.run(
    `INSERT INTO jobs (from_loc, to_loc, region, date, cargo, drivers_needed, pay, req, posted_by, plan, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [from_loc, to_loc, region, date, cargo, drivers_needed, pay, req, posted_by, plan, now, now]
  );
}

export async function getJobs(role = null, region = null, posted_by = null) {
  const db = getDatabase();
  let query = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];

  if (role === 'fahrer' && region) {
    query += ' AND region = ?';
    params.push(region);
  } else if (role === 'firma' && posted_by) {
    query += ' AND posted_by = ?';
    params.push(posted_by);
  }

  query += ' ORDER BY createdAt DESC';
  return await db.all(query, params);
}

export async function getJobById(id) {
  const db = getDatabase();
  return await db.get('SELECT * FROM jobs WHERE id = ?', [id]);
}

export async function updateJobStatus(id, status, drivers_hired = null) {
  const db = getDatabase();
  const now = new Date().toISOString();
  let query = 'UPDATE jobs SET status = ?, updatedAt = ?';
  const params = [status, now];

  if (drivers_hired !== null) {
    query += ', drivers_hired = ?';
    params.push(drivers_hired);
  }

  query += ' WHERE id = ?';
  params.push(id);

  return await db.run(query, params);
}

// Application functions
export async function createApplication(job_id, driver_name, driver_email) {
  const db = getDatabase();
  const now = new Date().toISOString();
  return await db.run(
    `INSERT INTO applications (job_id, driver_name, driver_email, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [job_id, driver_name, driver_email, now, now]
  );
}

export async function getApplicationsByJobId(job_id) {
  const db = getDatabase();
  return await db.all('SELECT * FROM applications WHERE job_id = ? ORDER BY createdAt DESC', [job_id]);
}

export async function getApplicationById(id) {
  const db = getDatabase();
  return await db.get('SELECT * FROM applications WHERE id = ?', [id]);
}

export async function updateApplicationStatus(id, status) {
  const db = getDatabase();
  const now = new Date().toISOString();
  return await db.run('UPDATE applications SET status = ?, updatedAt = ? WHERE id = ?', [status, now, id]);
}

export async function getApplicationByJobAndEmail(job_id, driver_email) {
  const db = getDatabase();
  return await db.get(
    'SELECT * FROM applications WHERE job_id = ? AND driver_email = ?',
    [job_id, driver_email]
  );
}

// Invoice functions
export async function createInvoice(invoice_number, job_id, route, date, driver_name, driver_email, driver_pay, platform_fee, total, posted_by, payer_name, paid_at) {
  const db = getDatabase();
  const now = new Date().toISOString();
  return await db.run(
    `INSERT INTO invoices (invoice_number, job_id, route, date, driver_name, driver_email, driver_pay, platform_fee, total, posted_by, payer_name, paid_at, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoice_number, job_id, route, date, driver_name, driver_email, driver_pay, platform_fee, total, posted_by, payer_name, paid_at, now, now]
  );
}

export async function getInvoices(posted_by = null) {
  const db = getDatabase();
  if (posted_by) {
    return await db.all('SELECT * FROM invoices WHERE posted_by = ? ORDER BY createdAt DESC', [posted_by]);
  }
  return await db.all('SELECT * FROM invoices ORDER BY createdAt DESC');
}

export async function getInvoiceById(id) {
  const db = getDatabase();
  return await db.get('SELECT * FROM invoices WHERE id = ?', [id]);
}

// Admin stats functions
export async function getAdminStats() {
  const db = getDatabase();
  
  const totalOrders = await db.get('SELECT COUNT(*) as count FROM jobs');
  const openOrders = await db.get('SELECT COUNT(*) as count FROM jobs WHERE status = "open"');
  const closedOrders = await db.get('SELECT COUNT(*) as count FROM jobs WHERE status = "closed"');
  const totalRevenue = await db.get('SELECT SUM(platform_fee) as total FROM invoices');
  const paidInvoices = await db.get('SELECT COUNT(*) as count FROM invoices WHERE status = "paid"');

  return {
    totalOrders: totalOrders.count || 0,
    openOrders: openOrders.count || 0,
    closedOrders: closedOrders.count || 0,
    totalRevenue: totalRevenue.total || 0,
    paidInvoices: paidInvoices.count || 0
  };
}

export async function getAllUsers() {
  const db = getDatabase();
  return await db.all('SELECT id, email, role, name, region, plan, createdAt FROM users');
}