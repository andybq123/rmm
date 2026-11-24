#!/usr/bin/env python3
"""
RMM Agent — Windows (compilado em RmmAgent.exe com PyInstaller)  v1.0.0

Agente GENÉRICO: este executável é compilado UMA vez pelo serviço
"builder" da VPS (Wine + PyInstaller) e vale para qualquer site.
A configuração do site (serverUrl + enrollmentToken) NÃO fica embutida
no .exe: ela vem do config.json que o instalador (Inno Setup) grava em
%ProgramData%\\RmmAgent\\config.json — é esse arquivo, gerado pelo painel
para o site escolhido, que personaliza cada instalação.

Uso direto (sem instalador):
  - coloque um config.json ao lado do executável ou em
    %ProgramData%\\RmmAgent\\config.json com:
      {"serverUrl": "https://<dominio>/actions",
       "enrollmentToken": "rmm_...", "siteName": "...", "intervalSeconds": 60}
  - execute RmmAgent.exe (ele se registra e envia métricas a cada 60s)

Argumentos de serviço (chamados pelo instalador Inno Setup):
  --install-service   cria o serviço do Windows "RmmAgent" (sc.exe)
  --start-service     inicia o serviço
  --remove-service    para e remove o serviço (desinstalação)
Sem argumentos, roda o loop de monitoramento em primeiro plano.
"""
import json, os, platform, socket, subprocess, sys, time, urllib.request

AGENT_VERSION = "1.0.0"
SERVICE_NAME = "RmmAgent"
STATE_NAME = ".rmm-agent.json"

CONFIG = {}
SERVER_URL = os.environ.get("RMM_SERVER_URL", "")
ENROLLMENT_TOKEN = os.environ.get("RMM_ENROLLMENT_TOKEN", "")
INTERVAL = 60


def _config_candidates():
    candidates = []
    pd = os.environ.get("ProgramData")
    if pd:
        candidates.append(os.path.join(pd, "RmmAgent", "config.json"))
    try:
        candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"))
    except Exception:
        pass
    try:
        candidates.append(os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "config.json"))
    except Exception:
        pass
    candidates.append(os.path.join(os.getcwd(), "config.json"))
    return candidates


def _load_config():
    global CONFIG, SERVER_URL, ENROLLMENT_TOKEN, INTERVAL
    for path in _config_candidates():
        try:
            if os.path.exists(path):
                data = json.loads(open(path, encoding="utf-8").read())
                if isinstance(data, dict):
                    CONFIG = data
                    break
        except Exception:
            continue
    if CONFIG.get("serverUrl"):
        SERVER_URL = str(CONFIG["serverUrl"]).rstrip("/")
        if not SERVER_URL.endswith("/actions"):
            SERVER_URL += "/actions"
    if CONFIG.get("enrollmentToken"):
        ENROLLMENT_TOKEN = str(CONFIG["enrollmentToken"])
    try:
        INTERVAL = int(CONFIG.get("intervalSeconds") or 60)
    except Exception:
        INTERVAL = 60


def _state_path():
    pd = os.environ.get("ProgramData")
    if pd:
        d = os.path.join(pd, "RmmAgent")
        try:
            os.makedirs(d, exist_ok=True)
            return os.path.join(d, "device.json")
        except Exception:
            pass
    return os.path.join(os.path.expanduser("~"), STATE_NAME)


def post(action, args):
    body = json.dumps({"action": action, "args": args}).encode()
    req = urllib.request.Request(SERVER_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "{}")


def ip_addr():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


try:
    import psutil  # type: ignore
except ImportError:
    psutil = None


def static_info():
    total_ram = 0
    total_disk = 0.0
    cpu_model = platform.processor() or platform.machine()
    cpu_cores = os.cpu_count() or 1
    if psutil:
        total_ram = int(psutil.virtual_memory().total / 1048576)
        try:
            total_disk = round(psutil.disk_usage("C:\\" if os.name == "nt" else "/").total / 1073741824, 1)
        except Exception:
            pass
    if os.name == "nt":
        try:
            import winreg  # type: ignore
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_model = str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip() or cpu_model
        except Exception:
            pass
    os_name = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}.get(platform.system(), "unknown")
    return {
        "enrollmentToken": ENROLLMENT_TOKEN, "hostname": socket.gethostname(),
        "os": os_name, "osVersion": f"{platform.system()} {platform.release()} {platform.version()}"[:120],
        "arch": platform.machine(), "ipAddress": ip_addr(), "macAddress": "",
        "agentVersion": AGENT_VERSION, "cpuModel": cpu_model,
        "cpuCores": cpu_cores, "totalRamMb": total_ram, "totalDiskGb": total_disk,
    }


