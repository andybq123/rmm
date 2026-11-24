; Inno Setup 6 — gera RmmAgent-Setup.exe (o instalador que o usuário só baixa e instala)
; IMPORTANTE: nenhum domínio vai embutido. O instalador PERGUNTA o
; domínio/servidor na tela "Servidor RMM" e grava a resposta em
; {commonappdata}\RmmAgent\config.json — é de lá que o agente lê.
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
[Run]
Filename: "{app}\RmmAgent.exe"; Parameters: "--install-service"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando serviço do agente..."
Filename: "{app}\RmmAgent.exe"; Parameters: "--start-service"; Flags: runhidden waituntilterminated
[UninstallRun]
Filename: "{app}\RmmAgent.exe"; Parameters: "--remove-service"; Flags: runhidden waituntilterminated
[Code]
var ServerPage: TInputQueryWizardPage;
procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectDir,
    'Servidor RMM', 'Para qual servidor este agente vai enviar os dados?',
    'Informe o domínio do seu painel RMM (o mesmo configurado na VPS). ' +
    'Nada fica fixo no instalador: cada instalação pode apontar para um servidor diferente.');
  ServerPage.Add('Domínio / URL do servidor:', False);
  ServerPage.Values[0] := ExpandConstant('{param:SERVER|}');
end;
function NextButtonClick(CurPageID: Integer): Boolean;
var V: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then begin
    V := Trim(ServerPage.Values[0]);
    if V = '' then begin
      MsgBox('Informe o domínio do servidor RMM para continuar.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Url: String;
begin
  if CurStep = ssPostInstall then begin
    Url := Trim(ServerPage.Values[0]);
    if (Pos('http://', Url) <> 1) and (Pos('https://', Url) <> 1) then Url := 'https://' + Url;
    StringChangeEx(Url, ' ', '', True);
    if Copy(Url, Length(Url), 1) = '/' then Delete(Url, Length(Url), 1);
    if Pos('/actions', Url) = 0 then Url := Url + '/actions';
    ForceDirectories(ExpandConstant('{commonappdata}\RmmAgent'));
    SaveStringToFile(ExpandConstant('{commonappdata}\RmmAgent\config.json'),
      '{' + #13#10 + '  "serverUrl": "' + Url + '",' + #13#10 + '  "intervalSeconds": 60' + #13#10 + '}', False);
  end;
end;
