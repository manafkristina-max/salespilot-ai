import { Megaphone, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ICP } from "../api";
import { EMPTY_ICP, ICP_PRESET, IcpEditor } from "../components/IcpEditor";
import { Badge, Button, Card, Empty, ErrorState, Field, fmtDate, Modal, PageHeader, Spinner, useAsync, useToast } from "../components/ui";

export default function Campaigns() {
  const { data, error, loading, reload } = useAsync(api.campaigns, []);
  const products = useAsync(() => api.settings().then((s) => s.values.products), []);
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");

  return (
    <div>
      <PageHeader title="Кампании" subtitle="Кампания = ICP + набор лидов + письма. Каждая кампания оценивает компании по своему ICP."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Новая кампания</Button>} />
      {loading && !data ? <Spinner /> : error ? <ErrorState error={error} retry={reload} /> : data!.length === 0 ? (
        <Card><Empty icon={<Megaphone className="h-5 w-5" />} title="Нет кампаний" hint="Создайте первую кампанию и настройте Ideal Customer Profile."
          action={<Button variant="primary" onClick={() => setOpen(true)}>Создать кампанию</Button>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data!.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="card block p-4 transition hover:border-zinc-300 dark:hover:border-zinc-700">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{c.name}</div>
                <Badge color={c.status === "active" ? "green" : "gray"}>{c.status === "active" ? "Активна" : c.status === "paused" ? "Пауза" : "Архив"}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-zinc-500">{c.description || "Без описания"}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.icp.industries.slice(0, 3).map((i) => <Badge key={i}>{i}</Badge>)}
                {c.icp.industries.length > 3 && <Badge>+{c.icp.industries.length - 3}</Badge>}
              </div>
              <div className="mt-4 grid grid-cols-3 border-t border-zinc-100 pt-3 text-center text-xs text-zinc-500 dark:border-zinc-800">
                <div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{c.stats?.leads ?? 0}</div>лидов</div>
                <div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{c.stats?.qualified ?? 0}</div>квалиф.</div>
                <div><div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{c.stats?.avg_score ?? "—"}</div>ср. оценка</div>
              </div>
              <div className="mt-2 text-[11px] text-zinc-400">Создана {fmtDate(c.created_at)}</div>
            </Link>
          ))}
        </div>
      )}
      <CreateCampaign open={open} onClose={() => setOpen(false)} products={products.data || []} />
    </div>
  );
}

function CreateCampaign({ open, onClose, products }: { open: boolean; onClose: () => void; products: { id: string; name: string }[] }) {
  const [name, setName] = useState("E-commerce бренды — Rich Content / PIM");
  const [description, setDescription] = useState("Бренды-производители с большим ассортиментом на маркетплейсах");
  const [icp, setIcp] = useState<ICP>(ICP_PRESET);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const submit = async () => {
    setSaving(true);
    try {
      const c = await api.createCampaign({ name, description, icp });
      toast("success", "Кампания создана");
      nav(`/campaigns/${c.id}`);
    } catch (e) { toast("error", (e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Новая кампания" wide
      footer={<><Button variant="ghost" onClick={() => setIcp(EMPTY_ICP)}>Очистить ICP</Button><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} disabled={!name.trim()} onClick={submit}>Создать</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Название"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Описание"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <h4 className="mb-3 text-sm font-semibold">Профиль идеального клиента (ICP)</h4>
          <IcpEditor value={icp} onChange={setIcp} products={products} />
        </div>
      </div>
    </Modal>
  );
}
