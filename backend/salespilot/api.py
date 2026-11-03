"""HTTP API (FastAPI). Serves the built frontend from frontend/dist too."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .config import ROOT, Settings, get_settings
from .db import Database
from .service import SalesPilot, ServiceError
from .settings_store import DEFAULTS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("salespilot.api")


class ICP(BaseModel):
    industries: list[str] = []
    geographies: list[str] = []
    company_types: list[str] = []
    employees_min: int | None = Field(None, ge=0)
    employees_max: int | None = Field(None, ge=0)
    min_sku: int | None = Field(None, ge=0)
    pains: list[str] = []
    product: str = "auto"

    @field_validator("industries", "geographies", "company_types", "pains")
    @classmethod
    def _clean(cls, v):
        return [s.strip() for s in v if s and s.strip()]


class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    icp: ICP = ICP()


class CampaignPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    status: Literal["active", "paused", "archived"] | None = None
    icp: ICP | None = None


class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    website: str = ""
    industry: str = ""
    company_type: str = ""
    country: str = ""
    city: str = ""
    employees: int | None = Field(None, ge=0)
    sku_count: int | None = Field(None, ge=0)
    revenue_band: str = ""
    description: str = ""
    campaign_id: int | None = None


class CompanyPatch(BaseModel):
    industry: str | None = None
    company_type: str | None = None
    country: str | None = None
    city: str | None = None
    employees: int | None = Field(None, ge=0)
    sku_count: int | None = Field(None, ge=0)
    revenue_band: str | None = None
    description: str | None = None


class FactIn(BaseModel):
    kind: Literal["pain", "signal", "info", "tech"] = "info"
    text: str = Field(min_length=3, max_length=500)
    source_url: str = Field(min_length=8, max_length=500)
    source_label: str = ""
    evidence: str = ""


class ContactIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    title: str = ""
    email: str = ""
    source_note: str = Field(min_length=3, max_length=300)


class EmailPatch(BaseModel):
    subject: str | None = Field(None, max_length=200)
    body: str | None = Field(None, max_length=8000)
    contact_id: int | None = None
    clear_contact: bool = False


class Reason(BaseModel):
    reason: str = ""


class SendIn(BaseModel):
    confirm: bool = False


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class MeetingIn(BaseModel):
    scheduled_for: str = ""
    note: str = ""


class AttachIn(BaseModel):
    company_ids: list[int]


class DraftIn(BaseModel):
    contact_id: int | None = None
    force: bool = False


def create_app(settings: Settings | None = None, db: Database | None = None) -> FastAPI:
    settings = settings or get_settings()
    db = db or Database(settings.db_path)
    sp = SalesPilot(db, settings)
    app = FastAPI(title="SalesPilot AI", version="0.1.0")
    app.state.sp = sp

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse({"detail": f"Внутренняя ошибка: {type(exc).__name__}"}, status_code=500)

    # ---- health / dashboard
    @app.get("/api/health")
    def health():
        return {"ok": True, "mode": sp.mode}

    @app.get("/api/dashboard")
    def dashboard():
        return sp.dashboard()

    # ---- campaigns
    @app.get("/api/campaigns")
    def campaigns():
        return sp.list_campaigns()

    @app.post("/api/campaigns", status_code=201)
    def create_campaign(body: CampaignIn):
        return sp.create_campaign(body.model_dump())

    @app.get("/api/campaigns/{cid}")
    def get_campaign(cid: int):
        c = sp.get_campaign(cid)
        c["leads"] = sp.db.query(
            "SELECT l.id, l.stage, l.score, l.confidence, l.company_id, co.name, co.industry, co.country, co.is_demo "
            "FROM leads l JOIN companies co ON co.id=l.company_id WHERE l.campaign_id=? "
            "ORDER BY l.score IS NULL, l.score DESC", (cid,))
        return c

    @app.patch("/api/campaigns/{cid}")
    def patch_campaign(cid: int, body: CampaignPatch):
        return sp.update_campaign(cid, body.model_dump(exclude_none=True))

    @app.delete("/api/campaigns/{cid}", status_code=204)
    def delete_campaign(cid: int):
        sp.delete_campaign(cid)
        return Response(status_code=204)

    @app.post("/api/campaigns/{cid}/scout")
    def scout(cid: int, source: Literal["demo", "live"] = "demo"):
        return sp.scout(cid, source)

    @app.post("/api/campaigns/{cid}/run")
    def run(cid: int, write: bool = True):
        return sp.run_pipeline(cid, write)

    @app.post("/api/campaigns/{cid}/attach")
    def attach(cid: int, body: AttachIn):
        sp.get_campaign(cid)
        added = sum(1 for i in body.company_ids if sp.get_company_row(i) and sp.attach(cid, i))
        return {"attached": added}

    # ---- companies
    @app.get("/api/companies")
    def companies(search: str = "", industry: str = "", country: str = "", campaign_id: int | None = None,
                  min_score: int | None = None, max_score: int | None = None,
                  data: Literal["all", "real", "demo"] = "all", stage: str = ""):
        return sp.list_companies(search, industry, country, campaign_id, min_score, max_score, data, stage)

    @app.post("/api/companies", status_code=201)
    def add_company(body: CompanyIn):
        data = body.model_dump()
        cid = data.pop("campaign_id")
        company, created = sp.add_company(data, source="manual")
        if not created:
            raise ServiceError(f"Дубликат: компания «{company['name']}» уже есть (id {company['id']})", 409)
        if cid:
            sp.attach(cid, company["id"])
        return company

    @app.post("/api/companies/import")
    async def import_csv(file: UploadFile = File(...), campaign_id: int | None = Form(None)):
        raw = await file.read()
        if len(raw) > 2_000_000:
            raise ServiceError("Файл больше 2 МБ")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1251", errors="replace")
        return sp.import_csv(text, campaign_id)

    @app.get("/api/companies/{cid}")
    def company(cid: int):
        return sp.get_company(cid)

    @app.patch("/api/companies/{cid}")
    def patch_company(cid: int, body: CompanyPatch):
        return sp.update_company(cid, body.model_dump(exclude_unset=True))

    @app.delete("/api/companies/{cid}", status_code=204)
    def delete_company(cid: int):
        sp.delete_company(cid)
        return Response(status_code=204)

    @app.post("/api/companies/{cid}/research")
    def research(cid: int):
        return sp.research_company(cid)

    @app.post("/api/companies/{cid}/facts", status_code=201)
    def add_fact(cid: int, body: FactIn):
        return sp.add_fact(cid, body.model_dump())

    @app.post("/api/companies/{cid}/contacts", status_code=201)
    def add_contact(cid: int, body: ContactIn):
        return sp.add_contact(cid, body.model_dump() | {"source": "manual"})

    @app.post("/api/facts/{fid}/verify")
    def verify(fid: int):
        return sp.verify_fact(fid)

    @app.post("/api/facts/{fid}/mark")
    def mark(fid: int, verification: Literal["verified", "unverified", "not_found"]):
        return sp.mark_fact(fid, verification)

    # ---- leads
    @app.post("/api/leads/{lid}/qualify")
    def qualify(lid: int):
        lead = sp.get_lead(lid)
        sp.research_company(lead["company_id"], lead["campaign_id"], lid)
        result = sp.qualify(lid)
        sp.match_product(lid)
        return result

    @app.post("/api/leads/{lid}/draft", status_code=201)
    def draft(lid: int, body: DraftIn = DraftIn()):
        return sp.write_email(lid, body.contact_id, body.force)

    @app.post("/api/leads/{lid}/meetings", status_code=201)
    def meeting(lid: int, body: MeetingIn):
        return sp.add_meeting(lid, body.scheduled_for, body.note)

    # ---- emails
    @app.get("/api/emails")
    def emails(status: str = "", campaign_id: int | None = None):
        return sp.list_emails(status, campaign_id)

    @app.get("/api/emails/{eid}")
    def email(eid: int):
        e = sp.get_email(eid)
        e["readiness"] = sp.send_readiness(e)
        e["contacts"] = sp.db.query("SELECT * FROM contacts WHERE company_id=?", (e["company_id"],))
        return e

    @app.patch("/api/emails/{eid}")
    def patch_email(eid: int, body: EmailPatch):
        data = body.model_dump(exclude_unset=True)
        if data.pop("clear_contact", False):
            data["contact_id"] = None
        elif data.get("contact_id") is None:
            data.pop("contact_id", None)
        return sp.update_email(eid, data)

    @app.post("/api/emails/{eid}/send")
    def send(eid: int, body: SendIn):
        return sp.send_email(eid, body.confirm)

    @app.post("/api/emails/{eid}/replies", status_code=201)
    def reply(eid: int, body: ReplyIn):
        return sp.add_reply(eid, body.body)

    @app.post("/api/emails/{eid}/{action}")
    def email_action(eid: int, action: Literal["submit", "approve", "reject", "reopen"], body: Reason = Reason()):
        return sp.set_email_status(eid, action, body.reason)

    # ---- analytics / export
    @app.get("/api/analytics")
    def analytics(campaign_id: int | None = None, scope: Literal["all", "real", "demo"] = "all"):
        return sp.analytics(campaign_id, scope)

    def _csv(text: str, name: str) -> Response:
        return Response("﻿" + text, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/export/companies.csv")
    def export_companies(search: str = "", industry: str = "", country: str = "", campaign_id: int | None = None,
                         min_score: int | None = None, data: Literal["all", "real", "demo"] = "all"):
        return _csv(sp.export_companies_csv(search=search, industry=industry, country=country,
                                            campaign_id=campaign_id, min_score=min_score, data=data), "companies.csv")

    @app.get("/api/export/emails.csv")
    def export_emails(status: str = "", campaign_id: int | None = None):
        return _csv(sp.export_emails_csv(status=status, campaign_id=campaign_id), "emails.csv")

    @app.get("/api/export/analytics.csv")
    def export_analytics(campaign_id: int | None = None, scope: Literal["all", "real", "demo"] = "all"):
        return _csv(sp.export_analytics_csv(campaign_id, scope), "analytics.csv")

    # ---- settings
    @app.get("/api/settings")
    def get_settings_():
        return {"values": sp.settings.all(), "integrations": sp.integrations(),
                "env": {"llm_provider": settings.llm_provider, "live_research_enabled": settings.live_research_enabled,
                        "live_sending_enabled": settings.live_sending_enabled,
                        "smtp_configured": settings.smtp_configured}}

    @app.put("/api/settings/{key}")
    def put_setting(key: str, value: Any = Body(...)):
        if key not in DEFAULTS:
            raise HTTPException(404, "Неизвестная настройка")
        if key == "mode" and value not in ("demo", "live"):
            raise ServiceError("mode должен быть demo или live")
        if key == "scoring_weights":
            if not isinstance(value, dict) or any(not isinstance(v, (int, float)) or v < 0 for v in value.values()):
                raise ServiceError("Веса должны быть неотрицательными числами")
            if sum(value.values()) <= 0:
                raise ServiceError("Сумма весов должна быть больше 0")
        if key == "qualify_threshold" and not (isinstance(value, int) and 0 <= value <= 100):
            raise ServiceError("Порог должен быть целым числом от 0 до 100")
        sp.settings.set(key, value)
        return {"key": key, "value": sp.settings.get(key)}

    @app.get("/api/agent-runs")
    def runs(agent: str = "", limit: int = Query(200, le=1000)):
        return sp.agent_runs(agent, limit)

    # ---- frontend
    dist = ROOT / "frontend" / "dist"
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            target = dist / path
            if path and target.is_file() and dist in target.resolve().parents:
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    return app
