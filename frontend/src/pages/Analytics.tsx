import { Download } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../api";
import { DemoNotice } from "../components/Layout";
import { Button, Card, cx, Empty, ErrorState, PageHeader, Spinner, useAsync } from "../components/ui";
import { Funnel } from "./Dashboard";

const SCOPES = [{ v: "real", l: "Реальные" }, { v: "demo", l: "Демо" }, { v: "all", l: "Все" }];

export default function Analytics() {
  const [scope, setScope] = useState("all");
  const [campaign, setCampaign] = useState("");
  const { data, error, loading, reload } = useAsync(() => api.analytics({ scope, campaign_id: campaign || null }), [scope, campaign]);
  const campaigns = useAsync(api.campaigns, []);

  return (
    <div>
      <PageHeader title="Аналитика" subtitle="Только измеряемые показатели из базы. ROI, выручка и прогнозы не рассчитываются: для них нет реальных данных."
        actions={<a href={`/api/export/analytics.csv${qs({ scope, campaign_id: campaign })}`}><Button icon={<Download className="h-4 w-4" />}>Экспорт CSV</Button></a>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
          {SCOPES.map((s) => <button key={s.v} onClick={() => setScope(s.v)} className={cx("rounded-md px-3 py-1 text-xs font-medium", scope === s.v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400")}>{s.l}</button>)}
        </div>
        <select className="input w-60" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Кампания">
          <option value="">Все кампании</option>{(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} retry={reload} /> : data && (
        <>
          {scope !== "real" && data.demo_leads > 0 && <DemoNotice>В выборке {data.demo_leads} демо-лидов: их отправки и ответы — симуляция. Для реальных результатов переключитесь на «Реальные».</DemoNotice>}
          {scope === "real" && data.real_leads === 0 && <DemoNotice>Реальных лидов пока нет. Импортируйте свои компании через CSV или добавьте вручную. Реальные отправки появятся только после подключения почты (SMTP) и включения рабочего режима.</DemoNotice>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Воронка и конверсии между этапами"><Funnel steps={data.funnel} /></Card>
            <Card title={`Распределение по оценке соответствия ICP${data.unscored ? ` · без оценки: ${data.unscored}` : ""}`}>
              {data.score_distribution.every((d) => d.count === 0) ? <Empty title="Нет оценённых лидов" /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.score_distribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
                      <XAxis dataKey="range" tick={{ fontSize: 12, fill: "#71717a" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#71717a" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "rgba(99,102,241,.08)" }} contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [v, "Лидов"]} />
                      <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
          <Card title="Статистика по кампаниям" className="mt-4" bodyClass="p-0">
            {data.campaigns.length === 0 ? <Empty title="Кампаний нет" /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-zinc-100 dark:border-zinc-800"><tr>
                    {["Кампания", "Лиды", "Квалиф.", "Ср. score", "Черновики", "Одобрено", "Отправлено (реал./сим.)", "Ответы (реал./сим.)", "Встречи"].map((h) => <th key={h} className="th">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="td font-medium">{c.name}</td><td className="td tabular-nums">{c.leads}</td><td className="td tabular-nums">{c.qualified}</td>
                        <td className="td tabular-nums">{c.avg_score ?? "—"}</td><td className="td tabular-nums">{c.drafts}</td><td className="td tabular-nums">{c.approved}</td>
                        <td className="td tabular-nums">{c.sent_live} / <span className="text-zinc-400">{c.sent_simulated}</span></td>
                        <td className="td tabular-nums">{c.replies_live} / <span className="text-zinc-400">{c.replies_simulated}</span></td>
                        <td className="td tabular-nums">{c.meetings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
