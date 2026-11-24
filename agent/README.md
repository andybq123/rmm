# Agente RMM — instalador .exe pré-configurado (estilo Tactical RMM)

O fluxo deste projeto é o mesmo do Tactical RMM:

1. **Crie o site no painel** — aba **Agentes → 1 · Criar o site**: nome do site + domínio público (`https://painel.suaempresa.com.br`).
2. **Gere o instalador no painel** — **Agentes → 2 · Gerar o instalador Windows (.exe)** → **Gerar pacote do instalador**. O painel devolve 4 arquivos já com **site, domínio e token embutidos**:
   - `rmm-agent.py` — o agente (Python, código aberto neste repo), já apontando para o site
   - `config.json` — `serverUrl` + `enrollmentToken` + nome do site
   - `build-exe.ps1` — compila o agente em `RmmAgent.exe` com PyInstaller
   - `RmmAgent.iss` — script do Inno Setup que empacota o `.exe` + `config.json`
3. **Compile uma vez** (máquina Windows de build, com Python 3.11+ e Inno Setup 6), com os 4 arquivos na mesma pasta:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build-exe.ps1   # gera dist\RmmAgent.exe
   iscc RmmAgent.iss                                          # gera RmmAgent-Setup-<site>.exe
   ```
4. **Distribua só o `RmmAgent-Setup-<site>.exe`**: em cada computador Windows, executar como administrador → Instalar. **Não pede domínio nem token** — o instalador copia o `config.json` pré-configurado para `%ProgramData%\RmmAgent\config.json`, instala o agente como serviço e a máquina aparece no painel em até 1 minuto.

> Os arquivos `windows/RmmAgent.iss` e `windows/build-exe.ps1` deste repositório são o **modelo** desse pacote. Para um site real, use sempre os arquivos **gerados pelo painel** — são eles que carregam o domínio e o token do seu site.

## Troca de domínio ou de token
Se você alterar o domínio do site ou rotacionar o token no painel, **gere um novo pacote e redistribua** o novo instalador. Instaladores antigos continuam apontando para a configuração anterior — mesmo comportamento do Tactical RMM.

## Assinatura de código
Sem certificado de assinatura, o Windows SmartScreen mostra um aviso na primeira instalação ("Mais informações → Executar assim mesmo"). Para produção, assine o `.exe` e o instalador com `signtool` e um certificado OV/EV.

## Linux
Use o script Bash da aba **Agentes** do painel — ele também já sai pré-configurado com o site — com o serviço systemd de `deploy/rmm-agent.service`: `systemctl enable --now rmm-agent`.
