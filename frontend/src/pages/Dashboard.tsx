import { Activity, Bot, Building2, CalendarCheck, CheckCircle2, FileText, MessageSquare, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { api, Dashboard as D, FunnelStep } from "../api";
import { DemoNotice } from "../components/Layout";
import { Badge, Button, Card, Empty, ErrorState, fmtDate, PageHeader, Spinner, Stat, useAsync } from "../components/ui";

const STATUS_COLOR = { success: "green", error: "red", skipped: "amber" } as const;

export default function Dashboard() {
  const { data, error, loading, reload } = useAsync(api.dashboard, []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const d = data as D;
  const empty = d.companies.total === 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Состояние воронки и агентов. Реальные и демонстрационные показатели разделены."
        actions={<><Link to="/campaigns?new=1"><Button variant="primary">Новая кампания</Button></Link></>} />
      {d.mode === "demo" && (
        <DemoNotice><b>Demo mode.</b> Компании из демо-датасета вымышлены (домены .test), письма не отправляются — только симуляция. Реальные показатели считаются отдельно.</DemoNotice>
      )}
      {empty ? (
        <Card><Empty title="Пока нет компаний" hint="Создайте кампанию, задайте ICP и запустите Scout Agent на демо-датасете, либо импортируйте CSV со своими лидами."
          action={<Link to="/campaigns?new=1"><Button variant="primary">Создать кампанию</Button></Link>} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Компании" icon={<Building2 className="h-4 w-4" />} value={d.companies.total} sub={<Split real={d.companies.real} demo={d.companies.demo} />} />
            <Stat label="Квалифицированы" icon={<CheckCircle2 className="h-4 w-4" />} value={d.qualified.real + d.qualified.demo} sub={<Split real={d.qualified.real} demo={d.qualified.demo} />} />
            <Stat label="Черновики" icon={<FileText className="h-4 w-4" />} value={d.drafts} sub={`${d.needs_review} на ревью · ${d.approved} одобрено`} />
            <Stat label="Отправки (реальные)" icon={<Send className="h-4 w-4" />} value={d.sent.live} sub={`симуляций: ${d.sent.simulated}`} />
            <Stat label="Ответы (реальные)" icon={<MessageSquare className="h-4 w-4" />} value={d.replies.live} sub={`на симуляции: ${d.replies.simulated}`} />
            <Stat label="Встречи" icon={<CalendarCheck className="h-4 w-4" />} value={d.meetings.real + d.meetings.demo} sub={<Split real={d.meetings.real} demo={d.meetings.demo} />} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card title="Конверсионная воронка (все данные)" className="lg:col-span-3" actions={<Link to="/analytics" className="text-xs text-brand-600 hover:underline">Подробнее →</Link>}>
              <Funnel steps={d.funnel} />
            </Card>
            <Card title="Агенты" className="lg:col-span-2" bodyClass="p-0">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {d.agents.map((a) => (
                  <li key={a.agent} className="flex items-start gap-3 px-4 py-2.5">
                    <Bot className="mt-0.5 h-4 w-4 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">{a.label}
                        {a.last ? <Badge color={STATUS_COLOR[a.last.status as keyof typeof STATUS_COLOR] || "gray"}>{a.last.status === "success" ? "ok" : a.last.status}</Badge> : <Badge>не запускался</Badge>}
                      </div>
                      <div className="truncate text-xs text-zinc-500" title={a.last?.message}>{a.provider}{a.last ? ` · ${fmtDate(a.last.started_at)}` : ""}</div>
                    </div>
                    <span className="text-xs tabular-nums text-zinc-400">{a.runs}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Последние действия агентов" className="mt-4" bodyClass="p-0" actions={<Link to="/settings#logs" className="text-xs text-brand-600 hover:underline">Все логи →</Link>}>
            {d.recent_runs.length === 0 ? <Empty title="Логов пока нет" icon={<Activity className="h-5 w-5" />} /> : (
              <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {d.recent_runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                    <Badge color={STATUS_COLOR[r.status as keyof typeof STATUS_COLOR] || "gray"}>{r.agent}</Badge>
                    <span className="min-w-0 flex-1 truncate" title={r.message}>{r.message}</span>
                    <span className="text-xs text-zinc-400">{fmtDate(r.started_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Split({ real, demo }: { real: number; demo: number }) {
  return <span>реальные: <b className="text-zinc-700 dark:text-zinc-300">{real}</b> · демо: {demo}</span>;
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.key} className="flex items-center gap-3 text-sm">
          <div className="w-36 shrink-0 text-zinc-600 dark:text-zinc-400">{s.label}</div>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-md bg-brand-500/80 transition-all" style={{ width: `${(s.count / max) * 100}%` }} />
          </div>
          <div className="w-10 text-right font-semibold tabular-nums">{s.count}</div>
          <div className="w-16 text-right text-xs tabular-nums text-zinc-500">{s.conversion == null ? "" : `${s.conversion}%`}</div>
        </div>
      ))}
    </div>
  );
}
