import { AlertTriangle, ArrowLeft, Check, ExternalLink, History, MessageSquare, RotateCcw, Save, Send, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, EmailDetail } from "../api";
import { Badge, Button, Card, DemoBadge, EmailStatus, Empty, ErrorState, Field, fmtDate, Modal, PageHeader, Spinner, useAsync, useToast, VERIFICATION } from "../components/ui";

const REPLY_LABEL: Record<string, { label: string; color: "green" | "red" | "amber" | "gray" | "violet" }> = {
  interested: { label: "Интерес", color: "green" }, objection: { label: "Возражение", color: "amber" },
  not_interested: { label: "Не интересно", color: "red" }, unsubscribe: { label: "Отписка", color: "red" },
  out_of_office: { label: "Автоответ", color: "gray" }, other: { label: "Другое", color: "violet" },
};

export default function EmailPage() {
  const id = Number(useParams().id);
  const { data, error, loading, reload, setData } = useAsync(() => api.email(id), [id]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reply, setReply] = useState("");
  const toast = useToast();

  useEffect(() => { if (data) { setSubject(data.subject); setBody(data.body); } }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const e = data as EmailDetail;
  const dirty = subject !== e.subject || body !== e.body;
  const editable = e.status !== "sent";

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast("success", msg); const fresh = await api.email(id); setData(fresh); return true; }
    catch (err) { toast("error", (err as Error).message); return false; } finally { setBusy(null); }
  };
  const save = () => act("save", () => api.updateEmail(id, { subject, body }), e.status === "approved" ? "Сохранено. Одобрение снято — нужно повторное ревью." : "Изменения сохранены");

  return (
    <div>
      <Link to="/outreach" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-3.5 w-3.5" /> Outreach</Link>
      <PageHeader title={<span className="flex items-center gap-2">Письмо #{e.id} <EmailStatus status={e.status} mode={e.send_mode} /></span>}
        subtitle={<span><Link to={`/companies/${e.company_id}?lead=${e.lead_id}`} className="text-brand-600 hover:underline">{e.company_name}</Link> {e.is_demo && <DemoBadge />} · {e.campaign_name} · Writer: {e.provider === "mock" ? "mock-шаблон" : e.provider}</span>}
        actions={editable ? <>
          {e.status === "rejected" && <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy === "reopen"} onClick={() => act("reopen", () => api.emailAction(id, "reopen"), "Письмо возвращено в черновики")}>Вернуть в черновики</Button>}
          {e.status === "draft" && <Button loading={busy === "submit"} disabled={dirty} onClick={() => act("submit", () => api.emailAction(id, "submit"), "Отправлено на ревью")}>На ревью</Button>}
          {["draft", "needs_review", "approved"].includes(e.status) && <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setRejectOpen(true)}>Отклонить</Button>}
          {["draft", "needs_review"].includes(e.status) && <Button variant="success" icon={<Check className="h-4 w-4" />} loading={busy === "approve"} disabled={dirty} title={dirty ? "Сначала сохраните изменения" : ""} onClick={() => act("approve", () => api.emailAction(id, "approve"), "Письмо одобрено")}>Одобрить</Button>}
          {e.status === "approved" && <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={dirty || !e.readiness.can_send} onClick={() => setSendOpen(true)}>{e.readiness.will_be_live ? "Отправить" : "Симулировать отправку"}</Button>}
        </> : null} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {e.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {e.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</div>)}
            </div>
          )}
          <Card title="Текст письма" actions={editable && dirty ? <><Button size="sm" variant="ghost" onClick={() => { setSubject(e.subject); setBody(e.body); }}>Отменить</Button><Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={busy === "save"} onClick={save}>Сохранить</Button></> : null}>
            <div className="space-y-3">
              <Field label="Получатель">
                {editable ? (
                  <select className="input" value={e.contact_id ?? ""} onChange={(ev) => act("contact", () => api.updateEmail(id, ev.target.value ? { contact_id: Number(ev.target.value) } : { clear_contact: true }), "Получатель обновлён")}>
                    <option value="">— не указан —</option>
                    {e.contacts.map((c) => <option key={c.id} value={c.id} disabled={!c.email}>{c.full_name}{c.email ? ` <${c.email}>` : " (нет email)"}</option>)}
                  </select>
                ) : <div className="text-sm">{e.to_email || "не указан"}</div>}
                {e.contacts.length === 0 && editable && <span className="mt-1 block text-xs text-zinc-500">Контактов нет — добавьте контакт с источником в <Link className="text-brand-600 hover:underline" to={`/companies/${e.company_id}`}>карточке компании</Link>.</span>}
              </Field>
              <Field label="Тема"><input className="input" value={subject} disabled={!editable} onChange={(ev) => setSubject(ev.target.value)} maxLength={200} /></Field>
              <Field label="Текст"><textarea className="textarea font-[inherit] leading-relaxed" rows={14} value={body} disabled={!editable} onChange={(ev) => setBody(ev.target.value)} /></Field>
            </div>
          </Card>

          <Card title={`Проверяемые утверждения (${e.claims.length})`} bodyClass="p-0">
            {e.claims.length === 0 ? <Empty title="В письме нет утверждений о компании" /> : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {e.claims.map((c) => (
                  <li key={c.n} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className="mt-0.5 rounded bg-zinc-100 px-1.5 text-xs font-semibold dark:bg-zinc-800">[{c.n}]</span>
                    <div className="min-w-0 flex-1"><p>{c.text}</p>
                      {e.is_demo ? <span className="text-xs text-zinc-500">{c.source_url}</span> : <a href={c.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">{c.source_url}<ExternalLink className="h-3 w-3" /></a>}
                    </div>
                    <Badge color={VERIFICATION[c.verification]?.color}>{VERIFICATION[c.verification]?.label || c.verification}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {e.status === "sent" && (
            <Card title="Ответы" bodyClass="p-0">
              {e.replies.length > 0 && (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {e.replies.map((r) => (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <div className="mb-1 flex items-center gap-2"><Badge color={REPLY_LABEL[r.classification]?.color}>{REPLY_LABEL[r.classification]?.label || r.classification}</Badge><span className="text-xs text-zinc-500">уверенность {Math.round(r.confidence * 100)}% · {r.rationale} · {r.source === "manual" ? "введено вручную" : r.source} · {fmtDate(r.received_at)}</span></div>
                      <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 border-t border-zinc-100 p-4 dark:border-zinc-800">
                <p className="text-xs text-zinc-500">Почтовый ящик не подключён: вставьте текст полученного ответа — Reply Handler классифицирует его. {e.send_mode === "simulated" && "Письмо было симуляцией, поэтому ответ будет учтён как демо."}</p>
                <textarea className="textarea" rows={3} value={reply} onChange={(ev) => setReply(ev.target.value)} placeholder="Текст ответа…" />
                <Button size="sm" icon={<MessageSquare className="h-3.5 w-3.5" />} disabled={!reply.trim()} loading={busy === "reply"} onClick={async () => { if (await act("reply", () => api.reply(id, reply), "Ответ классифицирован")) setReply(""); }}>Классифицировать ответ</Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Готовность к отправке">
            <ul className="space-y-1.5 text-sm">
              <Check2 ok={e.status === "approved" || e.status === "sent"} text="Письмо одобрено вручную" />
              {e.readiness.blockers.filter((b) => b !== "Письмо не одобрено").map((b) => <Check2 key={b} ok={false} text={b} />)}
            </ul>
            <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
              {e.readiness.will_be_live ? <span className="text-emerald-700 dark:text-emerald-400">Письмо будет отправлено реально через SMTP после подтверждения.</span> : (
                <div className="flex gap-2"><ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" /><span>Реальная отправка невозможна: {e.readiness.live_blockers.join(", ")}. Будет выполнена только симуляция.</span></div>
              )}
            </div>
            {e.sent_at && <p className="mt-3 text-xs text-zinc-500">Отправлено {fmtDate(e.sent_at)} · {e.send_mode === "simulated" ? "симуляция, ничего не отправлено" : "SMTP"} · id {e.message_id}</p>}
            {e.rejected_reason && <p className="mt-3 text-xs text-red-600">Причина отклонения: {e.rejected_reason}</p>}
          </Card>
          <Card title={<span className="flex items-center gap-1.5"><History className="h-4 w-4" /> История изменений</span>} bodyClass="p-0">
            <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {e.versions.map((v) => (
                <li key={v.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between"><span className="font-medium">v{v.version} · {ACTION[v.action] || v.action}</span><span className="text-zinc-400">{fmtDate(v.created_at)}</span></div>
                  <div className="text-zinc-500">{v.author === "user" ? "пользователь" : "Writer Agent"} · статус {v.status}{v.note ? ` · ${v.note}` : ""}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Отклонить письмо"
        footer={<><Button onClick={() => setRejectOpen(false)}>Отмена</Button><Button variant="danger" loading={busy === "reject"} onClick={async () => { if (await act("reject", () => api.emailAction(id, "reject", reason), "Письмо отклонено")) { setRejectOpen(false); setReason(""); } }}>Отклонить</Button></>}>
        <Field label="Причина (необязательно)"><input className="input" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Например: неверный продукт, слабая персонализация" autoFocus /></Field>
      </Modal>
      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title={e.readiness.will_be_live ? "Подтвердите реальную отправку" : "Симуляция отправки"}
        footer={<><Button onClick={() => setSendOpen(false)}>Отмена</Button><Button variant="primary" loading={busy === "send"} onClick={async () => { if (await act("send", () => api.send(id), e.readiness.will_be_live ? "Письмо отправлено" : "Симуляция выполнена: ничего не отправлено")) setSendOpen(false); }}>{e.readiness.will_be_live ? "Да, отправить это письмо" : "Выполнить симуляцию"}</Button></>}>
        <div className="space-y-2 text-sm">
          {e.readiness.will_be_live ? <p>Письмо будет <b>реально отправлено</b> на <b>{e.to_email}</b> через SMTP. Это действие нельзя отменить.</p>
            : <p>Реальная отправка выключена ({e.readiness.live_blockers.join(", ")}). Письмо получит статус Sent с пометкой «симуляция»; оно <b>не попадёт</b> в реальные метрики.</p>}
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60"><div className="font-medium">{e.subject}</div><div className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-500">{e.body}</div></div>
        </div>
      </Modal>
    </div>
  );
}

const ACTION: Record<string, string> = { created: "создано", edited: "изменено", submit: "на ревью", approve: "одобрено", reject: "отклонено", reopen: "возвращено", sent: "отправлено" };

function Check2({ ok, text }: { ok: boolean; text: string }) {
  return <li className="flex items-center gap-2">{ok ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-red-500" />}<span className={ok ? "" : "text-zinc-600 dark:text-zinc-400"}>{text}</span></li>;
}
