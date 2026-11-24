#!/usr/bin/env python3
"""
RMM Builder — serviço interno de compilação do instalador Windows (.exe).

Roda SOMENTE na VPS, como serviço "builder" do docker-compose, acessível
apenas na rede interna do compose (sem porta publicada). O painel (app)
fala com ele por HTTP:

  GET  /health            -> { ok, wine, innoSetup, agentExeCached, simulate }
  POST /build             -> { buildId, installerFileName, configJson, innoSetup }
                             responde 202 e compila em segundo plano
  GET  /builds/<id>       -> { buildId, status, error, logTail, sizeBytes, fileName }
  GET  /builds/<id>/file  -> bytes do instalador pronto (status ready)

Como compila um instalador de Windows dentro do Linux:
  1. O executável do agente (RmmAgent.exe) é GENÉRICO: compilado uma vez
     com PyInstaller rodando no Python de Windows sob Wine, a partir de
     /srv/rmm-agent.py, e cacheado em /srv/cache/RmmAgent.exe. Ele lê o
     config.json do site em tempo de execução (%ProgramData%\\RmmAgent).
  2. Para cada site, este serviço grava o config.json + RmmAgent.iss
     gerados pelo painel e roda o ISCC.exe (Inno Setup) sob Wine.
     Resultado: /builds/<buildId>/<installerFileName> em segundos.

Autenticação: se BUILDER_SECRET estiver definido, toda chamada (exceto
/health) exige o header X-Builder-Secret igual.

BUILDER_SIMULATE=1 é um modo de TESTE do protocolo (sem Wine): produz um
arquivo pequeno no lugar do .exe para validar painel <-> builder de ponta
a ponta. NUNCA é ligado pelo docker-compose de produção.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("BUILDER_PORT", "8080"))
BUILDS_DIR = os.environ.get("BUILDS_DIR", "/builds")
SECRET = os.environ.get("BUILDER_SECRET", "")
SIMULATE = os.environ.get("BUILDER_SIMULATE", "") == "1"
WINEPREFIX = os.environ.get("WINEPREFIX", "/root/.wine")
AGENT_SRC = os.environ.get("AGENT_SRC", "/srv/rmm-agent.py")
CACHE_EXE = os.environ.get("CACHE_EXE", "/srv/cache/RmmAgent.exe")
WIN_PYTHON = r"C:\Program Files\Python311\python.exe"
ISCC = r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_lock = threading.Lock()
_builds = {}  # buildId -> dict(status, error, log, sizeBytes, fileName, startedAt)


def log_line(build, msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    build["log"] = (build.get("log", "") + line + "\n")[-8000:]
    _persist(build)


def _build_dir(build_id):
    return os.path.join(BUILDS_DIR, build_id)


def _persist(build):
    try:
        d = _build_dir(build["buildId"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "status.json"), "w", encoding="utf-8") as f:
            json.dump({
                "buildId": build["buildId"], "status": build["status"],
                "error": build.get("error", ""), "logTail": build.get("log", "")[-4000:],
                "sizeBytes": build.get("sizeBytes", 0), "fileName": build.get("fileName", ""),
            }, f)
    except Exception:
        pass


def _load_persisted(build_id):
    try:
        with open(os.path.join(_build_dir(build_id), "status.json"), encoding="utf-8") as f:
            data = json.load(f)
        exe = os.path.join(_build_dir(build_id), data.get("fileName", ""))
        if data.get("status") == "ready" and data.get("fileName") and os.path.exists(exe):
            data["sizeBytes"] = os.path.getsize(exe)
        return data
    except Exception:
        return None


def wine_env():
    env = dict(os.environ)
    env["WINEPREFIX"] = WINEPREFIX
    env["WINEARCH"] = "win64"
    env["WINEDEBUG"] = "-all"
    env.setdefault("DISPLAY", ":99")
    return env


def run(cmd, timeout, cwd=None):
    """Roda um comando e devolve (returncode, saida combinada)."""
    p = subprocess.run(cmd, cwd=cwd, env=wine_env(), timeout=timeout,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                       errors="replace")
    return p.returncode, p.stdout or ""


def win_path(linux_path):
    """Converte /builds/x/y -> Z:\\builds\\x\\y (Wine mapeia / em Z:)."""
    return "Z:" + linux_path.replace("/", "\\")


def ensure_agent_exe(build):
    """Garante o RmmAgent.exe genérico em cache; compila sob Wine se faltar."""
    if os.path.exists(CACHE_EXE) and os.path.getsize(CACHE_EXE) > 100_000:
        log_line(build, "RmmAgent.exe generico ja esta em cache — reaproveitando.")
        return CACHE_EXE
    log_line(build, "Primeira compilacao do agente: PyInstaller (Python de Windows sob Wine). Pode levar alguns minutos...")
    os.makedirs(os.path.dirname(CACHE_EXE), exist_ok=True)
    work = "/srv/pyinstaller-work"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    shutil.copy(AGENT_SRC, os.path.join(work, "rmm-agent.py"))
    rc, out = run(["wine", WIN_PYTHON, "-m", "PyInstaller", "--onefile", "--noconsole",
                   "--name", "RmmAgent", "--distpath", win_path(work + "/dist"),
                   "--workpath", win_path(work + "/build"), "--specpath", win_path(work),
                   win_path(work + "/rmm-agent.py")], timeout=1800, cwd=work)
    log_line(build, "PyInstaller: " + out.strip().splitlines()[-1] if out.strip() else "PyInstaller executado.")
    produced = os.path.join(work, "dist", "RmmAgent.exe")
    if rc != 0 or not os.path.exists(produced):
        raise RuntimeError("PyInstaller falhou ao gerar o RmmAgent.exe. Saida: " + out[-1500:])
    shutil.copy(produced, CACHE_EXE)
    log_line(build, f"RmmAgent.exe compilado e cacheado ({os.path.getsize(CACHE_EXE)} bytes).")
    return CACHE_EXE


def do_build(build_id, payload):
    build = _builds[build_id]
    file_name = payload.get("installerFileName") or "RmmAgent-Setup.exe"
    build["fileName"] = file_name
    try:
        build["status"] = "building"
        _persist(build)
        d = _build_dir(build_id)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(os.path.join(d, "dist"), exist_ok=True)
        with open(os.path.join(d, "config.json"), "w", encoding="utf-8") as f:
            f.write(payload.get("configJson") or "{}")
        with open(os.path.join(d, "RmmAgent.iss"), "w", encoding="utf-8") as f:
            f.write(payload.get("innoSetup") or "")

        if SIMULATE:
            log_line(build, "MODO DE TESTE (BUILDER_SIMULATE): gerando arquivo substituto — nao e um instalador real.")
            target = os.path.join(d, file_name)
            with open(target, "wb") as f:
                f.write(b"RMM-SIMULATED-INSTALLER\n")
                f.write((payload.get("configJson") or "").encode())
            build["sizeBytes"] = os.path.getsize(target)
            build["status"] = "ready"
            log_line(build, "Build de teste concluido.")
            _persist(build)
            return

        agent_exe = ensure_agent_exe(build)
        shutil.copy(agent_exe, os.path.join(d, "dist", "RmmAgent.exe"))
        log_line(build, "Rodando o Inno Setup (ISCC) sob Wine para montar o instalador do site...")
        rc, out = run(["wine", ISCC, win_path(os.path.join(d, "RmmAgent.iss"))], timeout=900, cwd=d)
        tail = "\n".join(out.strip().splitlines()[-12:])
        if tail:
            log_line(build, tail)
        # O .iss nao define OutputDir: o Inno gera em <dir do .iss>\Output\
        candidates = [
            os.path.join(d, "Output", file_name),
            os.path.join(d, "installer-output", file_name),
            os.path.join(d, file_name),
        ]
        produced = next((c for c in candidates if os.path.exists(c)), None)
        if produced is None:
            for root, _dirs, files in os.walk(d):
                for name in files:
                    if name.lower() == file_name.lower() and root != d:
                        produced = os.path.join(root, name)
                        break
                if produced:
                    break
        if rc != 0 or produced is None:
            raise RuntimeError("O Inno Setup nao gerou o instalador. Saida: " + out[-1500:])
        target = os.path.join(d, file_name)
        if os.path.abspath(produced) != os.path.abspath(target):
            shutil.copy(produced, target)
        build["sizeBytes"] = os.path.getsize(target)
        build["status"] = "ready"
        log_line(build, f"Instalador pronto: {file_name} ({build['sizeBytes']} bytes).")
        _persist(build)
    except subprocess.TimeoutExpired:
        build["status"] = "failed"
        build["error"] = "A compilacao excedeu o tempo limite. Veja o log e tente de novo; se repetir, verifique os logs do servico builder (docker compose logs builder)."
        log_line(build, "TIMEOUT na compilacao.")
        _persist(build)
    except Exception as e:  # noqa: BLE001
        build["status"] = "failed"
        build["error"] = str(e)[:1200]
        log_line(build, "FALHA: " + str(e)[:800])
        _persist(build)


def tool_status():
    wine_ok = shutil.which("wine") is not None
    iscc_path = os.path.join(WINEPREFIX, "drive_c", "Program Files (x86)", "Inno Setup 6", "ISCC.exe")
    py_path = os.path.join(WINEPREFIX, "drive_c", "Program Files", "Python311", "python.exe")
    return {
        "ok": True,
        "wine": wine_ok,
        "innoSetup": os.path.exists(iscc_path),
        "windowsPython": os.path.exists(py_path),
        "agentExeCached": os.path.exists(CACHE_EXE),
        "simulate": SIMULATE,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # silencia o log padrao
        sys.stderr.write("[builder] " + (fmt % args) + "\n")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not SECRET:
            return True
        return self.headers.get("X-Builder-Secret", "") == SECRET

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, tool_status())
        m = re.match(r"^/builds/([A-Za-z0-9_-]{1,80})(/file)?$", self.path)
        if m:
            if not self._authorized():
                return self._json(401, {"error": "unauthorized"})
            build_id, is_file = m.group(1), m.group(2)
            build = _builds.get(build_id)
            data = None
            if build:
                data = {"buildId": build_id, "status": build["status"], "error": build.get("error", ""),
                        "logTail": build.get("log", "")[-4000:], "sizeBytes": build.get("sizeBytes", 0),
                        "fileName": build.get("fileName", "")}
            else:
                data = _load_persisted(build_id)
            if data is None:
                return self._json(404, {"error": "build not found"})
            if not is_file:
                return self._json(200, data)
            if data.get("status") != "ready" or not data.get("fileName"):
                return self._json(409, {"error": "build not ready"})
            path = os.path.join(_build_dir(build_id), data["fileName"])
            if not os.path.exists(path):
                return self._json(404, {"error": "file not found"})
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f'attachment; filename="{data["fileName"]}"')
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, length=1024 * 256)
            return
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/build":
            return self._json(404, {"error": "not found"})
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "invalid json"})
        build_id = str(payload.get("buildId") or "")
        if not SAFE_ID.match(build_id):
            return self._json(400, {"error": "invalid buildId"})
        if not payload.get("configJson") or not payload.get("innoSetup"):
            return self._json(400, {"error": "configJson e innoSetup sao obrigatorios"})
        with _lock:
            if build_id in _builds and _builds[build_id]["status"] == "building":
                return self._json(409, {"error": "build already running"})
            _builds[build_id] = {"buildId": build_id, "status": "building", "error": "",
                                 "log": "", "sizeBytes": 0, "fileName": payload.get("installerFileName", "")}
        t = threading.Thread(target=do_build, args=(build_id, payload), daemon=True)
        t.start()
        return self._json(202, {"accepted": True, "buildId": build_id})


if __name__ == "__main__":
    os.makedirs(BUILDS_DIR, exist_ok=True)
    print(f"[builder] ouvindo em 0.0.0.0:{PORT} builds={BUILDS_DIR} simulate={SIMULATE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