def metrics():
    if psutil:
        vm = psutil.virtual_memory()
        du = psutil.disk_usage("C:\\" if os.name == "nt" else "/")
        return {"cpuPercent": psutil.cpu_percent(interval=1), "ramPercent": vm.percent,
                "ramUsedMb": int(vm.used / 1048576), "diskPercent": du.percent,
                "diskUsedGb": round(du.used / 1073741824, 1),
                "uptimeSeconds": int(time.time() - psutil.boot_time())}
    uptime = 0
    if os.path.exists("/proc/uptime"):
        uptime = int(float(open("/proc/uptime").read().split()[0]))
    load = os.getloadavg()[0] / (os.cpu_count() or 1) * 100 if hasattr(os, "getloadavg") else 0
    return {"cpuPercent": round(load, 1), "ramPercent": 0, "ramUsedMb": 0,
            "diskPercent": 0, "diskUsedGb": 0, "uptimeSeconds": uptime}


def run_loop():
    _load_config()
    if not SERVER_URL or not ENROLLMENT_TOKEN:
        raise SystemExit(
            "[rmm-agent] config.json nao encontrado ou incompleto. "
            "Instale pelo instalador gerado no painel (ele grava o config.json do site) "
            "ou defina RMM_SERVER_URL e RMM_ENROLLMENT_TOKEN."
        )
    state = _state_path()
    if os.path.exists(state):
        device = json.load(open(state, encoding="utf-8"))
    else:
        device = post("registerDevice", static_info())
        json.dump(device, open(state, "w", encoding="utf-8"))
        print(f"[rmm-agent] Registrado: {device.get('deviceId')}")
    print(f"[rmm-agent] Enviando a cada {INTERVAL}s para {SERVER_URL}")
    while True:
        try:
            m = metrics()
            m.update({"deviceId": device["deviceId"], "agentToken": device["agentToken"], "ipAddress": ip_addr()})
            post("reportMetrics", m)
            poll = post("pollCommands", {"deviceId": device["deviceId"], "agentToken": device["agentToken"]})
            for cmd in poll.get("commands", []):
                status, result = "executed", "ok"
                try:
                    if cmd["type"] == "run_script" and cmd.get("payload"):
                        result = subprocess.run(cmd["payload"], shell=True, capture_output=True, text=True, timeout=120).stdout[-2000:]
                    elif cmd["type"] == "collect_info":
                        result = subprocess.run("systeminfo" if os.name == "nt" else "uname -a", shell=True, capture_output=True, text=True).stdout[-2000:]
                    elif cmd["type"] == "reboot":
                        subprocess.Popen(["shutdown", "/r", "/t", "5"] if os.name == "nt" else ["shutdown", "-r", "now"])
                    elif cmd["type"] == "shutdown":
                        subprocess.Popen(["shutdown", "/s", "/t", "5"] if os.name == "nt" else ["shutdown", "-h", "now"])
                except Exception as e:
                    status, result = "failed", str(e)
                post("reportCommandResult", {"deviceId": device["deviceId"], "agentToken": device["agentToken"],
                                             "commandId": cmd["id"], "status": status, "result": result})
        except Exception as e:
            print(f"[rmm-agent] falha: {e}")
        time.sleep(INTERVAL)


# ---------- Serviço do Windows (via sc.exe, sem dependências extras) ----------
def _sc(*args):
    return subprocess.run(["sc.exe", *args], capture_output=True, text=True)


def service_command(arg):
    exe = os.path.abspath(sys.executable)
    if arg == "--install-service":
        # binPath precisa apontar para o exe instalado (Program Files)
        r = _sc("create", SERVICE_NAME, f"binPath= \"{exe}\"", "start= auto", "DisplayName= RMM Agent")
        print(r.stdout, r.stderr)
        _sc("description", SERVICE_NAME, "Agente de monitoramento RMM")
        return 0
    if arg == "--start-service":
        r = _sc("start", SERVICE_NAME)
        print(r.stdout, r.stderr)
        return 0
    if arg == "--remove-service":
        _sc("stop", SERVICE_NAME)
        r = _sc("delete", SERVICE_NAME)
        print(r.stdout, r.stderr)
        return 0
    return None


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("--install-service", "--start-service", "--remove-service"):
        sys.exit(service_command(sys.argv[1]) or 0)
    run_loop()
