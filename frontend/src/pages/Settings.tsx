import { CheckCircle2, CircleDashed, Lock, Plug, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, SettingsValues } from "../api";
import { AGENT_LABEL, RUN_STATUS } from "./Dashboard";
import { useMode } from "../components/Layout";
import { Badge, Button, Card, cx, ErrorState, Field, fmtDate, PageHeader, Spinner, TagInput, useAsync, useToast } from "../components/ui";

const FACTOR_LABEL: Record<string, string> = { industry: "Соответствие отрасли", scale: "Масштаб", demand: "Сигналы спроса", tech: "Технологическая совместимость", data_quality: "Качество данных" };
const AGENTS = ["", "scout", "research", "qualifier", "sales", "writer", "sender", "reply_handler"];

export default function Settings() {
  const { data, error, loading, reload } = useAsync(api.settings, []);
  const [v, setV] = useState<SettingsValues | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const toast = useToast();
  const { refresh, publicDemo } = useMode();
  useEffect(() => { if (data) setV(structuredClone(data.values)); }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!v || !data) return null;

  const save = async (key: keyof SettingsValues, msg = "Сохранено") => {
    setSaving(key);
    try { await api.putSetting(key, v[key]); toast("success", msg); reload(); if (key === "mode") refresh(); }
    catch (e) { toast("error", (e as Error).message); } finally { setSaving(null); }
  };
  const dirty = (k: keyof SettingsValues) => JSON.stringify(v[k]) !== JSON.stringify(data.values[k]);
  const SaveBtn = ({ k }: { k: keyof SettingsValues }) => dirty(k) ? <Button size="sm" variant="primary" loading={saving === k} onClick={() => save(k)}>Сохранить</Button> : null;
  const totalW = Object.values(v.scoring_weights).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader title="Настройки" subtitle="ICP задаётся в каждой кампании. Здесь — модель оценки, внешние сервисы, правила согласования и журнал агентов."
        actions={v.mode === "demo" || publicDemo ? <Button variant="danger" onClick={async () => {
          if (!confirm("Удалить все данные и заново создать демо-кампанию?")) return;
          try { const r = await api.resetDemo(); toast("success", `Демо-данные пересозданы. ${r.message.split(".")[0]}`); reload(); refresh(); }
          catch (e) { toast("error", (e as Error).message); }
        }}>Сбросить демо-данные</Button> : null} />
      {publicDemo && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><b>Публичное демо.</b> Настройки доступны только для просмотра: изменить их можно в локальной копии проекта. Вернуть исходные демо-данные можно кнопкой «Сбросить демо-данные».</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Режим работы">
          <div className="grid grid-cols-2 gap-2">
            {(["demo", "live"] as const).map((m) => (
              <button key={m} onClick={() => setV({ ...v, mode: m })} className={cx("rounded-lg border p-3 text-left text-sm transition", v.mode === m ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-white dark:ring-white" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700")}>
                <div className="font-medium">{m === "demo" ? "Демо-режим" : "Рабочий режим"}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{m === "demo" ? "Без сетевых запросов, письма пишутся по шаблонам, отправка только симулируется." : "Подключаются внешние сервисы, настроенные в .env. Остальные работают как в демо."}</div>
              </button>
            ))}
          </div>
          {dirty("mode") && <div className="mt-3 flex justify-end"><Button variant="primary" size="sm" loading={saving === "mode"} onClick={() => save("mode", `Режим: ${v.mode}`)}>Применить режим</Button></div>}
          {v.mode === "live" && !data.env.smtp_configured && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Почта (SMTP) не настроена, поэтому даже в рабочем режиме письма будут только симулироваться.</p>}
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Plug className="h-4 w-4" /> Подключения и ИИ-сервисы</span>} bodyClass="p-0">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.integrations.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-2.5">
                {i.status === "connected" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : i.status === "error" ? <XCircle className="mt-0.5 h-4 w-4 text-red-500" /> : <CircleDashed className="mt-0.5 h-4 w-4 text-zinc-400" />}
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{i.name}</div><div className="text-xs text-zinc-500">{i.detail}</div></div>
                <Badge color={i.status === "connected" ? "green" : i.status === "mock" ? "amber" : i.status === "error" ? "red" : "gray"}>{({ connected: "подключено", mock: "шаблоны", disabled: "выключено", not_configured: "не настроено", error: "ошибка" } as Record<string, string>)[i.status] || i.status}</Badge>
              </li>
            ))}
          </ul>
          <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">Ключи и пароли задаются только в локальном файле <code>.env</code> (см. <code>.env.example</code>) и не отображаются в интерфейсе.</p>
        </Card>

        <Card title="Модель оценки соответствия ICP" actions={<>{(dirty("scoring_weights") || dirty("qualify_threshold")) && <Button size="sm" variant="primary" loading={saving === "scoring_weights"} onClick={async () => { await save("scoring_weights"); await save("qualify_threshold"); }}>Сохранить</Button>}</>}>
          <div className="space-y-3">
            {Object.entries(v.scoring_weights).map(([k, w]) => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-56 shrink-0">{FACTOR_LABEL[k] || k}</span>
                <input type="range" min={0} max={50} value={w} onChange={(e) => setV({ ...v, scoring_weights: { ...v.scoring_weights, [k]: Number(e.target.value) } })} className="flex-1 accent-indigo-600" />
                <span className="w-16 text-right tabular-nums text-zinc-500">{w} · {totalW ? Math.round((w / totalW) * 100) : 0}%</span>
              </div>
            ))}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
              <span className="w-56 shrink-0">Порог квалификации</span>
              <input type="range" min={0} max={100} value={v.qualify_threshold} onChange={(e) => setV({ ...v, qualify_threshold: Number(e.target.value) })} className="flex-1 accent-indigo-600" />
              <span className="w-16 text-right tabular-nums">{v.qualify_threshold}</span>
            </div>
            <p className="text-xs text-zinc-500">Факторы без данных засчитываются на 30% и снижают уверенность. При уверенности ниже 60% лид не квалифицируется. После изменения перезапустите агентов в кампании.</p>
            <Field label="Совместимые платформы (технологическая совместимость)"><TagInput value={v.compatible_tech} onChange={(x) => setV({ ...v, compatible_tech: x })} /></Field>
            <div className="flex justify-end"><SaveBtn k="compatible_tech" /></div>
          </div>
        </Card>

        <Card title="Согласование и отправка" actions={<SaveBtn k="approval" />}>
          <div className="space-y-3 text-sm">
            <label className="flex items-center justify-between gap-3 opacity-80"><span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Ручное одобрение каждого письма</span><input type="checkbox" checked disabled /></label>
            <label className="flex items-center justify-between gap-3"><span>Подтверждение перед каждой отправкой</span><input type="checkbox" checked={v.approval.require_send_confirmation} onChange={(e) => setV({ ...v, approval: { ...v.approval, require_send_confirmation: e.target.checked } })} /></label>
            <label className="flex items-center justify-between gap-3"><span className="font-medium text-red-600 dark:text-red-400">Приостановить все отправки</span><input type="checkbox" checked={v.approval.sending_paused} onChange={(e) => setV({ ...v, approval: { ...v.approval, sending_paused: e.target.checked } })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Мин. score для черновика"><input className="input" type="number" min={0} max={100} value={v.approval.min_score_to_draft} onChange={(e) => setV({ ...v, approval: { ...v.approval, min_score_to_draft: Number(e.target.value) } })} /></Field>
              <Field label="Дневной лимит отправок"><input className="input" type="number" min={0} value={v.approval.daily_send_limit} onChange={(e) => setV({ ...v, approval: { ...v.approval, daily_send_limit: Number(e.target.value) } })} /></Field>
            </div>
            <p className="text-xs text-zinc-500">Ручное одобрение заблокировано в MVP. Изменение одобренного письма снимает одобрение.</p>
          </div>
        </Card>

        <Card title="Продукты (каталог для подбора)" actions={<SaveBtn k="products" />}>
          <div className="space-y-4">
            {v.products.map((p, i) => (
              <div key={p.id} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="font-medium">{p.name}</div>
                <Field label="Ценностное предложение (используется в письме)"><textarea className="textarea" rows={2} value={p.value_prop} onChange={(e) => { const ps = [...v.products]; ps[i] = { ...p, value_prop: e.target.value }; setV({ ...v, products: ps }); }} /></Field>
                <Field label="Ключевые слова болей"><TagInput value={p.keywords} onChange={(k) => { const ps = [...v.products]; ps[i] = { ...p, keywords: k }; setV({ ...v, products: ps }); }} /></Field>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Подпись отправителя" actions={<SaveBtn k="sender" />}>
            <Field label="Подпись (подставляется в письма)"><textarea className="textarea" rows={4} value={v.sender.signature} onChange={(e) => setV({ ...v, sender: { ...v.sender, signature: e.target.value } })} /></Field>
          </Card>
          <Card title="Стоп-лист (не связываться)" actions={<SaveBtn k="do_not_contact" />}>
            <Field label="Email-адреса и домены" hint="Компании с этих доменов получают score 0; отправка на адреса блокируется. Отписки добавляются автоматически.">
              <TagInput value={v.do_not_contact} onChange={(x) => setV({ ...v, do_not_contact: x })} placeholder="domain.ru или name@domain.ru" />
            </Field>
          </Card>
        </div>
      </div>
      <AgentLogs />
    </div>
  );
}

function AgentLogs() {
  const [agent, setAgent] = useState("");
  const { data, loading, reload } = useAsync(() => api.runs(agent), [agent]);
  return (
    <Card title="Логи выполнения агентов" className="mt-4" bodyClass="p-0" actions={<>
      <select className="input h-7 w-44 text-xs" value={agent} onChange={(e) => setAgent(e.target.value)}>{AGENTS.map((a) => <option key={a} value={a}>{a ? AGENT_LABEL[a] : "Все агенты"}</option>)}</select>
      <Button size="sm" onClick={reload}>Обновить</Button></>}>
      <div id="logs" className="max-h-[28rem] overflow-y-auto">
        {loading && !data ? <Spinner /> : !data?.length ? <p className="px-4 py-8 text-center text-sm text-zinc-500">Логов нет</p> : (
          <table className="w-full">
            <thead className="sticky top-0 border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900"><tr><th className="th">Время</th><th className="th">Агент</th><th className="th">Статус</th><th className="th">Провайдер</th><th className="th">Сообщение</th><th className="th text-right">мс</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 font-mono text-xs dark:divide-zinc-800">
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{fmtDate(r.started_at)}</td>
                  <td className="px-3 py-1.5 font-sans">{AGENT_LABEL[r.agent] || r.agent}</td>
                  <td className="px-3 py-1.5"><Badge color={r.status === "success" ? "green" : r.status === "error" ? "red" : "amber"}>{RUN_STATUS[r.status] || r.status}</Badge></td>
                  <td className="px-3 py-1.5 text-zinc-500">{r.provider}</td>
                  <td className="px-3 py-1.5 font-sans">{r.message}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-500">{r.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
