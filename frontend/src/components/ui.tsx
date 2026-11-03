import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

export const cx = clsx;

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
        variant === "secondary" && "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        variant === "danger" && "border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950",
        variant === "success" && "bg-emerald-600 text-white hover:bg-emerald-700",
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const BADGE: Record<string, string> = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900",
};

export function Badge({ color = "gray", children, className, title }: { color?: keyof typeof BADGE; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", BADGE[color], className)}>
      {children}
    </span>
  );
}

export function DemoBadge() {
  return <Badge color="amber" title="Демонстрационные данные: компания и факты вымышлены">DEMO</Badge>;
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Spinner({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, hint, action, icon }: { title: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 rounded-full bg-zinc-100 p-3 text-zinc-400 dark:bg-zinc-800">{icon || <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-md text-sm text-zinc-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card flex items-start gap-3 border-red-200 p-4 text-sm dark:border-red-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      <div className="flex-1"><p className="font-medium text-red-700 dark:text-red-400">Не удалось загрузить данные</p><p className="text-zinc-600 dark:text-zinc-400">{error}</p></div>
      {retry && <Button size="sm" onClick={retry}>Повторить</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className={cx("card w-full", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Закрыть"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium text-zinc-500"><span>{label}</span>{icon}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function ScorePill({ score, confidence }: { score: number | null | undefined; confidence?: number | null }) {
  if (score === null || score === undefined) return <span className="text-xs text-zinc-400">—</span>;
  const color = score >= 75 ? "bg-emerald-500" : score >= 60 ? "bg-lime-500" : score >= 40 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2" title={confidence != null ? `Уверенность ${Math.round(confidence * 100)}%` : undefined}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={cx("h-full rounded-full", color)} style={{ width: `${score}%` }} /></div>
      <span className="w-7 text-sm font-semibold tabular-nums">{score}</span>
      {confidence != null && confidence < 0.6 && <Badge color="gray" title="Мало данных для уверенной оценки">низк. увер.</Badge>}
    </div>
  );
}

export const STAGE_LABEL: Record<string, string> = {
  new: "Новый", researched: "Исследован", qualified: "Квалифицирован", disqualified: "Не подходит",
  drafted: "Черновик", approved: "Одобрено", sent: "Отправлено", replied: "Ответ", meeting: "Встреча",
};
const STAGE_COLOR: Record<string, keyof typeof BADGE> = {
  new: "gray", researched: "blue", qualified: "green", disqualified: "red", drafted: "violet",
  approved: "green", sent: "blue", replied: "amber", meeting: "green",
};
export function StageBadge({ stage }: { stage: string }) {
  return <Badge color={STAGE_COLOR[stage] || "gray"}>{STAGE_LABEL[stage] || stage}</Badge>;
}

export const EMAIL_STATUS: Record<string, { label: string; color: keyof typeof BADGE }> = {
  draft: { label: "Draft", color: "gray" },
  needs_review: { label: "Needs Review", color: "amber" },
  approved: { label: "Approved", color: "green" },
  rejected: { label: "Rejected", color: "red" },
  sent: { label: "Sent", color: "blue" },
};
export function EmailStatus({ status, mode }: { status: string; mode?: string | null }) {
  const s = EMAIL_STATUS[status] || { label: status, color: "gray" as const };
  return (
    <span className="inline-flex items-center gap-1">
      <Badge color={s.color}>{s.label}</Badge>
      {status === "sent" && mode === "simulated" && <Badge color="amber" title="Ничего не отправлено: симуляция">симуляция</Badge>}
      {status === "sent" && mode === "live" && <Badge color="green">реально</Badge>}
    </span>
  );
}

export const VERIFICATION: Record<string, { label: string; color: keyof typeof BADGE }> = {
  verified: { label: "Проверено", color: "green" },
  unverified: { label: "Не проверено", color: "amber" },
  not_found: { label: "Не подтверждено", color: "red" },
  demo: { label: "Демо-источник", color: "gray" },
};

export function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------------- toasts
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx("card pointer-events-auto flex items-start gap-2 px-3.5 py-3 text-sm", t.kind === "error" && "border-red-200 dark:border-red-900")}>
            {t.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            <span className="flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------- data hook
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fn().then(setData).catch((e) => setError(e.message || String(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function TagInput({ value, onChange, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (s: string) => {
    const t = s.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const rest = (suggestions || []).filter((s) => !value.includes(s));
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="text-zinc-400 hover:text-zinc-700" aria-label={`Убрать ${v}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input
          className="h-6 min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          value={draft}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {rest.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rest.slice(0, 10).map((s) => (
            <button type="button" key={s} onClick={() => add(s)} className="rounded-md border border-dashed border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
