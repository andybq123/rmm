import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { widgetId, widgetSize } from "./spaceTarget";

export function Widget() {
  const q = useQuery({
    queryKey: ["widget-summary"],
    queryFn: () => api.getWidgetSummary({}),
    refetchInterval: 30000,
  });
  const s = q.data;
  const isLarge = widgetSize === "large";
  return (
    <div className="flex h-screen w-screen flex-col p-3.5" style={{ background: "var(--bg)", color: "var(--text)" }} data-widget={widgetId ?? "default"} data-widget-size={widgetSize ?? "small"}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--dim)" }}>Frota RMM · RMM Console</p>
      {q.isPending && <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Carregando…</p>}
      {q.error && <p className="mt-2 text-sm" style={{ color: "var(--crit)" }}>Sem conexão com o painel</p>}
      {s && (
        <>
          <p className="mt-1 font-mono text-3xl font-semibold leading-none">
            {s.online + s.critical}<span className="text-base" style={{ color: "var(--dim)" }}>/{s.total} respondendo</span>
          </p>
          <div className="mt-2 flex gap-1" aria-hidden>
            <span className="h-2 rounded-full" style={{ flexGrow: Math.max(s.online, 0.001), background: "#22c55e" }} />
            <span className="h-2 rounded-full" style={{ flexGrow: Math.max(s.critical, 0.001), background: "#ef4444" }} />
            <span className="h-2 rounded-full" style={{ flexGrow: Math.max(s.unstable, 0.001), background: "#f59e0b" }} />
            <span className="h-2 rounded-full" style={{ flexGrow: Math.max(s.offline, 0.001), background: "#94a3b8" }} />
          </div>
          <p className="mt-2 text-xs font-semibold" style={{ color: s.activeAlerts ? "var(--crit)" : "var(--ok)" }}>
            {s.total === 0 ? "Nenhuma máquina cadastrada" : s.activeAlerts ? `⚠ ${s.activeAlerts} alerta(s) ativo(s)` : "✓ Sem alertas ativos"}
            {s.total > 0 ? ` · CPU ${s.avgCpu.toFixed(0)}% · RAM ${s.avgRam.toFixed(0)}%` : ""}
          </p>
          {isLarge && s.total > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs font-semibold">
              <li className="flex justify-between"><span style={{ color: "var(--ok)" }}>● Online</span><span className="font-mono">{s.online}</span></li>
              <li className="flex justify-between"><span style={{ color: "var(--crit)" }}>● Crítico</span><span className="font-mono">{s.critical}</span></li>
              <li className="flex justify-between"><span style={{ color: "var(--warn)" }}>● Instável</span><span className="font-mono">{s.unstable}</span></li>
              <li className="flex justify-between"><span style={{ color: "var(--dim)" }}>● Offline</span><span className="font-mono">{s.offline}</span></li>
            </ul>
          )}
          {isLarge && <p className="mt-auto text-[10px]" style={{ color: "var(--dim)" }}>Detalhes e comandos: abra o painel e faça login.</p>}
        </>
      )}
    </div>
  );
}
