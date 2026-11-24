# RMM — Monitor de Computadores

Painel web corporativo para monitoramento remoto (RMM) de computadores Windows e Linux, com agentes reais, alertas automáticos e comandos remotos. Preparado para **VPS Linux com IP público e HTTPS**.

**Repositório:** andybq123/rmm

> **Fluxo estilo Tactical RMM:** você instala o painel na VPS, **cria o site no painel** (nome + domínio, na aba **Agentes**) e **gera o instalador `.exe` já pré-configurado** com esse site, o domínio e o token. Em cada máquina Windows é só executar o instalador — ele **não pede domínio nem token**.

## Funcionalidades
- Tela de login com usuários, papéis (Administrador / Operador / Visualizador) e sessões de 7 dias
- Dashboard da frota: online, instável, offline e crítico em tempo real (polling 15s)
- Métricas por máquina: CPU, RAM, disco, uptime, IP, MAC, hardware e histórico em gráfico
- Alertas automáticos quando CPU, RAM ou disco passam de 90%
- Comandos remotos: reiniciar, desligar, coletar informações e executar script
- **Site no painel + instalador .exe gerado pré-configurado** (domínio + token embutidos, como no Tactical RMM)
- Agentes de script: Bash (Linux), PowerShell (Windows) e Python universal — envio a cada 60s, já apontando para o site
- Token de matrícula para cadastro seguro de novos dispositivos

## Estrutura do projeto
```
client/            React + Tailwind (interface)
server/            Backend (actions tipadas) + autenticação + agentes
drizzle/           Migrations SQL
deploy/            VPS: install-vps.sh, Caddyfile, nginx.conf, backup.sh, rmm-agent.service
agent/             Build do .exe (PyInstaller) e instalador (Inno Setup)
docker-compose.yml Proxy reverso com HTTPS automático (Caddy) — domínio via .env
space.json         Metadados do artefato
```

---

## Instalação do sistema na VPS Linux — passo a passo completo

### Pré-requisitos
- VPS Linux **Ubuntu 22.04/24.04** ou **Debian 12** com **IP público** e acesso root (ou sudo)
- Um **domínio ou subdomínio** seu (ex.: `painel.suaempresa.com.br`) — você informa o domínio no instalador da VPS; ele não fica fixo no código
- Portas **22, 80 e 443** liberadas no painel da provedora da VPS (firewall da nuvem), se houver

### Passo 1 — Aponte o DNS para a VPS
No provedor do seu domínio (Registro.br, Cloudflare, etc.), crie um registro:

```
Tipo: A    Nome: painel (ou o subdomínio escolhido)    Valor: <IP público da VPS>    TTL: 300
```

Aguarde a propagação e confira de qualquer máquina:

```bash
ping painel.suaempresa.com.br   # deve responder com o IP da VPS
```

### Passo 2 — Acesse a VPS e baixe o projeto
```bash
ssh root@<IP-DA-VPS>
apt-get update && apt-get install -y git
git clone https://github.com/andybq123/rmm.git
cd rmm
```

### Passo 3 — Rode o instalador da VPS (ele pergunta o domínio)
```bash
sudo bash deploy/install-vps.sh
# → ele pergunta: "Domínio do sistema (sem https://):" — digite painel.suaempresa.com.br
```

Sem interação (automatizado), qualquer uma das formas funciona:

```bash
sudo bash deploy/install-vps.sh painel.suaempresa.com.br
sudo DOMAIN=painel.suaempresa.com.br bash deploy/install-vps.sh
```

O que o instalador faz por você:
- Valida o domínio e grava `DOMAIN`, `PUBLIC_URL=https://<domínio>` e `RMM_SERVER_URL=https://<domínio>/actions` no arquivo `.env` (permissão 600) + gera um `SESSION_SECRET` aleatório
- Instala **Docker** (se faltar), **UFW** liberando só **22/80/443**, **Fail2ban** e **atualizações automáticas** de segurança

### Passo 4 — Suba o sistema com HTTPS automático
```bash
docker compose up -d
docker compose ps              # o serviço rmm-caddy deve estar "Up"
docker compose logs -f caddy   # acompanhe a emissão do certificado Let's Encrypt (Ctrl+C sai)
```

O `docker-compose.yml` lê `DOMAIN`/`PUBLIC_URL` do `.env` — sem `.env` válido ele para e avisa, de propósito. O Caddy pede e renova o certificado sozinho.

