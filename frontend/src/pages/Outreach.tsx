import { Download, Mail } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, qs } from "../api";
import { Button, Card, cx, DemoBadge, EMAIL_STATUS, EmailStatus, Empty, ErrorState, fmtDate, PageHeader, ScorePill, Spinner, useAsync } from "../components/ui";

const TABS = ["", "draft", "needs_review", "approved", "rejected", "sent"];

export default function Outreach() {
  const [status, setStatus] = useState("");
  const [campaign, setCampaign] = useState("");
  const { data, error, loading, reload } = useAsync(() => api.emails({ status, campaign_id: campaign || null }), [status, campaign]);
  const all = useAsync(() => api.emails({}), []);
  const campaigns = useAsync(api.campaigns, []);
  const nav = useNavigate();
  const counts = (all.data || []).reduce<Record<string, number>>((a, e) => ({ ...a, [e.status]: (a[e.status] || 0) + 1 }), {});

  return (
    <div>
      <PageHeader title="Outreach" subtitle="Каждое исходящее письмо проходит ручное одобрение. Без одобрения отправка невозможна."
        actions={<a href={`/api/export/emails.csv${qs({ status, campaign_id: campaign })}`}><Button icon={<Download className="h-4 w-4" />}>Экспорт CSV</Button></a>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
          {TABS.map((t) => (
            <button key={t || "all"} onClick={() => setStatus(t)} className={cx("rounded-md px-2.5 py-1 text-xs font-medium", status === t ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800")}>
              {t ? EMAIL_STATUS[t].label : "Все"} <span className="ml-0.5 opacity-60">{t ? counts[t] || 0 : all.data?.length || 0}</span>
            </button>
          ))}
        </div>
        <select className="input w-60" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Кампания">
          <option value="">Все кампании</option>{(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Card bodyClass="p-0">
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorState error={error} retry={reload} /></div> : data!.length === 0 ? (
          <Empty icon={<Mail className="h-5 w-5" />} title="Писем нет" hint="Запустите агентов в кампании или сгенерируйте письмо из карточки компании." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-100 dark:border-zinc-800"><tr><th className="th">Тема</th><th className="th">Компания</th><th className="th">Получатель</th><th className="th">Score</th><th className="th">Статус</th><th className="th">Обновлено</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data!.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => nav(`/outreach/${e.id}`)}>
                    <td className="td max-w-md"><div className="truncate font-medium">{e.subject}</div><div className="truncate text-xs text-zinc-500">{e.campaign_name}</div></td>
                    <td className="td"><span className="mr-1.5">{e.company_name}</span>{e.is_demo && <DemoBadge />}</td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{e.to_email || <span className="text-amber-600">не указан</span>}</td>
                    <td className="td"><ScorePill score={e.score} /></td>
                    <td className="td"><EmailStatus status={e.status} mode={e.send_mode} /></td>
                    <td className="td text-xs text-zinc-500">{fmtDate(e.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
