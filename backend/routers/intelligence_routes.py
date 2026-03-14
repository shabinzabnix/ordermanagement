from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import (
    select, func, and_, or_, case, cast, Float, Integer, String, Date, 
    extract, distinct, join, union_all, literal_column
)
from database import get_db
from models import (
    Product, Store, HOStockBatch, StoreStockBatch,
    InterStoreTransfer, PurchaseRequest, SalesRecord, PurchaseRecord,
    CRMCustomer, MedicinePurchase, CRMTask, CRMCallLog,
    TransferStatus, PurchaseStatus, CustomerType, SupplierProfile,
)
from auth import get_current_user, require_roles
from datetime import datetime, timezone, timedelta
import pandas as pd
from pydantic import BaseModel
from io import BytesIO
import uuid
import asyncio
import math
from typing import Optional, List, Dict, Any, Tuple

router = APIRouter()


def _enforce_store(user, store_id):
    """Enforce store_id for store staff/manager roles."""
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        return user["store_id"]
    return store_id or None


# ─── Unified Intelligence Dashboard ──────────────────────

@router.get("/intel/dashboard")
async def intel_dashboard(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    from cache import get_cached, set_cached, cache_key
    ck = cache_key("intel_dashboard", store_id)
    cached = get_cached(ck, ttl=120)
    if cached: return cached
    now = datetime.now(timezone.utc)
    d30 = now + timedelta(days=30)
    d60 = now + timedelta(days=60)
    d90 = now + timedelta(days=90)
    dead_threshold = now - timedelta(days=60)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # 1. Parallelize ALL independent metrics
    tasks = [
        db.execute(select(func.sum(HOStockBatch.landing_cost_value))),
        db.execute(select(func.sum(StoreStockBatch.cost_value))),
        # Dead stock HO
        db.execute(select(func.sum(HOStockBatch.landing_cost_value)).where(and_(HOStockBatch.closing_stock > 0, HOStockBatch.created_at < dead_threshold))),
        # Dead stock Store (simplified: assuming no sales means sales=0 or NULL)
        db.execute(select(func.sum(StoreStockBatch.cost_value)).where(and_(StoreStockBatch.closing_stock_strips > 0, (StoreStockBatch.sales == 0) | (StoreStockBatch.sales.is_(None)), StoreStockBatch.created_at < dead_threshold))),
        # Expiry HO 30/60/90
        db.execute(select(
            func.count(case((HOStockBatch.expiry_date <= d30, 1), else_=None)),
            func.count(case((and_(HOStockBatch.expiry_date > d30, HOStockBatch.expiry_date <= d60), 1), else_=None)),
            func.count(case((and_(HOStockBatch.expiry_date > d60, HOStockBatch.expiry_date <= d90), 1), else_=None)),
            func.sum(case((HOStockBatch.expiry_date <= d30, HOStockBatch.landing_cost_value), else_=0))
        ).where(and_(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0))),
        # Expiry Store 30/60/90
        db.execute(select(
            func.count(case((StoreStockBatch.expiry_date <= d30, 1), else_=None)),
            func.count(case((and_(StoreStockBatch.expiry_date > d30, StoreStockBatch.expiry_date <= d60), 1), else_=None)),
            func.count(case((and_(StoreStockBatch.expiry_date > d60, StoreStockBatch.expiry_date <= d90), 1), else_=None)),
            func.sum(case((StoreStockBatch.expiry_date <= d30, StoreStockBatch.cost_value), else_=0))
        ).where(and_(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0))),
        # Customer counts
        db.execute(select(func.count(CRMCustomer.id)).where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))),
        db.execute(select(func.count(CRMCustomer.id))),
        # Medicine due
        db.execute(select(func.count(MedicinePurchase.id)).where(and_(MedicinePurchase.status == "active", MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=1)))),
        db.execute(select(func.count(MedicinePurchase.id)).where(and_(MedicinePurchase.status == "active", MedicinePurchase.next_due_date < today_start))),
        # Operations
        db.execute(select(func.count(InterStoreTransfer.id)).where(InterStoreTransfer.status == TransferStatus.PENDING)),
        db.execute(select(func.count(PurchaseRequest.id)).where(PurchaseRequest.status.in_([PurchaseStatus.PENDING, PurchaseStatus.TRANSFER_SUGGESTED]))),
        db.execute(select(func.sum(PurchaseRecord.total_amount))),
        db.execute(select(func.sum(SalesRecord.total_amount))),
    ]

    # Execute all independent metrics
    gr = await asyncio.gather(*tasks)
    res: List[Any] = list(gr)
    
    # Extract values safely using .scalar() for single-value queries
    ho_val: float = float(res[0].scalar() or 0.0)
    st_val: float = float(res[1].scalar() or 0.0)
    dead_ho: float = float(res[2].scalar() or 0.0)
    dead_st: float = float(res[3].scalar() or 0.0)
    
    # Expiry results (multiple columns in one row)
    ho_exp_row = res[4].first()
    st_exp_row = res[5].first()
    
    h30 = int(ho_exp_row[0] or 0) if ho_exp_row else 0
    h60 = int(ho_exp_row[1] or 0) if ho_exp_row else 0
    h90 = int(ho_exp_row[2] or 0) if ho_exp_row else 0
    hv = float(ho_exp_row[3] or 0.0) if ho_exp_row else 0.0

    s30 = int(st_exp_row[0] or 0) if st_exp_row else 0
    s60 = int(st_exp_row[1] or 0) if st_exp_row else 0
    s90 = int(st_exp_row[2] or 0) if st_exp_row else 0
    sv = float(st_exp_row[3] or 0.0) if st_exp_row else 0.0

    # Redistribution Suggestions Count
    redist_cnt_q = select(func.count(func.distinct(StoreStockBatch.ho_product_id))).where(and_(
        StoreStockBatch.closing_stock_strips > 0,
        (StoreStockBatch.sales == 0) | (StoreStockBatch.sales.is_(None)),
        StoreStockBatch.created_at < dead_threshold,
        StoreStockBatch.ho_product_id.in_(
            select(StoreStockBatch.ho_product_id).where(StoreStockBatch.sales > 0)
        )
    ))
    rd_val = (await db.execute(redist_cnt_q)).scalar()
    redistribution_count: int = int(rd_val or 0)

    # Metrics with correct indexing from tasks list
    rc_count: int = int(res[6].scalar() or 0)
    total_cust: int = int(res[7].scalar() or 0)
    due_today_val: int = int(res[8].scalar() or 0)
    overdue_val: int = int(res[9].scalar() or 0)
    p_transfers: int = int(res[10].scalar() or 0)
    p_purchases: int = int(res[11].scalar() or 0)
    purchase_val: float = float(res[12].scalar() or 0.0)
    sales_val: float = float(res[13].scalar() or 0.0)

    # Final result construction
    # Use floor-based rounding as a workaround for linter's 'round' overload issue
    result = {
        "inventory": {
            "total_value": math.floor((float(ho_val) + float(st_val)) * 100 + 0.5) / 100.0,
            "dead_stock_value": math.floor((float(dead_ho) + float(dead_st)) * 100 + 0.5) / 100.0,
            "expiring_value": math.floor((float(hv) + float(sv)) * 100 + 0.5) / 100.0,
            "expiring_30d": int(h30) + int(s30),
            "expiring_60d": int(h60) + int(s60),
            "expiring_90d": int(h90) + int(s90),
        },
        "customer": {
            "rc_customers": int(rc_count),
            "total_customers": int(total_cust),
            "due_today": int(due_today_val),
            "overdue": int(overdue_val),
        },
        "operations": {
            "pending_transfers": int(p_transfers),
            "pending_purchases": int(p_purchases),
            "redistribution_opportunities": int(redistribution_count),
            "total_purchase_value": math.floor(float(purchase_val) * 100 + 0.5) / 100.0,
            "total_sales_value": math.floor(float(sales_val) * 100 + 0.5) / 100.0,
        }
    }
    return set_cached(ck, result, ttl=120)



# ─── Demand Forecasting Engine ────────────────────────────

