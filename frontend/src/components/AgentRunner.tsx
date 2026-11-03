import { Bot, Brain, CheckCircle2, CircleDashed, Database, Globe, Square, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCaps, api, Job, JobEvent } from "../api";
import { Badge, Button, cx, Field, fmtDate, Modal, useToast } from "./ui";

const AGENT: Record<string, string> = {
  orchestrator: "Оркестратор", scout: "Поиск", research: "Исследование", qualifier: "Квалификация",
  sales: "Подбор продукта", writer: "Автор писем", sender: "Отправка",
};
const LEVEL_COLOR = { info: "gray", success: "green", warn: "amber", error: "red" } as const;
const STATUS: Record<Job["status"], { label: string; color: "gray" | "blue" | "green" | "amber" | "red" }> = {
  queued: { label: "В очереди", color: "gray" }, running: { label: "Работает", color: "blue" },
  done: { label: "Готово", color: "green" }, cancelled: { label: "Остановлено", color: "amber" },
  error: { label: "Ошибка", color: "red" }, interrupted: { label: "Прервано перезапуском", color: "amber" },
};
const SOURCE_LABEL: Record<string, string> = { wikidata: "Wikidata", domains: "ваши сайты", demo: "демо-датасет" };

/** Start dialog: where to take companies from and how many. */
export function StartAgentModal({ open, onClose, campaignId, onStarted }: { open: boolean; onClose: () => void; campaignId: number; onStarted: (j: Job) => void }) {
  const [caps, setCaps] = useState<AgentCaps | null>(null);
  const [source, setSource] = useState("wikidata");
  const [limit, setLimit] = useState(5);
  const [domains, setDomains] = useState("");
  const [write, setWrite] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.agentCaps().then((c) => {
      setCaps(c);
      if (!c.sources.wikidata.available) setSource(c.sources.domains.available ? "domains" : "demo");
    }).catch((e) => toast("error", e.message));
  }, [open, toast]);

  const start = async () => {
    setBusy(true);
    try { const j = await api.startAgent(campaignId, { source, limit, domains, write }); onStarted(j); onClose(); }
    catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };

  const options = [
    { id: "wikidata", icon: Database, title: "Найти компании в Wikidata", text: "Реальные компании по отраслям и странам из ICP, с официальными сайтами" },
    { id: "domains", icon: Globe, title: "Мои сайты", text: "Вставьте список сайтов — агент изучит и оценит каждую компанию" },
    { id: "demo", icon: Bot, title: "Демо-датасет", text: "14 вымышленных компаний, без сети — для быстрого показа" },
  ] as const;

  return (
    <Modal open={open} onClose={onClose} title="Запустить агента" wide
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} disabled={!caps || !caps.sources[source as keyof AgentCaps["sources"]]?.available || (source === "domains" && !domains.trim())} onClick={start}>Запустить</Button></>}>
      {!caps ? <p className="text-sm text-zinc-500">Проверяю, что доступно агенту…</p> : (
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3">
            {options.map(({ id, icon: Icon, title, text }) => {
              const av = caps.sources[id];
              return (
                <button key={id} type="button" disabled={!av.available} onClick={() => setSource(id)}
                  className={cx("rounded-lg border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                    source === id ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-white dark:ring-white" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700")}>
                  <Icon className="mb-1.5 h-4 w-4 text-brand-600" />
                  <div className="font-medium">{title}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{av.available ? text : av.reason}</div>
                </button>
              );
            })}
          </div>
          {source === "wikidata" && (
            <Field label={`Сколько компаний найти: ${limit}`} hint="Каждая компания — чтение до 4 страниц сайта и 1–2 вызова Claude, примерно 20–60 секунд">
              <input type="range" min={1} max={15} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-indigo-600" />
            </Field>
          )}
          {source === "domains" && (
            <Field label="Сайты компаний" hint="По одному в строке или через запятую, до 25">
              <textarea className="textarea" rows={4} placeholder={"brand.ru\nshop.example.kz"} value={domains} onChange={(e) => setDomains(e.target.value)} />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} /> Сразу готовить черновики писем для подходящих компаний</label>
          <div className="grid gap-2 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60 md:grid-cols-2">
            <Cap icon={Globe} title="Чтение сайтов" av={caps.research} />
            <Cap icon={Brain} title={`Анализ и письма: ${caps.brain.provider}`} av={caps.brain} />
          </div>
          <p className="text-xs text-zinc-500">Агент ничего не отправляет: письма остаются черновиками до вашего одобрения. Контактные лица не собираются и не придумываются.</p>
        </div>
      )}
    </Modal>
  );
}

function Cap({ icon: Icon, title, av }: { icon: typeof Globe; title: string; av: { available: boolean; reason: string } }) {
  return (
    <div className="flex items-start gap-2">
      {av.available ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />}
      <div><div className="flex items-center gap-1 font-medium"><Icon className="h-3 w-3" />{title}</div><div className="text-zinc-500">{av.reason}</div></div>
    </div>
  );
}

/** Live feed of the latest agent run in a campaign. */
export function AgentLive({ campaignId, jobId, onFinished }: { campaignId: number; jobId: number | null; onFinished: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  const lastId = useRef(0);
  const feed = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const load = useCallback(async (id: number, reset = false) => {
    if (reset) { lastId.current = 0; setEvents([]); }
    const j = await api.job(id, lastId.current);
    if (j.events?.length) { lastId.current = j.events[j.events.length - 1].id; setEvents((e) => [...e, ...j.events!]); }
    setJob(j);
    return j;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = jobId ?? (await api.campaignJobs(campaignId))[0]?.id;
      if (!id || cancelled) return;
      let j = await load(id, true);
      while (!cancelled && (j.status === "queued" || j.status === "running")) {
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;
        j = await load(id);
        if (j.status !== "queued" && j.status !== "running") onFinished();
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId, jobId, load, onFinished]);

  const running = job?.status === "running" || job?.status === "queued";
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [events.length]);

  if (!job) return null;
  const st = STATUS[job.status];
  const pct = job.progress_total ? Math.round((job.progress_done / job.progress_total) * 100) : running ? 5 : 100;
  const started = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  const end = job.finished_at ? new Date(job.finished_at).getTime() : now;
  const secs = Math.max(0, Math.round((end - started) / 1000));

  return (
    <section className="card mb-4 overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {running ? <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600" /></span>
            : job.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
          Агент · {SOURCE_LABEL[job.params.source] || job.params.source}
        </div>
        <Badge color={st.color}>{st.label}</Badge>
        <span className="text-xs tabular-nums text-zinc-500">{job.progress_done}/{job.progress_total || "…"} компаний · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
        <span className="text-xs text-zinc-400">запуск {fmtDate(job.created_at)}</span>
        <div className="ml-auto">
          {running && <Button size="sm" variant="danger" icon={<Square className="h-3 w-3" />} onClick={async () => { await api.cancelJob(job.id); toast("info", "Останавливаю после текущего шага…"); }}>Остановить</Button>}
        </div>
      </header>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-800"><div className={cx("h-full transition-all duration-500", job.status === "error" ? "bg-red-500" : "bg-brand-500")} style={{ width: `${pct}%` }} /></div>
      <div ref={feed} className="max-h-80 overflow-y-auto px-4 py-2 font-mono text-[12.5px] leading-relaxed">
        {events.map((e) => (
          <div key={e.id} className="flex gap-2 py-0.5">
            <span className="shrink-0 tabular-nums text-zinc-400">{new Date(e.ts).toLocaleTimeString("ru-RU")}</span>
            <Badge color={LEVEL_COLOR[e.level]} className="shrink-0 font-sans">{AGENT[e.agent] || e.agent}</Badge>
            <span className={cx("font-sans", e.level === "error" && "text-red-600 dark:text-red-400", e.level === "success" && "text-emerald-700 dark:text-emerald-400")}>
              {e.company && <b className="font-medium">{e.company}: </b>}{e.message}
            </span>
          </div>
        ))}
        {running && <div className="py-1 font-sans text-zinc-400">…</div>}
      </div>
      {!running && job.summary && job.status !== "interrupted" && (
        <div className="flex flex-wrap gap-4 border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <span>Найдено: <b>{job.summary.found ?? 0}</b></span><span>Подходят: <b>{job.summary.qualified ?? 0}</b></span>
          <span>Не подходят: <b>{job.summary.disqualified ?? 0}</b></span><span>Черновиков: <b>{job.summary.drafted ?? 0}</b></span>
          {!!job.summary.errors && <span className="text-red-600">Ошибок: <b>{job.summary.errors}</b></span>}
        </div>
      )}
    </section>
  );
}
