import { BarChart3, Building2, LayoutDashboard, Mail, Megaphone, Moon, Settings, Sun } from "lucide-react";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { Badge, cx } from "./ui";

const NAV = [
  { to: "/", label: "Обзор", icon: LayoutDashboard, end: true },
  { to: "/campaigns", label: "Кампании", icon: Megaphone },
  { to: "/leads", label: "Поиск лидов", icon: Building2 },
  { to: "/outreach", label: "Письма", icon: Mail },
  { to: "/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/settings", label: "Настройки", icon: Settings },
];

type ModeCtx = { mode: "demo" | "live" | null; refresh: () => void };
const Ctx = createContext<ModeCtx>({ mode: null, refresh: () => {} });
export const useMode = () => useContext(Ctx);

function useTheme() {
  const [dark, setDark] = useState(() => {
    const forced = new URLSearchParams(window.location.search).get("theme");
    if (forced) return forced === "dark";
    try { return localStorage.getItem("sp-theme") === "dark"; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("sp-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export function Layout() {
  const [dark, setDark] = useTheme();
  const [mode, setMode] = useState<"demo" | "live" | null>(null);
  const loc = useLocation();
  const refresh = () => api.dashboard().then((d) => setMode(d.mode)).catch(() => setMode(null));
  useEffect(() => { refresh(); }, [loc.pathname]);

  return (
    <Ctx.Provider value={{ mode, refresh }}>
      <div className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-3 py-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex">
          <div className="mb-6 flex items-center gap-2 px-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 32 32" className="h-5 w-5"><path d="M7 21l6-10 5 7 2.5-3.5L25 21" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">SalesPilot AI</div>
              <div className="text-[11px] text-zinc-500">ИИ-агент для B2B-продаж</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition",
                isActive ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60")}>
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
          <ModeBox mode={mode} />
          <button onClick={() => setDark(!dark)} className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {dark ? "Светлая тема" : "Тёмная тема"}
          </button>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav dark={dark} setDark={setDark} mode={mode} />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ModeBox({ mode }: { mode: string | null }) {
  if (!mode) return null;
  return (
    <NavLink to="/settings" className="mb-1 rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">Режим</span>
        {mode === "demo" ? <Badge color="amber">Демо</Badge> : <Badge color="green">Рабочий</Badge>}
      </div>
      <p className="mt-1 text-zinc-500">{mode === "demo" ? "Реальная отправка и сетевые запросы выключены." : "Внешние сервисы работают, только если настроены в .env."}</p>
    </NavLink>
  );
}

function MobileNav({ dark, setDark, mode }: { dark: boolean; setDark: (v: boolean) => void; mode: string | null }) {
  return (
    <div className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
      {NAV.map(({ to, label, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cx("whitespace-nowrap rounded-md px-2 py-1 text-xs", isActive ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "text-zinc-500")}>{label}</NavLink>
      ))}
      <span className="ml-auto">{mode === "demo" ? <Badge color="amber">Демо</Badge> : mode === "live" ? <Badge color="green">Рабочий</Badge> : null}</span>
      <button onClick={() => setDark(!dark)} className="p-1 text-zinc-500" aria-label="Тема">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
    </div>
  );
}

export function DemoNotice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{children}</div>;
}
