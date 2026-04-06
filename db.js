const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "kpi.db");

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('employee','moderator')),
      employee_code TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      design_center INTEGER NOT NULL DEFAULT 0,
      net_salary REAL,
      annual_bonus REAL
    );

    CREATE TABLE IF NOT EXISTS kpis (
      employee_code TEXT NOT NULL,
      kpi_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      weight REAL NOT NULL,
      target_q1 REAL, target_q2 REAL, target_q3 REAL, target_q4 REAL,
      PRIMARY KEY(employee_code, kpi_no),
      FOREIGN KEY(employee_code) REFERENCES employees(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL,
      category TEXT,
      topic TEXT NOT NULL,
      detail TEXT,
      kpi_no INTEGER,
      measure_type TEXT CHECK(measure_type IN ('count','ratio','score')),
      target_q1 REAL, target_q2 REAL, target_q3 REAL, target_q4 REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      FOREIGN KEY(employee_code) REFERENCES employees(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS goal_updates (
      goal_id INTEGER NOT NULL,
      quarter TEXT NOT NULL CHECK(quarter IN ('Q1','Q2','Q3','Q4')),
      actual REAL,
      status TEXT,
      note TEXT,
      evidence_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      PRIMARY KEY(goal_id, quarter),
      FOREIGN KEY(goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quarter_locks (
      employee_code TEXT NOT NULL,
      quarter TEXT NOT NULL CHECK(quarter IN ('Q1','Q2','Q3','Q4')),
      locked_at TEXT,
      locked_by TEXT,
      PRIMARY KEY(employee_code, quarter),
      FOREIGN KEY(employee_code) REFERENCES employees(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_goals_emp ON goals(employee_code);
    CREATE INDEX IF NOT EXISTS idx_goals_kpi ON goals(kpi_no);
    CREATE INDEX IF NOT EXISTS idx_updates_goal ON goal_updates(goal_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
  `);
}

function isSeeded(db) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM employees").get();
  return row.c > 0;
}

module.exports = { openDb, initDb, isSeeded, DB_PATH };
