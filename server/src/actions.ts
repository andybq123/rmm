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
    "Painel web corporativo para monitoramento remoto (RMM) de computadores Windows e Linux, com agentes reais, alertas automáticos e comandos remotos. Preparado para **VPS Linux com IP público e HTTPS**.",
    "",
    "Fluxo estilo Tactical RMM: você instala o painel na VPS, **cria o site no painel** (nome + domínio) e **gera o instalador .exe já pré-configurado** com esse site/domínio e o token — em cada máquina Windows é só executar o instalador, sem digitar servidor nenhum.",
    "",
    "## Funcionalidades",
    "- Tela de login com usuários, papéis (Administrador / Operador / Visualizador) e sessões de 7 dias",
    "- Dashboard da frota: online, instável, offline e crítico em tempo real (polling 15s)",
    "- Métricas por máquina: CPU, RAM, disco, uptime, IP, MAC, hardware e histórico em gráfico",
    "- Alertas automáticos quando CPU, RAM ou disco passam de 90%",
    "- Comandos remotos: reiniciar, desligar, coletar informações e executar script",
    "- **Site no painel + instalador .exe gerado pré-configurado** (domínio + token embutidos, como no Tactical RMM)",
    "- Agentes de script: Bash (Linux), PowerShell (Windows) e Python universal — envio a cada 60s, já apontando para o site",
    "- Token de matrícula para cadastro seguro de novos dispositivos",
    "",
    "## Estrutura do projeto",
    "```",
    "client/          React + Tailwind (interface)",
    "  src/App.tsx    Painel, login e todas as telas",
    "  src/Widget.tsx Widget resumido da frota",
    "server/          Backend (actions tipadas)",
    "  src/actions.ts Actions da API + scripts dos agentes + autenticação",
    "  src/schema.ts  Modelo de dados (Drizzle / SQLite)",
    "standalone/      Servidor do app na VPS (painel + actions, porta 3000)",
    "drizzle/         Migrations SQL",
    "deploy/          VPS: install-vps.sh, Caddyfile, nginx.conf, backup.sh, rmm-agent.service",
    "agent/           Build do .exe (PyInstaller) e instalador (Inno Setup)",
    "vendor/          SDK do painel vendorizado como código-fonte de texto (sem binários; build do Docker autossuficiente)",
    "space.json       Metadados do artefato",
    "Dockerfile       Imagem do serviço app do compose",
    "docker-compose.yml  App + proxy reverso com HTTPS automático (Caddy)",
    "```",
    "",
    "---",
    "",
    "## Instalação do sistema na VPS Linux — passo a passo completo",
    "",
    "### Pré-requisitos",
    "- VPS Linux **Ubuntu 22.04/24.04** ou **Debian 12** com **IP público** e acesso root (ou sudo)",
    "- Um **domínio ou subdomínio** seu (ex.: `painel.suaempresa.com.br`) — você informa o domínio no instalador da VPS; ele não fica fixo no código",
    "- Portas **22, 80 e 443** liberadas no painel da provedora da VPS (firewall da nuvem), se houver",
    "",
    "### Passo 1 — Aponte o DNS para a VPS",
    "No provedor do seu domínio (Registro.br, Cloudflare, etc.), crie um registro:",
    "```",
    "Tipo: A    Nome: painel (ou o subdomínio escolhido)    Valor: <IP público da VPS>    TTL: 300",
    "```",
    "Aguarde a propagação e confira de qualquer máquina:",
    "```bash",
    "ping painel.suaempresa.com.br   # deve responder com o IP da VPS",
    "```",
    "",
    "### Passo 2 — Acesse a VPS e baixe o projeto",
    "```bash",
    "ssh root@<IP-DA-VPS>",
    "apt-get update && apt-get install -y git",
    "git clone https://github.com/andybq123/rmm.git",
    "cd rmm",
    "```",
    "",
    "### Passo 3 — Rode o instalador da VPS (ele pergunta o domínio)",
    "```bash",
    "sudo bash deploy/install-vps.sh",
    "# → ele pergunta: \"Domínio do sistema (sem https://):\" — digite painel.suaempresa.com.br",
    "```",
    "Sem interação (automatizado), qualquer uma das formas funciona:",
    "```bash",
    "sudo bash deploy/install-vps.sh painel.suaempresa.com.br",
    "sudo DOMAIN=painel.suaempresa.com.br bash deploy/install-vps.sh",
    "```",
    "O que o instalador faz por você:",
    "- Valida o domínio e grava `DOMAIN`, `PUBLIC_URL=https://<domínio>` e `RMM_SERVER_URL=https://<domínio>/actions` no arquivo `.env` (permissão 600) + gera um `SESSION_SECRET` aleatório",
    "- Instala **Docker** (se faltar), **UFW** liberando só **22/80/443**, **Fail2ban** e **atualizações automáticas** de segurança",
    "- No final, **sobe o sistema sozinho** (`docker compose up -d --build` executado na raiz do projeto) e mostra o `docker compose ps` — os dois containers, `rmm-app` e `rmm-caddy`, precisam aparecer \"Up\"",
    "",
    "### Passo 4 — Suba o sistema com HTTPS automático",
    "O `install-vps.sh` já faz isso no final. Para subir de novo (ou após um `git pull`), rode na **raiz do projeto** (`cd ~/rmm`, onde está o `docker-compose.yml` — não dentro de `deploy/`):",
    "```bash",
    "docker compose up -d --build",
    "docker compose ps        # DOIS serviços \"Up\": rmm-app e rmm-caddy",
    "docker compose logs -f caddy   # acompanhe a emissão do certificado Let's Encrypt (Ctrl+C sai)",
    "```",
    "São dois containers: o **rmm-app** (o painel, construído pelo `Dockerfile`, porta interna 3000) e o **rmm-caddy** (80/443, encaminha para `app:3000`). Se subir só o Caddy, o site responde **502**.",
    "O `docker-compose.yml` lê `DOMAIN`/`PUBLIC_URL` do `.env` — sem `.env` válido ele para e avisa, de propósito. O Caddy pede e renova o certificado sozinho. O banco fica no volume Docker `rmm_app_data`.",
    "",
    "### Passo 5 — Teste de fora da VPS",
    "```bash",
    "curl -I https://painel.suaempresa.com.br   # esperado: HTTP/2 200 (ou 30x para a tela do app)",
    "```",
    "Abra `https://painel.suaempresa.com.br` no navegador.",
    "",
    "### Passo 6 — Crie o primeiro administrador",
    "Na primeira abertura, o painel mostra **Configuração inicial**: nome, e-mail e senha (mín. 8 caracteres) do primeiro **Administrador**. Depois disso, o acesso é pela tela de login; crie os demais usuários em **Usuários**.",
    "",
    "### Passo 7 — Crie o site e gere o instalador do agente (estilo Tactical RMM)",
    "1. No painel, abra **Agentes → 1 · Criar o site**: dê um nome ao site (ex.: `Matriz`) e informe o domínio público com `https://` (o mesmo da VPS). Salve.",
    "2. Em **Agentes → 2 · Gerar o instalador Windows (.exe)**, clique em **Gerar pacote do instalador** e baixe os 4 arquivos gerados (`rmm-agent.py`, `config.json`, `build-exe.ps1`, `RmmAgent.iss`) — eles já nascem com **domínio, site e token embutidos**.",
    "3. Numa máquina Windows de build (uma vez só por site): instale Python 3.11+ e Inno Setup 6, coloque os 4 arquivos na mesma pasta e rode:",
    "   ```powershell",
    "   powershell -ExecutionPolicy Bypass -File .\\build-exe.ps1   # gera dist\\RmmAgent.exe (PyInstaller)",
    "   iscc RmmAgent.iss                                          # gera o instalador final",
    "   ```",
    "4. Distribua o `RmmAgent-Setup-<site>.exe` gerado: em cada computador Windows, **só executar como administrador e instalar** — não pede domínio nem token; o agente instala como serviço e aparece no painel em até 1 minuto.",
    "5. **Linux:** baixe o script Bash na mesma aba Agentes (também já sai apontando para o site) e rode `sudo bash rmm-agent-linux.sh`, ou use o serviço `deploy/rmm-agent.service`.",
    "",
    "### Passo 8 — Backup diário do banco",
    "```bash",
    "chmod +x deploy/backup.sh",
    "( crontab -l 2>/dev/null; echo \"0 3 * * * $(pwd)/deploy/backup.sh\" ) | crontab -",
    "# guarda cópias de app.db por 14 dias em backups/",
    "```",
    "",
    "### Atualizar o sistema na VPS",
    "```bash",
    "cd rmm",
    "git pull --ff-only",
    "docker compose up -d --build",
    "```",
    "",
    "### Problemas comuns",
    "- **Certificado não emite:** confira se o registro A aponta para esta VPS e se as portas 80/443 estão liberadas na provedora; veja `docker compose logs caddy`.",
    "- **502 no navegador:** o app não está respondendo para o Caddy. Confira `docker compose ps` (os dois containers, `rmm-app` e `rmm-caddy`, precisam estar \"Up\"), veja `docker compose logs app` e recrie com `docker compose up -d --build` na raiz do projeto. Em clones antigos o compose subia só o Caddy apontando para `127.0.0.1:3000` (ele mesmo) — faça `git pull` antes.",
    "- **Agente não aparece no painel:** na máquina, confira o serviço `RmmAgent` em execução e se `https://<domínio>/actions` responde; gere o instalador de novo se trocou o domínio ou rotacionou o token.",
    "",
    "---",
    "",
    "## Agentes",
    "- **Windows (.exe) — fluxo principal:** site criado no painel → **Gerar pacote do instalador** na aba Agentes → compilar uma vez com `agent/windows/build-exe.ps1` (PyInstaller) + `agent/windows/RmmAgent.iss` (Inno Setup). O instalador final já vem com site, domínio e token pré-configurados — o usuário final só executa e instala.",
    "- **Linux:** script Bash gerado na aba Agentes (já com o site embutido) + serviço systemd (`deploy/rmm-agent.service`).",
    "- Trocar de domínio ou rotacionar o token exige **gerar um novo instalador** no painel e redistribuir — é o mesmo comportamento do Tactical RMM.",
    "",
    "## Segurança (exposição pública)",
    "- **Só HTTPS** no domínio público (Caddy/Let's Encrypt ou Nginx+Certbot) — o site do painel deve ser `https://`",
    "- Senhas com PBKDF2-SHA256 (100 mil iterações) + salt individual — nunca em texto puro",
    "- Agentes autenticados por agentToken próprio por máquina; cadastro exige enrollment token (rotacionável pelo admin) embutido no instalador gerado",
    "- Firewall UFW: apenas 22 (SSH por chave), 80 e 443 abertos; Fail2ban no SSH; painel nunca exposto sem proxy",
    "- Nunca commite app.db, .env, tokens ou senhas neste repositório",
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
# São DOIS serviços: "app" (o painel, porta interna 3000, imagem do
# Dockerfile da raiz) e "caddy" (80/443, encaminha para app:3000).
# Se subir só o Caddy, o navegador recebe 502 — não há app ouvindo.
# O domínio NÃO fica fixo aqui: ele vem do .env (DOMAIN / PUBLIC_URL),
# preenchido pelo deploy/install-vps.sh, que pergunta o domínio na instalação.
# Sem DOMAIN no .env o compose falha de propósito (mensagem abaixo).
# Uso (na RAIZ do projeto): cp deploy/.env.example .env  # edite DOMAIN/PUBLIC_URL
#      docker compose up -d --build
#      docker compose ps   # rmm-app e rmm-caddy devem estar "Up"
services:
  app:
    build: .
    container_name: rmm-app
    restart: unless-stopped
    environment:
      - PORT=3000
      - RMM_DB_PATH=/app/data/app.db
    volumes:
      - app_data:/app/data
    expose:
      - "3000"
  caddy:
    image: caddy:2-alpine
    container_name: rmm-caddy
    restart: unless-stopped
    depends_on:
      - app
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
  app_data:
  caddy_data:
  caddy_config:
