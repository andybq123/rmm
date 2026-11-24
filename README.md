# RMM — Monitor de Computadores

Painel web corporativo para monitoramento remoto (RMM) de computadores Windows e Linux, com agentes reais, alertas automáticos e comandos remotos. Preparado para **VPS Linux com IP público, domínio informado na instalação e HTTPS**.

**Repositório:** andybq123/rmm

> **Nenhum domínio é fixo no código.** O domínio do sistema é informado em dois momentos:
> 1. **Na instalação da VPS** — o `deploy/install-vps.sh` pergunta o domínio (ou recebe `DOMAIN=`/argumento) e grava `DOMAIN`/`PUBLIC_URL`/`RMM_SERVER_URL` no `.env`, de onde o `docker-compose.yml` e o Caddy leem.
> 2. **Na instalação do agente (.exe)** — o instalador tem uma tela "Servidor RMM" que pergunta o domínio/servidor e grava a resposta em `config.json` na máquina. Cada instalação pode apontar para um servidor diferente.

## Funcionalidades
- Tela de login com usuários, papéis (Administrador / Operador / Visualizador) e sessões de 7 dias
- Dashboard da frota: online, instável, offline e crítico em tempo real (polling 15s)
- Métricas por máquina: CPU, RAM, disco, uptime, IP, MAC, hardware e histórico em gráfico
- Alertas automáticos quando CPU, RAM ou disco passam de 90%
- Comandos remotos: reiniciar, desligar, coletar informações e executar script
- Agentes reais: Bash (Linux), PowerShell (Windows) e Python universal — envio a cada 60s
- Agente Windows instalável (`.exe`) via PyInstaller + Inno Setup — ver `agent/`; o servidor é perguntado na instalação
- Aba **VPS & Segurança** no painel com todos os arquivos de implantação para baixar

## Estrutura do projeto
```
client/            React + Tailwind (interface)
server/            Backend (actions tipadas) + autenticação + agentes
drizzle/           Migrations SQL
deploy/            VPS: Caddyfile, nginx.conf, install-vps.sh, backup.sh, .env.example
agent/             Build do .exe (PyInstaller) e instalador (Inno Setup, pergunta o servidor)
docker-compose.yml Proxy reverso com HTTPS automático (Caddy) — domínio via .env
space.json         Metadados do artefato
```

## Instalação em VPS Linux (domínio + HTTPS)
1. Aponte o DNS: registro **A** do domínio/subdomínio que você escolher para o IP público da VPS.
2. Na VPS (Ubuntu/Debian): `sudo bash deploy/install-vps.sh` — o instalador **pergunta o domínio**, grava o `.env`, e instala Docker, UFW (só 22/80/443), Fail2ban e atualizações automáticas. (Automatizado: `sudo DOMAIN=<seu-dominio> bash deploy/install-vps.sh`.)
3. Rode `docker compose up -d` — o compose exige `DOMAIN`/`PUBLIC_URL` do `.env` e o Caddy emite o certificado Let's Encrypt sozinho para o domínio informado.
4. No painel, em **Agentes → Domínio do servidor**, confira o mesmo domínio (pré-preenchimento opcional — o instalador do agente sempre pergunta).
5. Backup diário: `0 3 * * * /opt/rmm/deploy/backup.sh` (retenção de 14 dias).

## Agentes
- **Windows (.exe):** veja `agent/README.md` — gere `RmmAgent.exe` com PyInstaller e o instalador `RmmAgent-Setup.exe` com Inno Setup. Quem instala digita o domínio do servidor na tela do instalador; nada fica embutido.
- **Linux:** script Bash da aba Agentes + serviço systemd em `deploy/rmm-agent.service`; sem servidor configurado, o script pergunta o domínio na primeira execução e grava em `/opt/rmm-agent/agent.env`.
- Alternativas open source com .exe próprio (MeshCentral, TacticalRMM) são comparadas na aba Agentes do painel.

## Publicar atualizações neste repositório
```bash
git add .
git commit -m "descreva a mudança"
git push
# Na VPS:
git pull --ff-only && docker compose up -d --build
```

## Segurança (exposição pública)
- Só **HTTPS** no domínio público (Caddy/Let's Encrypt ou Nginx + Certbot)
- Senhas com PBKDF2-SHA256 (100 mil iterações) + salt individual — nunca em texto puro
- Agentes autenticados por `agentToken` próprio por máquina; cadastro exige enrollment token rotacionável
- Firewall UFW: apenas 22 (SSH por chave), 80 e 443; Fail2ban no SSH; app nunca exposto sem proxy reverso
- `.env` com permissões 600 e `SESSION_SECRET` gerado na instalação; nunca commite `app.db`, `.env`, tokens ou senhas
