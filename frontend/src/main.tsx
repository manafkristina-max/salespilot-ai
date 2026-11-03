import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>,
);
