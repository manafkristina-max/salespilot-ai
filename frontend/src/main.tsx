import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { STATIC_DEMO } from "./api";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import "./index.css";
import Analytics from "./pages/Analytics";
import CampaignDetail from "./pages/CampaignDetail";
import Campaigns from "./pages/Campaigns";
import CompanyPage from "./pages/Company";
import Dashboard from "./pages/Dashboard";
import EmailPage from "./pages/Email";
import Leads from "./pages/Leads";
import Outreach from "./pages/Outreach";
import Settings from "./pages/Settings";

try {
  const forced = new URLSearchParams(window.location.search).get("theme");
  if (forced ? forced === "dark" : localStorage.getItem("sp-theme") === "dark") document.documentElement.classList.add("dark");
} catch { /* storage unavailable */ }

// GitHub Pages serves static files only, so the online demo uses hash URLs (#/leads).
const Router = STATIC_DEMO ? HashRouter : BrowserRouter;
const root = ReactDOM.createRoot(document.getElementById("root")!);

const app = (
  <React.StrictMode>
    <ToastProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="leads" element={<Leads />} />
            <Route path="companies/:id" element={<CompanyPage />} />
            <Route path="outreach" element={<Outreach />} />
            <Route path="outreach/:id" element={<EmailPage />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<div className="py-20 text-center text-sm text-zinc-500">Страница не найдена</div>} />
          </Route>
        </Routes>
      </Router>
    </ToastProvider>
  </React.StrictMode>
);

if (STATIC_DEMO) {
  root.render(<BootScreen />);
  import("./staticDemo")
    .then((m) => m.boot((msg) => window.dispatchEvent(new CustomEvent("sp-boot", { detail: msg }))))
    .then(() => root.render(app))
    .catch((e) => window.dispatchEvent(new CustomEvent("sp-boot", { detail: `error:${e?.message || e}` })));
} else {
  root.render(app);
}

function BootScreen() {
  const [steps, setSteps] = React.useState<string[]>([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const h = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      if (msg.startsWith("error:")) setError(msg.slice(6));
      else setSteps((s) => [...s, msg]);
    };
    window.addEventListener("sp-boot", h);
    return () => window.removeEventListener("sp-boot", h);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <svg viewBox="0 0 32 32" className="h-5 w-5"><path d="M7 21l6-10 5 7 2.5-3.5L25 21" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div><div className="font-semibold">SalesPilot AI · онлайн-демо</div><div className="text-xs text-zinc-500">ИИ-агент для B2B-продаж</div></div>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Настоящий backend на Python запускается прямо в вашем браузере, без сервера. Первый запуск занимает 15–30 секунд, повторный — несколько секунд.</p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              {i === steps.length - 1 && !error ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /> : <span className="text-emerald-500">✓</span>}
              <span className={i === steps.length - 1 && !error ? "" : "text-zinc-500"}>{s}</span>
            </li>
          ))}
        </ul>
        {error && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">Не удалось запустить демо: {error}. Обновите страницу или запустите проект локально: <code>./start.sh --demo</code>.</div>}
      </div>
    </div>
  );
}
