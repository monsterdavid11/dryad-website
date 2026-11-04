import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, stripe_customer TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY REFERENCES users(id), stripe_id TEXT UNIQUE, status TEXT NOT NULL, plan TEXT, period_end INTEGER, cancel_at_end INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), script TEXT NOT NULL, started_at TEXT NOT NULL, seconds INTEGER NOT NULL, runs INTEGER NOT NULL, gold INTEGER NOT NULL, elixir INTEGER NOT NULL, walls INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkouts(user_id TEXT PRIMARY KEY REFERENCES users(id), plan TEXT NOT NULL, session_id TEXT NOT NULL, url TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_keys(device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE, public_key TEXT NOT NULL, revoked_at INTEGER);
    CREATE TABLE IF NOT EXISTS pairings(id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, user_code TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, user_id TEXT REFERENCES users(id), device_id TEXT REFERENCES devices(id) ON DELETE CASCADE, claimed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS native_tokens(hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS native_challenges(id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, nonce TEXT NOT NULL, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry(device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, recorded_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(device_id,session_id,sequence));
    CREATE TABLE IF NOT EXISTS telemetry_sessions(device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, day TEXT NOT NULL, script TEXT NOT NULL, seconds INTEGER NOT NULL, runs INTEGER NOT NULL, gold INTEGER NOT NULL, elixir INTEGER NOT NULL, walls INTEGER NOT NULL, PRIMARY KEY(device_id,session_id,day));
    CREATE TABLE IF NOT EXISTS dev_entitlements(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_tokens(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS verified_emails(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, verified_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_resets(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL, locked_until INTEGER, error TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(state,available);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, at INTEGER NOT NULL, details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS release_catalog(channel TEXT PRIMARY KEY, version TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS release_packages(channel TEXT PRIMARY KEY REFERENCES release_catalog(channel), release_sha256 TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_holds(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS download_tokens(hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, channel TEXT NOT NULL, sha256 TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_hardware(device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pairing_hardware(pairing_id TEXT PRIMARY KEY REFERENCES pairings(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL);
  `);
  return db;
}
