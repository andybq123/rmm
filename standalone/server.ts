// ============================================================
//  RMM Console — servidor standalone (VPS / Docker)
//
//  Serve o painel compilado (client/dist) e executa as MESMAS
//  actions de server/src/actions.ts, com o banco SQLite próprio
//  (drizzle/bun-sqlite + migrations de drizzle/). É este processo
//  que o serviço "app" do docker-compose roda na porta 3000 —
//  o Caddy faz proxy para "app:3000" na rede interna do compose.
//
//  Uso local (fora do Docker):  bun standalone/server.ts
//  Variáveis: PORT (3000), RMM_DB_PATH (data/app.db)
// ============================================================
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import { Actions } from "../server/src/actions";
import * as schema from "../server/src/schema";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.RMM_DB_PATH ?? "data/app.db";
const ROOT = process.cwd();
const CLIENT_DIR = join(ROOT, "client", "dist");

// ---------- Banco: SQLite próprio + migrations do projeto ----------
mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: join(ROOT, "drizzle") });

// ---------- ctx mínimo compatível com as actions ----------
// As actions deste painel usam apenas ctx.db e ctx.invalidateQueries.
// O restante lança erro explícito se um dia for chamado neste servidor.
const unsupported = (name: string) =>
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(`Recurso indisponível no servidor standalone da VPS: ${name}`);
      },
    },
  );
const ctx = {
  slug: "rmm-monitor-de-computadores",
  invocationId: "",
  spaceDir: ROOT,
  db: () => db,
  blobs: unsupported("ctx.blobs"),
  agent: unsupported("ctx.agent"),
  inference: unsupported("ctx.inference"),
  tool: unsupported("ctx.tool"),
  executePrivileged: unsupported("ctx.executePrivileged"),
  emit: () => {},
  invalidateQueries: () => {},
} as unknown as Ctx;

// ---------- Dispatch das actions (mesmo contrato do painel) ----------
// Cliente envia POST /actions { action, args } e lê { data } ou { error }.
type ActionDef = {
  request: { parse: (value: unknown) => unknown };
  response: { parse: (value: unknown) => unknown };
  handler: (ctx: Ctx, args: never) => Promise<unknown>;
};
const actions = Actions as unknown as Record<string, ActionDef>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleActions(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { action?: string; args?: unknown } | null;
  const name = typeof body?.action === "string" ? body.action : "";
  const def = actions[name];
  if (!def) return json({ error: `Ação desconhecida: ${name || "(vazia)"}` }, 404);
  let args: unknown;
  try {
    args = def.request.parse(body?.args ?? {});
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Argumentos inválidos." }, 400);
  }
  try {
    const result = await def.handler(ctx, args as never);
    return json({ data: def.response.parse(result) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erro interno do servidor." }, 400);
  }
}

// ---------- Download do instalador .exe compilado pelo builder ----------
// GET /installer-download/<buildId>?t=<sessionToken>
// O .exe NÃO passa pelas actions (JSON não é lugar para binário de ~15 MB):
// ele fica no volume do serviço builder e esta rota — que só existe no
// servidor da VPS — valida a sessão do painel no banco e faz proxy do
// arquivo a partir do builder (rede interna do compose), já com
// Content-Disposition de download.
const BUILDER_URL = (process.env.BUILDER_URL ?? "http://builder:8080").replace(/\/+$/, "");

async function handleInstallerDownload(url: URL): Promise<Response> {
  const id = decodeURIComponent(url.pathname.slice("/installer-download/".length)).split("/")[0] ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!id || !token) return json({ error: "Download inválido: informe o build e a sessão." }, 400);
  const sRows = await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
  const s = sRows[0];
  if (!s || s.expiresAt.getTime() < Date.now()) return json({ error: "Sessão expirada. Faça login de novo e gere o download pelo painel." }, 401);
  const bRows = await db.select().from(schema.installerBuilds).where(eq(schema.installerBuilds.id, id)).limit(1);
  const b = bRows[0];
  if (!b) return json({ error: "Build não encontrado." }, 404);
  if (b.status !== "ready") return json({ error: `Este instalador ainda não está pronto (status: ${b.status}).` }, 409);
  if (!BUILDER_URL) return json({ error: "Serviço builder não configurado neste servidor (BUILDER_URL)." }, 503);
  let upstream: Response;
  try {
    upstream = await fetch(`${BUILDER_URL}/builds/${encodeURIComponent(id)}/file`);
  } catch {
    return json({ error: "Serviço builder indisponível no momento. Verifique: docker compose logs builder" }, 502);
  }
  if (!upstream.ok || !upstream.body) return json({ error: "O builder não devolveu o arquivo do instalador." }, 502);
  const fileName = b.installerFileName || "RmmAgent-Setup.exe";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${fileName}"`,
      ...(b.sizeBytes ? { "content-length": String(b.sizeBytes) } : {}),
      "cache-control": "no-store",
    },
  });
}

// ---------- Arquivos estáticos do painel (SPA) ----------
function staticResponse(pathname: string): Response | null {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const full = join(CLIENT_DIR, rel);
  if (!full.startsWith(CLIENT_DIR)) return null;
  if (extname(rel) && existsSync(full)) return new Response(Bun.file(full));
  return null;
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname.startsWith("/installer-download/")) {
      if (req.method !== "GET") return json({ error: "Use GET." }, 405);
      return handleInstallerDownload(url);
    }
    if (url.pathname === "/actions") {
      if (req.method !== "POST") return json({ error: "Use POST em /actions." }, 405);
      return handleActions(req);
    }
    const file = staticResponse(url.pathname);
    if (file) return file;
    const index = join(CLIENT_DIR, "index.html");
    if (existsSync(index)) {
      return new Response(Bun.file(index), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Painel ainda não compilado (client/dist ausente).", { status: 503 });
  },
});

console.log(`[rmm] Servidor standalone ouvindo em http://0.0.0.0:${server.port} (banco: ${DB_PATH})`);