`;
  const caddyfile = `# Caddy — HTTPS automático (Let's Encrypt)
# O domínio vem da variável de ambiente DOMAIN (do .env) — nada fixo aqui.
# O install-vps.sh pergunta o domínio e grava DOMAIN/PUBLIC_URL no .env.
# O destino é o serviço "app" do docker-compose (NUNCA 127.0.0.1: dentro do
# container do Caddy, 127.0.0.1 é o próprio Caddy e a conexão é recusada).
{$DOMAIN} {
  encode zstd gzip
  reverse_proxy app:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
`;
  const nginxConf = `# Nginx — alternativa ao Caddy (HTTPS com Certbot)
# __DOMAIN__ é substituído pelo domínio informado na instalação:
#   sed -i "s/__DOMAIN__/$DOMAIN/g" deploy/nginx.conf   (o install-vps.sh faz isso)
# O destino é o serviço "app" do docker-compose: rode o Nginx na mesma rede
# Docker do compose. NUNCA 127.0.0.1 se o Nginx estiver em container.
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
    proxy_pass http://app:3000;
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
echo " 2) No painel, em Agentes > Criar o site, salve o nome do site e $PUBLIC_URL"
echo " 3) Teste de fora: curl -I $PUBLIC_URL"
# 3) Sobe os DOIS serviços (app + caddy) a partir da RAIZ do projeto.
# NUNCA rode "docker compose" de dentro de deploy/: o risco é subir um
# compose antigo/incompleto, só com o Caddy — o site responde 502 porque
# não há app ouvindo. Aqui subimos da raiz, com o compose completo.
echo "[rmm] Subindo o sistema (rmm-app + rmm-caddy)..."
docker compose up -d --build
docker compose ps
echo "[rmm] Pronto. Os DOIS containers acima precisam estar 'Up'."
echo "[rmm] Se o rmm-app não subiu, veja o motivo: docker compose logs app"
`;
  const backupScript = `#!/usr/bin/env bash
# Backup diário do banco do RMM — agende no cron: 0 3 * * * /opt/rmm/deploy/backup.sh
set -euo pipefail
# No Docker, o banco fica no volume app_data do compose:
#   docker volume inspect rmm_app_data (Mountpoint) -> .../_data/app.db
SRC="\${RMM_DB:-/var/lib/docker/volumes/rmm_app_data/_data/app.db}"
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
${actionsUrl ? `\n# Domínio atualmente salvo no painel (referência): ${actionsUrl}` : "# Nenhum site salvo no painel ainda — crie o site em Agentes; os agentes gerados já vêm com ele embutido."}
`;
  const innoSetup = `; Inno Setup — gera o instalador RmmAgent-Setup.exe (Windows)
; Compile com Inno Setup 6: iscc agent\\windows\\RmmAgent.iss
; Antes: gere o exe com PyInstaller (ver agent/windows/build-exe.ps1)
; FLUXO TACTICAL: este instalador é GERADO a partir do site salvo no painel.
; O config.json ao lado (gerado junto, com serverUrl/token do site) é
; empacotado e copiado para {commonappdata}\\RmmAgent\\config.json —
; quem instala NÃO digita domínio nenhum: só executa e instala.
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
Source: "config.json"; DestDir: "{commonappdata}\\RmmAgent"; Flags: ignoreversion
[Run]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando serviço do agente..."
Filename: "{app}\\RmmAgent.exe"; Parameters: "--start-service"; Flags: runhidden waituntilterminated
[UninstallRun]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
${domain ? `; Site pré-configurado neste instalador: ${domain} (${actionsUrl})` : "; Nenhum site salvo no painel ainda — crie o site em Agentes antes de gerar o instalador."}
`;
  const buildExePs1 = `# Gera RmmAgent.exe a partir do agente Python (open source, sem custo)
# Requisitos na máquina de build (Windows): Python 3.11+ e pip
# Uso: powershell -ExecutionPolicy Bypass -File build-exe.ps1
# FLUXO TACTICAL: rode na MESMA pasta onde estão rmm-agent.py e o
# config.json gerados pelo painel (site + domínio + token já embutidos).
# O Inno Setup empacota o config.json junto — o instalador final não
# pergunta nada a quem instala.
$ErrorActionPreference = "Stop"
if (-not (Test-Path "config.json")) { throw "config.json não encontrado nesta pasta. Baixe o pacote completo em Agentes > Gerar instalador no painel." }
if (-not (Test-Path "rmm-agent.py")) { throw "rmm-agent.py não encontrado nesta pasta. Baixe o pacote completo em Agentes > Gerar instalador no painel." }
pip install --upgrade pyinstaller psutil
pyinstaller --onefile --noconsole --name RmmAgent rmm-agent.py
Write-Host "Pronto: dist\\RmmAgent.exe — assine com signtool se tiver certificado de código."
Write-Host "Sem certificado, o Windows SmartScreen pode avisar na primeira instalação."
Write-Host "Compile depois o instalador pré-configurado: iscc RmmAgent.iss"
`;
  const agentConfigJson = JSON.stringify({ serverUrl: actionsUrl, _instrucao: "Modelo. O config.json REAL é gerado pelo painel em Agentes > Gerar instalador, já com o site/domínio/token do site — esse é o arquivo que vai dentro do instalador .exe.", intervalSeconds: 60 }, null, 2);
  return { dockerCompose, caddyfile, nginxConf, envExample, installScript, backupScript, systemdService, innoSetup, buildExePs1, agentConfigJson, domain, actionsUrl };
}


function buildInstallerFiles(publicUrl: string, enrollmentToken: string, siteName: string) {
  const actionsUrl = actionsUrlFromPublic(publicUrl);
  const domain = domainFromPublic(publicUrl);
  const site = siteName.trim() || domain || "site";
  const slug = site.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site";
  const configJson = JSON.stringify({ serverUrl: actionsUrl, enrollmentToken, siteName: site, intervalSeconds: 60 }, null, 2);
  const innoSetup = `; ============================================================
;  RmmAgent.iss — instalador GERADO pelo painel RMM
;  Site: ${site}
;  Servidor pré-configurado: ${actionsUrl}
;  Quem recebe o instalador final só executa e instala —
;  nenhum domínio ou token é pedido na instalação.
;  Compile com Inno Setup 6:  iscc RmmAgent.iss
;  Antes, gere o exe: powershell -ExecutionPolicy Bypass -File build-exe.ps1
; ============================================================
#define MyAppName "RMM Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "RMM Console"
[Setup]
AppId={{8F3A2B10-1C4D-4E5F-9A6B-RMMAGENT01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppInfoDescription=Agente RMM — site ${site} (${domain})
DefaultDirName={autopf}\\RmmAgent
DefaultGroupName={#MyAppName}
OutputBaseFilename=RmmAgent-Setup-${slug}
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
[Files]
Source: "dist\\RmmAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.json"; DestDir: "{commonappdata}\\RmmAgent"; Flags: ignoreversion
[Run]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando serviço do agente..."
Filename: "{app}\\RmmAgent.exe"; Parameters: "--start-service"; Flags: runhidden waituntilterminated
[UninstallRun]
Filename: "{app}\\RmmAgent.exe"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
`;
  const buildExePs1 = `# ============================================================
#  build-exe.ps1 — GERADO pelo painel RMM (site: ${site})
#  Servidor pré-configurado: ${actionsUrl}
#  Rode NESTA pasta, com rmm-agent.py + config.json + RmmAgent.iss juntos.
#  Requisitos (máquina de build Windows): Python 3.11+ e Inno Setup 6.
# ============================================================
$ErrorActionPreference = "Stop"
if (-not (Test-Path "config.json")) { throw "Falta o config.json gerado pelo painel nesta pasta." }
if (-not (Test-Path "rmm-agent.py")) { throw "Falta o rmm-agent.py gerado pelo painel nesta pasta." }
pip install --upgrade pyinstaller psutil
pyinstaller --onefile --noconsole --name RmmAgent rmm-agent.py
Write-Host "OK: dist\\RmmAgent.exe"
Write-Host "Agora compile o instalador final (já pré-configurado): iscc RmmAgent.iss"
Write-Host "Resultado: RmmAgent-Setup-${slug}.exe — distribua este arquivo; quem instala só executa."
`;
  const instructions = [
    `INSTALADOR DO AGENTE — SITE "${site.toUpperCase()}"`,
    `Servidor pré-configurado: ${actionsUrl}`,
    "",
    "Este pacote foi gerado pelo painel (Agentes > Gerar instalador).",
    "Todos os arquivos já contêm o site, o domínio e o token de matrícula —",
    "o instalador final NÃO pede nenhuma configuração a quem instala.",
    "",
    "GERAR O .EXE (uma vez por site, numa máquina Windows de build):",
    "  1) Instale Python 3.11+ (python.org) e Inno Setup 6 (jrsoftware.org).",
    "  2) Coloque estes 4 arquivos na MESMA pasta:",
    "       rmm-agent.py   config.json   build-exe.ps1   RmmAgent.iss",
    "  3) Gere o executável do agente:",
    "       powershell -ExecutionPolicy Bypass -File .\\build-exe.ps1",
    "  4) Compile o instalador final:",
    "       iscc RmmAgent.iss",
    `  5) Pronto: RmmAgent-Setup-${slug}.exe`,
    "",
    "DISTRIBUIR:",
    `  Envie só o RmmAgent-Setup-${slug}.exe para as máquinas do site.`,
    "  Em cada computador Windows: executar como administrador > Instalar.",
    "  Nada é perguntado — o agente instala como serviço, já apontando para",
    `  ${actionsUrl}, e a máquina aparece no painel em até 1 minuto.`,
    "",
    "IMPORTANTE:",
    "  - Se trocar o domínio do site ou rotacionar o token no painel,",
    "    gere um NOVO pacote e redistribua (instaladores antigos apontam",
    "    para a configuração anterior — mesmo comportamento do Tactical RMM).",
    "  - Sem certificado de assinatura de código, o SmartScreen pode avisar",
    "    na primeira instalação (Mais informações > Executar assim mesmo).",
  ].join("\n");
  return { configJson, innoSetup, buildExePs1, instructions, siteName: site, siteSlug: slug, installerFileName: `RmmAgent-Setup-${slug}.exe`, domain, actionsUrl };
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

# >>> Servidor PRÉ-CONFIGURADO pelo painel (site criado em Agentes):
# >>> ${hasServer ? resolvedActionsUrl : "(nenhum site salvo — crie o site no painel e baixe o script de novo)"}
# >>> A variável RMM_SERVER_URL, se definida, sobrescreve (uso avançado).
SERVER_URL="\${RMM_SERVER_URL:-${resolvedActionsUrl}}"
if [ -z "$SERVER_URL" ]; then
  echo "[rmm-agent] ERRO: nenhum servidor embutido neste script." >&2
  echo "[rmm-agent] Crie o site em Agentes no painel e baixe o script novamente — ele já vem pré-configurado." >&2
  exit 1
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

# >>> Servidor PRÉ-CONFIGURADO pelo painel (site criado em Agentes): ${hasServer ? resolvedActionsUrl : "(nenhum site salvo — crie o site no painel e baixe de novo)"}
# >>> $env:RMM_SERVER_URL sobrescreve (uso avançado). Sem prompt: o script já nasce apontando para o site.
$ServerUrl       = if ($env:RMM_SERVER_URL) { $env:RMM_SERVER_URL } else { "${resolvedActionsUrl}" }
if (-not $ServerUrl) { throw "[rmm-agent] Nenhum servidor embutido. Crie o site em Agentes no painel e baixe o script novamente." }
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
# Servidor PRÉ-CONFIGURADO: este arquivo é gerado pelo painel DEPOIS que o
# site é criado (Agentes) — SERVER_URL e o token já vêm embutidos, como no
# instalador do Tactical RMM. O config.json que o instalador .exe grava em
# %ProgramData%/RmmAgent (também gerado pelo painel, com o mesmo site)
# tem prioridade quando existe. SEM prompt interativo.
def _resolve_server_url():
    global SERVER_URL
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
    if SERVER_URL:
        return SERVER_URL
    raise SystemExit("[rmm-agent] Servidor não configurado neste arquivo. Gere o agente/instalador a partir do site criado em Agentes no painel — ele já vem pré-configurado.")
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
    description: "Retorna o site configurado (nome + domínio), o token de matrícula e os scripts reais dos agentes Windows, Linux e Python, já pré-configurados com o site. Requer sessão.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      enrollmentToken: z.string(),
      siteName: z.string(),
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
      const nameRows = await db.select().from(schema.settings).where(eq(schema.settings.key, "site_name")).limit(1);
      const siteName = nameRows[0]?.value ?? "";
      const scripts = buildScripts(token, publicUrl);
      return { enrollmentToken: token, siteName, publicUrl, actionsUrl: actionsUrlFromPublic(publicUrl), ...scripts };
    },
  }),

  getInstallerPackage: defineAction({
    description: "Gera o pacote do instalador Windows (.exe) pré-configurado com o site salvo (domínio + token embutidos, estilo Tactical RMM): agente Python, config.json, build-exe.ps1, RmmAgent.iss e instruções. Exige site com domínio https salvo. Requer sessão.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({
      ready: z.boolean(), siteName: z.string(), domain: z.string(), actionsUrl: z.string(),
      installerFileName: z.string(), agentPy: z.string(), configJson: z.string(),
      innoSetup: z.string(), buildExePs1: z.string(), instructions: z.string(),
    }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const pub = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const publicUrl = pub[0]?.value ?? "";
      const nam = await db.select().from(schema.settings).where(eq(schema.settings.key, "site_name")).limit(1);
      const siteName = nam[0]?.value ?? "";
      const tRows = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      let token = tRows[0]?.value;
      if (!token) {
        token = `rmm_${randHex(16)}`;
        await db.insert(schema.settings).values({ key: "enrollment_token", value: token });
      }
      const actionsUrl = actionsUrlFromPublic(publicUrl);
      if (!actionsUrl) {
        return { ready: false, siteName, domain: "", actionsUrl: "", installerFileName: "", agentPy: "", configJson: "", innoSetup: "", buildExePs1: "", instructions: "Crie o site primeiro: informe o nome e o domínio (https://...) e salve. Depois gere o instalador — ele já sai pré-configurado com esse site." };
      }
      const files = buildInstallerFiles(publicUrl, token, siteName);
      const scripts = buildScripts(token, publicUrl);
      return { ready: true, siteName: files.siteName, domain: files.domain, actionsUrl, installerFileName: files.installerFileName, agentPy: scripts.pythonPy, configJson: files.configJson, innoSetup: files.innoSetup, buildExePs1: files.buildExePs1, instructions: files.instructions };
    },
  }),

  getSystemConfig: defineAction({
    description: "Retorna a configuração do site: nome, domínio/URL pública usada pelos agentes e status básico.",
    request: z.object({ sessionToken: z.string().default("") }),
    response: z.object({ siteName: z.string(), publicUrl: z.string(), actionsUrl: z.string(), usesHttps: z.boolean(), hasEnrollmentToken: z.boolean() }),
    async handler(ctx, args) {
      await requireAuth(ctx, args.sessionToken);
      const db = ctx.db<typeof schema>();
      const pub = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      const nam = await db.select().from(schema.settings).where(eq(schema.settings.key, "site_name")).limit(1);
      const enr = await db.select().from(schema.settings).where(eq(schema.settings.key, "enrollment_token")).limit(1);
      const publicUrl = pub[0]?.value ?? "";
      return { siteName: nam[0]?.value ?? "", publicUrl, actionsUrl: actionsUrlFromPublic(publicUrl), usesHttps: publicUrl.startsWith("https://"), hasEnrollmentToken: !!enr[0]?.value };
    },
  }),

  updateSystemConfig: defineAction({
    description: "Cria/atualiza o site do painel (nome + domínio público) — é este site que o instalador .exe gerado carrega pré-configurado. Apenas administradores.",
    request: z.object({ sessionToken: z.string().default(""), publicUrl: z.string().trim().max(300).default(""), siteName: z.string().trim().max(80).default("") }),
    response: z.object({ ok: z.literal(true), siteName: z.string(), publicUrl: z.string(), actionsUrl: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; siteName: string; publicUrl: string; actionsUrl: string }> {
      const me = await requireAuth(ctx, args.sessionToken);
      if (me.role !== "admin") throw new Error("Apenas administradores podem alterar o site do servidor.");
      const cleaned = normalizePublicUrl(args.publicUrl);
      if (cleaned && !/^https?:\/\//i.test(cleaned)) throw new Error("Informe a URL completa, começando com https:// (recomendado) ou http:// para testes locais.");
      if (cleaned && cleaned.includes(" ")) throw new Error("URL inválida: não pode conter espaços.");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, "public_url")).limit(1);
      if (rows[0]) await db.update(schema.settings).set({ value: cleaned }).where(eq(schema.settings.key, "public_url"));
      else await db.insert(schema.settings).values({ key: "public_url", value: cleaned });
      const nameRows = await db.select().from(schema.settings).where(eq(schema.settings.key, "site_name")).limit(1);
      if (nameRows[0]) await db.update(schema.settings).set({ value: args.siteName }).where(eq(schema.settings.key, "site_name"));
      else await db.insert(schema.settings).values({ key: "site_name", value: args.siteName });
      ctx.invalidateQueries();
      return { ok: true, siteName: args.siteName, publicUrl: cleaned, actionsUrl: actionsUrlFromPublic(cleaned) };
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
        { id: "https", ok: usesHttps, title: "Domínio público com HTTPS", detail: usesHttps ? `Agentes apontam para ${actionsUrlFromPublic(publicUrl)}` : "Crie o site em Agentes com o domínio em https:// e sirva só via HTTPS (Caddy ou Nginx+Certbot). Sem HTTPS, tokens trafegam em texto puro." },
        { id: "admin", ok: users.length >= 1, title: "Administrador criado e senhas com hash", detail: "Senhas PBKDF2-SHA256 + salt; sessões de 7 dias. Troque senhas fracas e desative usuários que saírem da equipe." },
        { id: "enrollment", ok: true, title: "Matrícula protegida por token", detail: "Só máquinas com o enrollment token se cadastram; cada máquina recebe um agentToken próprio. Rotacione o token se ele vazar." },
        { id: "firewall", ok: false, title: "Firewall da VPS (manual)", detail: "Na VPS: UFW liberando só 22/80/443, SSH por chave, Fail2ban ativo — o script deploy/install-vps.sh já configura isso." },
        { id: "backup", ok: false, title: "Backup do banco (manual)", detail: "Agende deploy/backup.sh no cron (diário, retenção de 14 dias) e teste a restauração. O app.db concentra usuários e tokens." },
        { id: "proxy", ok: false, title: "Proxy reverso na frente (manual)", detail: "Nunca exponha a porta interna do app direto na internet: Caddy/Nginx na 443 com HSTS e headers de segurança (passo a passo de instalação no README do repositório no GitHub)." },
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
        'git commit -m "feat: RMM com login, site no painel e instalador .exe pré-configurado"',
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
