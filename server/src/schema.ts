import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  os: text("os", { enum: ["windows", "linux", "darwin", "unknown"] }).notNull().default("unknown"),
  osVersion: text("os_version").notNull().default(""),
  arch: text("arch").notNull().default(""),
  ipAddress: text("ip_address").notNull().default(""),
  macAddress: text("mac_address"),
  agentVersion: text("agent_version").notNull().default("1.0.0"),
  cpuModel: text("cpu_model").notNull().default(""),
  cpuCores: integer("cpu_cores").notNull().default(0),
  totalRamMb: integer("total_ram_mb").notNull().default(0),
  totalDiskGb: real("total_disk_gb").notNull().default(0),
  groupName: text("group_name").notNull().default("Geral"),
  notes: text("notes").notNull().default(""),
  agentToken: text("agent_token").notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastCpuPercent: real("last_cpu_percent").notNull().default(0),
  lastRamPercent: real("last_ram_percent").notNull().default(0),
  lastRamUsedMb: integer("last_ram_used_mb").notNull().default(0),
  lastDiskPercent: real("last_disk_percent").notNull().default(0),
  lastDiskUsedGb: real("last_disk_used_gb").notNull().default(0),
  lastUptimeSeconds: integer("last_uptime_seconds").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull(),
  cpuPercent: real("cpu_percent").notNull().default(0),
  ramPercent: real("ram_percent").notNull().default(0),
  ramUsedMb: integer("ram_used_mb").notNull().default(0),
  diskPercent: real("disk_percent").notNull().default(0),
  diskUsedGb: real("disk_used_gb").notNull().default(0),
  uptimeSeconds: integer("uptime_seconds").notNull().default(0),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull(),
  deviceHostname: text("device_hostname").notNull().default(""),
  type: text("type").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("warning"),
  message: text("message").notNull(),
  isResolved: integer("is_resolved").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

export const commands = sqliteTable("commands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull().default(""),
  status: text("status", { enum: ["pending", "sent", "executed", "failed"] }).notNull().default("pending"),
  result: text("result"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  executedAt: integer("executed_at", { mode: "timestamp_ms" }),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role", { enum: ["admin", "operator", "viewer"] }).notNull().default("operator"),
  isActive: integer("is_active").notNull().default(1),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const installerBuilds = sqliteTable("installer_builds", {
  id: text("id").primaryKey(),
  siteName: text("site_name").notNull().default(""),
  domain: text("domain").notNull().default(""),
  installerFileName: text("installer_file_name").notNull().default(""),
  status: text("status", { enum: ["queued", "building", "ready", "failed", "unavailable"] }).notNull().default("building"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  error: text("error").notNull().default(""),
  logTail: text("log_tail").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

// Legacy table kept in type for migration compatibility — dropped in SQL
export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