@router.get("/intel/demand-forecast")
async def demand_forecast(
    store_id: int = Query(None),
    search: str = Query(None),
    days: int = Query(30),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=99999),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Demand forecasting: Sales QTY from SalesRecord, Stock UNITS from StoreStockBatch."""
    now = datetime.now(timezone.utc)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    cutoff_30 = now - timedelta(days=30)
    cutoff_60 = now - timedelta(days=60)
    cutoff_90 = now - timedelta(days=90)

    # Push all aggregation to DB — one query instead of fetching every sales row
    agg_cols = [
        SalesRecord.product_name,
        SalesRecord.store_id,
        func.max(SalesRecord.product_id).label("pid"),
        func.sum(func.case((SalesRecord.invoice_date >= cutoff_90, func.coalesce(SalesRecord.quantity, 1)), else_=0)).label("qty_90"),
        func.sum(func.case((SalesRecord.invoice_date >= cutoff_60, func.coalesce(SalesRecord.quantity, 1)), else_=0)).label("qty_60"),
        func.sum(func.case((SalesRecord.invoice_date >= cutoff_30, func.coalesce(SalesRecord.quantity, 1)), else_=0)).label("qty_30"),
        func.sum(func.case((SalesRecord.invoice_date >= cutoff_90, func.coalesce(SalesRecord.total_amount, 0)), else_=0)).label("amt_90"),
        func.sum(func.case((SalesRecord.invoice_date >= cutoff_30, func.coalesce(SalesRecord.total_amount, 0)), else_=0)).label("amt_30"),
    ]
    sr_query = (
        select(*agg_cols)
        .where(SalesRecord.invoice_date >= cutoff_90)
        .group_by(SalesRecord.product_name, SalesRecord.store_id)
    )
    if store_id:
        sr_query = sr_query.where(SalesRecord.store_id == store_id)

    product_sales = {}
    for row in (await db.execute(sr_query)).all():
        key = (row[0], row[1])
        product_sales[key] = {
            "pid": row[2] or "",
            "qty_90": float(row[3] or 0),
            "qty_60": float(row[4] or 0),
            "qty_30": float(row[5] or 0),
            "amt_90": float(row[6] or 0),
            "amt_30": float(row[7] or 0),
        }

    # Only fetch stock for products that have sales — avoids full table scan
    active_pids = list(set(d["pid"] for d in product_sales.values() if d.get("pid")))
    active_names = list(set(k[0] for k in product_sales.keys()))

    stock_q = (
        select(
            StoreStockBatch.ho_product_id,
            StoreStockBatch.product_name,
            StoreStockBatch.store_id,
            func.sum(StoreStockBatch.closing_stock).label("units"),
        )
        .group_by(StoreStockBatch.ho_product_id, StoreStockBatch.product_name, StoreStockBatch.store_id)
    )
    if store_id:
        stock_q = stock_q.where(StoreStockBatch.store_id == store_id)
    if active_pids or active_names:
        stock_q = stock_q.where(
            StoreStockBatch.ho_product_id.in_(active_pids) | StoreStockBatch.product_name.in_(active_names)
        )

    stock_by_pid: dict = {}
    stock_by_name: dict = {}
    for row in (await db.execute(stock_q)).all():
        units_raw = row[3]
        units = float(units_raw or 0.0)
        if row[0]:
            k = (row[0], row[2])
            stock_by_pid[k] = float(stock_by_pid.get(k, 0.0)) + units
        k2 = (row[1], row[2])
        stock_by_name[k2] = float(stock_by_name.get(k2, 0.0)) + units

    forecasts = []
    for (product, sid), data in product_sales.items():
        avg_30 = data["qty_30"] / 30 if data["qty_30"] > 0 else 0
        avg_60 = data["qty_60"] / 60 if data["qty_60"] > 0 else 0
        avg_90 = data["qty_90"] / 90 if data["qty_90"] > 0 else 0
        best_avg = max(avg_30, avg_60, avg_90)
        reorder_qty = math.floor(best_avg * days + 0.5)
        pid = data.get("pid", "")
        current_stock = stock_by_pid.get((pid, sid), 0) if pid else 0
        if current_stock == 0:
            current_stock = stock_by_name.get((product, sid), 0)
        days_of_stock = math.floor(current_stock / best_avg + 0.5) if best_avg > 0 else 999

        forecasts.append({
            "product_name": product, "product_id": pid,
            "store_id": sid, "store_name": stores_map.get(sid, ""),
            "sales_30d": math.floor(float(data["qty_30"]) + 0.5),
            "sales_60d": math.floor(float(data["qty_60"]) + 0.5),
            "sales_90d": math.floor(float(data["qty_90"]) + 0.5),
            "revenue_30d": math.floor(float(data["amt_30"]) * 100 + 0.5) / 100.0,
            "revenue_90d": math.floor(float(data["amt_90"]) * 100 + 0.5) / 100.0,
            "avg_daily": math.floor(float(best_avg) * 100 + 0.5) / 100.0,
            "reorder_qty": math.floor(float(reorder_qty) + 0.5),
            "current_stock": math.floor(float(current_stock) + 0.5),
            "days_of_stock": min(int(days_of_stock), 999),
            "urgency": "critical" if days_of_stock < 7 else "low" if days_of_stock < 15 else "normal",
        })

    if search:
        sl = search.lower()
        forecasts = [f for f in forecasts if sl in f["product_name"].lower() or sl in (f["product_id"] or "").lower()]

    forecasts.sort(key=lambda x: x["days_of_stock"])
    total = len(forecasts)
    start = (page - 1) * limit
    
    # Typed limit loop for forecasts
    limited_forecasts: List[Dict[str, Any]] = []
    end = start + limit
    for idx_f, f_val in enumerate(forecasts):
        if idx_f >= start and idx_f < end:
            limited_forecasts.append(f_val)
        if idx_f >= end:
            break
            
    return {"forecasts": limited_forecasts, "total": total, "forecast_days": days, "page": page, "limit": limit}


@router.get("/intel/export-forecast")
async def export_forecast(
    store_id: int = Query(None),
    search: str = Query(None),
    days: int = Query(30),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    from routers.phase2_routes import _excel
    data = await demand_forecast(store_id=store_id, search=search, days=days, page=1, limit=99999, db=db, user=user)
    rows = [{"rank": i+1, "product": f["product_name"], "product_id": f["product_id"],
             "store": f["store_name"], "sales_30d": f["sales_30d"], "sales_60d": f["sales_60d"],
             "sales_90d": f["sales_90d"], "avg_daily": f["avg_daily"],
             "current_stock": f["current_stock"], "days_left": f["days_of_stock"],
             "reorder_qty": f["reorder_qty"], "urgency": f["urgency"]}
            for i, f in enumerate(data["forecasts"])]
    headers = [
        {"label": "#", "key": "rank"}, {"label": "Product", "key": "product"},
        {"label": "Product ID", "key": "product_id"}, {"label": "Store", "key": "store"},
        {"label": "30d Qty", "key": "sales_30d"}, {"label": "60d Qty", "key": "sales_60d"},
        {"label": "90d Qty", "key": "sales_90d"}, {"label": "Avg/Day", "key": "avg_daily"},
        {"label": "Stock (Units)", "key": "current_stock"}, {"label": "Days Left", "key": "days_left"},
        {"label": "Reorder (Units)", "key": "reorder_qty"}, {"label": "Urgency", "key": "urgency"},
    ]
    return _excel(rows, headers, "demand_forecast.xlsx")

# ─── Expiry Risk Detection ────────────────────────────────

@router.get("/intel/expiry-risk")
async def expiry_risk(
    risk_level: str = Query("all"),
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    now = datetime.now(timezone.utc)
    d30 = now + timedelta(days=30)
    d60 = now + timedelta(days=60)
    d90 = now + timedelta(days=90)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    items = []

    # HO stock — filter expiry window in SQL, not Python
    ho_q = select(HOStockBatch).where(
        HOStockBatch.expiry_date.isnot(None),
        HOStockBatch.closing_stock > 0,
        HOStockBatch.expiry_date <= d90,
    )
    for s in (await db.execute(ho_q)).scalars().all():
        days_to_exp = (s.expiry_date - now).days
        level = "30d" if days_to_exp <= 30 else "60d" if days_to_exp <= 60 else "90d"
        items.append({
            "location": "Head Office", "store_id": None,
            "product_id": s.product_id, "product_name": s.product_name,
            "batch": s.batch, "stock": s.closing_stock, "mrp": s.mrp or 0,
            "value": float(s.landing_cost_value or 0),
            "expiry_date": s.expiry_date.isoformat(), "days_to_expiry": days_to_exp,
            "risk_level": level,
        })

    # Store stock — filter expiry window in SQL, not Python
    ss_q = select(StoreStockBatch).where(
        StoreStockBatch.expiry_date.isnot(None),
        StoreStockBatch.closing_stock_strips > 0,
        StoreStockBatch.expiry_date <= d90,
    )
    if store_id:
        ss_q = ss_q.where(StoreStockBatch.store_id == store_id)
    for s in (await db.execute(ss_q)).scalars().all():
        days_to_exp = (s.expiry_date - now).days
        level = "30d" if days_to_exp <= 30 else "60d" if days_to_exp <= 60 else "90d"
        items.append({
            "location": stores_map.get(s.store_id, f"Store {s.store_id}"), "store_id": s.store_id,
            "product_id": s.ho_product_id or s.store_product_id or "",
            "product_name": s.product_name, "batch": s.batch,
            "stock": s.closing_stock_strips, "mrp": s.mrp or 0,
            "value": float(s.cost_value or 0),
            "expiry_date": s.expiry_date.isoformat(), "days_to_expiry": days_to_exp,
            "risk_level": level,
        })

    if risk_level != "all":
        items = [i for i in items if i["risk_level"] == risk_level]

    items.sort(key=lambda x: x["days_to_expiry"])
    summary = {"30d": 0, "60d": 0, "90d": 0, "total_value": 0.0}
    for i in items:
        summary[i["risk_level"]] += 1
        summary["total_value"] += i["value"]
    summary["total_value"] = math.floor(float(summary["total_value"]) * 100 + 0.5) / 100.0

    return {"items": items, "summary": summary}



# ─── Expiry Monthly Calendar ─────────────────────────────────

@router.get("/intel/expiry-monthly")
async def expiry_monthly(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Returns monthly summary counts via SQL aggregation — no item loading."""
    from sqlalchemy import extract
    now = datetime.now(timezone.utc)

    # HO monthly aggregation
    ho_months = []
    if not store_id:
        ho_yr = extract('year', HOStockBatch.expiry_date)
        ho_mn = extract('month', HOStockBatch.expiry_date)
        ho_q = (await db.execute(
            select(ho_yr.label("yr"), ho_mn.label("mn"), func.count(HOStockBatch.id), func.sum(HOStockBatch.landing_cost_value))
            .where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0)
            .group_by(ho_yr, ho_mn)
        )).all()
        for r in ho_q:
            mk = f"{int(r[0])}-{int(r[1]):02d}"
            ho_months.append({"month": mk, "count": int(r[2]), "value": float(r[3] or 0)})

    # Store monthly aggregation
    ss_yr = extract('year', StoreStockBatch.expiry_date)
    ss_mn = extract('month', StoreStockBatch.expiry_date)
    ss_base = select(ss_yr.label("yr"), ss_mn.label("mn"), func.count(StoreStockBatch.id), func.sum(StoreStockBatch.cost_value)).where(
        StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0)
    if store_id: ss_base = ss_base.where(StoreStockBatch.store_id == store_id)
    ss_base = ss_base.group_by(ss_yr, ss_mn)
    store_months = []
    for r in (await db.execute(ss_base)).all():
        mk = f"{int(r[0])}-{int(r[1]):02d}"
        store_months.append({"month": mk, "count": int(r[2]), "value": float(r[3] or 0)})

    # Merge HO + Store months
    merged = {}
    for m in ho_months + store_months:
        if m["month"] not in merged:
            # Generate label from YYYY-MM
            try:
                date_str = str(m["month"]) + "-01"
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                label = dt.strftime("%B %Y")
            except Exception:
                label = str(m["month"])
            merged[m["month"]] = {"month": m["month"], "label": label, "count": 0, "value": 0.0}
        merged[m["month"]]["count"] += int(m["count"])
        merged[m["month"]]["value"] += float(m["value"])

    months_sorted = sorted(merged.values(), key=lambda x: x["month"])
    for m in months_sorted:
        m["value"] = math.floor(float(m["value"]) * 100 + 0.5) / 100.0

    # Summary — store counts in parallel, HO counts in parallel when no store filter
    d30 = now + timedelta(days=30); d90 = now + timedelta(days=90)

    ss_sid = [StoreStockBatch.store_id == store_id] if store_id else []
    ss_r = await asyncio.gather(
        db.execute(select(func.count(StoreStockBatch.id)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0, *ss_sid, StoreStockBatch.expiry_date < now)),
        db.execute(select(func.count(StoreStockBatch.id)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0, *ss_sid, StoreStockBatch.expiry_date >= now, StoreStockBatch.expiry_date <= d30)),
        db.execute(select(func.count(StoreStockBatch.id)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0, *ss_sid, StoreStockBatch.expiry_date >= now, StoreStockBatch.expiry_date <= d90)),
        db.execute(select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0, *ss_sid)),
    )
    expired_count = ss_r[0].scalar() or 0
    within_30     = ss_r[1].scalar() or 0
    within_90     = ss_r[2].scalar() or 0
    total_val     = float(ss_r[3].scalar() or 0)

    if not store_id:
        ho_r = await asyncio.gather(
            db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date < now)),
            db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date >= now, HOStockBatch.expiry_date <= d30)),
            db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date >= now, HOStockBatch.expiry_date <= d90)),
            db.execute(select(func.sum(HOStockBatch.landing_cost_value)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0)),
        )
        expired_count += ho_r[0].scalar() or 0
        within_30     += ho_r[1].scalar() or 0
        within_90     += ho_r[2].scalar() or 0
        total_val     += float(ho_r[3].scalar() or 0)

    total_batches = sum(m["count"] for m in months_sorted)

    return {
        "months": months_sorted,
        "summary": {"total_batches": total_batches, "expired": expired_count, "within_30d": within_30, "within_90d": within_90, "total_value": math.floor(float(total_val) * 100 + 0.5) / 100.0},
    }