### Passo 5 — Teste de fora da VPS
```bash
curl -I https://painel.suaempresa.com.br   # esperado: HTTP/2 200 (ou redirecionamento para o app)
```

Abra `https://painel.suaempresa.com.br` no navegador.

### Passo 6 — Crie o primeiro administrador
Na primeira abertura, o painel mostra **Configuração inicial**: nome, e-mail e senha (mín. 8 caracteres) do primeiro **Administrador**. Depois disso, o acesso é pela tela de login; crie os demais usuários em **Usuários**.

### Passo 7 — Crie o site e gere o instalador do agente (estilo Tactical RMM)
1. No painel, abra **Agentes → 1 · Criar o site**: dê um nome ao site (ex.: `Matriz`) e informe o domínio público com `https://` (o mesmo da VPS). Salve.
2. Em **Agentes → 2 · Gerar o instalador Windows (.exe)**, clique em **Gerar pacote do instalador** e baixe os 4 arquivos gerados (`rmm-agent.py`, `config.json`, `build-exe.ps1`, `RmmAgent.iss`) — eles já nascem com **domínio, site e token embutidos**.
3. Numa máquina Windows de build (uma vez só por site): instale Python 3.11+ e Inno Setup 6, coloque os 4 arquivos na mesma pasta e rode:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build-exe.ps1   # gera dist\RmmAgent.exe (PyInstaller)
   iscc RmmAgent.iss                                          # gera o instalador final
   ```
4. Distribua o `RmmAgent-Setup-<site>.exe` gerado: em cada computador Windows, **só executar como administrador e instalar** — não pede domínio nem token; o agente instala como serviço e aparece no painel em até 1 minuto.
5. **Linux:** baixe o script Bash na mesma aba Agentes (também já sai apontando para o site) e rode `sudo bash rmm-agent-linux.sh`, ou use o serviço `deploy/rmm-agent.service`.

### Passo 8 — Backup diário do banco
```bash
chmod +x deploy/backup.sh
( crontab -l 2>/dev/null; echo "0 3 * * * $(pwd)/deploy/backup.sh" ) | crontab -
# guarda cópias de app.db por 14 dias em backups/
```

### Atualizar o sistema na VPS
```bash
cd rmm
git pull --ff-only
docker compose up -d --build
```

### Problemas comuns
- **Certificado não emite:** confira se o registro A aponta para esta VPS e se as portas 80/443 estão liberadas na provedora; veja `docker compose logs caddy`.
- **502 no navegador:** o app interno (porta 3000) não subiu — confira os serviços e reinicie com `docker compose restart`.
- **Agente não aparece no painel:** na máquina, confira o serviço `RmmAgent` em execução e se `https://<domínio>/actions` responde; gere o instalador de novo se trocou o domínio ou rotacionou o token.

---

## Agentes
- **Windows (.exe) — fluxo principal:** site criado no painel → **Gerar pacote do instalador** na aba Agentes → compilar uma vez com `agent/windows/build-exe.ps1` (PyInstaller) + `agent/windows/RmmAgent.iss` (Inno Setup). O instalador final já vem com site, domínio e token pré-configurados — o usuário final só executa e instala. Detalhes em `agent/README.md`.
- **Linux:** script Bash gerado na aba Agentes (já com o site embutido) + serviço systemd em `deploy/rmm-agent.service`.
- Trocar de domínio ou rotacionar o token exige **gerar um novo instalador** no painel e redistribuir — é o mesmo comportamento do Tactical RMM.

## Publicar atualizações neste repositório
```bash
git add .
git commit -m "descreva a mudança"
git push
# Na VPS:
git pull --ff-only && docker compose up -d --build
```

## Segurança (exposição pública)
- Só **HTTPS** no domínio público (Caddy/Let's Encrypt ou Nginx + Certbot) — o site do painel deve ser `https://`
- Senhas com PBKDF2-SHA256 (100 mil iterações) + salt individual — nunca em texto puro
- Agentes autenticados por `agentToken` próprio por máquina; cadastro exige enrollment token rotacionável, embutido no instalador gerado
- Firewall UFW: apenas 22 (SSH por chave), 80 e 443; Fail2ban no SSH; app nunca exposto sem proxy reverso
- `.env` com permissões 600 e `SESSION_SECRET` gerado na instalação; nunca commite `app.db`, `.env`, tokens ou senhas
