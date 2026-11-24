# ============================================================
#  RMM Builder — compila o instalador Windows (.exe) DENTRO da VPS
#
#  Imagem Linux com Wine: instala o Python de Windows e o Inno Setup 6
#  sob Wine na construção da imagem. Em tempo de execução, o serviço
#  builder.py recebe (pela rede interna do compose) o config.json e o
#  RmmAgent.iss gerados pelo painel para o site e devolve o .exe pronto.
#
#  O executável do agente (PyInstaller) é compilado na PRIMEIRA build
#  de instalador e fica em cache em /srv/cache (volume builder_cache):
#  as builds seguintes só rodam o Inno Setup e levam segundos.
#
#  Build:  docker compose build builder   (demora: baixa Wine + Python
#  de Windows + Inno Setup — uma vez só, na instalação/atualização)
# ============================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/root/.wine \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99

# Wine (64 + 32 bits p/ o instalador do Inno Setup), X virtual e utilidades
RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      wine wine64 wine32 xvfb cabextract curl unzip ca-certificates \
      python3 procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY builder/builder.py /srv/builder.py
COPY builder/entrypoint.sh /srv/entrypoint.sh
COPY agent/windows/rmm-agent.py /srv/rmm-agent.py
RUN chmod +x /srv/entrypoint.sh && mkdir -p /srv/cache /builds

# --- Windows sob Wine: Python 3.11 + PyInstaller/psutil + Inno Setup 6 ---
# Cada etapa roda com Xvfb porque os instaladores gráficos exigem DISPLAY.
# Se um download falhar, o build da imagem PARA aqui (visível no
# docker compose build) em vez de subir um builder quebrado.
RUN Xvfb :99 -screen 0 1024x768x16 >/dev/null 2>&1 & \
    sleep 2; \
    wineboot --init && wineserver -w; \
    curl -fL -o /tmp/python.exe https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe \
 && wine /tmp/python.exe /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1; \
    wineserver -w; \
    wine "C:\\Program Files\\Python311\\python.exe" -m pip install --no-warn-script-location pyinstaller psutil; \
    wineserver -w; \
    rm -f /tmp/python.exe

RUN Xvfb :99 -screen 0 1024x768x16 >/dev/null 2>&1 & \
    sleep 2; \
    (curl -fL -o /tmp/innosetup.exe https://files.jrsoftware.org/is/6/innosetup-6.4.3.exe \
     || curl -fL -o /tmp/innosetup.exe https://github.com/jrsoftware/issrc/releases/download/is-6_4_3/innosetup-6.4.3.exe) \
 && wine /tmp/innosetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART; \
    wineserver -w; \
    test -f "/root/.wine/drive_c/Program Files (x86)/Inno Setup 6/ISCC.exe"; \
    rm -f /tmp/innosetup.exe

EXPOSE 8080
VOLUME ["/builds", "/srv/cache"]
CMD ["/srv/entrypoint.sh"]
