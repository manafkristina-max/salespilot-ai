import { AlertCircle, ArrowLeft, CalendarPlus, ExternalLink, FileSearch, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, CompanyDetail, Lead, Match, ScoreDetail } from "../api";
import { useMode } from "../components/Layout";
import { Badge, Button, Card, cx, DemoBadge, EmailStatus, Empty, ErrorState, Field, fmtDate, Modal, PageHeader, Spinner, StageBadge, useAsync, useToast, VERIFICATION } from "../components/ui";

const MISSING_LABEL: Record<string, string> = {
  industry: "отрасль", country: "страна", employees: "численность", sku_count: "кол-во SKU", tech: "техстек",
  facts: "факты исследования", contact: "контактное лицо", website: "сайт", company_type: "тип компании",
};
const KIND: Record<string, string> = { pain: "Боль", signal: "Сигнал", info: "Инфо", tech: "Техно" };

export default function CompanyPage() {
  const id = Number(useParams().id);
  const [sp, setSp] = useSearchParams();
  const { data, error, loading, reload } = useAsync(() => api.company(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [factOpen, setFactOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const { mode } = useMode();

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const c = data as CompanyDetail;
  const leadId = Number(sp.get("lead")) || c.leads[0]?.id;
  const lead = c.leads.find((l) => l.id === leadId);

  const act = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try { const m = await fn(); if (m) toast("success", m); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div>
      <button onClick={() => nav(-1)} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-3.5 w-3.5" /> Назад</button>
      <PageHeader
        title={<span className="flex items-center gap-2">{c.name} {c.is_demo && <DemoBadge />}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {c.domain ? (c.is_demo ? <span title="Домен в зоне .test не существует">{c.domain} (вымышленный домен)</span>
            : <a href={c.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-600 hover:underline">{c.domain}<ExternalLink className="h-3 w-3" /></a>) : "Сайт не указан"}
          <span>Источник: {c.source === "demo_dataset" ? "демо-датасет" : c.source === "csv" ? "CSV-импорт" : "вручную"}</span>
          <span>Исследована: {fmtDate(c.researched_at)}</span>
        </span>}
        actions={<>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
            if (!confirm(`Удалить «${c.name}» со всеми фактами, контактами и письмами?`)) return;
            try { await api.deleteCompany(id); toast("success", "Компания удалена"); nav("/leads"); } catch (e) { toast("error", (e as Error).message); }
          }}>Удалить</Button>
          <Button icon={<FileSearch className="h-4 w-4" />} loading={busy === "research"} onClick={() => act("research", async () => (await api.research(id)).message)}>Research Agent</Button>
          {lead && <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === "qualify"} onClick={() => act("qualify", async () => { const r = await api.qualify(lead.id); return `ICP Fit Score: ${r.score}/100`; })}>Пересчитать score</Button>}
        </>} />

      {c.leads.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {c.leads.map((l) => (
            <button key={l.id} onClick={() => setSp({ lead: String(l.id) })} className={cx("rounded-lg border px-2.5 py-1 text-xs", l.id === leadId ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-200 dark:border-zinc-700")}>
              {l.campaign_name} · {l.score ?? "—"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {lead ? <ScoreCard lead={lead} /> : (
            <Card title="ICP Fit Score"><Empty title="Компания не входит ни в одну кампанию" hint="Score рассчитывается относительно ICP кампании. Добавьте компанию в кампанию." action={<AttachButton companyId={id} onDone={reload} />} /></Card>
          )}
          {lead && Object.keys(lead.match).length > 0 && <MatchCard match={lead.match as Match} />}

          <Card title={`Факты и источники (${c.facts.length})`} bodyClass="p-0"
            actions={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFactOpen(true)}>Добавить факт</Button>}>
            {c.facts.length === 0 ? <Empty title="Фактов нет" hint={c.is_demo ? "В демо-датасете для этой компании нет фактов." : mode === "demo" ? "В Demo mode сайты не загружаются. Добавьте факт вручную со ссылкой на источник или включите live-исследование в .env." : "Запустите Research Agent или добавьте факт вручную."} /> : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {c.facts.map((f) => (
                  <li key={f.id} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Badge color={f.kind === "pain" ? "red" : f.kind === "signal" ? "violet" : "gray"}>{KIND[f.kind] || f.kind}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{f.text}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                          {f.source_url && (c.is_demo ? <span className="truncate">{f.source_url}</span> :
                            <a href={f.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 truncate text-brand-600 hover:underline">{f.source_label || f.source_url}<ExternalLink className="h-3 w-3" /></a>)}
                          <span>Проверка: {fmtDate(f.checked_at)}</span>
                          {f.evidence && <span className="italic">«{f.evidence}»</span>}
                        </div>
                        {f.verification_note && <p className="mt-0.5 text-xs text-zinc-400">{f.verification_note}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge color={VERIFICATION[f.verification]?.color}>{VERIFICATION[f.verification]?.label || f.verification}</Badge>
                        {!c.is_demo && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" loading={busy === `v${f.id}`} onClick={() => act(`v${f.id}`, async () => { const r = await api.verifyFact(f.id); return `Проверка: ${VERIFICATION[r.verification]?.label}`; })}>Проверить по ссылке</Button>
                            {f.verification !== "verified" && <Button size="sm" variant="ghost" title="Я проверил источник сам" onClick={() => act(`m${f.id}`, async () => { await api.markFact(f.id, "verified"); return "Отмечено как проверенное вручную"; })}><ShieldCheck className="h-3.5 w-3.5" /></Button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {lead && (
            <Card title="Outreach" actions={<>
              <Button size="sm" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setMeetingOpen(true)}>Отметить встречу</Button>
              <Button size="sm" variant="primary" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy === "draft"}
                onClick={() => act("draft", async () => {
                  let e;
                  try { e = await api.draft(lead.id); } catch (err) {
                    if (!(err as Error).message.includes("ниже порога") || !confirm(`${(err as Error).message}. Всё равно сгенерировать?`)) throw err;
                    e = await api.draft(lead.id, { force: true });
                  }
                  nav(`/outreach/${e.id}`);
                })}>Сгенерировать письмо</Button>
            </>} bodyClass="p-0">
              {lead.emails.length === 0 && lead.meetings.length === 0 ? <Empty title="Писем пока нет" hint="Writer Agent подготовит черновик на основе фактов с источниками." /> : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {lead.emails.map((e) => (
                    <li key={e.id}><Link to={`/outreach/${e.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span><EmailStatus status={e.status} mode={e.send_mode} /><span className="text-xs text-zinc-400">{fmtDate(e.updated_at)}</span>
                    </Link></li>
                  ))}
                  {lead.meetings.map((m) => (
                    <li key={`m${m.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm"><CalendarPlus className="h-4 w-4 text-emerald-500" /><span className="flex-1">Встреча {m.scheduled_for || ""} {m.note && `— ${m.note}`}</span><Badge color={c.is_demo ? "amber" : "green"}>{c.is_demo ? "демо" : "ручной ввод"}</Badge></li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Профиль" actions={<Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditOpen(true)}>Изменить</Button>}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
              {[["Отрасль", c.industry], ["Тип", c.company_type], ["Страна", c.country], ["Город", c.city], ["Сотрудники", c.employees], ["SKU", c.sku_count], ["Выручка", c.revenue_band]].map(([k, v]) => (
                <div key={k as string}><dt className="text-xs text-zinc-500">{k}</dt><dd className={cx("break-words", (v == null || v === "") && "text-zinc-400")}>{v == null || v === "" ? "нет данных" : v}</dd></div>
              ))}
            </dl>
            {c.description && <p className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">{c.description}</p>}
            <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="mb-1.5 text-xs text-zinc-500">Технологический стек</div>
              <div className="flex flex-wrap gap-1">{c.tech.length ? c.tech.map((t) => <Badge key={t} color="blue">{t}</Badge>) : <span className="text-sm text-zinc-400">не определён</span>}</div>
            </div>
          </Card>
          <Card title={`Контакты (${c.contacts.length})`} actions={<Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setContactOpen(true)}>Добавить</Button>} bodyClass="p-0">
            {c.contacts.length === 0 ? (
              <div className="px-4 py-5 text-sm text-zinc-500">
                <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span>Контактов нет. SalesPilot не генерирует имена и email-адреса — добавьте контакт вручную с указанием источника.</span></div>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {c.contacts.map((p) => (
                  <li key={p.id} className="px-4 py-2.5 text-sm"><div className="font-medium">{p.full_name}</div><div className="text-xs text-zinc-500">{[p.title, p.email].filter(Boolean).join(" · ") || "—"}</div><div className="mt-0.5 text-[11px] text-zinc-400">Источник: {p.source_note}</div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <AddFactModal open={factOpen} onClose={() => setFactOpen(false)} companyId={id} isDemo={c.is_demo} onDone={reload} />
      <AddContactModal open={contactOpen} onClose={() => setContactOpen(false)} companyId={id} onDone={reload} />
      <EditCompanyModal open={editOpen} onClose={() => setEditOpen(false)} company={c} onDone={reload} />
      {lead && <MeetingModal open={meetingOpen} onClose={() => setMeetingOpen(false)} leadId={lead.id} isDemo={c.is_demo} onDone={reload} />}
    </div>
  );
}

function ScoreCard({ lead }: { lead: Lead }) {
  const s = lead.score_detail as ScoreDetail;
  if (!s || s.score === undefined) {
    return <Card title={`ICP Fit Score · ${lead.campaign_name}`}><Empty title="Score ещё не рассчитан" hint="Нажмите «Пересчитать score» или запустите агентов в кампании." /></Card>;
  }
  return (
    <Card title={<span className="flex items-center gap-2">ICP Fit Score · {lead.campaign_name} <StageBadge stage={lead.stage} /></span>}
      actions={<span className="text-xs text-zinc-400">рассчитан {fmtDate(s.scored_at)}</span>}>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight">{s.score}<span className="text-lg text-zinc-400">/100</span></div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            {s.qualified ? <Badge color="green">Квалифицирован</Badge> : <Badge color="red">Не квалифицирован</Badge>}
            <span className="text-zinc-500">порог {s.threshold ?? 60}</span>
          </div>
        </div>
        <div className="min-w-[12rem] flex-1">
          <div className="flex justify-between text-xs text-zinc-500"><span>Уверенность</span><span className="tabular-nums">{Math.round(s.confidence * 100)}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={cx("h-full rounded-full", s.confidence >= 0.8 ? "bg-emerald-500" : s.confidence >= 0.6 ? "bg-amber-500" : "bg-red-400")} style={{ width: `${s.confidence * 100}%` }} /></div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{s.summary}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {s.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{f.label} {f.missing_data && <Badge color="amber" title="Нет данных: засчитано консервативно (30%)">нет данных</Badge>}</span>
              <span className="tabular-nums text-zinc-500">{f.points} / {f.max_points}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={cx("h-full rounded-full", f.missing_data ? "bg-zinc-300 dark:bg-zinc-600" : "bg-brand-500")} style={{ width: `${f.max_points ? (f.points / f.max_points) * 100 : 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">{f.explanation}</p>
          </div>
        ))}
      </div>
      {!!s.knockouts?.length && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <b>Стоп-критерии ICP:</b> {s.knockouts.join("; ")}. Лид не квалифицируется независимо от суммы баллов.
        </div>
      )}
      {s.missing.length > 0 && (
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          <b>Недостающие данные:</b> {s.missing.map((m) => MISSING_LABEL[m] || m).join(", ")}. Заполните их, чтобы повысить уверенность оценки.
        </div>
      )}
    </Card>
  );
}

function MatchCard({ match }: { match: Match }) {
  return (
    <Card title="Sales Agent: подбор продукта">
      <div className="flex items-center gap-2 text-sm">Рекомендуемый продукт: <Badge color="violet">{match.recommended_name || "—"}</Badge><span className="text-xs text-zinc-500">({match.reason})</span></div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{match.rationale}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {match.ranking.map((r) => (
          <div key={r.product_id} className={cx("rounded-lg border p-2.5 text-xs", r.product_id === match.recommended ? "border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/30" : "border-zinc-200 dark:border-zinc-800")}>
            <div className="flex justify-between font-medium"><span>{r.product}</span><span className="tabular-nums">{r.strength}</span></div>
            <div className="mt-1 text-zinc-500">{r.matched.length ? `совпадений с фактами: ${r.matched.length}` : "совпадений нет"}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AttachButton({ companyId, onDone }: { companyId: number; onDone: () => void }) {
  const { data } = useAsync(api.campaigns, []);
  const [cid, setCid] = useState("");
  const toast = useToast();
  useEffect(() => { if (data?.[0]) setCid(String(data[0].id)); }, [data]);
  if (!data?.length) return <Link to="/campaigns"><Button>Создать кампанию</Button></Link>;
  return (
    <div className="flex gap-2">
      <select className="input w-56" value={cid} onChange={(e) => setCid(e.target.value)}>{data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <Button variant="primary" onClick={async () => { try { await api.attach(Number(cid), [companyId]); toast("success", "Добавлено в кампанию"); onDone(); } catch (e) { toast("error", (e as Error).message); } }}>Добавить</Button>
    </div>
  );
}

function AddFactModal({ open, onClose, companyId, isDemo, onDone }: { open: boolean; onClose: () => void; companyId: number; isDemo: boolean; onDone: () => void }) {
  const blank = { kind: "pain", text: "", source_url: "", source_label: "", evidence: "" };
  const [v, setV] = useState(blank);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setSaving(true);
    try { await api.addFact(companyId, v); toast("success", "Факт добавлен"); setV(blank); onClose(); onDone(); }
    catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Добавить факт"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} disabled={!v.text || !v.source_url} onClick={submit}>Добавить</Button></>}>
      <div className="space-y-3">
        {isDemo && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Компания демонстрационная: факт будет помечен как демо.</p>}
        <Field label="Тип"><select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="pain">Боль</option><option value="signal">Сигнал спроса</option><option value="info">Информация</option><option value="tech">Технология</option></select></Field>
        <Field label="Утверждение *"><textarea className="textarea" rows={2} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <Field label="Ссылка на источник *" hint="Без источника факт не принимается"><input className="input" placeholder="https://…" value={v.source_url} onChange={(e) => setV({ ...v, source_url: e.target.value })} /></Field>
        <Field label="Фрагмент-доказательство" hint="Точная цитата со страницы — по ней Research Agent проверит факт"><input className="input" value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AddContactModal({ open, onClose, companyId, onDone }: { open: boolean; onClose: () => void; companyId: number; onDone: () => void }) {
  const blank = { full_name: "", title: "", email: "", source_note: "" };
  const [v, setV] = useState(blank);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setSaving(true);
    try { await api.addContact(companyId, v); toast("success", "Контакт добавлен"); setV(blank); onClose(); onDone(); }
    catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Добавить контакт"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} disabled={!v.full_name || v.source_note.length < 3} onClick={submit}>Добавить</Button></>}>
      <div className="space-y-3">
        <Field label="Имя и фамилия *"><input className="input" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="Должность"><input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Источник контакта *" hint="Например: «визитка с выставки», «страница команды на сайте», «LinkedIn, публичный профиль». Убедитесь, что у вас есть законное основание для контакта."><input className="input" value={v.source_note} onChange={(e) => setV({ ...v, source_note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function EditCompanyModal({ open, onClose, company, onDone }: { open: boolean; onClose: () => void; company: CompanyDetail; onDone: () => void }) {
  const [v, setV] = useState({ industry: "", company_type: "", country: "", city: "", employees: "", sku_count: "", revenue_band: "", description: "" });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) setV({ industry: company.industry, company_type: company.company_type, country: company.country, city: company.city, employees: company.employees?.toString() ?? "", sku_count: company.sku_count?.toString() ?? "", revenue_band: company.revenue_band, description: company.description });
  }, [open, company]);
  const submit = async () => {
    setSaving(true);
    try { await api.updateCompany(company.id, { ...v, employees: v.employees === "" ? null : Number(v.employees), sku_count: v.sku_count === "" ? null : Number(v.sku_count) }); toast("success", "Профиль обновлён. Пересчитайте score."); onClose(); onDone(); }
    catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };
  const field = (k: keyof typeof v, label: string, type = "text") => <Field label={label}><input className="input" type={type} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <Modal open={open} onClose={onClose} title="Профиль компании" wide footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} onClick={submit}>Сохранить</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        {field("industry", "Отрасль")}{field("company_type", "Тип компании")}{field("country", "Страна")}{field("city", "Город")}
        {field("employees", "Сотрудники", "number")}{field("sku_count", "SKU", "number")}{field("revenue_band", "Выручка")}{field("description", "Описание")}
      </div>
    </Modal>
  );
}

function MeetingModal({ open, onClose, leadId, isDemo, onDone }: { open: boolean; onClose: () => void; leadId: number; isDemo: boolean; onDone: () => void }) {
  const [v, setV] = useState({ scheduled_for: "", note: "" });
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Отметить встречу"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={async () => { try { await api.meeting(leadId, v); toast("success", "Встреча записана"); onClose(); onDone(); } catch (e) { toast("error", (e as Error).message); } }}>Сохранить</Button></>}>
      <div className="space-y-3">
        {isDemo && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Компания демонстрационная — встреча будет учтена как демо и не попадёт в реальные метрики.</p>}
        <Field label="Дата и время"><input className="input" type="datetime-local" value={v.scheduled_for} onChange={(e) => setV({ ...v, scheduled_for: e.target.value })} /></Field>
        <Field label="Заметка"><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
