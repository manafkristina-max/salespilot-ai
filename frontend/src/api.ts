// Typed API client for the SalesPilot backend.

export type ICP = {
  industries: string[];
  geographies: string[];
  company_types: string[];
  employees_min: number | null;
  employees_max: number | null;
  min_sku: number | null;
  pains: string[];
  product: string;
};

export type Campaign = {
  id: number;
  name: string;
  description: string;
  status: string;
  icp: ICP;
  created_at: string;
  stats?: { leads: number; qualified: number | null; avg_score: number | null };
  leads?: CampaignLead[];
};

export type CampaignLead = {
  id: number; stage: string; score: number | null; confidence: number | null; company_id: number;
  name: string; industry: string; country: string; is_demo: number;
};

export type Company = {
  id: number; name: string; domain: string | null; website: string; industry: string; company_type: string;
  country: string; city: string; employees: number | null; sku_count: number | null; revenue_band: string;
  description: string; tech: string[]; is_demo: boolean; source: string; researched_at: string | null;
  created_at: string; score?: number | null; confidence?: number | null; stages?: string | null;
  lead_count?: number; fact_count?: number;
};

export type Fact = {
  id: number; company_id: number; kind: string; text: string; source_url: string; source_label: string;
  evidence: string; verification: "verified" | "unverified" | "not_found" | "demo"; verification_note: string;
  checked_at: string | null; created_by: string;
};

export type Contact = { id: number; full_name: string; title: string; email: string; source: string; source_note: string };

export type Factor = {
  key: string; label: string; weight: number; value: number | null; points: number; max_points: number;
  explanation: string; missing_data: boolean;
};

export type ScoreDetail = {
  score: number; confidence: number; qualified: boolean; factors: Factor[]; missing: string[]; summary: string; knockouts?: string[];
  threshold?: number; scored_at?: string;
};

export type Match = {
  recommended: string | null; recommended_name: string | null; reason: string; rationale: string;
  ranking: { product_id: string; product: string; strength: number; matched: { fact_id: number; text: string; keywords: string[] }[] }[];
};

export type Lead = {
  id: number; campaign_id: number; campaign_name: string; stage: string; score: number | null;
  confidence: number | null; score_detail: ScoreDetail | Record<string, never>; match: Match | Record<string, never>;
  emails: Email[]; meetings: { id: number; scheduled_for: string; note: string; created_at: string }[];
};

export type CompanyDetail = Company & { facts: Fact[]; contacts: Contact[]; leads: Lead[] };

export type Claim = { n: number; fact_id: number; text: string; source_url: string; verification: string };

export type Email = {
  id: number; lead_id: number; contact_id: number | null; to_email: string; subject: string; body: string;
  status: "draft" | "needs_review" | "approved" | "rejected" | "sent"; claims: Claim[]; warnings: string[];
  provider: string; send_mode: "live" | "simulated" | null; sent_at: string | null; message_id: string | null;
  approved_at: string | null; rejected_reason: string; created_at: string; updated_at: string;
  company_name?: string; campaign_name?: string; is_demo?: boolean; score?: number | null; company_id?: number;
  reply_count?: number; contact_name?: string | null;
};

export type EmailDetail = Email & {
  versions: { id: number; version: number; subject: string; body: string; status: string; action: string; author: string; note: string; created_at: string }[];
  replies: { id: number; body: string; classification: string; confidence: number; rationale: string; source: string; received_at: string }[];
  readiness: { can_send: boolean; will_be_live: boolean; blockers: string[]; live_blockers: string[] };
  contacts: Contact[];
};

export type AgentRun = {
  id: number; agent: string; campaign_id: number | null; lead_id: number | null; status: string; message: string;
  provider: string; started_at: string; finished_at: string | null; duration_ms: number | null;
  details?: Record<string, unknown>;
};

export type FunnelStep = { key: string; label: string; count: number; conversion: number | null };

export type Dashboard = {
  mode: "demo" | "live";
  companies: { total: number; demo: number; real: number };
  qualified: { real: number; demo: number };
  drafts: number; needs_review: number; approved: number;
  sent: { live: number; simulated: number };
  replies: { live: number; simulated: number };
  meetings: { real: number; demo: number };
  agents: { agent: string; label: string; runs: number; errors: number; last: AgentRun | null; provider: string }[];
  funnel: FunnelStep[];
  recent_runs: AgentRun[];
};

export type Analytics = {
  scope: string; funnel: FunnelStep[]; score_distribution: { range: string; count: number }[]; unscored: number;
  campaigns: {
    id: number; name: string; leads: number; qualified: number; avg_score: number | null; drafts: number;
    approved: number; sent_live: number; sent_simulated: number; replies_live: number; replies_simulated: number; meetings: number;
  }[];
  demo_leads: number; real_leads: number;
};

export type Product = { id: string; name: string; value_prop: string; keywords: string[] };

export type SettingsValues = {
  mode: "demo" | "live";
  scoring_weights: Record<string, number>;
  qualify_threshold: number;
  compatible_tech: string[];
  approval: { require_manual_approval: boolean; require_send_confirmation: boolean; min_score_to_draft: number; daily_send_limit: number; sending_paused: boolean };
  products: Product[];
  do_not_contact: string[];
  sender: { name: string; company: string; signature: string };
};

