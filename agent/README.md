# Agente RMM — como virar .exe instalável

O agente deste projeto é o `rmm-agent.py` (Python, código aberto neste repo), baixado na aba **Agentes** do painel.

**Nenhum domínio fica fixo** — nem no `.exe`, nem no instalador:
- O **instalador da VPS** (`deploy/install-vps.sh`) pergunta o domínio e grava `DOMAIN`/`PUBLIC_URL` no `.env`; o `docker-compose.yml` e o Caddy leem de lá.
- O **instalador do agente** (`RmmAgent-Setup.exe`) tem uma tela **"Servidor RMM"** que pergunta o domínio/servidor na hora da instalação e grava a resposta em `%ProgramData%\RmmAgent\config.json`. O agente lê o servidor desse arquivo (ou da variável `RMM_SERVER_URL`). Cada máquina pode apontar para um servidor diferente sem recompilar nada.

## Windows — gerar o .exe e o instalador
1. Numa máquina Windows de build, coloque o `rmm-agent.py` baixado do painel na pasta `agent/`.
2. Gere o executável: `powershell -ExecutionPolicy Bypass -File windows/build-exe.ps1` → `dist/RmmAgent.exe` (PyInstaller). Não embuta `config.json` com domínio — ele é gerado na instalação.
3. Gere o instalador que o usuário final usa: abra `windows/RmmAgent.iss` no **Inno Setup 6** e compile → `RmmAgent-Setup.exe`. É esse arquivo que você distribui: baixar, executar como administrador, **digitar o domínio do seu servidor na tela do instalador**, pronto — o agente roda como serviço apontando para aquele domínio.
4. Instalação silenciosa (opcional): `RmmAgent-Setup.exe /SERVER=https://<seu-dominio>` pré-preenche a tela do servidor.
5. Sem certificado de assinatura de código, o Windows SmartScreen mostra um aviso na primeira instalação ("Mais informações → Executar assim mesmo"). Para produção, assine o .exe com `signtool` e um certificado OV/EV.

## Linux
Use o script Bash da aba Agentes + `deploy/rmm-agent.service` (systemd). Sem servidor configurado, o script **pergunta o domínio** na primeira execução e grava em `/opt/rmm-agent/agent.env`: `systemctl enable --now rmm-agent`.

## Alternativas 100% open source com .exe próprio
Se preferir não manter agente próprio, estas plataformas open source distribuem agente .exe pronto — mas são um RMM completo à parte (painel próprio), não um agente deste painel:
- **MeshCentral** (Apache-2.0) — MeshAgent .exe gerado pelo seu servidor MeshCentral.
- **TacticalRMM** — agente .exe/MSI pelo painel Tactical.
- **RustDesk** (AGPL) — foco em acesso remoto, não em telemetria RMM.
A recomendação para este projeto é o caminho PyInstaller + Inno Setup acima: mantém um painel só, um token só e o domínio sempre informado na instalação.
