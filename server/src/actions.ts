import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, lt } from "drizzle-orm";
import * as schema from "./schema";

// ---------- helpers ----------

function randHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newId(): string {
  return `${randHex(8)}-${randHex(2)}-${randHex(2)}-${randHex(2)}-${randHex(6)}`;
}

// ---------- Auth helpers (PBKDF2 via WebCrypto) ----------
async function hashPassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as never, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
type UserRow = typeof schema.users.$inferSelect;
function userOut(u: UserRow) {
  return { id: u.id, name: u.name, email: u.email, role: u.role as "admin" | "operator" | "viewer", isActive: u.isActive === 1, lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : "", createdAt: u.createdAt.toISOString() };
}
const userSchema = z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(["admin", "operator", "viewer"]), isActive: z.boolean(), lastLoginAt: z.string(), createdAt: z.string() });

async function getSessionUser(ctx: Ctx, token: string) {
  if (!token) return null;
  const db = ctx.db<typeof schema>();
  const sRows = await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
  const s = sRows[0];
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  const uRows = await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
  const u = uRows[0];
  if (!u || u.isActive !== 1) return null;
  return u;
}
async function requireAuth(ctx: Ctx, token: string): Promise<UserRow> {
  const db = ctx.db<typeof schema>();
  const all = await db.select().from(schema.users).limit(1);
  if (!all[0]) throw new Error("Nenhum usuário cadastrado. Conclua a configuração inicial do administrador.");
  const u = await getSessionUser(ctx, token);
  if (!u) throw new Error("Sessão expirada ou inválida. Faça login novamente.");
  return u as UserRow;
}
async function createSession(ctx: Ctx, userId: string): Promise<string> {
  const db = ctx.db<typeof schema>();
  const token = `sess_${randHex(32)}`;
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.insert(schema.sessions).values({ token, userId, expiresAt: expires });
  return token;
}
function buildGithubReadme(): string {
  return [
    "# RMM — Monitor de Computadores",
    "",
    "Painel web corporativo para monitoramento remoto (RMM) de computadores Windows e Linux, com agentes reais, alertas automáticos e comandos remotos. Preparado para VPS Linux com domínio público e HTTPS.",
    "",
    "## Funcionalidades",
    "- Tela de login com usuários, papéis (Administrador / Operador / Visualizador) e sessões de 7 dias",
    "- Dashboard da frota: online, instável, offline e crítico em tempo real (polling 15s)",
    "- Métricas por máquina: CPU, RAM, disco, uptime, IP, MAC, hardware e histórico em gráfico",
    "- Alertas automáticos quando CPU, RAM ou disco passam de 90%",
    "- Comandos remotos: reiniciar, desligar, coletar informações e executar script",
    "- Agentes reais: Bash (Linux), PowerShell (Windows) e Python universal — envio a cada 60s",
    "- Agente Windows instalável (.exe) via PyInstaller + Inno Setup (código aberto, sem custo)",
    "- Token de matrícula para cadastro seguro de novos dispositivos",
    "- Configuração de domínio público no painel — os scripts já saem apontando para ele",
    "",
    "## Estrutura do projeto",
    "```",
    "client/          React + Tailwind (interface)",
    "  src/App.tsx    Painel, login e todas as telas",
    "  src/Widget.tsx Widget resumido da frota",
    "server/          Backend (actions tipadas)",
    "  src/actions.ts Actions da API + scripts dos agentes + autenticação",
    "  src/schema.ts  Modelo de dados (Drizzle / SQLite)",
    "drizzle/         Migrations SQL",
    "deploy/          VPS: docker-compose, Caddy/Nginx, install e backup",
    "agent/           Build do .exe (PyInstaller) e instalador (Inno Setup)",
    "space.json       Metadados do artefato",
    "docker-compose.yml  Proxy reverso com HTTPS automático (Caddy)",
    "```",
    "",
    "## Instalação em VPS Linux (domínio + HTTPS)",
    "1. Aponte o DNS: registro **A** do domínio/subdomínio que você escolher para o IP público da VPS. Nenhum domínio é fixo no código.",
    "2. Na VPS (Ubuntu/Debian): `sudo bash deploy/install-vps.sh` — o instalador **pergunta o domínio** (ou aceita `DOMAIN=<seu-dominio>` / argumento) e grava `DOMAIN`/`PUBLIC_URL`/`RMM_SERVER_URL` no `.env`. Instala Docker, UFW (só 22/80/443), Fail2ban e atualizações automáticas.",
    "3. Suba o proxy: `docker compose up -d` — o compose lê `DOMAIN`/`PUBLIC_URL` do `.env` (sem `.env` válido ele para e avisa) e o Caddy emite o certificado Let's Encrypt sozinho.",
    "4. No painel, abra **Agentes → Domínio do servidor** e confira o mesmo domínio informado na VPS. O instalador do agente (.exe) também **pergunta o servidor na hora da instalação** e grava a resposta em `config.json` — nenhum agente sai com domínio embutido.",
    "5. Agende o backup: `0 3 * * * /opt/rmm/backup.sh` (guarda 14 dias).",
    "Detalhes completos, Nginx alternativo e checklist de segurança estão na aba **VPS & Segurança** do painel.",
    "",
    "## Agentes",
    "- **Windows (.exe):** gere com `agent/windows/build-exe.ps1` (PyInstaller sobre o agente Python) e o instalador com `agent/windows/RmmAgent.iss` (Inno Setup). O usuário final só baixa o `RmmAgent-Setup.exe` e instala como administrador; o agente roda como serviço e aponta para o seu domínio.",
    "- **Linux:** script Bash + serviço systemd (`deploy/rmm-agent.service`).",
    "- **Alternativas 100% open source compatíveis com a ideia de .exe:** MeshCentral Agent e TacticalRMM Agent distribuem instalador .exe próprio — veja a comparação honesta na aba Agentes do painel antes de trocar a stack.",
    "",
    "## Segurança (exposição pública)",
    "- **Só HTTPS** no domínio público (Caddy/Let's Encrypt ou Nginx+Certbot) — agentes recusam URL sem https quando há domínio configurado",
    "- Senhas com PBKDF2-SHA256 (100 mil iterações) + salt individual — nunca em texto puro",
    "- Agentes autenticados por agentToken próprio por máquina; cadastro exige enrollment token (rotacionável pelo admin)",
    "- Firewall UFW: apenas 22 (SSH por chave), 80 e 443 abertos; Fail2ban no SSH; painel nunca exposto sem proxy",
    "- Nunca commite app.db, tokens ou senhas neste repositório",
    "",
  ].join("\n");
}
function buildGitignore(): string {
  return ["node_modules/", "dist/", ".space-build/", "app.db", "app.db-*", "*.log", ".env", ".env.*", "!.env.example", ".DS_Store", "deploy/.env", "agent/dist/", "agent/build/", "*.exe", "!agent/*.md", ""].join("\n");
}

function normalizePublicUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return "";
  return t;
}
function actionsUrlFromPublic(publicUrl: string): string {
  const base = normalizePublicUrl(publicUrl);
  if (!base) return "";
  return base.endsWith("/actions") ? base : `${base}/actions`;
}
function domainFromPublic(publicUrl: string): string {
  const base = normalizePublicUrl(publicUrl);
  if (!base) return "";
  try { return new URL(base).hostname; } catch { return ""; }
}