export type Integration = { id: string; name: string; status: string; detail: string };

export type SettingsResponse = {
  values: SettingsValues; integrations: Integration[];
  env: { llm_provider: string; live_research_enabled: boolean; live_sending_enabled: boolean; smtp_configured: boolean; public_demo: boolean };
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(method: string, url: string, body?: unknown, isForm = false): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) init.body = body as FormData;
    else { init.body = JSON.stringify(body); (init.headers as Record<string, string>)["Content-Type"] = "application/json"; }
  }
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new ApiError("Сервер недоступен. Запущен ли backend?", 0); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = (data as { detail?: unknown }).detail;
    if (Array.isArray(msg)) msg = msg.map((d: { loc?: string[]; msg?: string }) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join("; ");
    throw new ApiError(String(msg || `Ошибка ${res.status}`), res.status);
  }
  return data as T;
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  dashboard: () => request<Dashboard>("GET", "/api/dashboard"),
  campaigns: () => request<Campaign[]>("GET", "/api/campaigns"),
  campaign: (id: number) => request<Campaign>("GET", `/api/campaigns/${id}`),
  createCampaign: (b: { name: string; description: string; icp: ICP }) => request<Campaign>("POST", "/api/campaigns", b),
  updateCampaign: (id: number, b: Partial<Campaign>) => request<Campaign>("PATCH", `/api/campaigns/${id}`, b),
  deleteCampaign: (id: number) => request<void>("DELETE", `/api/campaigns/${id}`),
  scout: (id: number) => request<{ message: string; added_to_campaign: number }>("POST", `/api/campaigns/${id}/scout?source=demo`),
  runPipeline: (id: number) => request<{ researched: number; qualified: number; disqualified: number; drafted: number; errors: string[] }>("POST", `/api/campaigns/${id}/run`),
  attach: (id: number, ids: number[]) => request<{ attached: number }>("POST", `/api/campaigns/${id}/attach`, { company_ids: ids }),
  companies: (f: Record<string, string | number | null>) => request<Company[]>("GET", `/api/companies${qs(f)}`),
  company: (id: number) => request<CompanyDetail>("GET", `/api/companies/${id}`),
  addCompany: (b: Record<string, unknown>) => request<Company>("POST", "/api/companies", b),
  deleteCompany: (id: number) => request<void>("DELETE", `/api/companies/${id}`),
  updateCompany: (id: number, b: Record<string, unknown>) => request<Company>("PATCH", `/api/companies/${id}`, b),
  importCsv: (file: File, campaignId?: number | null) => {
    const fd = new FormData(); fd.append("file", file);
    if (campaignId) fd.append("campaign_id", String(campaignId));
    return request<{ created: number; duplicates: string[]; errors: string[]; attached: number }>("POST", "/api/companies/import", fd, true);
  },
  research: (id: number) => request<{ status: string; message: string }>("POST", `/api/companies/${id}/research`),
  addFact: (id: number, b: Record<string, string>) => request<Fact>("POST", `/api/companies/${id}/facts`, b),
  addContact: (id: number, b: Record<string, string>) => request<Contact>("POST", `/api/companies/${id}/contacts`, b),
  verifyFact: (id: number) => request<Fact>("POST", `/api/facts/${id}/verify`),
  markFact: (id: number, v: string) => request<Fact>("POST", `/api/facts/${id}/mark?verification=${v}`),
  qualify: (leadId: number) => request<ScoreDetail>("POST", `/api/leads/${leadId}/qualify`),
  draft: (leadId: number, b: { contact_id?: number | null; force?: boolean } = {}) => request<Email>("POST", `/api/leads/${leadId}/draft`, b),
  meeting: (leadId: number, b: { scheduled_for: string; note: string }) => request("POST", `/api/leads/${leadId}/meetings`, b),
  emails: (f: Record<string, string | number | null>) => request<Email[]>("GET", `/api/emails${qs(f)}`),
  email: (id: number) => request<EmailDetail>("GET", `/api/emails/${id}`),
  updateEmail: (id: number, b: Record<string, unknown>) => request<Email>("PATCH", `/api/emails/${id}`, b),
  emailAction: (id: number, action: "submit" | "approve" | "reject" | "reopen", reason = "") =>
    request<Email>("POST", `/api/emails/${id}/${action}`, { reason }),
  send: (id: number) => request<Email>("POST", `/api/emails/${id}/send`, { confirm: true }),
  reply: (id: number, body: string) => request<Email>("POST", `/api/emails/${id}/replies`, { body }),
  analytics: (f: Record<string, string | number | null>) => request<Analytics>("GET", `/api/analytics${qs(f)}`),
  settings: () => request<SettingsResponse>("GET", "/api/settings"),
  putSetting: (key: string, value: unknown) => request<{ value: unknown }>("PUT", `/api/settings/${key}`, value),
  health: () => request<{ ok: boolean; mode: "demo" | "live"; public_demo: boolean }>("GET", "/api/health"),
  resetDemo: () => request<{ message: string }>("POST", "/api/demo/reset"),
  runs: (agent = "") => request<AgentRun[]>("GET", `/api/agent-runs${qs({ agent })}`),
};
