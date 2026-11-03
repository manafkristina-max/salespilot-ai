import { Building2, Download, Plus, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, qs } from "../api";
import { Badge, Button, Card, DemoBadge, Empty, ErrorState, Field, Modal, PageHeader, ScorePill, Spinner, STAGE_LABEL, StageBadge, useAsync, useToast } from "../components/ui";

type Filters = { search: string; industry: string; country: string; campaign_id: string; min_score: string; data: string; stage: string };
const INIT: Filters = { search: "", industry: "", country: "", campaign_id: "", min_score: "", data: "all", stage: "" };

export default function Leads() {
  const [f, setF] = useState<Filters>(INIT);
  const [q, setQ] = useState(INIT);
  useEffect(() => { const t = setTimeout(() => setQ(f), 250); return () => clearTimeout(t); }, [f]);
  const { data, error, loading, reload } = useAsync(() => api.companies(q), [JSON.stringify(q)]);
  const all = useAsync(() => api.companies({}), []);
  const campaigns = useAsync(api.campaigns, []);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const nav = useNavigate();

  const options = useMemo(() => {
    const rows = all.data || [];
    return {
      industries: [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort(),
      countries: [...new Set(rows.map((r) => r.country).filter(Boolean))].sort(),
    };
  }, [all.data]);
  const set = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }));
  const active = JSON.stringify(f) !== JSON.stringify(INIT);
  const refresh = () => { reload(); all.reload(); };

  return (
    <div>
      <PageHeader title="Lead Discovery" subtitle="Все компании в базе. Score показан лучший по кампаниям; подробности — в карточке."
        actions={<>
          <a href={`/api/export/companies.csv${qs({ ...q, stage: undefined })}`}><Button icon={<Download className="h-4 w-4" />}>Экспорт CSV</Button></a>
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Импорт CSV</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>Добавить компанию</Button>
        </>} />

      <Card bodyClass="p-3" className="mb-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <input className="input pl-8" placeholder="Название, домен, описание…" value={f.search} onChange={(e) => set("search", e.target.value)} />
          </div>
          <select className="input" value={f.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} aria-label="Кампания">
            <option value="">Все кампании</option>
            {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={f.industry} onChange={(e) => set("industry", e.target.value)} aria-label="Отрасль">
            <option value="">Все отрасли</option>{options.industries.map((i) => <option key={i}>{i}</option>)}
          </select>
          <select className="input" value={f.country} onChange={(e) => set("country", e.target.value)} aria-label="Страна">
            <option value="">Все страны</option>{options.countries.map((i) => <option key={i}>{i}</option>)}
          </select>
          <select className="input" value={f.min_score} onChange={(e) => set("min_score", e.target.value)} aria-label="Score">
            <option value="">Любой score</option><option value="40">≥ 40</option><option value="60">≥ 60</option><option value="75">≥ 75</option>
          </select>
          <select className="input" value={f.data} onChange={(e) => set("data", e.target.value)} aria-label="Тип данных">
            <option value="all">Все данные</option><option value="real">Только реальные</option><option value="demo">Только демо</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">Этап:</span>
          {["", "new", "qualified", "disqualified", "drafted", "approved", "sent", "replied", "meeting"].map((s) => (
            <button key={s || "all"} onClick={() => set("stage", s)} className={`rounded-md px-2 py-0.5 text-xs ${f.stage === s ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}>{s ? STAGE_LABEL[s] : "Все"}</button>
          ))}
          {active && <button onClick={() => setF(INIT)} className="ml-auto text-xs text-brand-600 hover:underline">Сбросить фильтры</button>}
        </div>
      </Card>

      <Card bodyClass="p-0">
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorState error={error} retry={reload} /></div> : data!.length === 0 ? (
          active ? <Empty title="Ничего не найдено" hint="Измените или сбросьте фильтры." action={<Button onClick={() => setF(INIT)}>Сбросить</Button>} />
            : <Empty icon={<Building2 className="h-5 w-5" />} title="В базе нет компаний" hint="Запустите Scout Agent в кампании, импортируйте CSV или добавьте компанию вручную." action={<Button variant="primary" onClick={() => setAddOpen(true)}>Добавить компанию</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-100 dark:border-zinc-800"><tr>
                <th className="th">Компания</th><th className="th">Отрасль</th><th className="th">Тип</th><th className="th">Гео</th>
                <th className="th text-right">Сотр.</th><th className="th text-right">SKU</th><th className="th">ICP Fit</th><th className="th">Этап</th><th className="th text-right">Факты</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data!.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => nav(`/companies/${c.id}`)}>
                    <td className="td">
                      <div className="flex items-center gap-2"><span className="font-medium">{c.name}</span>{c.is_demo && <DemoBadge />}</div>
                      <div className="text-xs text-zinc-500">{c.domain || "без сайта"}</div>
                    </td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{c.industry || "—"}</td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{c.company_type || "—"}</td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{[c.country, c.city].filter(Boolean).join(", ") || "—"}</td>
                    <td className="td text-right tabular-nums">{c.employees ?? "—"}</td>
                    <td className="td text-right tabular-nums">{c.sku_count ?? "—"}</td>
                    <td className="td"><ScorePill score={c.score} confidence={c.confidence} /></td>
                    <td className="td"><div className="flex flex-wrap gap-1">{(c.stages || "").split(",").filter(Boolean).map((s) => <StageBadge key={s} stage={s} />)}{!c.stages && <Badge>вне кампаний</Badge>}</div></td>
                    <td className="td text-right tabular-nums text-zinc-500">{c.fact_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">Показано: {data!.length}</div>
          </div>
        )}
      </Card>
      <AddCompanyModal open={addOpen} onClose={() => setAddOpen(false)} campaigns={campaigns.data || []} onDone={refresh} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} campaigns={campaigns.data || []} onDone={refresh} />
    </div>
  );
}

function AddCompanyModal({ open, onClose, campaigns, onDone }: { open: boolean; onClose: () => void; campaigns: { id: number; name: string }[]; onDone: () => void }) {
  const blank = { name: "", website: "", industry: "", company_type: "", country: "", city: "", employees: "", sku_count: "", description: "", campaign_id: "" };
  const [v, setV] = useState(blank);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = (k: keyof typeof blank, x: string) => setV((s) => ({ ...s, [k]: x }));
  const submit = async () => {
    setSaving(true);
    try {
      await api.addCompany({ ...v, employees: v.employees ? Number(v.employees) : null, sku_count: v.sku_count ? Number(v.sku_count) : null, campaign_id: v.campaign_id ? Number(v.campaign_id) : null });
      toast("success", "Компания добавлена"); setV(blank); onClose(); onDone();
    } catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Добавить компанию" wide
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} disabled={!v.name.trim()} onClick={submit}>Добавить</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Название *"><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="Сайт" hint="Используется для защиты от дубликатов"><input className="input" placeholder="https://brand.ru" value={v.website} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="Отрасль"><input className="input" value={v.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
        <Field label="Тип компании"><input className="input" placeholder="Бренд-производитель" value={v.company_type} onChange={(e) => set("company_type", e.target.value)} /></Field>
        <Field label="Страна"><input className="input" value={v.country} onChange={(e) => set("country", e.target.value)} /></Field>
        <Field label="Город"><input className="input" value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Сотрудников"><input className="input" type="number" min={0} value={v.employees} onChange={(e) => set("employees", e.target.value)} /></Field>
        <Field label="SKU"><input className="input" type="number" min={0} value={v.sku_count} onChange={(e) => set("sku_count", e.target.value)} /></Field>
        <Field label="Описание"><input className="input" value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Добавить в кампанию">
          <select className="input" value={v.campaign_id} onChange={(e) => set("campaign_id", e.target.value)}>
            <option value="">— не добавлять —</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

const SAMPLE = "name,website,industry,company_type,country,city,employees,sku_count,description,contact_name,contact_title,contact_email,contact_source\n";

export function ImportCsvModal({ open, onClose, campaignId, campaigns, onDone }: { open: boolean; onClose: () => void; campaignId?: number; campaigns?: { id: number; name: string }[]; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [cid, setCid] = useState<string>(campaignId ? String(campaignId) : "");
  const [result, setResult] = useState<{ created: number; duplicates: string[]; errors: string[]; attached: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const close = () => { setResult(null); setFile(null); onClose(); };
  const submit = async () => {
    if (!file) return;
    setSaving(true);
    try { const r = await api.importCsv(file, cid ? Number(cid) : null); setResult(r); onDone(); toast("success", `Импорт: создано ${r.created}, дубликатов ${r.duplicates.length}`); }
    catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={close} title="Импорт компаний из CSV"
      footer={result ? <Button variant="primary" onClick={close}>Готово</Button> : <><Button onClick={close}>Отмена</Button><Button variant="primary" loading={saving} disabled={!file} onClick={submit}>Импортировать</Button></>}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p>Создано компаний: <b>{result.created}</b>{(campaignId || cid) ? <> · добавлено в кампанию: <b>{result.attached}</b></> : null}</p>
          <p>Пропущено дубликатов: <b>{result.duplicates.length}</b>{result.duplicates.length > 0 && <span className="text-zinc-500"> ({result.duplicates.slice(0, 5).join(", ")}{result.duplicates.length > 5 ? "…" : ""})</span>}</p>
          {result.errors.length > 0 && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{result.errors.map((e) => <div key={e}>{e}</div>)}</div>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">Обязательная колонка — <code>name</code>. Дубликаты определяются по домену сайта и нормализованному названию. Контакты импортируются только если указаны в файле — система их не генерирует.</p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-2 text-[11px] dark:bg-zinc-800">{SAMPLE}</pre>
          <a className="text-xs text-brand-600 hover:underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="salespilot_template.csv">Скачать шаблон</a>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800" />
          {!campaignId && campaigns && (
            <Field label="Добавить в кампанию">
              <select className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
                <option value="">— не добавлять —</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