function buildDeploymentFiles(publicUrl: string) {
  // NENHUM domínio fixo: se o admin já salvou um domínio no painel, ele só
  // pré-preenche os exemplos; caso contrário os arquivos usam a variável
  // DOMAIN/PUBLIC_URL do .env e o install.sh PERGUNTA o domínio na hora.
  const domain = domainFromPublic(publicUrl);
  const actionsUrl = actionsUrlFromPublic(publicUrl);
  const domainForDocs = domain || "<domínio informado na instalação>";
  const dockerCompose = `# RMM Console — docker-compose para VPS Linux
# O domínio NÃO fica fixo aqui: ele vem do .env (DOMAIN / PUBLIC_URL),
# preenchido pelo deploy/install-vps.sh, que pergunta o domínio na instalação.
# Sem DOMAIN no .env o compose falha de propósito (mensagem abaixo).
# Uso: cp deploy/.env.example .env  # edite DOMAIN/PUBLIC_URL
#      docker compose up -d
services:
  caddy:
    image: caddy:2-alpine
    container_name: rmm-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      - DOMAIN=\${DOMAIN:?Defina DOMAIN no arquivo .env - e o dominio desta VPS, ex. o que voce apontou no DNS}
      - PUBLIC_URL=\${PUBLIC_URL:?Defina PUBLIC_URL no arquivo .env - ex. https:// + o seu DOMAIN}
volumes:
  caddy_data:
  caddy_config:
`;
  const caddyfile = `# Caddy — HTTPS automático (Let's Encrypt)
# O domínio vem da variável de ambiente DOMAIN (do .env) — nada fixo aqui.
# O install-vps.sh pergunta o domínio e grava DOMAIN/PUBLIC_URL no .env.
{$DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
  log {
    output file /var/log/caddy/rmm.log
  }
}
`;
  const nginxConf = `# Nginx — alternativa ao Caddy (HTTPS com Certbot)
# __DOMAIN__ é substituído pelo domínio informado na instalação:
#   sed -i "s/__DOMAIN__/$DOMAIN/g" deploy/nginx.conf   (o install-vps.sh faz isso)
server {
  listen 80;
  server_name __DOMAIN__;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  server_name __DOMAIN__;
  ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
`;
  const envExample = `# Copie para .env na VPS — NUNCA commite o .env real
# O install-vps.sh pergunta o domínio e já preenche estas três linhas por você.
# Deixe em branco e preencha com o SEU domínio (o que você apontou no DNS):
DOMAIN=
PUBLIC_URL=
RMM_SERVER_URL=
# Porta interna do app (atrás do proxy)
PORT=3000
# Gere com: openssl rand -hex 32
SESSION_SECRET=
${domain ? `# Domínio atualmente salvo no painel (só como referência): ${domain} / ${actionsUrl}` : "# Nenhum domínio salvo no painel ainda — o instalador vai perguntar."}
`;
  const installScript = `#!/usr/bin/env bash
# ============================================================
#  RMM Console — Instalação em VPS Linux (Ubuntu 22.04/24.04 ou Debian 12)
#  O domínio NÃO é fixo: ele é PERGUNTADO aqui (ou vem de $1 / $DOMAIN / .env).
#  Uso interativo:  sudo bash deploy/install-vps.sh
#  Uso direto:      sudo DOMAIN=meu.dominio.com bash deploy/install-vps.sh
#                   sudo bash deploy/install-vps.sh meu.dominio.com
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
# 1) Descobre o domínio: argumento > variável DOMAIN > .env existente > PROMPT
DOMAIN="\${1:-\${DOMAIN:-}}"
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN=$(grep -E '^DOMAIN=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)
fi
if [ -z "$DOMAIN" ]; then
  echo "Qual domínio vai apontar para esta VPS?"
  echo "Ex.: o subdomínio que você criou no DNS (registro A -> IP desta VPS)."
  read -rp "Domínio do sistema (sem https://, sem barra no final): " DOMAIN
fi
DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##' | tr -d ' ')
if [ -z "$DOMAIN" ] || ! echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'; then
  echo "ERRO: domínio inválido: '$DOMAIN'. Informe só o host, ex.: painel.minhaempresa.com" >&2; exit 1
fi
PUBLIC_URL="https://$DOMAIN"
RMM_SERVER_URL="$PUBLIC_URL/actions"
echo "[rmm] Domínio informado: $DOMAIN"
echo "[rmm] Instalando dependências..."
apt-get update
apt-get install -y curl git ufw fail2ban unattended-upgrades
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban || true
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
dpkg-reconfigure -f noninteractive unattended-upgrades || true
# 2) Grava o domínio no .env (é dele que docker-compose e o Caddy leem)
if [ ! -f .env ]; then cp deploy/.env.example .env; fi
sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" .env
sed -i "s|^RMM_SERVER_URL=.*|RMM_SERVER_URL=$RMM_SERVER_URL|" .env
if grep -q '^SESSION_SECRET=$' .env || grep -q '^SESSION_SECRET=troque' .env; then
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
fi
chmod 600 .env
echo "[rmm] .env atualizado com DOMAIN=$DOMAIN"
echo "[rmm] Base pronta. Próximos passos:"
echo " 1) Confirme o DNS: registro A de $DOMAIN -> IP público desta VPS"
echo " 2) Suba o proxy (HTTPS automático): docker compose up -d"
echo " 3) No painel, em Agentes > Domínio, confira/salve $PUBLIC_URL"
echo " 4) Teste de fora: curl -I $PUBLIC_URL"
`;
  const backupScript = `#!/usr/bin/env bash
# Backup diário do banco do RMM — agende no cron: 0 3 * * * /opt/rmm/backup.sh
set -euo pipefail
SRC="\${RMM_DB:-/opt/rmm/app.db}"
DEST_DIR="\${RMM_BACKUP_DIR:-/opt/rmm/backups}"
mkdir -p "$DEST_DIR"
STAMP=$(date +%F-%H%M)
cp "$SRC" "$DEST_DIR/app-$STAMP.db"
find "$DEST_DIR" -name 'app-*.db' -mtime +14 -delete
echo "Backup: $DEST_DIR/app-$STAMP.db"
`;
  const systemdService = `[Unit]
Description=RMM Agent (Linux)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# A URL vem do arquivo de ambiente gravado na instalação da máquina —
# nenhum domínio fixo aqui. Crie /opt/rmm-agent/agent.env com:
#   RMM_SERVER_URL=https://<seu-dominio>/actions
EnvironmentFile=/opt/rmm-agent/agent.env
ExecStart=/usr/bin/env bash /opt/rmm-agent/rmm-agent-linux.sh
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
${actionsUrl ? `\n# Domínio atualmente salvo no painel (referência): ${actionsUrl}` : "# Nenhum domínio salvo no painel ainda — o agente pergunta na instalação."}
`;
  const innoSetup = `; Inno Setup — gera o instalador RmmAgent-Setup.exe (Windows)
; Compile com Inno Setup 6: iscc agent\\windows\\RmmAgent.iss
; Antes: gere o exe com PyInstaller (ver agent/windows/build-exe.ps1)
; IMPORTANTE: nenhum domínio vai embutido. O instalador PERGUNTA o
; domínio/servidor na tela "Servidor RMM" e grava a resposta em
; {commonappdata}\\RmmAgent\\config.json — é de lá que o agente lê.
#define MyAppName "RMM Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "RMM Console"
[Setup]
AppId={{8F3A2B10-1C4D-4E5F-9A6B-RMMAGENT01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\\RmmAgent
DefaultGroupName={#MyAppName}
OutputBaseFilename=RmmAgent-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
[Files]
Source: "dist\\RmmAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
[Run]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando serviço do agente..."
Filename: "{app}\\RmmAgent.exe"; Parameters: "--start-service"; Flags: runhidden waituntilterminated
[UninstallRun]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
[Code]
var ServerPage: TInputQueryWizardPage;
procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectDir,
    'Servidor RMM', 'Para qual servidor este agente vai enviar os dados?',
    'Informe o domínio do seu painel RMM (o mesmo configurado na VPS). ' +
    'Nada fica fixo no instalador: cada instalação pode apontar para um servidor diferente.');
  ServerPage.Add('Domínio / URL do servidor:', False);
  { Pré-preenche só se quem gerou o instalador passou /SERVER=... na linha de comando }
  ServerPage.Values[0] := ExpandConstant('{param:SERVER|}');
end;
function NextButtonClick(CurPageID: Integer): Boolean;
var V: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then begin
    V := Trim(ServerPage.Values[0]);
    if V = '' then begin
      MsgBox('Informe o domínio do servidor RMM para continuar.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Url: String;
begin
  if CurStep = ssPostInstall then begin
    Url := Trim(ServerPage.Values[0]);
    if (Pos('http://', Url) <> 1) and (Pos('https://', Url) <> 1) then Url := 'https://' + Url;
    StringChangeEx(Url, ' ', '', True);
    if Copy(Url, Length(Url), 1) = '/' then Delete(Url, Length(Url), 1);
    if Pos('/actions', Url) = 0 then Url := Url + '/actions';
    ForceDirectories(ExpandConstant('{commonappdata}\\RmmAgent'));
    SaveStringToFile(ExpandConstant('{commonappdata}\\RmmAgent\\config.json'),
      '{' + #13#10 + '  "serverUrl": "' + Url + '",' + #13#10 + '  "intervalSeconds": 60' + #13#10 + '}', False);
  end;
end;
`;
  const buildExePs1 = `# Gera RmmAgent.exe a partir do agente Python (open source, sem custo)
# Requisitos na máquina de build (Windows): Python 3.11+ e pip
# Uso: powershell -ExecutionPolicy Bypass -File build-exe.ps1
# NENHUM domínio é embutido no .exe: quem instala informa o servidor
# na tela do instalador (Inno Setup), que grava config.json em
# %ProgramData%\\RmmAgent — o agente lê o servidor desse arquivo.
$ErrorActionPreference = "Stop"
pip install --upgrade pyinstaller psutil
# O agente fonte é o rmm-agent.py baixado na aba Agentes do painel
pyinstaller --onefile --noconsole --name RmmAgent rmm-agent.py
Write-Host "Pronto: dist\\RmmAgent.exe — assine com signtool se tiver certificado de código."
Write-Host "Sem certificado, o Windows SmartScreen pode avisar na primeira instalação."
Write-Host "Compile depois o instalador: iscc RmmAgent.iss  (ele pergunta o domínio na instalação)"
`;
  const agentConfigJson = JSON.stringify({ serverUrl: actionsUrl, _instrucao: "Modelo apenas. No instalador .exe este arquivo é GERADO na hora, com o domínio que a pessoa digitar na tela do instalador — não distribua com domínio fixo.", intervalSeconds: 60 }, null, 2);
  return { dockerCompose, caddyfile, nginxConf, envExample, installScript, backupScript, systemdService, innoSetup, buildExePs1, agentConfigJson, domain, actionsUrl };
}


type DeviceRow = typeof schema.devices.$inferSelect;

function deriveStatus(d: DeviceRow, now: number): "online" | "unstable" | "offline" | "critical" {
  const ageSec = (now - d.lastSeenAt.getTime()) / 1000;
  if (ageSec > 300) return "offline";
  if (d.lastCpuPercent >= 95 || d.lastDiskPercent >= 95 || d.lastRamPercent >= 95) return "critical";
  if (ageSec > 120) return "unstable";
  return "online";
}

function deviceOut(d: DeviceRow, now: number) {
  return {
    id: d.id,
    hostname: d.hostname,
    os: d.os as "windows" | "linux" | "darwin" | "unknown",
    osVersion: d.osVersion,
    arch: d.arch,
    ipAddress: d.ipAddress,
    macAddress: d.macAddress ?? "",
    agentVersion: d.agentVersion,
    cpuModel: d.cpuModel,
    cpuCores: d.cpuCores,
    totalRamMb: d.totalRamMb,
    totalDiskGb: d.totalDiskGb,
    groupName: d.groupName,
    notes: d.notes,
    status: deriveStatus(d, now),
    lastSeenAt: d.lastSeenAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    cpuPercent: Math.round(d.lastCpuPercent * 10) / 10,
    ramPercent: Math.round(d.lastRamPercent * 10) / 10,
    ramUsedMb: d.lastRamUsedMb,
    diskPercent: Math.round(d.lastDiskPercent * 10) / 10,
    diskUsedGb: Math.round(d.lastDiskUsedGb * 10) / 10,
    uptimeSeconds: d.lastUptimeSeconds,
  };
}

const deviceSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  os: z.enum(["windows", "linux", "darwin", "unknown"]),
  osVersion: z.string(),
  arch: z.string(),
  ipAddress: z.string(),
  macAddress: z.string(),
  agentVersion: z.string(),
  cpuModel: z.string(),
  cpuCores: z.number(),
  totalRamMb: z.number(),
  totalDiskGb: z.number(),
  groupName: z.string(),
  notes: z.string(),
  status: z.enum(["online", "unstable", "offline", "critical"]),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  cpuPercent: z.number(),
  ramPercent: z.number(),
  ramUsedMb: z.number(),
  diskPercent: z.number(),
  diskUsedGb: z.number(),
  uptimeSeconds: z.number(),
});

function buildScripts(enrollmentToken: string, publicUrl = "") {
  const resolvedActionsUrl = actionsUrlFromPublic(publicUrl);
  const hasServer = !!resolvedActionsUrl;
  const linuxSh = `#!/usr/bin/env bash
# ============================================================
#  RMM Agent — Linux  (v1.0.0)
#  Monitora CPU, RAM, disco e uptime e envia ao painel web.
#  Instalação: sudo bash install-linux.sh
# ============================================================
set -euo pipefail

# >>> Servidor: NENHUM domínio fixo. Ordem: variável RMM_SERVER_URL >
# >>> config gravada na instalação > PROMPT perguntando o domínio.
# >>> Pré-configurado pelo painel (se o admin salvou um domínio): ${hasServer ? resolvedActionsUrl : "(nenhum — será perguntado)"}
SERVER_URL="\${RMM_SERVER_URL:-${resolvedActionsUrl}}"
if [ -z "$SERVER_URL" ] && [ -f "/opt/rmm-agent/agent.env" ]; then
  SERVER_URL=$(grep -E '^RMM_SERVER_URL=' /opt/rmm-agent/agent.env | cut -d= -f2- || true)
fi
if [ -z "$SERVER_URL" ]; then
  read -rp "Domínio/URL do servidor RMM (ex.: https://painel.minhaempresa.com): " _INFORMADO
  _INFORMADO=$(echo "$_INFORMADO" | tr -d ' ')
  case "$_INFORMADO" in http*) ;; *) _INFORMADO="https://$_INFORMADO";; esac
  _INFORMADO="\${_INFORMADO%/}"
  case "$_INFORMADO" in */actions) SERVER_URL="$_INFORMADO";; *) SERVER_URL="$_INFORMADO/actions";; esac
  mkdir -p /opt/rmm-agent
  echo "RMM_SERVER_URL=$SERVER_URL" > /opt/rmm-agent/agent.env
  echo "[rmm-agent] Servidor gravado em /opt/rmm-agent/agent.env: $SERVER_URL"
fi
ENROLLMENT_TOKEN="${enrollmentToken}"
INTERVAL=60
AGENT_DIR="/opt/rmm-agent"
DEVICE_FILE="$AGENT_DIR/device.json"
AGENT_VERSION="1.0.0"

mkdir -p "$AGENT_DIR"

post_action() {
  # $1 = action, $2 = json args
  curl -s -X POST "$SERVER_URL" -H "Content-Type: application/json" \\
    -d "{\\"action\\":\\"$1\\",\\"args\\":$2}"
}

json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null || echo "\\"$1\\""; }

collect_static() {
  HOSTNAME_V=$(hostname)
  OS_VERSION=$( (grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"') || uname -s )
  ARCH=$(uname -m)
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  MAC=$(cat /sys/class/net/$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')/address 2>/dev/null || echo "")
  CPU_MODEL=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "CPU")
  CPU_CORES=$(nproc 2>/dev/null || echo 1)
  TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  TOTAL_DISK_GB=$(df -B1 / | awk 'NR==2 {printf "%.1f", $2/1073741824}')
  echo "$HOSTNAME_V|$OS_VERSION|$ARCH|$IP|$MAC|$CPU_MODEL|$CPU_CORES|$TOTAL_RAM_MB|$TOTAL_DISK_GB"
}

register_device() {
  IFS='|' read -r H OV AR IP MAC CM CC TR TD <<< "$(collect_static)"
  ARGS=$(cat <<JSON
{"enrollmentToken":"$ENROLLMENT_TOKEN","hostname":"$H","os":"linux","osVersion":"$OV","arch":"$AR","ipAddress":"$IP","macAddress":"$MAC","agentVersion":"$AGENT_VERSION","cpuModel":"$CM","cpuCores":$CC,"totalRamMb":$TOTAL_RAM_MB,"totalDiskGb":$TOTAL_DISK_GB}
JSON
)
  # TOTAL_RAM_MB/TOTAL_DISK_GB already expanded above via vars; rebuild safely:
  ARGS="{\\"enrollmentToken\\":\\"$ENROLLMENT_TOKEN\\",\\"hostname\\":\\"$H\\",\\"os\\":\\"linux\\",\\"osVersion\\":\\"$OV\\",\\"arch\\":\\"$AR\\",\\"ipAddress\\":\\"$IP\\",\\"macAddress\\":\\"$MAC\\",\\"agentVersion\\":\\"$AGENT_VERSION\\",\\"cpuModel\\":\\"$CM\\",\\"cpuCores\\":$CC,\\"totalRamMb\\":$TR,\\"totalDiskGb\\":$TD}"
  RESP=$(post_action "registerDevice" "$ARGS")
  echo "$RESP" > "$DEVICE_FILE"
  echo "[rmm-agent] Registrado: $RESP"
}

cpu_percent() {
  read -r _ u1 n1 s1 i1 w1 x1 y1 z1 _ < /proc/stat; local t1=$((u1+n1+s1+i1+w1+x1+y1+z1)) idle1=$i1
  sleep 1
  read -r _ u2 n2 s2 i2 w2 x2 y2 z2 _ < /proc/stat; local t2=$((u2+n2+s2+i2+w2+x2+y2+z2)) idle2=$i2
  local dt=$((t2-t1)) di=$((idle2-idle1))
  if [ "$dt" -gt 0 ]; then awk -v dt="$dt" -v di="$di" 'BEGIN {printf "%.1f", (1 - di/dt)*100}'; else echo "0"; fi
}

report_metrics() {
  DEVICE_ID=$(python3 -c "import json;print(json.load(open('$DEVICE_FILE'))['deviceId'])" 2>/dev/null || grep -o '"deviceId":"[^"]*"' "$DEVICE_FILE" | cut -d'"' -f4)
  AGENT_TOKEN=$(python3 -c "import json;print(json.load(open('$DEVICE_FILE'))['agentToken'])" 2>/dev/null || grep -o '"agentToken":"[^"]*"' "$DEVICE_FILE" | cut -d'"' -f4)
  CPU=$(cpu_percent)
  read -r TOTAL USED <<< $(free -m | awk '/Mem:/ {print $2, $3}')
  RAM_PCT=$(awk -v u="$USED" -v t="$TOTAL" 'BEGIN {if(t>0) printf "%.1f", u/t*100; else print 0}')
  DISK_PCT=$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')
  DISK_USED=$(df -B1 / | awk 'NR==2 {printf "%.1f", $3/1073741824}')
  UPTIME=$(awk '{print int($1)}' /proc/uptime)
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  ARGS="{\\"deviceId\\":\\"$DEVICE_ID\\",\\"agentToken\\":\\"$AGENT_TOKEN\\",\\"cpuPercent\\":$CPU,\\"ramPercent\\":$RAM_PCT,\\"ramUsedMb\\":$USED,\\"diskPercent\\":$DISK_PCT,\\"diskUsedGb\\":$DISK_USED,\\"uptimeSeconds\\":$UPTIME,\\"ipAddress\\":\\"$IP\\"}"
  post_action "reportMetrics" "$ARGS" > /dev/null
  # Poll comandos remotos
  POLL="{\\"deviceId\\":\\"$DEVICE_ID\\",\\"agentToken\\":\\"$AGENT_TOKEN\\"}"
  post_action "pollCommands" "$POLL" > "$AGENT_DIR/commands.json" || true
  if command -v python3 >/dev/null && [ -s "$AGENT_DIR/commands.json" ]; then
    python3 - "$AGENT_DIR/commands.json" "$DEVICE_ID" "$AGENT_TOKEN" "$SERVER_URL" <<'PYEOF'
import json,sys,subprocess,urllib.request
try:
    data=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for cmd in data.get("commands",[]):
    result="ok"; status="executed"
    try:
        t=cmd.get("type"); p=cmd.get("payload","")
        if t=="reboot": subprocess.Popen(["shutdown","-r","now"])
        elif t=="shutdown": subprocess.Popen(["shutdown","-h","now"])
        elif t=="run_script" and p: result=subprocess.run(p,shell=True,capture_output=True,text=True,timeout=120).stdout[-2000:]
        elif t=="collect_info": result=subprocess.run("uname -a; uptime; df -h /",shell=True,capture_output=True,text=True).stdout[-2000:]
    except Exception as e:
        status="failed"; result=str(e)
    body=json.dumps({"action":"reportCommandResult","args":{"deviceId":sys.argv[2],"agentToken":sys.argv[3],"commandId":cmd["id"],"status":status,"result":result}}).encode()
    urllib.request.urlopen(urllib.request.Request(sys.argv[4],data=body,headers={"Content-Type":"application/json"}),timeout=15)
PYEOF
  fi
}

if [ ! -f "$DEVICE_FILE" ]; then register_device; fi
echo "[rmm-agent] Iniciado — enviando a cada \${INTERVAL}s para $SERVER_URL"
while true; do report_metrics || echo "[rmm-agent] falha no envio, tentando de novo"; sleep "$INTERVAL"; done
`;

  const windowsPs1 = `# ============================================================
#  RMM Agent — Windows  (v1.0.0)  PowerShell 5.1+
#  Monitora CPU, RAM, disco e uptime e envia ao painel web.
#  Instalação (Admin): powershell -ExecutionPolicy Bypass -File install-windows.ps1
# ============================================================
$ErrorActionPreference = "SilentlyContinue"

# >>> Servidor: NENHUM domínio fixo. Ordem: $env:RMM_SERVER_URL >
# >>> config.json (gravado pelo instalador .exe, que pergunta o domínio) > PROMPT.
# >>> Pré-configurado pelo painel (se o admin salvou um domínio): ${hasServer ? resolvedActionsUrl : "(nenhum — será perguntado)"}
$ServerUrl       = if ($env:RMM_SERVER_URL) { $env:RMM_SERVER_URL } else { "${resolvedActionsUrl}" }
if (-not $ServerUrl) {
  $cfgPath = "$env:ProgramData\\RmmAgent\\config.json"
  if (Test-Path $cfgPath) { try { $ServerUrl = (Get-Content $cfgPath | ConvertFrom-Json).serverUrl } catch {} }
}
if (-not $ServerUrl) {
  $typed = Read-Host "Informe o domínio/URL do servidor RMM (ex.: https://painel.minhaempresa.com)"
  $typed = $typed.Trim()
  if ($typed -notmatch '^https?://') { $typed = "https://$typed" }
  $typed = $typed.TrimEnd('/')
  if ($typed -notmatch '/actions$') { $typed = "$typed/actions" }
  $ServerUrl = $typed
  New-Item -ItemType Directory -Force -Path "$env:ProgramData\\RmmAgent" | Out-Null
  @{ serverUrl = $ServerUrl; intervalSeconds = 60 } | ConvertTo-Json | Set-Content "$env:ProgramData\\RmmAgent\\config.json"
  Write-Host "[rmm-agent] Servidor gravado em config.json: $ServerUrl"
}
$EnrollmentToken = "${enrollmentToken}"
$Interval        = 60
$AgentVersion    = "1.0.0"
$AgentDir        = "$env:ProgramData\\RmmAgent"
$DeviceFile      = Join-Path $AgentDir "device.json"
New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null

function Invoke-RmmAction($Action, $ArgsObj) {
  $body = @{ action = $Action; args = $ArgsObj } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Uri $ServerUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 20
}

function Get-StaticInfo {
  $os   = Get-CimInstance Win32_OperatingSystem
  $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
  $ip   = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
  $mac  = (Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1).MacAddress
  return @{
    hostname = $env:COMPUTERNAME
    osVersion = "$($os.Caption) Build $($os.BuildNumber)"
    arch = $env:PROCESSOR_ARCHITECTURE
    ipAddress = "$ip"; macAddress = "$mac"
    cpuModel = "$($cpu.Name)"; cpuCores = [int]$cpu.NumberOfLogicalProcessors
    totalRamMb = [int]($os.TotalVisibleMemorySize / 1024)
    totalDiskGb = [math]::Round($disk.Size / 1GB, 1)
  }
}

if (-not (Test-Path $DeviceFile)) {
  $s = Get-StaticInfo
  $resp = Invoke-RmmAction "registerDevice" @{
    enrollmentToken = $EnrollmentToken; hostname = $s.hostname; os = "windows"
    osVersion = $s.osVersion; arch = $s.arch; ipAddress = $s.ipAddress
    macAddress = $s.macAddress; agentVersion = $AgentVersion
    cpuModel = $s.cpuModel; cpuCores = $s.cpuCores
    totalRamMb = $s.totalRamMb; totalDiskGb = $s.totalDiskGb
  }
  $resp | ConvertTo-Json | Set-Content $DeviceFile
  Write-Host "[rmm-agent] Registrado: $($resp.deviceId)"
}

$device = Get-Content $DeviceFile | ConvertFrom-Json
Write-Host "[rmm-agent] Iniciado — enviando a cada ${"${Interval}"}s para $ServerUrl"

while ($true) {
  try {
    $osPerf = Get-CimInstance Win32_OperatingSystem
    $cpuPct = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    $totalMb = $osPerf.TotalVisibleMemorySize / 1024
    $freeMb  = $osPerf.FreePhysicalMemory / 1024
    $usedMb  = [int]($totalMb - $freeMb)
    $ramPct  = if ($totalMb -gt 0) { [math]::Round($usedMb / $totalMb * 100, 1) } else { 0 }
    $disk    = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $diskUsedGb = [math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 1)
    $diskPct = if ($disk.Size -gt 0) { [math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 1) } else { 0 }
    $uptime = [int]((Get-Date) - $osPerf.LastBootUpTime).TotalSeconds
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress

    Invoke-RmmAction "reportMetrics" @{
      deviceId = $device.deviceId; agentToken = $device.agentToken
      cpuPercent = [double]$cpuPct; ramPercent = [double]$ramPct; ramUsedMb = $usedMb
      diskPercent = [double]$diskPct; diskUsedGb = [double]$diskUsedGb
      uptimeSeconds = $uptime; ipAddress = "$ip"
    } | Out-Null

    $poll = Invoke-RmmAction "pollCommands" @{ deviceId = $device.deviceId; agentToken = $device.agentToken }
    foreach ($cmd in $poll.commands) {
      $status = "executed"; $result = "ok"
      try {
        switch ($cmd.type) {
          "reboot"       { shutdown /r /t 5; $result = "reboot agendado" }
          "shutdown"     { shutdown /s /t 5; $result = "shutdown agendado" }
          "run_script"   { if ($cmd.payload) { $result = (Invoke-Expression $cmd.payload | Out-String) } }
          "collect_info" { $result = (systeminfo | Out-String).Substring(0, [math]::Min(2000, (systeminfo | Out-String).Length)) }
        }
      } catch { $status = "failed"; $result = "$_" }
      Invoke-RmmAction "reportCommandResult" @{
        deviceId = $device.deviceId; agentToken = $device.agentToken
        commandId = $cmd.id; status = $status; result = $result
      } | Out-Null
    }
  } catch { Write-Host "[rmm-agent] falha no envio: $_" }
  Start-Sleep -Seconds $Interval
}
`;

  const pythonPy = `#!/usr/bin/env python3
"""
RMM Agent — Universal (Windows / Linux / macOS)  v1.0.0
Sem dependências obrigatórias (usa psutil se estiver instalado).
Uso:  RMM_SERVER_URL=https://<seu-dominio>/actions python3 agent.py
Sem RMM_SERVER_URL nem config.json, o agente PERGUNTA o servidor na 1a execução.
"""
import json, os, platform, socket, subprocess, sys, time, urllib.request

SERVER_URL = os.environ.get("RMM_SERVER_URL", "${resolvedActionsUrl}")
# Servidor: NENHUM domínio fixo no código. Ordem de resolução:
# 1) variável RMM_SERVER_URL  2) config.json gravado PELO INSTALADOR .exe,
#    que pergunta o domínio na hora da instalação (%ProgramData%/RmmAgent
#    ou ao lado do executável)  3) prompt interativo na primeira execução.
def _resolve_server_url():
    global SERVER_URL
    if SERVER_URL:
        return SERVER_URL
    import pathlib as _p
    candidates = []
    _pd = os.environ.get("ProgramData")
    if _pd: candidates.append(_p.Path(_pd) / "RmmAgent" / "config.json")
    candidates.append(_p.Path(__file__).with_name("config.json"))
    try: candidates.append(_p.Path(sys.executable).with_name("config.json"))
    except Exception: pass
    for _cfg in candidates:
        try:
            if _cfg.exists():
                _j = json.loads(_cfg.read_text())
                if _j.get("serverUrl"):
                    SERVER_URL = str(_j["serverUrl"]).rstrip("/")
                    if not SERVER_URL.endswith("/actions"): SERVER_URL += "/actions"
                    return SERVER_URL
        except Exception:
            continue
    try:
        _typed = input("Informe o domínio/URL do servidor RMM (ex.: https://painel.minhaempresa.com): ").strip()
    except EOFError:
        _typed = ""
    if not _typed:
        raise SystemExit("[rmm-agent] Servidor não configurado. O instalador pergunta o domínio na instalação; ou defina RMM_SERVER_URL / config.json com serverUrl.")
    if not _typed.startswith(("http://", "https://")): _typed = "https://" + _typed
    _typed = _typed.rstrip("/")
    if not _typed.endswith("/actions"): _typed += "/actions"
    SERVER_URL = _typed
    try:
        _dest = candidates[0]
        _dest.parent.mkdir(parents=True, exist_ok=True)
        _dest.write_text(json.dumps({"serverUrl": SERVER_URL, "intervalSeconds": 60}, indent=2))
        print(f"[rmm-agent] Servidor gravado em {_dest}: {SERVER_URL}")
    except Exception:
        pass
    return SERVER_URL
_resolve_server_url()
ENROLLMENT_TOKEN = "${enrollmentToken}"
INTERVAL = 60
AGENT_VERSION = "1.0.0"
STATE = os.path.join(os.path.expanduser("~"), ".rmm-agent.json")

try:
    import psutil  # type: ignore
except ImportError:
    psutil = None

def post(action, args):
    body = json.dumps({"action": action, "args": args}).encode()
    req = urllib.request.Request(SERVER_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "{}")

def ip_addr():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        return ""

def static_info():
    total_ram = 0; total_disk = 0.0
    if psutil:
        total_ram = int(psutil.virtual_memory().total / 1048576)
        total_disk = round(psutil.disk_usage("/").total / 1073741824, 1)
    os_name = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}.get(platform.system(), "unknown")
    return {
        "enrollmentToken": ENROLLMENT_TOKEN, "hostname": socket.gethostname(),
        "os": os_name, "osVersion": f"{platform.system()} {platform.release()} {platform.version()}"[:120],
        "arch": platform.machine(), "ipAddress": ip_addr(), "macAddress": "",
        "agentVersion": AGENT_VERSION, "cpuModel": platform.processor() or platform.machine(),
        "cpuCores": os.cpu_count() or 1, "totalRamMb": total_ram, "totalDiskGb": total_disk,
    }

def metrics():
    if psutil:
        vm = psutil.virtual_memory(); du = psutil.disk_usage("/")
        return {"cpuPercent": psutil.cpu_percent(interval=1), "ramPercent": vm.percent,
                "ramUsedMb": int(vm.used / 1048576), "diskPercent": du.percent,
                "diskUsedGb": round(du.used / 1073741824, 1),
                "uptimeSeconds": int(time.time() - psutil.boot_time())}
    # Fallback Linux sem psutil
    uptime = int(float(open("/proc/uptime").read().split()[0])) if os.path.exists("/proc/uptime") else 0
    load = os.getloadavg()[0] / (os.cpu_count() or 1) * 100 if hasattr(os, "getloadavg") else 0
    return {"cpuPercent": round(load, 1), "ramPercent": 0, "ramUsedMb": 0,
            "diskPercent": 0, "diskUsedGb": 0, "uptimeSeconds": uptime}

def main():
    if os.path.exists(STATE):
        device = json.load(open(STATE))
    else:
        device = post("registerDevice", static_info())
        json.dump(device, open(STATE, "w"))
        print(f"[rmm-agent] Registrado: {device.get('deviceId')}")
    print(f"[rmm-agent] Enviando a cada {INTERVAL}s para {SERVER_URL}")
    while True:
        try:
            m = metrics(); m.update({"deviceId": device["deviceId"], "agentToken": device["agentToken"], "ipAddress": ip_addr()})
            post("reportMetrics", m)
            poll = post("pollCommands", {"deviceId": device["deviceId"], "agentToken": device["agentToken"]})
            for cmd in poll.get("commands", []):
                status, result = "executed", "ok"
                try:
                    if cmd["type"] == "run_script" and cmd.get("payload"):
                        result = subprocess.run(cmd["payload"], shell=True, capture_output=True, text=True, timeout=120).stdout[-2000:]
                    elif cmd["type"] == "collect_info":
                        result = subprocess.run("uname -a" if os.name != "nt" else "systeminfo", shell=True, capture_output=True, text=True).stdout[-2000:]
                    elif cmd["type"] == "reboot":
                        subprocess.Popen(["shutdown", "/r", "/t", "5"] if os.name == "nt" else ["shutdown", "-r", "now"])
                    elif cmd["type"] == "shutdown":
                        subprocess.Popen(["shutdown", "/s", "/t", "5"] if os.name == "nt" else ["shutdown", "-h", "now"])
                except Exception as e:
                    status, result = "failed", str(e)
                post("reportCommandResult", {"deviceId": device["deviceId"], "agentToken": device["agentToken"],
                                             "commandId": cmd["id"], "status": status, "result": result})
        except Exception as e:
            print(f"[rmm-agent] falha: {e}")
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
`;

  return { linuxSh, windowsPs1, pythonPy };
}

export const Actions = {
  getDashboard: defineAction({
    description: "Retorna estatísticas da frota e a lista de dispositivos com status e métricas atuais. Requer sessão de usuário.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      stats: z.object({
        total: z.number(), online: z.number(), unstable: z.number(), offline: z.number(), critical: z.number(),
        activeAlerts: z.number(), avgCpu: z.number(), avgRam: z.number(), avgDisk: z.number(),
        windowsCount: z.number(), linuxCount: z.number(),
      }),
      devices: z.array(deviceSchema),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      const rows = await db.select().from(schema.devices);
      const devices = rows.map((r) => deviceOut(r, now));
      const alertRows = await db.select().from(schema.alerts).where(eq(schema.alerts.isResolved, 0));
      const onlineDevs = devices.filter((d) => d.status === "online" || d.status === "critical");
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
      // Sort: critical, offline, unstable, online, then hostname
      const rank: Record<string, number> = { critical: 0, offline: 1, unstable: 2, online: 3 };
      devices.sort((a, b) => ((rank[a.status] ?? 3) - (rank[b.status] ?? 3)) || a.hostname.localeCompare(b.hostname));
      return {
        stats: {
          total: devices.length,
          online: devices.filter((d) => d.status === "online").length,
          unstable: devices.filter((d) => d.status === "unstable").length,
          offline: devices.filter((d) => d.status === "offline").length,
          critical: devices.filter((d) => d.status === "critical").length,
          activeAlerts: alertRows.length,
          avgCpu: avg(onlineDevs.map((d) => d.cpuPercent)),
          avgRam: avg(onlineDevs.map((d) => d.ramPercent)),
          avgDisk: avg(devices.map((d) => d.diskPercent)),
          windowsCount: devices.filter((d) => d.os === "windows").length,
          linuxCount: devices.filter((d) => d.os === "linux").length,
        },
        devices,
      };
    },
  }),

  getDeviceDetail: defineAction({
    description: "Retorna detalhe de um dispositivo: métricas recentes, alertas e comandos.",
    request: z.object({ deviceId: z.string().min(1), sessionToken: z.string().default("") }),
    response: z.object({
      device: deviceSchema,
      metrics: z.array(z.object({
        id: z.number(), cpuPercent: z.number(), ramPercent: z.number(), diskPercent: z.number(),
        ramUsedMb: z.number(), diskUsedGb: z.number(), uptimeSeconds: z.number(), recordedAt: z.string(),
      })),
      deviceAlerts: z.array(z.object({
        id: z.number(), type: z.string(), severity: z.enum(["info", "warning", "critical"]),
        message: z.string(), isResolved: z.boolean(), createdAt: z.string(),
      })),
      deviceCommands: z.array(z.object({
        id: z.number(), type: z.string(), payload: z.string(),
        status: z.enum(["pending", "sent", "executed", "failed"]),
        result: z.string(), createdAt: z.string(), executedAt: z.string(),
      })),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.devices).where(eq(schema.devices.id, args.deviceId)).limit(1);
      const dev = rows[0];
      if (!dev) throw new Error("Dispositivo não encontrado.");
      const mRows = await db.select().from(schema.metrics)
        .where(eq(schema.metrics.deviceId, args.deviceId))
        .orderBy(desc(schema.metrics.id)).limit(60);
      const aRows = await db.select().from(schema.alerts)
        .where(eq(schema.alerts.deviceId, args.deviceId))
        .orderBy(desc(schema.alerts.id)).limit(30);
      const cRows = await db.select().from(schema.commands)
        .where(eq(schema.commands.deviceId, args.deviceId))
        .orderBy(desc(schema.commands.id)).limit(30);
      return {
        device: deviceOut(dev, Date.now()),
        metrics: mRows.reverse().map((m) => ({
          id: m.id, cpuPercent: m.cpuPercent, ramPercent: m.ramPercent, diskPercent: m.diskPercent,
          ramUsedMb: m.ramUsedMb, diskUsedGb: m.diskUsedGb, uptimeSeconds: m.uptimeSeconds,
          recordedAt: m.recordedAt.toISOString(),
        })),
        deviceAlerts: aRows.map((a) => ({
          id: a.id, type: a.type, severity: a.severity, message: a.message,
          isResolved: a.isResolved === 1, createdAt: a.createdAt.toISOString(),
        })),
        deviceCommands: cRows.map((c) => ({
          id: c.id, type: c.type, payload: c.payload, status: c.status,
          result: c.result ?? "", createdAt: c.createdAt.toISOString(),
          executedAt: c.executedAt ? c.executedAt.toISOString() : "",
        })),
      };
    },
  }),

  listAlerts: defineAction({
    description: "Lista alertas, não resolvidos primeiro.",
    request: z.object({ onlyActive: z.boolean().default(false), sessionToken: z.string().default("") }),
    response: z.object({
      alerts: z.array(z.object({
        id: z.number(), deviceId: z.string(), deviceHostname: z.string(), type: z.string(),
        severity: z.enum(["info", "warning", "critical"]), message: z.string(),
        isResolved: z.boolean(), createdAt: z.string(),
      })),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.alerts).orderBy(desc(schema.alerts.id)).limit(100);
      const filtered = args.onlyActive ? rows.filter((r) => r.isResolved === 0) : rows;
      const sorted = [...filtered].sort((a, b) => (a.isResolved - b.isResolved) || (b.id - a.id));
      return {
        alerts: sorted.map((a) => ({
          id: a.id, deviceId: a.deviceId, deviceHostname: a.deviceHostname, type: a.type,
          severity: a.severity, message: a.message, isResolved: a.isResolved === 1,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  }),

  resolveAlert: defineAction({
    description: "Marca um alerta como resolvido.",
    request: z.object({ alertId: z.number().int(), sessionToken: z.string().default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      await db.update(schema.alerts)
        .set({ isResolved: 1, resolvedAt: new Date() })
        .where(eq(schema.alerts.id, args.alertId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  createCommand: defineAction({
    description: "Enfileira um comando remoto para um dispositivo executar no próximo polling do agente.",
    request: z.object({
      deviceId: z.string().min(1),
      sessionToken: z.string().default(""),
      type: z.enum(["reboot", "shutdown", "run_script", "collect_info", "update_agent"]),
      payload: z.string().max(4000).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      if (args.type === "run_script" && !args.payload.trim()) {
        throw new Error("Informe o script/comando a executar.");
      }
      const res = await db.insert(schema.commands)
        .values({ deviceId: args.deviceId, type: args.type, payload: args.payload, status: "pending" })
        .returning({ id: schema.commands.id });
      const row = res[0];
      if (!row) throw new Error("Falha ao criar comando.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  updateDevice: defineAction({
    description: "Atualiza grupo e observações de um dispositivo.",
    request: z.object({
      deviceId: z.string().min(1),
      sessionToken: z.string().default(""),
      groupName: z.string().max(60).default("Geral"),
      notes: z.string().max(500).default(""),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      await db.update(schema.devices)
        .set({ groupName: args.groupName.trim() || "Geral", notes: args.notes })
        .where(eq(schema.devices.id, args.deviceId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteDevice: defineAction({
    description: "Remove um dispositivo e seu histórico de métricas e comandos.",
    request: z.object({ deviceId: z.string().min(1), sessionToken: z.string().default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.devices).where(eq(schema.devices.id, args.deviceId));
      await db.delete(schema.metrics).where(eq(schema.metrics.deviceId, args.deviceId));
      await db.delete(schema.commands).where(eq(schema.commands.deviceId, args.deviceId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getEnrollment: defineAction({
    description: "Retorna o token de matrícula e os scripts reais dos agentes Windows, Linux e Python, já apontando para o domínio público configurado. Requer sessão.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      enrollmentToken: z.string(),
      publicUrl: z.string(),
      actionsUrl: z.string(),
      linuxSh: z.string(),
      windowsPs1: z.string(),
      pythonPy: z.string(),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      let token = rows[0]?.value;
      if (!token) {
        token = `rmm_${randHex(16)}`;
        await db.insert(schema.settings).values({ key: "enrollment_token", value: token });
      }
      const pubRows = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const publicUrl = pubRows[0]?.value ?? "";
      const scripts = buildScripts(token, publicUrl);
      return { enrollmentToken: token, publicUrl, actionsUrl: actionsUrlFromPublic(publicUrl), ...scripts };
    },
  }),

  getSystemConfig: defineAction({
    description: "Retorna a configuração do servidor: domínio/URL pública usada pelos agentes e status de segurança básico.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ publicUrl: z.string(), actionsUrl: z.string(), usesHttps: z.boolean(), hasEnrollmentToken: z.boolean() }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const pub = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const enr = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      const publicUrl = pub[0]?.value ?? "";
      return { publicUrl, actionsUrl: actionsUrlFromPublic(publicUrl), usesHttps: publicUrl.startsWith("https://"), hasEnrollmentToken: !!enr[0]?.value };
    },
  }),

  updateSystemConfig: defineAction({
    description: "Salva o domínio/URL pública do painel informado pelo administrador (nenhum domínio é fixo no código). Apenas administradores. Serve de pré-preenchimento; o instalador do agente também pergunta o servidor na instalação.",
    request: z.object({ sessionToken: z.string().default(""), publicUrl: z.string().trim().max(300).default("") }),
    response: z.object({ ok: z.literal(true), publicUrl: z.string(), actionsUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; publicUrl: string; actionsUrl: string }> {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores podem alterar o domínio do servidor.");
      const cleaned = normalizePublicUrl(args.publicUrl);
      if (cleaned && !/^https?:\/\//i.test(cleaned)) throw new Error("Informe a URL completa, começando com https:// (recomendado) ou http:// para testes locais.");
      if (cleaned && cleaned.includes(" ")) throw new Error("URL inválida: não pode conter espaços.");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      if (rows[0]) await db.update(schema.settings).set({ value: cleaned }).where(eq(schema.settings.key, "public_url"));
      else await db.insert(schema.settings).values({ key: "public_url", value: cleaned });
      ctx.invalidateQueries();
      return { ok: true, publicUrl: cleaned, actionsUrl: actionsUrlFromPublic(cleaned) };
    },
  }),

  getDeploymentGuide: defineAction({
    description: "Retorna todos os arquivos de implantação em VPS Linux (docker-compose, Caddy, Nginx, install, backup, systemd, .env) e o pacote para gerar o agente .exe do Windows (PyInstaller + Inno Setup). Requer sessão.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      publicUrl: z.string(), actionsUrl: z.string(), domain: z.string(),
      dockerCompose: z.string(), caddyfile: z.string(), nginxConf: z.string(), envExample: z.string(),
      installScript: z.string(), backupScript: z.string(), systemdService: z.string(),
      innoSetup: z.string(), buildExePs1: z.string(), agentConfigJson: z.string(),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const pub = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const publicUrl = pub[0]?.value ?? "";
      const files = buildDeploymentFiles(publicUrl);
      return { publicUrl, ...files };
    },
  }),

  getSecurityOverview: defineAction({
    description: "Retorna um checklist de segurança para exposição pública na VPS, calculado a partir da configuração atual (domínio HTTPS, token, usuários).",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      publicUrl: z.string(), usesHttps: z.boolean(), hasDomain: z.boolean(), userCount: z.number(), deviceCount: z.number(),
      checks: z.array(z.object({ id: z.string(), ok: z.boolean(), title: z.string(), detail: z.string() })),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const pub = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const publicUrl = pub[0]?.value ?? "";
      const users = await db.select().from(schema.users);
      const devices = await db.select().from(schema.devices);
      const usesHttps = publicUrl.startsWith("https://");
      const hasDomain = !!publicUrl && !publicUrl.includes("localhost") && !publicUrl.includes("<");
      const checks = [
        { id: "https", ok: usesHttps, title: "Domínio público com HTTPS", detail: usesHttps ? `Agentes apontam para ${actionsUrlFromPublic(publicUrl)}` : "Configure o domínio em Agentes/VPS e sirva só via HTTPS (Caddy ou Nginx+Certbot). Sem HTTPS, tokens trafegam em texto puro." },
        { id: "admin", ok: users.length >= 1, title: "Administrador criado e senhas com hash", detail: "Senhas PBKDF2-SHA256 + salt; sessões de 7 dias. Troque senhas fracas e desative usuários que saírem da equipe." },
        { id: "enrollment", ok: true, title: "Matrícula protegida por token", detail: "Só máquinas com o enrollment token se cadastram; cada máquina recebe um agentToken próprio. Rotacione o token se ele vazar." },
        { id: "firewall", ok: false, title: "Firewall da VPS (manual)", detail: "Na VPS: UFW liberando só 22/80/443, SSH por chave, Fail2ban ativo — o script deploy/install-vps.sh já configura isso." },
        { id: "backup", ok: false, title: "Backup do banco (manual)", detail: "Agende deploy/backup.sh no cron (diário, retenção de 14 dias) e teste a restauração. O app.db concentra usuários e tokens." },
        { id: "proxy", ok: false, title: "Proxy reverso na frente (manual)", detail: "Nunca exponha a porta interna do app direto na internet: Caddy/Nginx na 443 com HSTS e headers de segurança (arquivos na aba VPS)." },
      ];
      return { publicUrl, usesHttps, hasDomain, userCount: users.length, deviceCount: devices.length, checks };
    },
  }),

  regenerateEnrollmentToken: defineAction({
    description: "Gera um novo token de matrícula, invalidando scripts antigos. Requer sessão de administrador.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ enrollmentToken: z.string() }),
    async handler(ctx, args) {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores podem gerar um novo token de matrícula.");
      const db = ctx.db<typeof schema>();
      const token = `rmm_${randHex(16)}`;
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      if (rows[0]) {
        await db.update(schema.settings).set({ value: token }).where(eq(schema.settings.key, "enrollment_token"));
      } else {
        await db.insert(schema.settings).values({ key: "enrollment_token", value: token });
      }
      ctx.invalidateQueries();
      return { enrollmentToken: token };
    },
  }),

  // ---------- Agent API (chamadas pelos agentes instalados) ----------

  registerDevice: defineAction({
    description: "API do agente: matricula um novo computador com o token de matrícula e retorna deviceId + agentToken.",
    request: z.object({
      enrollmentToken: z.string().min(1),
      hostname: z.string().min(1).max(120),
      os: z.enum(["windows", "linux", "darwin", "unknown"]).default("unknown"),
      osVersion: z.string().max(200).default(""),
      arch: z.string().max(40).default(""),
      ipAddress: z.string().max(60).default(""),
      macAddress: z.string().max(60).default(""),
      agentVersion: z.string().max(20).default("1.0.0"),
      cpuModel: z.string().max(200).default(""),
      cpuCores: z.number().int().min(0).max(512).default(0),
      totalRamMb: z.number().int().min(0).default(0),
      totalDiskGb: z.number().min(0).default(0),
    }),
    response: z.object({ deviceId: z.string(), agentToken: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      const expected = rows[0]?.value;
      if (!expected || args.enrollmentToken !== expected) {
        throw new Error("Token de matrícula inválido. Copie o token atual na aba Agentes do painel.");
      }
      // Re-registro da mesma máquina (mesmo hostname + MAC) reaproveita o cadastro
      if (args.macAddress) {
        const existing = await db.select().from(schema.devices)
          .where(and(eq(schema.devices.hostname, args.hostname), eq(schema.devices.macAddress, args.macAddress)))
          .limit(1);
        const ex = existing[0];
        if (ex) {
          await db.update(schema.devices).set({
            os: args.os, osVersion: args.osVersion, arch: args.arch, ipAddress: args.ipAddress,
            agentVersion: args.agentVersion, cpuModel: args.cpuModel, cpuCores: args.cpuCores,
            totalRamMb: args.totalRamMb, totalDiskGb: args.totalDiskGb, lastSeenAt: new Date(),
          }).where(eq(schema.devices.id, ex.id));
          ctx.invalidateQueries();
          return { deviceId: ex.id, agentToken: ex.agentToken };
        }
      }
      const id = newId();
      const agentToken = `agt_${randHex(20)}`;
      await db.insert(schema.devices).values({
        id, hostname: args.hostname, os: args.os, osVersion: args.osVersion, arch: args.arch,
        ipAddress: args.ipAddress, macAddress: args.macAddress || null, agentVersion: args.agentVersion,
        cpuModel: args.cpuModel, cpuCores: args.cpuCores, totalRamMb: args.totalRamMb,
        totalDiskGb: args.totalDiskGb, agentToken, lastSeenAt: new Date(),
      });
      ctx.invalidateQueries();
      return { deviceId: id, agentToken };
    },
  }),

  reportMetrics: defineAction({
    description: "API do agente: recebe heartbeat com CPU, RAM, disco e uptime; atualiza o dispositivo e gera alertas por limiar.",
    request: z.object({
      deviceId: z.string().min(1),
      agentToken: z.string().min(1),
      cpuPercent: z.number().min(0).max(100).default(0),
      ramPercent: z.number().min(0).max(100).default(0),
      ramUsedMb: z.number().int().min(0).default(0),
      diskPercent: z.number().min(0).max(100).default(0),
      diskUsedGb: z.number().min(0).default(0),
      uptimeSeconds: z.number().int().min(0).default(0),
      ipAddress: z.string().max(60).default(""),
    }),
    response: z.object({ ok: z.literal(true), pendingCommands: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; pendingCommands: number }> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.devices).where(eq(schema.devices.id, args.deviceId)).limit(1);
      const dev = rows[0];
      if (!dev || dev.agentToken !== args.agentToken) {
        throw new Error("Dispositivo ou agentToken inválido.");
      }
      const now = new Date();
      await db.update(schema.devices).set({
        lastSeenAt: now,
        lastCpuPercent: args.cpuPercent, lastRamPercent: args.ramPercent,
        lastRamUsedMb: args.ramUsedMb, lastDiskPercent: args.diskPercent,
        lastDiskUsedGb: args.diskUsedGb, lastUptimeSeconds: args.uptimeSeconds,
        ...(args.ipAddress ? { ipAddress: args.ipAddress } : {}),
      }).where(eq(schema.devices.id, args.deviceId));

      await db.insert(schema.metrics).values({
        deviceId: args.deviceId, cpuPercent: args.cpuPercent, ramPercent: args.ramPercent,
        ramUsedMb: args.ramUsedMb, diskPercent: args.diskPercent, diskUsedGb: args.diskUsedGb,
        uptimeSeconds: args.uptimeSeconds, recordedAt: now,
      });

      // Poda: métricas com mais de 7 dias deste dispositivo
      const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      await db.delete(schema.metrics).where(and(eq(schema.metrics.deviceId, args.deviceId), lt(schema.metrics.recordedAt, cutoff)));

      // Alertas por limiar (sem duplicar alerta ativo do mesmo tipo)
      const checks: Array<{ type: string; value: number; label: string }> = [
        { type: "cpu_high", value: args.cpuPercent, label: "CPU" },
        { type: "ram_high", value: args.ramPercent, label: "Memória RAM" },
        { type: "disk_high", value: args.diskPercent, label: "Disco" },
      ];
      for (const c of checks) {
        if (c.value >= 90) {
          const active = await db.select().from(schema.alerts)
            .where(and(eq(schema.alerts.deviceId, args.deviceId), eq(schema.alerts.type, c.type), eq(schema.alerts.isResolved, 0)))
            .limit(1);
          if (!active[0]) {
            await db.insert(schema.alerts).values({
              deviceId: args.deviceId, deviceHostname: dev.hostname, type: c.type,
              severity: c.value >= 95 ? "critical" : "warning",
              message: `${c.label} em ${Math.round(c.value)}% em ${dev.hostname}`,
            });
          }
        }
      }

      const pending = await db.select().from(schema.commands)
        .where(and(eq(schema.commands.deviceId, args.deviceId), eq(schema.commands.status, "pending")));
      ctx.invalidateQueries();
      return { ok: true, pendingCommands: pending.length };
    },
  }),

  pollCommands: defineAction({
    description: "API do agente: retorna comandos pendentes para o dispositivo e marca como enviados.",
    request: z.object({ deviceId: z.string().min(1), agentToken: z.string().min(1) }),
    response: z.object({
      commands: z.array(z.object({ id: z.number(), type: z.string(), payload: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.devices).where(eq(schema.devices.id, args.deviceId)).limit(1);
      const dev = rows[0];
      if (!dev || dev.agentToken !== args.agentToken) throw new Error("Dispositivo ou agentToken inválido.");
      const pending = await db.select().from(schema.commands)
        .where(and(eq(schema.commands.deviceId, args.deviceId), eq(schema.commands.status, "pending")))
        .orderBy(schema.commands.id);
      for (const c of pending) {
        await db.update(schema.commands).set({ status: "sent" }).where(eq(schema.commands.id, c.id));
      }
      if (pending.length) ctx.invalidateQueries();
      return { commands: pending.map((c) => ({ id: c.id, type: c.type, payload: c.payload })) };
    },
  }),

  reportCommandResult: defineAction({
    description: "API do agente: registra o resultado da execução de um comando remoto.",
    request: z.object({
      deviceId: z.string().min(1),
      agentToken: z.string().min(1),
      commandId: z.number().int(),
      status: z.enum(["executed", "failed"]),
      result: z.string().max(4000).default(""),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.devices).where(eq(schema.devices.id, args.deviceId)).limit(1);
      const dev = rows[0];
      if (!dev || dev.agentToken !== args.agentToken) throw new Error("Dispositivo ou agentToken inválido.");
      await db.update(schema.commands)
        .set({ status: args.status, result: args.result, executedAt: new Date() })
        .where(and(eq(schema.commands.id, args.commandId), eq(schema.commands.deviceId, args.deviceId)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  simulateHeartbeat: defineAction({
    description: "Envia um heartbeat de teste a partir do próprio painel para validar o fluxo sem instalar o agente (usa dados do navegador, marcados como teste).",
    request: z.object({
      hostname: z.string().min(1).max(120),
      sessionToken: z.string().default(""),
      os: z.enum(["windows", "linux", "darwin", "unknown"]).default("unknown"),
    }),
    response: z.object({ deviceId: z.string() }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      // Garante token de matrícula
      const tRows = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      let token = tRows[0]?.value;
      if (!token) {
        token = `rmm_${randHex(16)}`;
        await db.insert(schema.settings).values({ key: "enrollment_token", value: token });
      }
      // Reusa dispositivo de teste com mesmo hostname
      const existing = await db.select().from(schema.devices).where(eq(schema.devices.hostname, args.hostname)).limit(1);
      let deviceId: string;
      let agentToken: string;
      if (existing[0]) {
        deviceId = existing[0].id; agentToken = existing[0].agentToken;
      } else {
        deviceId = newId(); agentToken = `agt_${randHex(20)}`;
        await db.insert(schema.devices).values({
          id: deviceId, hostname: args.hostname, os: args.os,
          osVersion: "Teste via painel", arch: "", ipAddress: "127.0.0.1",
          agentVersion: "test-1.0.0", cpuModel: "Heartbeat de teste", cpuCores: 4,
          totalRamMb: 16384, totalDiskGb: 512, agentToken, groupName: "Testes",
          notes: "Criado pelo botão de teste do painel — exclua quando o agente real conectar.",
          lastSeenAt: new Date(),
        });
      }
      const cpu = Math.round((15 + Math.random() * 40) * 10) / 10;
      const ram = Math.round((30 + Math.random() * 35) * 10) / 10;
      const disk = Math.round((40 + Math.random() * 20) * 10) / 10;
      await db.update(schema.devices).set({
        lastSeenAt: new Date(), lastCpuPercent: cpu, lastRamPercent: ram,
        lastRamUsedMb: Math.round(16384 * ram / 100), lastDiskPercent: disk,
        lastDiskUsedGb: Math.round(512 * disk / 100 * 10) / 10, lastUptimeSeconds: 86400,
      }).where(eq(schema.devices.id, deviceId));
      await db.insert(schema.metrics).values({
        deviceId, cpuPercent: cpu, ramPercent: ram, ramUsedMb: Math.round(16384 * ram / 100),
        diskPercent: disk, diskUsedGb: Math.round(512 * disk / 100 * 10) / 10, uptimeSeconds: 86400,
      });
      void agentToken;
      ctx.invalidateQueries();
      return { deviceId };
    },
  }),

  getWidgetSummary: defineAction({
    description: "Resumo agregado e somente-leitura para o widget: contagens da frota e alertas, sem hostnames, IPs ou qualquer dado de dispositivo. Não exige sessão porque o widget da tela inicial não tem fluxo de login; expõe apenas números agregados.",
    request: z.object({}),
    response: z.object({
      total: z.number(), online: z.number(), unstable: z.number(), offline: z.number(), critical: z.number(),
      activeAlerts: z.number(), avgCpu: z.number(), avgRam: z.number(), hasUsers: z.boolean(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      const rows = await db.select().from(schema.devices);
      const devices = rows.map((r) => deviceOut(r, now));
      const alertRows = await db.select().from(schema.alerts).where(eq(schema.alerts.isResolved, 0));
      const userRows = await db.select().from(schema.users).limit(1);
      const onlineDevs = devices.filter((d) => d.status === "online" || d.status === "critical");
      const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
      return {
        total: devices.length,
        online: devices.filter((d) => d.status === "online").length,
        unstable: devices.filter((d) => d.status === "unstable").length,
        offline: devices.filter((d) => d.status === "offline").length,
        critical: devices.filter((d) => d.status === "critical").length,
        activeAlerts: alertRows.length,
        avgCpu: avg(onlineDevs.map((d) => d.cpuPercent)),
        avgRam: avg(onlineDevs.map((d) => d.ramPercent)),
        hasUsers: !!userRows[0],
      };
    },
  }),

  // ---------- Auth & Users ----------
  getAuthState: defineAction({
    description: "Retorna se já existe usuário cadastrado (setup concluído) para decidir entre tela de configuração inicial e login.",
    request: z.object({}),
    response: z.object({ hasUsers: z.boolean(), needsSetup: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.users).limit(1);
      return { hasUsers: !!rows[0], needsSetup: !rows[0] };
    },
  }),

  setupAdmin: defineAction({
    description: "Cria o primeiro usuário administrador quando ainda não há usuários. Só funciona uma vez.",
    request: z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().min(3).max(120), password: z.string().min(8).max(100) }),
    response: z.object({ token: z.string(), user: userSchema }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.users).limit(1);
      if (existing[0]) throw new Error("A configuração inicial já foi concluída. Faça login.");
      const email = args.email.toLowerCase();
      const salt = randHex(16);
      const hash = await hashPassword(args.password, salt);
      const id = newId();
      await db.insert(schema.users).values({ id, name: args.name.trim(), email, passwordHash: hash, passwordSalt: salt, role: "admin", isActive: 1, lastLoginAt: new Date() });
      const token = await createSession(ctx, id);
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      ctx.invalidateQueries();
      return { token, user: userOut(rows[0]!) };
    },
  }),

  login: defineAction({
    description: "Autentica um usuário por e-mail e senha e cria uma sessão de 7 dias.",
    request: z.object({ email: z.string().trim().min(3).max(120), password: z.string().min(1).max(100) }),
    response: z.object({ token: z.string(), user: userSchema }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.toLowerCase();
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      const u = rows[0];
      if (!u || u.isActive !== 1) throw new Error("E-mail ou senha inválidos.");
      const hash = await hashPassword(args.password, u.passwordSalt);
      if (hash !== u.passwordHash) throw new Error("E-mail ou senha inválidos.");
      await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
      const token = await createSession(ctx, u.id);
      ctx.invalidateQueries();
      return { token, user: userOut({ ...u, lastLoginAt: new Date() }) };
    },
  }),

  logout: defineAction({
    description: "Encerra a sessão atual do usuário.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      if (args.sessionToken) await db.delete(schema.sessions).where(eq(schema.sessions.token, args.sessionToken));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getCurrentUser: defineAction({
    description: "Retorna o usuário da sessão atual, ou hasUser=false se a sessão expirou.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ hasUser: z.boolean(), user: userSchema.nullable() }),
    async handler(ctx, args) {
      const u = await getSessionUser(ctx, args.sessionToken);
      return { hasUser: !!u, user: u ? userOut(u as UserRow) : null };
    },
  }),

  listUsers: defineAction({
    description: "Lista todos os usuários do painel. Apenas administradores.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ users: z.array(userSchema) }),
    async handler(ctx, args) {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores podem ver os usuários.");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.users).orderBy(schema.users.createdAt);
      return { users: rows.map(userOut) };
    },
  }),

  createUser: defineAction({
    description: "Cria um novo usuário do painel. Apenas administradores.",
    request: z.object({ sessionToken: z.string().default(""), name: z.string().trim().min(2).max(80), email: z.string().trim().min(3).max(120), password: z.string().min(8).max(100), role: z.enum(["admin", "operator", "viewer"]).default("operator") }),
    response: z.object({ user: userSchema }),
    async handler(ctx, args) {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores podem criar usuários.");
      const db = ctx.db<typeof schema>();
      const email = args.email.toLowerCase();
      const dup = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (dup[0]) throw new Error("Já existe um usuário com este e-mail.");
      const salt = randHex(16);
      const hash = await hashPassword(args.password, salt);
      const id = newId();
      await db.insert(schema.users).values({ id, name: args.name.trim(), email, passwordHash: hash, passwordSalt: salt, role: args.role, isActive: 1 });
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      ctx.invalidateQueries();
      return { user: userOut(rows[0]!) };
    },
  }),

  setUserActive: defineAction({
    description: "Ativa ou desativa um usuário. Apenas administradores; não desativa a si mesmo.",
    request: z.object({ sessionToken: z.string().default(""), userId: z.string().min(1), isActive: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores.");
      if (me.id === args.userId && !args.isActive) throw new Error("Você não pode desativar sua própria conta.");
      const db = ctx.db<typeof schema>();
      await db.update(schema.users).set({ isActive: args.isActive ? 1 : 0 }).where(eq(schema.users.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteUser: defineAction({
    description: "Exclui um usuário do painel. Apenas administradores; não exclui a si mesmo.",
    request: z.object({ sessionToken: z.string().default(""), userId: z.string().min(1) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores.");
      if (me.id === args.userId) throw new Error("Você não pode excluir sua própria conta.");
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, args.userId));
      await db.delete(schema.users).where(eq(schema.users.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  changePassword: defineAction({
    description: "Troca a senha do usuário logado, conferindo a senha atual.",
    request: z.object({ sessionToken: z.string().default(""), currentPassword: z.string().min(1).max(100), newPassword: z.string().min(8).max(100) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const me = await requireAuth(ctx, args.sessionToken);
      const current = await hashPassword(args.currentPassword, me.passwordSalt);
      if (current !== me.passwordHash) throw new Error("Senha atual incorreta.");
      const salt = randHex(16);
      const hash = await hashPassword(args.newPassword, salt);
      const db = ctx.db<typeof schema>();
      await db.update(schema.users).set({ passwordHash: hash, passwordSalt: salt }).where(eq(schema.users.id, me.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getGithubGuide: defineAction({
    description: "Retorna README.md, .gitignore e comandos git prontos para publicar este projeto no GitHub. Requer sessão.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ readme: z.string(), gitignore: z.string(), gitCommands: z.string(), ghCommands: z.string() }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const gitCommands = [
        "# 1) Na pasta do projeto (ts-spaces/rmm-monitor-de-computadores):",
        "git init",
        "git add .",
        'git commit -m "feat: RMM com login, VPS (Docker/Caddy), agente .exe e segurança reforçada"',
        "git branch -M main",
        "",
        "# 2) Repositório já criado: andybq123/rmm — ligue o remoto e envie:",
        "git remote add origin https://github.com/andybq123/rmm.git",
        "git push -u origin main",
        "",
        "# Se o remoto já existir, atualize normalmente:",
        "git add .",
        'git commit -m "descreva a mudança"',
        "git push",
        "",
        "# Na VPS, para atualizar a partir do GitHub:",
        "git pull --ff-only",
        "docker compose up -d --build",
      ].join("\n");
      const ghCommands = [
        "# Alternativa com GitHub CLI (gh) — o repo andybq123/rmm já existe:",
        "gh auth login",
        "git remote add origin https://github.com/andybq123/rmm.git",
        "git push -u origin main",
        "",
        "# Ver o repo no navegador:",
        "gh repo view andybq123/rmm --web",
      ].join("\n");
      return { readme: buildGithubReadme(), gitignore: buildGitignore(), gitCommands, ghCommands };
    },
  }),
} satisfies ActionsModule;
