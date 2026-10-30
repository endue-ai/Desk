-- An index file as schema version 1 wrote it, frozen: migrate.rs opens it with every later build.
-- Never edit it; a new schema version adds its own fixture.
CREATE TABLE items (
  seq INTEGER PRIMARY KEY,
  connector TEXT NOT NULL,
  instance TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT,
  deep_link TEXT,
  body TEXT,
  json TEXT NOT NULL,
  status TEXT,
  unread INTEGER,
  updated_at_utc INTEGER NOT NULL,
  created_at_utc INTEGER,
  start_utc INTEGER,
  end_utc INTEGER,
  due_utc INTEGER,
  received_at_utc INTEGER,
  published_at_utc INTEGER,
  UNIQUE (connector, instance, id)
);
CREATE INDEX items_kind_updated ON items (kind, updated_at_utc);
CREATE INDEX items_source_updated ON items (connector, instance, updated_at_utc);
CREATE VIRTUAL TABLE items_fts USING fts5 (
  title, body, content = 'items', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body) VALUES ('delete', old.seq, old.title, old.body);
END;
CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body) VALUES ('delete', old.seq, old.title, old.body);
  INSERT INTO items_fts (rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
INSERT INTO items (
  connector, instance, id, kind, title, updated_at, json, status, updated_at_utc, due_utc
) VALUES (
  'desk.fixtures', 'default', 't1', 'task', 'Pay rent', '2026-10-30T09:00:00+09:00',
  '{"id":"t1","source":{"connector":"desk.fixtures","instance":"default"},"kind":"task","title":"Pay rent","updatedAt":"2026-10-30T09:00:00+09:00","status":"open","due":"2026-11-01T00:00:00Z"}',
  'open', 1793318400, 1793491200
);
PRAGMA user_version = 1;
