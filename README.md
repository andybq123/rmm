# RMM — Monitor de Computadores

Painel web corporativo para monitoramento remoto (RMM) de computadores Windows e Linux, com agentes reais, alertas automáticos e comandos remotos. Preparado para **VPS Linux com IP público e HTTPS**.

**Repositório:** andybq123/rmm

> **Fluxo estilo Tactical RMM:** você instala o painel na VPS, **cria o site no painel** (nome + domínio, na aba **Agentes**) e clica em **Gerar pacote novo**: o instalador `.exe` é **compilado dentro da própria VPS** e sai pronto para baixar, já pré-configurado com esse site, o domínio e o token. Em cada máquina Windows é só executar o instalador — ele **não pede domínio nem token**.

## Funcionalidades
- Tela de login com usuários, papéis (Administrador / Operador / Visualizador) e sessões de 7 dias
- Dashboard da frota: online, instável, offline e crítico em tempo real (polling 15s)
- Métricas por máquina: CPU, RAM, disco, uptime, IP, MAC, hardware e histórico em gráfico
- Alertas automáticos quando CPU, RAM ou disco passam de 90%
- Comandos remotos: reiniciar, desligar, coletar informações e executar script
- **Site no painel + instalador .exe compilado dentro da VPS** (domínio + token embutidos, como no Tactical RMM): **Gerar pacote novo** compila no serviço builder da VPS (Wine + Inno Setup) e devolve o `.exe` pronto para baixar
- Agentes de script: Bash (Linux), PowerShell (Windows) e Python universal — envio a cada 60s, já apontando para o site
- Token de matrícula para cadastro seguro de novos dispositivos

## Estrutura do projeto
```
client/            React + Tailwind (interface)
server/            Backend (actions tipadas) + autenticação + agentes
standalone/        Servidor do app na VPS (serve o painel + executa as actions, porta 3000)
builder/           Serviço que compila o instalador .exe dentro da VPS (Wine + Python de Windows + Inno Setup)
drizzle/           Migrations SQL
deploy/            VPS: install-vps.sh, Caddyfile, nginx.conf, backup.sh, rmm-agent.service
agent/             Build do .exe (PyInstaller) e instalador (Inno Setup)
vendor/            SDK do painel vendorizado como código-fonte de texto (sem binários; o build do Docker é autossuficiente)
Dockerfile         Imagem do serviço "app" do compose
docker-compose.yml App + proxy reverso com HTTPS automático (Caddy) — domínio via .env
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
- No final, **sobe o sistema sozinho** (`docker compose up -d --build` executado na raiz do projeto) e mostra o `docker compose ps` — os dois containers, `rmm-app` e `rmm-caddy`, precisam aparecer "Up"

### Passo 4 — Suba o sistema com HTTPS automático
O `install-vps.sh` já faz isso no final. Para subir de novo (ou após um `git pull`), rode na **raiz do projeto** (`cd ~/rmm`, onde está o `docker-compose.yml` — não dentro de `deploy/`):

```bash
docker compose up -d --build
docker compose ps              # TRÊS serviços "Up": rmm-app, rmm-builder e rmm-caddy
docker compose logs -f caddy   # acompanhe a emissão do certificado Let's Encrypt (Ctrl+C sai)
```

São três containers: o **rmm-app** (o painel em si, construído pelo `Dockerfile`, ouvindo na porta interna 3000), o **rmm-builder** (compila o instalador `.exe` dentro da VPS — Wine + Inno Setup, sem porta pública) e o **rmm-caddy** (portas 80/443, HTTPS automático, encaminha para `app:3000`). Se subir só o Caddy, o site responde **502** — é o sintoma de que o app não subiu. **A primeira build do builder demora alguns minutos** (baixa Wine, o Python de Windows e o Inno Setup) — acontece uma vez só; as próximas reaproveitam o cache.

O `docker-compose.yml` lê `DOMAIN`/`PUBLIC_URL` do `.env` — sem `.env` válido ele para e avisa, de propósito. O Caddy pede e renova o certificado sozinho. O banco do painel fica no volume Docker `rmm_app_data` (sobrevive a `docker compose down` sem `-v`).

### Passo 5 — Teste de fora da VPS
```bash
curl -I https://painel.suaempresa.com.br   # esperado: HTTP/2 200 (ou redirecionamento para o app)
```

Abra `https://painel.suaempresa.com.br` no navegador.

### Passo 6 — Crie o primeiro administrador
Na primeira abertura, o painel mostra **Configuração inicial**: nome, e-mail e senha (mín. 8 caracteres) do primeiro **Administrador**. Depois disso, o acesso é pela tela de login; crie os demais usuários em **Usuários**.

### Passo 7 — Crie o site e baixe o instalador do agente (estilo Tactical RMM)
1. No painel, abra **Agentes → 1 · Criar o site**: dê um nome ao site (ex.: `Matriz`) e informe o domínio público com `https://` (o mesmo da VPS). Salve.
2. Em **Agentes → 2 · Gerar o instalador Windows (.exe)**, clique em **Gerar pacote novo**. A compilação acontece **dentro da VPS**, no serviço **builder**: o painel mostra o progresso e o log. Na primeira vez, o builder também compila o executável do agente (PyInstaller sob Wine) e pode levar alguns minutos; nas seguintes, ele só monta o instalador do site e leva segundos.
3. Com o status **Pronto**, clique em **Baixar instalador .exe**: um único arquivo `RmmAgent-Setup-<site>.exe`, já com **domínio, site e token embutidos**.
4. Distribua esse `.exe`: em cada computador Windows, **só executar como administrador e instalar** — não pede domínio nem token; o agente instala como serviço e aparece no painel em até 1 minuto.
5. **Linux:** baixe o script Bash na mesma aba Agentes (também já sai apontando para o site) e rode `sudo bash rmm-agent-linux.sh`, ou use o serviço `deploy/rmm-agent.service`.

Se a compilação falhar, o painel mostra o erro e o final do log; o log completo do serviço fica em `docker compose logs builder` na VPS.

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
- **502 no navegador:** o app não está respondendo para o Caddy. Confira `docker compose ps` (os dois containers, `rmm-app` e `rmm-caddy`, precisam estar "Up"), veja `docker compose logs app` e recrie com `docker compose up -d --build` na raiz do projeto. Nas versões antigas deste repositório o compose subia **só o Caddy** e ele apontava para `127.0.0.1:3000` (ele mesmo) — se o seu clone é antigo, faça `git pull` antes.
- **Agente não aparece no painel:** na máquina, confira o serviço `RmmAgent` em execução e se `https://<domínio>/actions` responde; gere o instalador de novo se trocou o domínio ou rotacionou o token.

---

## Agentes
- **Windows (.exe) — fluxo principal:** site criado no painel → **Gerar pacote novo** na aba Agentes → o serviço **builder** compila o instalador **dentro da VPS** (o executável do agente é compilado uma vez com PyInstaller sob Wine e fica em cache; cada build roda o Inno Setup com o `config.json` do site) → **baixar o `.exe` pronto**. O instalador já vem com site, domínio e token pré-configurados — o usuário final só executa e instala. Detalhes em `agent/README.md`. O pacote-fonte (`build-exe.ps1` + `RmmAgent.iss`) continua disponível na mesma aba para quem preferir compilar manualmente no Windows.
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
