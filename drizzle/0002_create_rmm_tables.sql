DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  os TEXT NOT NULL DEFAULT 'unknown',
  os_version TEXT NOT NULL DEFAULT '',
  arch TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  mac_address TEXT,
  agent_version TEXT NOT NULL DEFAULT '1.0.0',
  cpu_model TEXT NOT NULL DEFAULT '',
  cpu_cores INTEGER NOT NULL DEFAULT 0,
  total_ram_mb INTEGER NOT NULL DEFAULT 0,
  total_disk_gb REAL NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT 'Geral',
  notes TEXT NOT NULL DEFAULT '',
  agent_token TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_cpu_percent REAL NOT NULL DEFAULT 0,
  last_ram_percent REAL NOT NULL DEFAULT 0,
  last_ram_used_mb INTEGER NOT NULL DEFAULT 0,
  last_disk_percent REAL NOT NULL DEFAULT 0,
  last_disk_used_gb REAL NOT NULL DEFAULT 0,
  last_uptime_seconds INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  cpu_percent REAL NOT NULL DEFAULT 0,
  ram_percent REAL NOT NULL DEFAULT 0,
  ram_used_mb INTEGER NOT NULL DEFAULT 0,
  disk_percent REAL NOT NULL DEFAULT 0,
  disk_used_gb REAL NOT NULL DEFAULT 0,
  uptime_seconds INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  device_hostname TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  is_resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
--> statement-breakpoint
CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at INTEGER NOT NULL,
  executed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
