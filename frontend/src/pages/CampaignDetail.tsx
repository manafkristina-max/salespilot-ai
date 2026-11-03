import { ArrowLeft, Play, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ICP } from "../api";
import { AgentLive, StartAgentModal } from "../components/AgentRunner";
import { IcpEditor } from "../components/IcpEditor";
import { ImportCsvModal } from "./Leads";
import { Button, Card, DemoBadge, Empty, ErrorState, PageHeader, ScorePill, Spinner, StageBadge, useAsync, useToast } from "../components/ui";

export default function CampaignDetail() {
  const id = Number(useParams().id);
  const { data, error, loading, reload } = useAsync(() => api.campaign(id), [id]);
  const products = useAsync(() => api.settings().then((s) => s.values.products), []);
  const [icp, setIcp] = useState<ICP | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { if (data) setIcp(data.icp); }, [data]);
  const onAgentFinished = useCallback(() => reload(), [reload]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} retry={reload} />;
  const c = data!;
  const dirty = icp && JSON.stringify(icp) !== JSON.stringify(c.icp);

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { toast("success", await fn()); reload(); } catch (e) { toast("error", (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div>
      <Link to="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-3.5 w-3.5" /> Кампании</Link>
      <PageHeader title={c.name} subtitle={c.description}
        actions={<>
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Импорт CSV</Button>
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === "run"} disabled={!c.leads?.length} title="Пересчитать оценки и подбор продукта по текущему ICP"
            onClick={() => act("run", async () => {
              const r = await api.runPipeline(id);
              return `Пересчитано: подходят ${r.qualified}, не подходят ${r.disqualified}, новых черновиков ${r.drafted}` + (r.errors.length ? `. Ошибок: ${r.errors.length}` : "");
            })}>Переоценить лиды</Button>
          <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => setAgentOpen(true)}>Запустить агента</Button>
        </>} />

      <AgentLive campaignId={id} jobId={jobId} onFinished={onAgentFinished} />
      <StartAgentModal open={agentOpen} onClose={() => setAgentOpen(false)} campaignId={id} onStarted={(j) => setJobId(j.id)} />

      <Card title="Профиль идеального клиента (ICP)" className="mb-4"
        actions={dirty ? <><Button size="sm" variant="ghost" onClick={() => setIcp(c.icp)}>Отменить</Button>
          <Button size="sm" variant="primary" loading={busy === "icp"} onClick={() => act("icp", async () => { await api.updateCampaign(id, { icp: icp! }); return "ICP сохранён. Перезапустите агентов, чтобы пересчитать оценки."; })}>Сохранить ICP</Button></> : null}>
        {icp && <IcpEditor value={icp} onChange={setIcp} products={products.data || []} />}
      </Card>

      <Card title={`Лиды кампании (${c.leads?.length ?? 0})`} bodyClass="p-0"
        actions={<Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={async () => {
          if (!confirm("Удалить кампанию? Лиды и письма кампании будут удалены; компании останутся в базе.")) return;
          await api.deleteCampaign(id); toast("success", "Кампания удалена"); nav("/campaigns");
        }}>Удалить</Button>}>
        {!c.leads?.length ? (
          <Empty title="В кампании нет лидов" hint="Нажмите «Запустить агента»: он найдёт компании в Wikidata, изучит ваши сайты или возьмёт демо-датасет. Можно также импортировать CSV." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-zinc-100 dark:border-zinc-800"><tr><th className="th">Компания</th><th className="th">Отрасль</th><th className="th">Страна</th><th className="th">Соответствие ICP</th><th className="th">Этап</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {c.leads.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => nav(`/companies/${l.company_id}?lead=${l.id}`)}>
                    <td className="td font-medium"><span className="mr-2">{l.name}</span>{!!l.is_demo && <DemoBadge />}</td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{l.industry || "—"}</td>
                    <td className="td text-zinc-600 dark:text-zinc-400">{l.country || "—"}</td>
                    <td className="td"><ScorePill score={l.score} confidence={l.confidence} /></td>
                    <td className="td"><StageBadge stage={l.stage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} campaignId={id} onDone={reload} />
    </div>
  );
}
