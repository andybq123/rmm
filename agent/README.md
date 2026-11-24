# Agente RMM — instalador .exe compilado dentro da VPS (estilo Tactical RMM)

O fluxo deste projeto é o mesmo do Tactical RMM, sem etapa manual de compilação:

1. **Crie o site no painel** — aba **Agentes → 1 · Criar o site**: nome do site + domínio público (`https://painel.suaempresa.com.br`).
2. **Clique em "Gerar pacote novo"** — aba **Agentes → 2 · Gerar o instalador Windows (.exe)**. A compilação acontece **dentro da VPS**, no serviço **builder** (`builder/` no repositório):
   - o executável do agente (`windows/rmm-agent.py` → `RmmAgent.exe`) é **genérico**: compilado uma vez com PyInstaller rodando no Python de Windows sob Wine e guardado em cache no volume `builder_cache`. Ele lê a configuração do site em tempo de execução, do `config.json` instalado;
   - para cada build, o builder grava o `config.json` + `RmmAgent.iss` **gerados pelo painel para o site** (domínio + token embutidos) e roda o Inno Setup (ISCC) sob Wine;
   - o painel mostra o progresso e o log; ao final, o status fica **Pronto**.
3. **Baixe o instalador** — botão **Baixar instalador .exe** no painel: um único `RmmAgent-Setup-<site>.exe`. O download é servido pelo app a partir do builder, com a sua sessão do painel.
4. **Distribua só esse `.exe`**: em cada computador Windows, executar como administrador → Instalar. **Não pede domínio nem token** — o instalador copia o `config.json` pré-configurado para `%ProgramData%\RmmAgent\config.json`, instala o agente como serviço do Windows (`RmmAgent`, via `sc.exe`) e a máquina aparece no painel em até 1 minuto.

## E se a compilação falhar?
O painel mostra o erro e o final do log da build. Na VPS, o log completo do serviço é `docker compose logs builder`. Causas comuns: builder ainda construindo a imagem na primeira subida (`docker compose ps` — aguarde o `rmm-builder` ficar Up) ou falta de espaço em disco para as imagens do Wine.

## Alternativa manual (pacote-fonte)
A mesma aba Agentes ainda gera o **pacote-fonte** pré-configurado (`rmm-agent.py`, `config.json`, `build-exe.ps1`, `RmmAgent.iss`) para quem preferir compilar numa máquina Windows com Python 3.11+ e Inno Setup 6:
```powershell
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1   # gera dist\RmmAgent.exe
iscc RmmAgent.iss                                          # gera RmmAgent-Setup-<site>.exe
```
> Os arquivos `windows/RmmAgent.iss` e `windows/build-exe.ps1` deste repositório são o **modelo** desse pacote. Para um site real, use sempre os arquivos **gerados pelo painel** — são eles que carregam o domínio e o token do seu site. O agente canônico compilado pelo builder é `windows/rmm-agent.py`.

## Troca de domínio ou de token
Se você alterar o domínio do site ou rotacionar o token no painel, clique em **Gerar pacote novo** e redistribua o novo instalador. Instaladores antigos continuam apontando para a configuração anterior — mesmo comportamento do Tactical RMM.

## Assinatura de código
Sem certificado de assinatura, o Windows SmartScreen mostra um aviso na primeira instalação ("Mais informações → Executar assim mesmo"). Para produção, assine o `.exe` e o instalador com `signtool` e um certificado OV/EV.

## Linux
Use o script Bash da aba **Agentes** do painel — ele também já sai pré-configurado com o site — com o serviço systemd de `deploy/rmm-agent.service`: `systemctl enable --now rmm-agent`.
