import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const projectRoot = rootDir
export const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data')
export const uploadsDir = path.join(dataDir, 'uploads')

fs.mkdirSync(uploadsDir, { recursive: true })

export const db = new DatabaseSync(path.join(dataDir, 'brain.db'))
export const OWNER_USER_ID = 'owner'

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    telegram_id TEXT UNIQUE,
    telegram_username TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (file_id, entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS inbox_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    text TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'text',
    tz TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'new',
    ai_result TEXT,
    ai_error TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    tags TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    source_inbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    due_time TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    source_inbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    title TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '✦',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'owner',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    source_inbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weekly_summaries (
    user_id TEXT NOT NULL DEFAULT 'owner',
    week_start TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, week_start)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS notification_settings (
    user_id TEXT PRIMARY KEY,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    push_enabled INTEGER NOT NULL DEFAULT 0,
    telegram_enabled INTEGER NOT NULL DEFAULT 0,
    day_before INTEGER NOT NULL DEFAULT 1,
    at_time INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS reminder_deliveries (
    user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reminder_kind TEXT NOT NULL,
    due_key TEXT NOT NULL,
    delivered_at TEXT NOT NULL,
    PRIMARY KEY (user_id, entity_type, entity_id, reminder_kind, due_key)
  );

  CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_at ON reminder_deliveries(delivered_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, body, tags,
    content='notes', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    title, notes,
    content='tasks', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    title, description,
    content='events', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS inbox_fts USING fts5(
    text,
    content='inbox_items', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    INSERT INTO notes_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, new.notes);
  END;
  CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, notes) VALUES ('delete', old.rowid, old.title, old.notes);
  END;
  CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, notes) VALUES ('delete', old.rowid, old.title, old.notes);
    INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, new.notes);
  END;

  CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
  END;
  CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
  END;
  CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO events_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
  END;

  CREATE TRIGGER IF NOT EXISTS inbox_ai AFTER INSERT ON inbox_items BEGIN
    INSERT INTO inbox_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS inbox_ad AFTER DELETE ON inbox_items BEGIN
    INSERT INTO inbox_fts(inbox_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS inbox_au AFTER UPDATE ON inbox_items BEGIN
    INSERT INTO inbox_fts(inbox_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO inbox_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
`)

function tableColumns(table: string): { name: string }[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
}

function ensureColumn(table: string, column: string, definition: string): void {
  if (tableColumns(table).some((entry) => entry.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

for (const table of ['files', 'inbox_items', 'notes', 'tasks', 'habits', 'events']) {
  ensureColumn(table, 'user_id', "TEXT NOT NULL DEFAULT 'owner'")
}
ensureColumn('sessions', 'user_id', 'TEXT')

if (!tableColumns('weekly_summaries').some((entry) => entry.name === 'user_id')) {
  db.exec(`
    ALTER TABLE weekly_summaries RENAME TO weekly_summaries_legacy;
    CREATE TABLE weekly_summaries (
      user_id TEXT NOT NULL DEFAULT 'owner',
      week_start TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, week_start)
    );
    INSERT INTO weekly_summaries (user_id, week_start, content, created_at)
      SELECT '${OWNER_USER_ID}', week_start, content, created_at FROM weekly_summaries_legacy;
    DROP TABLE weekly_summaries_legacy;
  `)
}

for (const table of ['files', 'inbox_items', 'notes', 'tasks', 'habits', 'events']) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table}(user_id);`)
}
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);')

db.prepare(
  `INSERT OR IGNORE INTO users (id, login, name, password_hash, role, created_at)
   VALUES (?, 'owner', 'Владелец', '', 'owner', ?)`,
).run(OWNER_USER_ID, new Date().toISOString())
db.prepare('UPDATE sessions SET user_id = ? WHERE user_id IS NULL').run(OWNER_USER_ID)

for (const table of ['notes_fts', 'tasks_fts', 'events_fts', 'inbox_fts']) {
  try {
    db.exec(`INSERT INTO ${table}(${table}) VALUES ('rebuild');`)
  } catch {
    // FTS rebuild is best-effort; application still works without it.
  }
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }
}