@router.get("/intel/expiry-month-detail")
async def expiry_month_detail(
    month: str = Query(..., description="YYYY-MM"),
    store_id: int = Query(None),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Returns items for a specific month — loaded on demand when user clicks a month."""
    now = datetime.now(timezone.utc)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    try:
        month_start = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if month_start.month == 12:
            month_end = month_start.replace(year=month_start.year + 1, month=1)
        else:
            month_end = month_start.replace(month=month_start.month + 1)
    except ValueError:
        return {"items": [], "label": month}

    items = []

    # HO stock
    if not store_id:
        ho_q = select(HOStockBatch).where(
            HOStockBatch.expiry_date >= month_start, HOStockBatch.expiry_date < month_end,
            HOStockBatch.closing_stock > 0,
        )
        for s in (await db.execute(ho_q)).scalars().all():
            if search and search.lower() not in (s.product_name or "").lower() and search.lower() not in (s.batch or "").lower():
                continue
            items.append({
                "location": "Head Office", "store_id": 0,
                "product_id": s.product_id, "product_name": s.product_name,
                "batch": s.batch, "stock": s.closing_stock, "mrp": s.mrp or 0,
                "value": math.floor(float(s.landing_cost_value or 0) * 100 + 0.5) / 100.0,
                "expiry_date": s.expiry_date.isoformat(), "days_left": (s.expiry_date - now).days,
            })

    # Store stock
    ss_q = select(StoreStockBatch).where(
        StoreStockBatch.expiry_date >= month_start, StoreStockBatch.expiry_date < month_end,
        StoreStockBatch.closing_stock_strips > 0,
    )
    if store_id: ss_q = ss_q.where(StoreStockBatch.store_id == store_id)
    for s in (await db.execute(ss_q)).scalars().all():
        if search and search.lower() not in (s.product_name or "").lower() and search.lower() not in (s.batch or "").lower():
            continue
        items.append({
            "location": stores_map.get(s.store_id, f"Store {s.store_id}"), "store_id": s.store_id,
            "product_id": s.ho_product_id or s.store_product_id or "",
            "product_name": s.product_name, "batch": s.batch,
            "stock": s.closing_stock_strips, "mrp": s.mrp or 0,
            "value": math.floor(float(s.cost_value or 0) * 100 + 0.5) / 100.0,
            "expiry_date": s.expiry_date.isoformat(), "days_left": (s.expiry_date - now).days,
        })

    items.sort(key=lambda x: x["days_left"])
    label = month_start.strftime("%B %Y")
    return {"items": items, "label": label, "month": month, "total": len(items)}


# ─── Dead Stock Redistribution ────────────────────────────

@router.get("/intel/redistribution")
async def redistribution_suggestions(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Smart redistribution: Find dead stock with demand signal in other stores."""
    now = datetime.now(timezone.utc)
    dead_threshold = now - timedelta(days=60)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # 1. Fetch ALL dead stock (bulk)
    dead_batches = (await db.execute(select(StoreStockBatch).where(and_(
        StoreStockBatch.closing_stock_strips > 0,
        (StoreStockBatch.sales == 0) | (StoreStockBatch.sales.is_(None)),
        StoreStockBatch.created_at < dead_threshold
    )).order_by(StoreStockBatch.cost_value.desc()).limit(200))).scalars().all()

    if not dead_batches:
        return {"suggestions": [], "total_suggestions": 0, "total_recoverable_value": 0}

    pids = list(set(b.ho_product_id for b in dead_batches if b.ho_product_id is not None))
    # Demand from other stores (last 90 days sales)
    demand_rows_exec = await db.execute(select(
        SalesRecord.product_id, SalesRecord.store_id, func.sum(SalesRecord.quantity).label("qty")
    ).where(and_(
        SalesRecord.product_id.in_(pids),
        SalesRecord.invoice_date >= now - timedelta(days=90)
    )).group_by(SalesRecord.product_id, SalesRecord.store_id))
    demand_rows = demand_rows_exec.all()

    demand_map: Dict[str, List[Dict[str, float]]] = {}
    for r in demand_rows:
        pid_r = r[0]
        if pid_r is not None:
            pid_str = str(pid_r)
            if pid_str not in demand_map:
                demand_map[pid_str] = []
            demand_map[pid_str].append({"store_id": int(r[1]), "sales": float(r[2] or 0.0)})

    # also current store demand signal
    stock_demand_exec = await db.execute(select(
        StoreStockBatch.ho_product_id, StoreStockBatch.store_id, StoreStockBatch.sales
    ).where(and_(
        StoreStockBatch.ho_product_id.in_(pids),
        StoreStockBatch.sales.isnot(None),
        cast(StoreStockBatch.sales, Float) > 0.0
    )))
    stock_demand = stock_demand_exec.all()
    for r in stock_demand:
        pid_s = r[0]
        if pid_s is not None:
            pid_str = str(pid_s)
            if pid_str not in demand_map:
                demand_map[pid_str] = []
            demand_map[pid_str].append({"store_id": int(r[1]), "sales": float(r[2] or 0.0)})

    suggestions: List[Dict[str, Any]] = []
    total_recoverable: float = 0.0
    for b in dead_batches:
        pid = b.ho_product_id
        if pid is None or pid not in demand_map:
            continue
        
        # Sort demand by highest sales
        targets = sorted(demand_map[pid], key=lambda x: x["sales"], reverse=True)
        # Filters targets to exclude owner store
        other_demand = [t for t in targets if t["store_id"] != b.store_id]
        
        if other_demand:
            best_target = other_demand[0]
            val_raw: float = float(b.cost_value or 0.0)
            suggestions.append({
                "product_id": pid,
                "product_name": b.product_name,
                "source_store": stores_map.get(b.store_id, f"Store {b.store_id}"),
                "source_id": b.store_id,
                "target_store": stores_map.get(best_target["store_id"], f"Store {best_target['store_id']}"),
                "target_id": best_target["store_id"],
                "stock_quantity": float(b.closing_stock_strips or 0.0),
                "recoverable_value": math.floor(float(val_raw) * 100 + 0.5) / 100.0,
                "demand_signal": float(best_target["sales"] or 0.0),
                "batch": b.batch
            })
            total_recoverable = float(total_recoverable or 0.0) + float(val_raw or 0.0)  # type: ignore[arg-type]

    # Use explicit loop for capping instead of slice operator to satisfy strict linter
    final_list: List[Dict[str, Any]] = []
    count_limit = 0
    for sug in suggestions:
        if count_limit >= 100:
            break
        final_list.append(sug)
        count_limit = count_limit + 1

    return {
        "suggestions": final_list,
        "total_suggestions": len(suggestions),
        "total_recoverable_value": math.floor(float(total_recoverable) * 100 + 0.5) / 100.0
    }


# ─── CRM Task Automation ──────────────────────────────────

@router.post("/intel/auto-tasks")
async def generate_auto_tasks(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    """Auto-generate CRM tasks for today: due, overdue, high-value patients."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    d3 = today_start + timedelta(days=3)
    created = 0

    # Get active medicines due within 3 days or overdue
    due_items = (await db.execute(
        select(MedicinePurchase).where(and_(
            MedicinePurchase.status == "active",
            MedicinePurchase.next_due_date.isnot(None),
            MedicinePurchase.next_due_date <= d3,
        ))
    )).scalars().all()

    # Batch-check which customers already have a pending task today (1 query instead of N)
    due_customer_ids = [mp.customer_id for mp in due_items]
    already_tasked: set = set()
    if due_customer_ids:
        tasked_rows = (await db.execute(
            select(CRMTask.customer_id).where(and_(
                CRMTask.customer_id.in_(due_customer_ids),
                CRMTask.created_at >= today_start,
                CRMTask.status == "pending",
            )).distinct()
        )).scalars().all()
        already_tasked = set(tasked_rows)

    for mp in due_items:
        if mp.customer_id in already_tasked:
            continue

        is_overdue = mp.next_due_date < today_start
        days_info = abs((now - mp.next_due_date).days)
        notes = f"{'OVERDUE' if is_overdue else 'DUE'}: {mp.medicine_name} ({'overdue by ' + str(days_info) + 'd' if is_overdue else 'due in ' + str(days_info) + 'd'})"

        db.add(CRMTask(
            customer_id=mp.customer_id,
            due_date=now, status="pending",
            notes=notes, created_by=user["user_id"],
        ))
        created: int = int(created) + 1  # type: ignore[arg-type]

    await db.commit()
    return {"message": f"Generated {created} CRM tasks", "tasks_created": created}


@router.get("/intel/auto-task-queue")
async def get_task_queue(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Get today's auto-generated task queue for CRM calling."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    tasks = (await db.execute(
        select(CRMTask).where(and_(CRMTask.status == "pending", CRMTask.created_at >= today_start))
        .order_by(CRMTask.created_at.desc())
    )).scalars().all()

    cids = set(t.customer_id for t in tasks)
    cmap = {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            cmap[c.id] = c

    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    result = []
    for t in tasks:
        c = cmap.get(t.customer_id)
        if not c:
            continue
        
        c_sid = getattr(c, 'assigned_store_id', None) or getattr(c, 'first_store_id', None)
        if store_id and c_sid != store_id:
            continue
        
        c_type = "UNKNOWN"
        raw_ct = getattr(c, 'customer_type', None)
        if raw_ct:
            c_type = raw_ct.value if hasattr(raw_ct, 'value') else str(raw_ct)

        result.append({
            "task_id": t.id, "customer_id": getattr(c, 'id', None),
            "customer_name": getattr(c, 'customer_name', 'Unknown'), 
            "mobile": getattr(c, 'mobile_number', ''),
            "store": stores_map.get(c_sid, ""),
            "customer_type": c_type,
            "adherence": getattr(c, 'adherence_score', 0),
            "notes": t.notes, "status": t.status,
        })

    return {"queue": result, "total": len(result)}


# ─── Supplier Intelligence ─────────────────────────────────

@router.get("/intel/supplier-intelligence")
async def supplier_intelligence(
    search: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Analyze suppliers from Product Master using SQL aggregation."""

    # Build a union of all supplier columns into a single (supplier, product_id, product_name, ptr, lcost, mrp) set
    sup_queries = []
    for col in [Product.primary_supplier, Product.secondary_supplier, Product.least_price_supplier, Product.most_qty_supplier]:
        sup_queries.append(
            select(col.label("supplier"), Product.product_id, Product.product_name, Product.ptr, Product.landing_cost, Product.mrp)
            .where(col.isnot(None), col != "")
        )
    all_sup = union_all(*sup_queries).subquery()

    # ── Supplier Overview (aggregated) ──
    sup_agg = (
        select(
            all_sup.c.supplier,
            func.count(func.distinct(all_sup.c.product_id)).label("product_count"),
            func.avg(all_sup.c.ptr).label("avg_ptr"),
            func.avg(all_sup.c.landing_cost).label("avg_lcost"),
        )
        .group_by(all_sup.c.supplier)
    )
    if search:
        sup_agg = sup_agg.where(all_sup.c.supplier.ilike(f"%{search}%"))

    total_suppliers = (await db.execute(select(func.count()).select_from(sup_agg.subquery()))).scalar() or 0
    sup_rows = (await db.execute(
        sup_agg.order_by(func.count(func.distinct(all_sup.c.product_id)).desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()

    suppliers = [{
        "supplier": r[0], "product_count": int(r[1]),
        "avg_ptr": math.floor(float(r[2] or 0.0) * 100 + 0.5) / 100.0, 
        "avg_landing_cost": math.floor(float(r[3] or 0.0) * 100 + 0.5) / 100.0,
    } for r in sup_rows]

    # ── Best Supplier per Product (lowest PTR from primary/least_price) ──
    best_q = select(
        Product.product_id, Product.product_name,
        func.coalesce(Product.least_price_supplier, Product.primary_supplier).label("best_supplier"),
        Product.ptr, Product.landing_cost, Product.mrp,
    ).where(func.coalesce(Product.least_price_supplier, Product.primary_supplier).isnot(None))

    if search:
        sl = f"%{search}%"
        best_q = best_q.where(
            Product.product_name.ilike(sl) | Product.primary_supplier.ilike(sl) |
            Product.least_price_supplier.ilike(sl) | Product.product_id.ilike(sl)
        )

    total_best = (await db.execute(select(func.count()).select_from(best_q.subquery()))).scalar() or 0
    best_rows = (await db.execute(
        best_q.order_by(Product.product_name).offset((page - 1) * limit).limit(limit)
    )).all()

    best_per_product = [{
        "product_id": r[0], "product_name": r[1], "best_supplier": r[2],
        "ptr": math.floor(float(r[3] or 0) * 100 + 0.5) / 100.0,
        "landing_cost": math.floor(float(r[4] or 0) * 100 + 0.5) / 100.0,
        "mrp": math.floor(float(r[5] or 0) * 100 + 0.5) / 100.0,
        "margin_pct": math.floor((1 - float(r[3] or 0) / float(r[5])) * 1000 + 0.5) / 10.0 if r[5] and float(r[5]) > 0 else 0.0,
    } for r in best_rows]

    return {
        "suppliers": suppliers, "total_suppliers": total_suppliers,
        "best_per_product": best_per_product, "total_best_per_product": total_best,
        "page": page, "limit": limit,
    }


# ─── Smart Purchase Recommendation ─────────────────────────

@router.get("/intel/purchase-recommendation/{product_id}")
async def purchase_recommendation(
    product_id: str,
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Smart recommendation: check network stock first, then suggest best supplier."""
    product = (await db.execute(select(Product).where(Product.product_id == product_id))).scalar_one_or_none()
    if not product:
        return {"recommendation": "product_not_found", "details": {}}

    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # 1. Check HO stock
    ho_stock = float((await db.execute(
        select(func.sum(HOStockBatch.closing_stock)).where(HOStockBatch.product_id == product_id)
    )).scalar() or 0)

    # 2. Check store stock (all stores)
    store_stocks = []
    ss_q = (await db.execute(
        select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("t"))
        .where(StoreStockBatch.ho_product_id == product_id)
        .group_by(StoreStockBatch.store_id)
    )).all()
    for r in ss_q:
        qty = float(r[1] or 0)
        if qty > 0 and (not store_id or r[0] != store_id):
            store_stocks.append({"store_id": r[0], "store_name": stores_map.get(r[0], ""), "stock": math.floor(float(qty) + 0.5)})

    # 3. Supplier data
    supplier_options = []
    if product.primary_supplier:
        supplier_options.append({"supplier": product.primary_supplier, "type": "primary", "ptr": product.ptr or 0, "landing_cost": product.landing_cost or 0})
    if product.secondary_supplier:
        supplier_options.append({"supplier": product.secondary_supplier, "type": "secondary", "ptr": product.ptr or 0, "landing_cost": product.landing_cost or 0})
    if product.least_price_supplier and product.least_price_supplier not in [product.primary_supplier, product.secondary_supplier]:
        supplier_options.append({"supplier": product.least_price_supplier, "type": "least_price", "ptr": product.ptr or 0, "landing_cost": product.landing_cost or 0})

    # Decision
    total_network = ho_stock + sum(s["stock"] for s in store_stocks)
    if total_network > 0:
        recommendation = "transfer"
        reason = f"Stock available in network ({total_network:.0f} units). Recommend inter-store transfer."
    else:
        recommendation = "purchase"
        best_supplier = min(supplier_options, key=lambda x: x["ptr"]) if supplier_options else None
        reason = f"No network stock. Purchase from {best_supplier['supplier']} (PTR: {best_supplier['ptr']})" if best_supplier else "No network stock. No supplier data."

    return {
        "product_id": product_id, "product_name": product.product_name,
        "recommendation": recommendation, "reason": reason,
        "ho_stock": ho_stock, "store_stocks": store_stocks,
        "total_network": total_network,
        "supplier_options": supplier_options,
        "best_supplier": min(supplier_options, key=lambda x: x["ptr"])["supplier"] if supplier_options else None,
    }


# ─── Enhanced Store Performance with CLV ────────────────────

@router.get("/intel/store-performance")
async def enhanced_store_performance(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Enhanced store scorecard via bulk SQL aggregation."""
    now = datetime.now(timezone.utc)
    stores = (await db.execute(select(Store).where(Store.is_active == True).order_by(Store.store_name))).scalars().all()
    sids = [s.id for s in stores]

    if not sids:
        return {"stores": []}

    # Parallelize ALL store metric aggregations
    tasks = [
        # 1. Stock Metrics by Store
        db.execute(select(
            StoreStockBatch.store_id,
            func.sum(StoreStockBatch.cost_value).label("val"),
            func.sum(StoreStockBatch.closing_stock_strips).label("qty"),
            func.sum(StoreStockBatch.sales).label("sales")
        ).where(StoreStockBatch.store_id.in_(sids)).group_by(StoreStockBatch.store_id)),
        
        # 2. Customer & CLV Metrics
        db.execute(select(
            func.coalesce(CRMCustomer.assigned_store_id, CRMCustomer.first_store_id).label("sid"),
            func.count(CRMCustomer.id).label("total"),
            func.count(case((CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]), 1), else_=None)).label("rc"),
            func.sum(CRMCustomer.clv_value).label("clv"),
            func.count(case((CRMCustomer.clv_tier == "high", 1), else_=None)).label("high")
        ).where(or_(CRMCustomer.assigned_store_id.in_(sids), CRMCustomer.first_store_id.in_(sids)))
        .group_by(func.coalesce(CRMCustomer.assigned_store_id, CRMCustomer.first_store_id))),

        # 3. Sales Revenue
        db.execute(select(
            SalesRecord.store_id,
            func.sum(SalesRecord.total_amount).label("rev")
        ).where(SalesRecord.store_id.in_(sids)).group_by(SalesRecord.store_id)),

        # 4. Overdue Meds
        db.execute(select(
            MedicinePurchase.store_id,
            func.count(MedicinePurchase.id).label("overdue")
        ).where(and_(
            MedicinePurchase.store_id.in_(sids),
            MedicinePurchase.status == "active",
            MedicinePurchase.next_due_date < now
        )).group_by(MedicinePurchase.store_id))
    ]

    results_data = await asyncio.gather(*tasks)

    # Convert results into maps for fast O(1) lookup
    stock_map = {r[0]: r for r in results_data[0].all()}   # type: ignore[index]
    cust_map  = {r[0]: r for r in results_data[1].all()}   # type: ignore[index]
    rev_map   = {r[0]: r for r in results_data[2].all()}   # type: ignore[index]
    overdue_map = {r[0]: r for r in results_data[3].all()} # type: ignore[index]

    final_results = []
    for store in stores:
        sid = store.id
        # Use safely typed defaults
        s_data = stock_map.get(sid)
        c_data = cust_map.get(sid)
        r_data = rev_map.get(sid)
        o_data = overdue_map.get(sid)

        # Extract values using index-safe access or defaults
        val_stock: float = float(s_data[1] or 0.0) if s_data and len(s_data) > 1 else 0.0
        qty_stock: float = float(s_data[2] or 0.0) if s_data and len(s_data) > 2 else 0.0
        s_qty: float = float(s_data[3] or 0.0) if s_data and len(s_data) > 3 else 0.0
        
        c_total: int = int(c_data[1] or 0) if c_data and len(c_data) > 1 else 0
        c_rc: int = int(c_data[2] or 0) if c_data and len(c_data) > 2 else 0
        c_clv: float = float(c_data[3] or 0.0) if c_data and len(c_data) > 3 else 0.0
        c_high: int = int(c_data[4] or 0) if c_data and len(c_data) > 4 else 0

        rev: float = float(r_data[1] or 0.0) if r_data and len(r_data) > 1 else 0.0
        overdue: int = int(o_data[1] or 0) if o_data and len(o_data) > 1 else 0

        final_results.append({
            "store_id": sid, "store_name": store.store_name, "store_code": store.store_code,
            "stock_value": math.floor(float(val_stock) * 100 + 0.5) / 100.0,
            "total_stock": math.floor(float(qty_stock) * 10 + 0.5) / 10.0,
            "turnover": math.floor(float(s_qty / qty_stock) * 100 + 0.5) / 100.0 if qty_stock > 0 else 0,
            "sales_revenue": math.floor(float(rev) * 100 + 0.5) / 100.0,
            "customer_count": int(c_total),
            "rc_count": int(c_rc),
            "retention_pct": math.floor(float(c_rc / c_total * 100) * 10 + 0.5) / 10.0 if c_total > 0 else 0,
            "high_value_customers": int(c_high),
            "total_clv": math.floor(float(c_clv) * 100 + 0.5) / 100.0,
            "avg_clv": math.floor(float(c_clv / c_total) * 100 + 0.5) / 100.0 if c_total > 0 else 0,
            "overdue_meds": int(overdue),
        })

    final_results.sort(key=lambda x: -x["total_clv"])
    return {"stores": final_results}



# ─── Top Selling Products ───────────────────────────────────

@router.get("/intel/top-selling")
async def top_selling_products(
    store_id: int = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    search: str = Query(None),
    sort_by: str = Query("revenue"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    d_from = now - timedelta(days=30)
    d_to = now + timedelta(days=1)
    if date_from:
        try: d_from = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        except: pass
    if date_to:
        try: d_to = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        except: pass

    # Store staff sees only their store
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        store_id = user["store_id"]

    from sqlalchemy import cast, Date
    base_filter = and_(SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to)
    if store_id:
        base_filter = and_(base_filter, SalesRecord.store_id == store_id)

    query = (
        select(
            SalesRecord.product_name,
            SalesRecord.product_id,
            func.sum(SalesRecord.quantity).label("total_qty"),
            func.count(SalesRecord.id).label("invoice_count"),
            func.sum(SalesRecord.total_amount).label("total_amount"),
            func.count(func.distinct(SalesRecord.store_id)).label("store_count"),
        )
        .where(base_filter)
        .group_by(SalesRecord.product_name, SalesRecord.product_id)
    )

    if search:
        query = query.having(SalesRecord.product_name.ilike(f"%{search}%"))

    if sort_by == "qty":
        query = query.order_by(func.sum(SalesRecord.quantity).desc())
    elif sort_by == "invoices":
        query = query.order_by(func.count(SalesRecord.id).desc())
    else:
        query = query.order_by(func.sum(SalesRecord.total_amount).desc())

    # Count total
    count_q = select(func.count()).select_from(
        select(SalesRecord.product_name).where(base_filter).group_by(SalesRecord.product_name, SalesRecord.product_id).subquery()
    )
    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(query.offset((page - 1) * limit).limit(limit))).all()

    products = []
    for r in rows:
        qty = float(r[2] or 0)
        cnt = int(r[3] or 0)
        amt = float(r[4] or 0)
        products.append({
            "product_name": r[0], "product_id": r[1] or "",
            "total_qty": math.floor(float(qty) + 0.5), "invoice_count": int(cnt),
            "total_amount": math.floor(float(amt) * 100 + 0.5) / 100.0, "store_count": int(r[5] or 0),
            "avg_price": math.floor((float(amt) / float(qty)) * 100 + 0.5) / 100.0 if qty > 0 else 0,
        })

    return {"products": products, "total": total, "page": page, "limit": limit}


@router.get("/intel/export-top-selling")
async def export_top_selling(
    store_id: int = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    sort_by: str = Query("revenue"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from routers.phase2_routes import _excel
    data = await top_selling_products(store_id=store_id, date_from=date_from, date_to=date_to,
        sort_by=sort_by, page=1, limit=5000, db=db, user=user)
    rows = [{"rank": i+1, "product": p["product_name"], "product_id": p["product_id"],
             "qty": p["total_qty"], "invoices": p["invoice_count"],
             "revenue": p["total_amount"], "avg_price": p["avg_price"], "stores": p["store_count"]}
            for i, p in enumerate(data["products"])]
    headers = [
        {"label": "Rank", "key": "rank"}, {"label": "Product", "key": "product"},
        {"label": "Product ID", "key": "product_id"}, {"label": "Qty Sold", "key": "qty"},
        {"label": "Invoices", "key": "invoices"}, {"label": "Revenue", "key": "revenue"},
        {"label": "Avg Price", "key": "avg_price"}, {"label": "Stores", "key": "stores"},
    ]
    return _excel(rows, headers, "top_selling_products.xlsx")


# ─── Store-wise Dashboard ──────────────────────────────────

@router.get("/intel/store-dashboard/{store_id}")
async def store_dashboard(
    store_id: int,
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Store-wise dashboard: stock value from ledger, sales from sales uploads, date-wise breakdown."""
    # Enforce store for store roles
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        if store_id != user["store_id"]:
            raise HTTPException(403, "You can only view your assigned store's dashboard")
    now = datetime.now(timezone.utc)
    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if not store:
        return {"error": "Store not found"}

    # Parse date range
    d_from = now - timedelta(days=30)
    d_to = now
    if date_from:
        try: d_from = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        except: pass
    if date_to:
        try: d_to = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        except: pass

    # All independent queries run in parallel
    from sqlalchemy import cast, Date
    (
        r_stock_val, r_stock_units, r_sku,
        r_sales_cnt, r_sales_val,
        r_daily_sales, r_top_products, r_customers,
        r_purch_amt, r_purch_cnt,
    ) = await asyncio.gather(
        db.execute(select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.store_id == store_id)),
        db.execute(select(func.sum(StoreStockBatch.closing_stock_strips)).where(StoreStockBatch.store_id == store_id)),
        db.execute(select(func.count(StoreStockBatch.id)).where(StoreStockBatch.store_id == store_id)),
        db.execute(select(func.count(SalesRecord.id)).where(and_(SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to))),
        db.execute(select(func.sum(SalesRecord.total_amount)).where(and_(SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to))),
        db.execute(select(cast(SalesRecord.invoice_date, Date).label("sale_date"), func.count(SalesRecord.id).label("count"), func.sum(SalesRecord.total_amount).label("amount")).where(and_(SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to)).group_by(cast(SalesRecord.invoice_date, Date)).order_by(cast(SalesRecord.invoice_date, Date))),
        db.execute(select(SalesRecord.product_name, func.sum(SalesRecord.quantity).label("qty"), func.count(SalesRecord.id).label("cnt"), func.sum(SalesRecord.total_amount).label("amt")).where(and_(SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to)).group_by(SalesRecord.product_name).order_by(func.sum(SalesRecord.total_amount).desc()).limit(20)),
        db.execute(select(func.count(CRMCustomer.id)).where((CRMCustomer.first_store_id == store_id) | (CRMCustomer.assigned_store_id == store_id))),
        db.execute(select(func.sum(PurchaseRecord.total_amount)).where(and_(PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to))),
        db.execute(select(func.count(func.distinct(PurchaseRecord.entry_number))).where(and_(PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to))),
    )

    stock_value        = float(r_stock_val.scalar() or 0)
    total_stock_units  = float(r_stock_units.scalar() or 0)
    total_sku          = r_sku.scalar() or 0
    total_sales_count  = r_sales_cnt.scalar() or 0
    total_sales_value  = float(r_sales_val.scalar() or 0)
    _daily_rows  = r_daily_sales.all()
    _top_rows    = r_top_products.all()
    daily_sales  = [{"date": str(r[0]), "invoices": int(r[1] or 0), "amount": math.floor(float(r[2] if r[2] is not None else 0.0) * 100 + 0.5) / 100.0} for r in _daily_rows]
    top_products = [{"product": str(r[0]), "qty": math.floor(float(r[1] if r[1] is not None else 0.0) + 0.5), "count": int(r[2] or 0), "amount": math.floor(float(r[3] if r[3] is not None else 0.0) * 100 + 0.5) / 100.0} for r in _top_rows]
    customer_count     = r_customers.scalar() or 0
    total_purchase_amount = float(r_purch_amt.scalar() or 0)
    total_purchase_count  = r_purch_cnt.scalar() or 0

    # Top suppliers by purchase amount
    top_suppliers_q = (await db.execute(
        select(PurchaseRecord.supplier_name, func.sum(PurchaseRecord.total_amount).label("amt"), func.sum(PurchaseRecord.quantity).label("qty"))
        .where(and_(PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to))
        .group_by(PurchaseRecord.supplier_name).order_by(func.sum(PurchaseRecord.total_amount).desc()).limit(20)
    )).all()
    top_suppliers = [{"supplier": str(r[0]), "amount": math.floor(float(r[1] or 0) * 100 + 0.5) / 100.0, "qty": math.floor(float(r[2] or 0) + 0.5)} for r in top_suppliers_q]

    # Date-wise purchase breakdown
    daily_purchases_q = (await db.execute(
        select(
            cast(PurchaseRecord.purchase_date, Date).label("p_date"),
            func.count(func.distinct(PurchaseRecord.entry_number)).label("count"),
            func.sum(PurchaseRecord.total_amount).label("amount"),
        ).where(and_(
            PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to,
        )).group_by(cast(PurchaseRecord.purchase_date, Date)).order_by(cast(PurchaseRecord.purchase_date, Date))
    )).all()
    daily_purchases = [{"date": str(r[0]), "invoices": int(r[1] or 0), "amount": math.floor(float(r[2] or 0) * 100 + 0.5) / 100.0} for r in daily_purchases_q]

    return {
        "store": {"id": store.id, "name": store.store_name, "code": store.store_code, "location": store.location},
        "stock": {"value": math.floor(float(stock_value) * 100 + 0.5) / 100.0, "units": math.floor(float(total_stock_units) * 10 + 0.5) / 10.0, "sku_count": total_sku},
        "sales": {"count": total_sales_count, "value": math.floor(float(total_sales_value) * 100 + 0.5) / 100.0, "period_from": d_from.isoformat(), "period_to": d_to.isoformat()},
        "purchases": {"count": total_purchase_count, "value": math.floor(float(total_purchase_amount) * 100 + 0.5) / 100.0},
        "daily_sales": daily_sales,
        "daily_purchases": daily_purchases,
        "top_products": top_products,
        "top_suppliers": top_suppliers,
        "customer_count": customer_count,
    }


@router.get("/intel/store-dashboard-summary")
async def store_dashboard_summary(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """All stores summary: stock value + sales value — bulk aggregation, no per-store loop."""
    from cache import get_cached, set_cached, cache_key
    ck = cache_key("store_dash_summary", user.get("store_id"))
    cached = get_cached(ck, ttl=120)
    if cached: return cached
    now = datetime.now(timezone.utc)
    d30 = now - timedelta(days=30)
    store_q = select(Store).where(Store.is_active == True).order_by(Store.store_name)
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        store_q = store_q.where(Store.id == user["store_id"])
    stores = (await db.execute(store_q)).scalars().all()
    sids = [s.id for s in stores]
    if not sids:
        return {"stores": []}

    # Single bulk query per metric instead of per-store loop
    stock_rows, sales_rows, purchase_rows = await asyncio.gather(
        db.execute(
            select(StoreStockBatch.store_id,
                   func.sum(StoreStockBatch.cost_value).label("val"),
                   func.sum(StoreStockBatch.closing_stock_strips).label("units"))
            .where(StoreStockBatch.store_id.in_(sids))
            .group_by(StoreStockBatch.store_id)
        ),
        db.execute(
            select(SalesRecord.store_id,
                   func.sum(SalesRecord.total_amount).label("val"),
                   func.count(SalesRecord.id).label("cnt"))
            .where(and_(SalesRecord.store_id.in_(sids), SalesRecord.invoice_date >= d30))
            .group_by(SalesRecord.store_id)
        ),
        db.execute(
            select(PurchaseRecord.store_id,
                   func.sum(PurchaseRecord.total_amount).label("val"))
            .where(and_(PurchaseRecord.store_id.in_(sids), PurchaseRecord.purchase_date >= d30))
            .group_by(PurchaseRecord.store_id)
        ),
    )

    stock_map = {r[0]: (float(r[1] or 0), float(r[2] or 0)) for r in stock_rows.all()}
    sales_map = {r[0]: (float(r[1] or 0), int(r[2] or 0)) for r in sales_rows.all()}
    purchase_map = {r[0]: float(r[1] or 0) for r in purchase_rows.all()}

    result = []
    for s in stores:
        sv, su = stock_map.get(s.id, (0, 0))
        salv, salc = sales_map.get(s.id, (0, 0))
        pv = purchase_map.get(s.id, 0)
        if sv > 0 or salv > 0 or pv > 0:
            result.append({
                "store_id": s.id, "store_name": s.store_name, "store_code": s.store_code,
                "stock_value": math.floor(float(sv) * 100 + 0.5) / 100.0, "stock_units": math.floor(float(su) * 10 + 0.5) / 10.0,
                "sales_value": math.floor(float(salv) * 100 + 0.5) / 100.0, "sales_count": int(salc),
                "purchase_value": math.floor(float(pv) * 100 + 0.5) / 100.0,
            })

    result.sort(key=lambda x: -x["sales_value"])
    return set_cached(ck, {"stores": result}, ttl=120)


# ─── Purchase Report Upload ────────────────────────────────

PURCHASE_COLUMNS = {
    "purchase date": "purchase_date", "date": "purchase_date", "invoice date": "purchase_date",
    "entry no": "entry_number", "entry number": "entry_number", "invoice no": "entry_number", "invoice number": "entry_number", "bill no": "entry_number",
    "supplier name": "supplier_name", "supplier": "supplier_name", "party name": "supplier_name", "company": "supplier_name",
    "product name": "product_name", "name": "product_name", "product": "product_name", "item name": "product_name",
    "ho id": "product_id", "product id": "product_id", "item code": "product_id",
    "quantity": "quantity", "qty": "quantity",
    "total": "total_amount", "total amount": "total_amount", "amount": "total_amount",
}
PURCHASE_REQUIRED = ["product_name", "supplier_name"]


@router.post("/intel/purchase-upload")
async def upload_purchase_report(
    store_id: int = Query(...),
    mode: str = Query("full"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Enforce store for store roles
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        if store_id != user["store_id"]:
            raise HTTPException(403, "You can only upload for your assigned store")
    
    # For date-wise modes, just add new records (dedup handles duplicates)
    # No deletion needed — small daily files just append to existing data

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()

    # Auto-detect header row — try rows 0-3, fall back to default
    df = None
    for skip in [0, 1, 2, 3]:
        try:
            test_df = await asyncio.to_thread(pd.read_excel, BytesIO(content), header=skip)
            if test_df.empty:
                continue
            cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
            if sum(1 for c in cols_lower if c in PURCHASE_COLUMNS) >= 3:
                df = test_df
                break
        except Exception:
            continue
    if df is None:
        try:
            df = await asyncio.to_thread(pd.read_excel, BytesIO(content))
        except Exception as e:
            raise HTTPException(400, f"Failed to read Excel: {str(e)}")
    if df is None:
        raise HTTPException(400, "Unable to parse Excel file. Please ensure it is a valid format.")
    assert df is not None  # type narrowing for static checkers
    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    # Map columns — use rename dict instead of direct .columns assignment
    col_rename: Dict[str, str] = {}
    for col in list(df.columns):  # type: ignore[union-attr]
        col_norm = str(col).strip().lower().replace('_', ' ')
        if col_norm in PURCHASE_COLUMNS:
            col_rename[str(col)] = PURCHASE_COLUMNS[col_norm]
    # Also normalize any unmapped cols
    normalize_map = {str(col): str(col).strip().lower().replace('_', ' ') for col in list(df.columns)}  # type: ignore[union-attr]
    df = df.rename(columns=normalize_map)  # type: ignore[union-attr]
    mapped: Dict[str, str] = {}
    for col in list(df.columns):  # type: ignore[union-attr]
        col_str = str(col)
        if col_str in PURCHASE_COLUMNS:
            mapped[col_str] = PURCHASE_COLUMNS[col_str]
    missing = [f for f in PURCHASE_REQUIRED if f not in set(mapped.values())]
    original_cols = list(df.columns)  # type: ignore[union-attr]
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Your columns: {original_cols}")
    df = df.rename(columns=mapped)  # type: ignore[union-attr]

    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if not store:
        raise HTTPException(400, f"Store ID {store_id} does not exist")

    # Load existing entries for dedup
    existing = set()
    for r in (await db.execute(select(PurchaseRecord.entry_number, PurchaseRecord.product_name).where(PurchaseRecord.store_id == store_id))).all():
        if r[0]:
            existing.add((str(r[0]).strip(), str(r[1] or "").strip()))

    uid_short = str(uuid.uuid4()).replace("-", "")[:12]
    batch_id: str = uid_short
    success: int = 0
    skipped: int = 0
    failed: int = 0
    records = []
    errors = []

    for idx, row in df.iterrows():  # type: ignore[union-attr]
        try:
            product = str(row.get("product_name", "")).strip()
            supplier = str(row.get("supplier_name", "")).strip()
            _row_n: int = int(idx) + 2  # type: ignore[arg-type]
            if not product or product == "nan":
                failed = int(failed) + 1
                errors.append(f"Row {_row_n}: Missing product name")
                continue
            if not supplier or supplier == "nan":
                failed = int(failed) + 1
                errors.append(f"Row {_row_n}: Missing supplier name for '{product}'")
                continue

            entry_num = str(row.get("entry_number", "")).strip() if pd.notna(row.get("entry_number")) else None
            if entry_num in ("", "nan", "None"):
                entry_num = None
            if entry_num and (entry_num, product) in existing:
                skipped = int(skipped) + 1  # type: ignore[arg-type]
                continue

            # Parse date
            p_date = None
            raw_date = row.get("purchase_date")
            if pd.notna(raw_date):
                try:
                    if isinstance(raw_date, str):
                        for fmt in ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"]:
                            try:
                                p_date = datetime.strptime(raw_date.strip(), fmt).replace(tzinfo=timezone.utc)
                                break
                            except ValueError:
                                continue
                    else:
                        p_date = pd.Timestamp(raw_date).to_pydatetime().replace(tzinfo=timezone.utc)
                except Exception:
                    pass

            pid = str(row.get("product_id", "")).strip() if pd.notna(row.get("product_id")) else None
            pid_str: str = str(pid) if pid else ""
            if pid_str.endswith(".0"):
                pid = pid_str[:-2]
            if pid in ("", "nan", "None"):
                pid = None

            records.append(PurchaseRecord(
                store_id=store_id, purchase_date=p_date or datetime.now(timezone.utc),
                entry_number=entry_num, supplier_name=supplier,
                product_id=pid, product_name=product,
                quantity=float(row.get("quantity", 0)) if pd.notna(row.get("quantity")) else 0,
                total_amount=float(row.get("total_amount", 0)) if pd.notna(row.get("total_amount")) else 0,
                upload_batch_id=batch_id,
            ))
            success += 1
        except Exception as exc:
            failed = int(failed) + 1
            _exc_str: str = str(exc)
            errors.append(f"Row {_row_n}: {_exc_str[:80]}")

    for r in records:
        db.add(r)
    try:
        await db.commit()
    except Exception as exc_save:
        await db.rollback()
        _save_err: str = str(exc_save)
        raise HTTPException(500, f"Failed to save: {_save_err[:200]}")

    # Save upload history
    try:
        from models import UploadHistory, UploadType
        db.add(UploadHistory(file_name=file.filename, upload_type=UploadType.PURCHASE_REPORT, store_id=store_id,
            uploaded_by=user["user_id"], total_records=len(df), success_records=success, failed_records=failed,
            error_details=f"Purchase upload. Dupes skipped: {skipped}"))
        await db.commit()
    except Exception:
        pass

    # Limit errors loop
    err_limit: List[str] = []
    for e in errors:
        if len(err_limit) >= 20:
            break
        err_limit.append(e)

    return {"message": "Purchase report uploaded", "total": len(df), "new_records": int(success), "skipped_duplicate": int(skipped), "failed": int(failed), "errors": err_limit}


@router.get("/intel/purchase-records")
async def list_purchase_records(
    store_id: int = Query(None),
    supplier: str = Query(None),
    search: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=99999),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    query = select(PurchaseRecord)
    effective_store = _enforce_store(user, store_id)
    if effective_store:
        query = query.where(PurchaseRecord.store_id == effective_store)
    if supplier:
        query = query.where(PurchaseRecord.supplier_name.ilike(f"%{supplier}%"))
    if search:
        query = query.where(PurchaseRecord.product_name.ilike(f"%{search}%"))
    if date_from:
        try:
            query = query.where(PurchaseRecord.purchase_date >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
        except: pass
    if date_to:
        try:
            query = query.where(PurchaseRecord.purchase_date < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1))
        except: pass

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    records = (await db.execute(query.order_by(PurchaseRecord.purchase_date.desc()).offset((page - 1) * limit).limit(limit))).scalars().all()

    sids = set(r.store_id for r in records)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    return {
        "records": [{
            "id": r.id, "store_id": r.store_id, "store_name": smap.get(r.store_id, ""),
            "purchase_date": r.purchase_date.isoformat() if r.purchase_date else None,
            "entry_number": r.entry_number, "supplier_name": r.supplier_name,
            "product_id": r.product_id, "product_name": r.product_name,
            "quantity": float(r.quantity or 0.0), 
            "total_amount": math.floor(float(r.total_amount or 0.0) * 100 + 0.5) / 100.0,
        } for r in records],
        "total": total, "page": page, "limit": limit,
    }


@router.get("/intel/purchase-analytics")
async def purchase_analytics(
    store_id: int = Query(None),
    days: int = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Purchase analytics: supplier-wise, product-wise, store-wise spending."""
    now = datetime.now(timezone.utc)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    conditions = []
    if date_from:
        try: conditions.append(PurchaseRecord.purchase_date >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
        except: pass
    if date_to:
        try: conditions.append(PurchaseRecord.purchase_date < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1))
        except: pass
    if not conditions and days:
        conditions.append(PurchaseRecord.purchase_date >= now - timedelta(days=days))
    if store_id:
        conditions.append(PurchaseRecord.store_id == store_id)

    base = and_(*conditions) if conditions else True

    # Totals
    total_amount = float((await db.execute(select(func.sum(PurchaseRecord.total_amount)).where(base))).scalar() or 0)
    total_qty = float((await db.execute(select(func.sum(PurchaseRecord.quantity)).where(base))).scalar() or 0)
    total_invoices = (await db.execute(select(func.count(func.distinct(PurchaseRecord.entry_number))).where(base))).scalar() or 0

    # Supplier-wise
    sup_q = (await db.execute(
        select(PurchaseRecord.supplier_name, func.sum(PurchaseRecord.total_amount).label("amt"),
               func.sum(PurchaseRecord.quantity).label("qty"), func.count(PurchaseRecord.id).label("cnt"))
        .where(base).group_by(PurchaseRecord.supplier_name).order_by(func.sum(PurchaseRecord.total_amount).desc()).limit(50)
    )).all()
    suppliers = [{"supplier": r[0], "amount": math.floor(float(r[1] or 0) * 100 + 0.5) / 100.0, "qty": math.floor(float(r[2] or 0) + 0.5), "records": int(r[3] or 0)} for r in sup_q]

    # Product-wise top purchases
    prod_q = (await db.execute(
        select(PurchaseRecord.product_name, PurchaseRecord.product_id,
               func.sum(PurchaseRecord.total_amount).label("amt"), func.sum(PurchaseRecord.quantity).label("qty"))
        .where(base).group_by(PurchaseRecord.product_name, PurchaseRecord.product_id)
        .order_by(func.sum(PurchaseRecord.total_amount).desc()).limit(50)
    )).all()
    products = [{"product": r[0], "product_id": r[1] or "", "amount": math.floor(float(r[2] or 0) * 100 + 0.5) / 100.0, "qty": math.floor(float(r[3] or 0) + 0.5)} for r in prod_q]

    # Store-wise
    store_q = (await db.execute(
        select(PurchaseRecord.store_id, func.sum(PurchaseRecord.total_amount).label("amt"),
               func.sum(PurchaseRecord.quantity).label("qty"))
        .where(base)
        .group_by(PurchaseRecord.store_id).order_by(func.sum(PurchaseRecord.total_amount).desc())
    )).all()
    store_spending = [{"store_id": r[0], "store_name": stores_map.get(r[0], ""), "amount": math.floor(float(r[1] or 0) * 100 + 0.5) / 100.0, "qty": math.floor(float(r[2] or 0) + 0.5)} for r in store_q]

    # Sales vs Purchase comparison per product (matching by product_id)
    sales_q = (await db.execute(
        select(SalesRecord.product_id, func.sum(SalesRecord.quantity).label("sq"), func.sum(SalesRecord.total_amount).label("sa"))
        .where(base if base is not True else True)
        .group_by(SalesRecord.product_id)
    )).all()
    sales_map = {r[0]: {"qty": float(r[1] or 0), "amt": float(r[2] or 0)} for r in sales_q if r[0]}

    comparison = []
    products_list: List[Dict[str, Any]] = products # type: ignore
    for p in products_list[:30]:
        pid = str(p["product_id"])
        s = sales_map.get(pid, {"qty": 0, "amt": 0})
        comparison.append({
            "product": p["product"], "product_id": pid,
            "purchase_qty": p["qty"], "purchase_amt": p["amount"],
            "sales_qty": math.floor(float(s["qty"]) + 0.5), "sales_amt": math.floor(float(s["amt"]) * 100 + 0.5) / 100.0,
        })

    return {
        "total_purchase_amount": math.floor(float(total_amount) * 100 + 0.5) / 100.0,
        "total_purchase_qty": math.floor(float(total_qty) + 0.5),
        "total_invoices": total_invoices,
        "period_days": days,
        "suppliers": suppliers,
        "top_products": products,
        "store_spending": store_spending,
        "purchase_vs_sales": comparison,
    }


@router.get("/intel/export-purchase-records")
async def export_purchase_records(
    store_id: int = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from routers.phase2_routes import _excel
    data = await list_purchase_records(store_id=store_id, date_from=date_from, date_to=date_to, page=1, limit=99999, db=db, user=user)
    rows = [{"date": r["purchase_date"][:10] if r["purchase_date"] else "", "entry": r["entry_number"] or "",
             "store": r["store_name"], "supplier": r["supplier_name"], "product_id": r["product_id"] or "",
             "product": r["product_name"], "qty": r["quantity"], "amount": r["total_amount"]}
            for r in data["records"]]
    headers = [{"label": "Date", "key": "date"}, {"label": "Entry No", "key": "entry"}, {"label": "Store", "key": "store"},
               {"label": "Supplier", "key": "supplier"}, {"label": "Product ID", "key": "product_id"},
               {"label": "Product", "key": "product"}, {"label": "Qty", "key": "qty"}, {"label": "Amount", "key": "amount"}]
    return _excel(rows, headers, "purchase_records.xlsx")


# ─── Supplier Profiles ────────────────────────────────────────

from pydantic import BaseModel as PydanticBase
from typing import Optional as Opt


class SupplierProfileReq(PydanticBase):
    supplier_name: str
    contact_person: Opt[str] = None
    contact_phone: Opt[str] = None
    contact_email: Opt[str] = None
    address: Opt[str] = None
    gst_number: Opt[str] = None
    credit_days: Opt[int] = 0
    sub_categories: Opt[str] = None
    return_policy: Opt[str] = None
    payment_terms: Opt[str] = None
    notes: Opt[str] = None


@router.get("/intel/supplier-profiles")
async def list_supplier_profiles(
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    query = select(SupplierProfile).where(SupplierProfile.is_active == True)
    if search:
        query = query.where(SupplierProfile.supplier_name.ilike(f"%{search}%") | SupplierProfile.contact_person.ilike(f"%{search}%"))
    profiles = (await db.execute(query.order_by(SupplierProfile.supplier_name))).scalars().all()
    return {"profiles": [{
        "id": p.id, "supplier_name": p.supplier_name, "contact_person": p.contact_person,
        "contact_phone": p.contact_phone, "contact_email": p.contact_email,
        "address": p.address, "gst_number": p.gst_number, "credit_days": p.credit_days,
        "sub_categories": p.sub_categories.split(",") if p.sub_categories else [],
        "return_policy": p.return_policy, "payment_terms": p.payment_terms, "notes": p.notes,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    } for p in profiles]}


@router.get("/intel/supplier-profiles/{supplier_name}")
async def get_supplier_profile(
    supplier_name: str,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    p = (await db.execute(select(SupplierProfile).where(SupplierProfile.supplier_name == supplier_name))).scalar_one_or_none()

    # Products from this supplier
    products = (await db.execute(
        select(Product).where(
            (Product.primary_supplier == supplier_name) | (Product.secondary_supplier == supplier_name) |
            (Product.least_price_supplier == supplier_name) | (Product.most_qty_supplier == supplier_name)
        ).limit(50)
    )).scalars().all()

    # Sub-categories from products
    sub_cats = set()
    for prod in products:
        if prod.sub_category: sub_cats.add(prod.sub_category)
        if prod.category: sub_cats.add(prod.category)

    # 90d purchase stats
    d90 = datetime.now(timezone.utc) - timedelta(days=90)
    purchase_stats = (await db.execute(
        select(func.sum(PurchaseRecord.total_amount), func.sum(PurchaseRecord.quantity), func.count(PurchaseRecord.id))
        .where(PurchaseRecord.supplier_name == supplier_name, PurchaseRecord.purchase_date >= d90)
    )).one()

    profile_data = None
    if p:
        profile_data = {
            "id": p.id, "supplier_name": p.supplier_name, "contact_person": p.contact_person,
            "contact_phone": p.contact_phone, "contact_email": p.contact_email,
            "address": p.address, "gst_number": p.gst_number, "credit_days": p.credit_days,
            "sub_categories": p.sub_categories.split(",") if p.sub_categories else [],
            "return_policy": p.return_policy, "payment_terms": p.payment_terms, "notes": p.notes,
        }

    return {
        "profile": profile_data,
        "supplier_name": supplier_name,
        "product_count": len(products),
        "sub_categories": sorted(sub_cats),
        "products": [{"product_id": pr.product_id, "product_name": pr.product_name, "category": pr.category,
                       "sub_category": pr.sub_category, "mrp": pr.mrp or 0, "ptr": pr.ptr or 0, "landing_cost": pr.landing_cost or 0} for pr in products],
        "purchase_90d": {"amount": math.floor(float(purchase_stats[0] or 0) * 100 + 0.5) / 100.0, "qty": math.floor(float(purchase_stats[1] or 0) + 0.5), "invoices": int(purchase_stats[2] or 0)},
    }


@router.post("/intel/supplier-profiles")
async def create_or_update_supplier_profile(
    data: SupplierProfileReq,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    existing = (await db.execute(select(SupplierProfile).where(SupplierProfile.supplier_name == data.supplier_name))).scalar_one_or_none()
    if existing:
        for k, v in data.dict(exclude_unset=True).items():
            if k != 'supplier_name': setattr(existing, k, v)
        existing.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return {"message": "Supplier profile updated", "id": existing.id}
    else:
        profile = SupplierProfile(**data.dict())
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
        return {"message": "Supplier profile created", "id": profile.id}



# ─── Sub-Category & Supplier Mapping ──────────────────────────

@router.get("/intel/subcategory-suppliers")
async def subcategory_suppliers(
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Returns all sub-categories with their suppliers, product counts, and pricing."""
    # Get all distinct sub_category + supplier combos from products
    rows = (await db.execute(
        select(
            Product.sub_category,
            Product.category,
            Product.primary_supplier,
            func.count(Product.id).label("product_count"),
            func.avg(Product.mrp).label("avg_mrp"),
            func.avg(Product.ptr).label("avg_ptr"),
            func.avg(Product.landing_cost).label("avg_lcost"),
        )
        .where(Product.sub_category.isnot(None), Product.sub_category != "", Product.primary_supplier.isnot(None))
        .group_by(Product.sub_category, Product.category, Product.primary_supplier)
        .order_by(Product.sub_category, func.count(Product.id).desc())
    )).all()

    # Group by sub_category
    sub_cats = {}
    for r in rows:
        sc = r[0]
        if search and search.lower() not in sc.lower() and search.lower() not in (r[2] or "").lower():
            continue
        if sc not in sub_cats:
            sub_cats[sc] = {"sub_category": sc, "category": r[1], "suppliers": [], "total_products": 0}
        sub_cats[sc]["suppliers"].append({
            "supplier": r[2], "product_count": int(r[3]),
            "avg_mrp": math.floor(float(r[4] or 0) * 100 + 0.5) / 100.0,
            "avg_ptr": math.floor(float(r[5] or 0) * 100 + 0.5) / 100.0,
            "avg_lcost": math.floor(float(r[6] or 0) * 100 + 0.5) / 100.0,
        })
        sub_cats[sc]["total_products"] += int(r[3])

    result = sorted(sub_cats.values(), key=lambda x: -x["total_products"])

    # Enrich with supplier profile data (credit days, return policy)
    all_suppliers = set()
    for sc in result:
        for s in sc["suppliers"]:
            all_suppliers.add(s["supplier"])

    profile_map = {}
    if all_suppliers:
        profiles = (await db.execute(
            select(SupplierProfile).where(SupplierProfile.supplier_name.in_(all_suppliers))
        )).scalars().all()
        for p in profiles:
            profile_map[p.supplier_name] = {
                "credit_days": p.credit_days, "contact_person": p.contact_person,
                "contact_phone": p.contact_phone, "return_policy": p.return_policy,
                "has_profile": True,
            }

    for sc in result:
        for s in sc["suppliers"]:
            pf = profile_map.get(s["supplier"], {})
            s["credit_days"] = pf.get("credit_days", 0)
            s["contact_person"] = pf.get("contact_person", "")
            s["return_policy"] = pf.get("return_policy", "")
            s["has_profile"] = pf.get("has_profile", False)

    return {"sub_categories": result, "total": len(result)}
