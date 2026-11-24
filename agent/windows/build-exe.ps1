# Gera RmmAgent.exe a partir do agente Python (open source)
# Requisitos (máquina de build Windows): Python 3.11+
# Uso: powershell -ExecutionPolicy Bypass -File build-exe.ps1
# FLUXO TACTICAL: rode na MESMA pasta onde estão o rmm-agent.py e o
# config.json GERADOS pelo painel (site + domínio + token embutidos).
# O Inno Setup empacota o config.json junto — o instalador final
# (RmmAgent-Setup-<site>.exe) não pergunta nada a quem instala.
$ErrorActionPreference = "Stop"
if (-not (Test-Path "config.json")) { throw "config.json não encontrado nesta pasta. Baixe o pacote completo em Agentes > Gerar instalador no painel." }
if (-not (Test-Path "rmm-agent.py")) { throw "rmm-agent.py não encontrado nesta pasta. Baixe o pacote completo em Agentes > Gerar instalador no painel." }
pip install --upgrade pyinstaller psutil
pyinstaller --onefile --noconsole --name RmmAgent rmm-agent.py
Write-Host "Pronto: dist\RmmAgent.exe"
Write-Host "Sem certificado de assinatura de código, o SmartScreen pode avisar na 1a instalação."
Write-Host "Compile depois o instalador pré-configurado: iscc RmmAgent.iss"
