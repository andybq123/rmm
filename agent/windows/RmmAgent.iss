; Inno Setup 6 — MODELO do instalador RmmAgent-Setup-<site>.exe
; Para um site real, use o RmmAgent.iss GERADO pelo painel
; (Agentes > Gerar instalador): ele já vem nomeado para o site e é
; compilado junto do config.json pré-configurado (domínio + token).
; FLUXO TACTICAL: quem instala NÃO digita domínio nenhum — o
; config.json ao lado é empacotado e copiado para
; {commonappdata}\RmmAgent\config.json na instalação.
#define MyAppName "RMM Agent"
#define MyAppVersion "1.0.0"
[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\RmmAgent
OutputBaseFilename=RmmAgent-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
[Files]
Source: "dist\RmmAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.json"; DestDir: "{commonappdata}\RmmAgent"; Flags: ignoreversion
[Run]
Filename: "{app}\RmmAgent.exe"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando serviço do agente..."
Filename: "{app}\RmmAgent.exe"; Parameters: "--start-service"; Flags: runhidden waituntilterminated
[UninstallRun]
Filename: "{app}\RmmAgent.exe"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
