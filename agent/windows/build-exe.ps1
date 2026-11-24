# Gera RmmAgent.exe a partir do agente Python (open source)
# Requisitos (máquina de build Windows): Python 3.11+
# Uso: powershell -ExecutionPolicy Bypass -File build-exe.ps1
# NENHUM domínio é embutido no .exe: quem instala informa o servidor na
# tela do instalador (Inno Setup), que grava config.json em
# %ProgramData%\RmmAgent — o agente lê o servidor desse arquivo.
$ErrorActionPreference = "Stop"
pip install --upgrade pyinstaller psutil
pyinstaller --onefile --noconsole --name RmmAgent rmm-agent.py
Write-Host "Pronto: dist\RmmAgent.exe"
Write-Host "Sem certificado de assinatura de código, o SmartScreen pode avisar na 1a instalação."
Write-Host "Compile depois o instalador: iscc RmmAgent.iss (ele pergunta o domínio na instalação)"
