from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import (
    Product, Store, HOStockBatch, StoreStockBatch,
    InterStoreTransfer, PurchaseRequest, SalesRecord, PurchaseRecord,
    CRMCustomer, MedicinePurchase, CRMTask, CRMCallLog,
    TransferStatus, PurchaseStatus, CustomerType,
)
from auth import get_current_user, require_roles
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import uuid

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
    now = datetime.now(timezone.utc)
    d30 = now + timedelta(days=30)
    d60 = now + timedelta(days=60)
    d90 = now + timedelta(days=90)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # ── Inventory Intelligence ──
    ho_value = float((await db.execute(select(func.sum(HOStockBatch.landing_cost_value)))).scalar() or 0)
    store_value = float((await db.execute(select(func.sum(StoreStockBatch.cost_value)))).scalar() or 0)
    total_inventory_value = round(ho_value + store_value, 2)

    # Dead stock value (no sales, 60+ days)
    dead_value = 0
    for s in (await db.execute(select(StoreStockBatch))).scalars().all():
        if s.closing_stock_strips > 0 and (s.sales or 0) == 0:
            days = (now - s.created_at).days if s.created_at else 0
            if days > 60:
                dead_value += float(s.cost_value or 0)
    for s in (await db.execute(select(HOStockBatch))).scalars().all():
        if s.closing_stock > 0:
            days = (now - s.created_at).days if s.created_at else 0
            if days > 60:
                dead_value += float(s.landing_cost_value or 0)

    # Expiring stock
    exp_30, exp_60, exp_90, exp_value = 0, 0, 0, 0.0
    for s in (await db.execute(select(HOStockBatch).where(HOStockBatch.expiry_date.isnot(None)))).scalars().all():
        if s.expiry_date and s.closing_stock > 0:
            if s.expiry_date <= d30:
                exp_30 += 1; exp_value += float(s.landing_cost_value or 0)
            elif s.expiry_date <= d60:
                exp_60 += 1
            elif s.expiry_date <= d90:
                exp_90 += 1
    for s in (await db.execute(select(StoreStockBatch).where(StoreStockBatch.expiry_date.isnot(None)))).scalars().all():
        if s.expiry_date and s.closing_stock_strips > 0:
            if s.expiry_date <= d30:
                exp_30 += 1; exp_value += float(s.cost_value or 0)
            elif s.expiry_date <= d60:
                exp_60 += 1
            elif s.expiry_date <= d90:
                exp_90 += 1

    # ── Customer Intelligence ──
    rc_customers = (await db.execute(
        select(func.count(CRMCustomer.id)).where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))
    )).scalar() or 0
    total_customers = (await db.execute(select(func.count(CRMCustomer.id)))).scalar() or 0
    due_today = (await db.execute(
        select(func.count(MedicinePurchase.id)).where(and_(
            MedicinePurchase.status == "active",
            MedicinePurchase.next_due_date >= today_start,
            MedicinePurchase.next_due_date < today_start + timedelta(days=1),
        ))
    )).scalar() or 0
    overdue = (await db.execute(
        select(func.count(MedicinePurchase.id)).where(and_(
            MedicinePurchase.status == "active",
            MedicinePurchase.next_due_date < today_start,
        ))
    )).scalar() or 0

    # ── Operations Intelligence ──
    pending_transfers = (await db.execute(
        select(func.count(InterStoreTransfer.id)).where(InterStoreTransfer.status == TransferStatus.PENDING)
    )).scalar() or 0
    pending_purchases = (await db.execute(
        select(func.count(PurchaseRequest.id)).where(
            PurchaseRequest.status.in_([PurchaseStatus.PENDING, PurchaseStatus.TRANSFER_SUGGESTED])
        )
    )).scalar() or 0

    # Redistribution suggestions count
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    product_demand = {}
    for s in (await db.execute(select(StoreStockBatch).where(StoreStockBatch.sales > 0))).scalars().all():
        pid = s.ho_product_id or s.store_product_id
        if pid:
            product_demand.setdefault(pid, set()).add(s.store_id)
    dead_products = set()
    for s in (await db.execute(select(StoreStockBatch))).scalars().all():
        if s.closing_stock_strips > 0 and (s.sales or 0) == 0:
            days = (now - s.created_at).days if s.created_at else 0
            if days > 60:
                pid = s.ho_product_id or s.store_product_id
                if pid and pid in product_demand:
                    dead_products.add(pid)
    redistribution_count = len(dead_products)

    return {
        "inventory": {
            "total_value": total_inventory_value,
            "dead_stock_value": round(dead_value, 2),
            "expiring_value": round(exp_value, 2),
            "expiring_30d": exp_30, "expiring_60d": exp_60, "expiring_90d": exp_90,
        },
        "customer": {
            "total_customers": total_customers, "rc_customers": rc_customers,
            "due_today": due_today, "overdue": overdue,
        },
        "operations": {
            "pending_transfers": pending_transfers, "pending_purchases": pending_purchases,
            "redistribution_suggestions": redistribution_count,
            "total_purchase_value": round(float((await db.execute(select(func.sum(PurchaseRecord.total_amount)))).scalar() or 0), 2),
            "total_sales_value": round(float((await db.execute(select(func.sum(SalesRecord.total_amount)))).scalar() or 0), 2),
        },
    }


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

    sr_query = select(SalesRecord)
    if store_id:
        sr_query = sr_query.where(SalesRecord.store_id == store_id)
    sales_records = (await db.execute(sr_query.where(SalesRecord.invoice_date >= cutoff_90))).scalars().all()

    product_sales = {}
    for sr in sales_records:
        key = (sr.product_name, sr.store_id)
        if key not in product_sales:
            product_sales[key] = {"qty_30": 0, "qty_60": 0, "qty_90": 0, "amt_30": 0, "amt_90": 0, "pid": sr.product_id}
        qty = float(sr.quantity or 0) if sr.quantity else 1
        amt = float(sr.total_amount or 0)
        product_sales[key]["qty_90"] += qty
        product_sales[key]["amt_90"] += amt
        if sr.invoice_date and sr.invoice_date >= cutoff_60:
            product_sales[key]["qty_60"] += qty
        if sr.invoice_date and sr.invoice_date >= cutoff_30:
            product_sales[key]["qty_30"] += qty
            product_sales[key]["amt_30"] += amt

    stock_by_pid = {}
    stock_by_name = {}
    for ss in (await db.execute(select(StoreStockBatch))).scalars().all():
        units = float(ss.closing_stock or 0)
        if ss.ho_product_id:
            k = (ss.ho_product_id, ss.store_id)
            stock_by_pid[k] = stock_by_pid.get(k, 0) + units
        k2 = (ss.product_name, ss.store_id)
        stock_by_name[k2] = stock_by_name.get(k2, 0) + units

    forecasts = []
    for (product, sid), data in product_sales.items():
        avg_30 = data["qty_30"] / 30 if data["qty_30"] > 0 else 0
        avg_60 = data["qty_60"] / 60 if data["qty_60"] > 0 else 0
        avg_90 = data["qty_90"] / 90 if data["qty_90"] > 0 else 0
        best_avg = max(avg_30, avg_60, avg_90)
        reorder_qty = round(best_avg * days, 0)
        pid = data.get("pid", "")
        current_stock = stock_by_pid.get((pid, sid), 0) if pid else 0
        if current_stock == 0:
            current_stock = stock_by_name.get((product, sid), 0)
        days_of_stock = round(current_stock / best_avg, 0) if best_avg > 0 else 999

        forecasts.append({
            "product_name": product, "product_id": pid,
            "store_id": sid, "store_name": stores_map.get(sid, ""),
            "sales_30d": round(data["qty_30"], 0), "sales_60d": round(data["qty_60"], 0), "sales_90d": round(data["qty_90"], 0),
            "revenue_30d": round(data["amt_30"], 2), "revenue_90d": round(data["amt_90"], 2),
            "avg_daily": round(best_avg, 2),
            "reorder_qty": reorder_qty,
            "current_stock": round(current_stock, 0),
            "days_of_stock": min(days_of_stock, 999),
            "urgency": "critical" if days_of_stock < 7 else "low" if days_of_stock < 15 else "normal",
        })

    if search:
        sl = search.lower()
        forecasts = [f for f in forecasts if sl in f["product_name"].lower() or sl in (f["product_id"] or "").lower()]

    forecasts.sort(key=lambda x: x["days_of_stock"])
    total = len(forecasts)
    start = (page - 1) * limit
    return {"forecasts": forecasts[start:start + limit], "total": total, "forecast_days": days, "page": page, "limit": limit}


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

    # HO stock
    for s in (await db.execute(select(HOStockBatch).where(HOStockBatch.expiry_date.isnot(None)))).scalars().all():
        if not s.expiry_date or s.closing_stock <= 0:
            continue
        days_to_exp = (s.expiry_date - now).days
        if days_to_exp > 90:
            continue
        level = "30d" if days_to_exp <= 30 else "60d" if days_to_exp <= 60 else "90d"
        items.append({
            "location": "Head Office", "store_id": None,
            "product_id": s.product_id, "product_name": s.product_name,
            "batch": s.batch, "stock": s.closing_stock, "mrp": s.mrp or 0,
            "value": float(s.landing_cost_value or 0),
            "expiry_date": s.expiry_date.isoformat(), "days_to_expiry": days_to_exp,
            "risk_level": level,
        })

    # Store stock
    ss_q = select(StoreStockBatch).where(StoreStockBatch.expiry_date.isnot(None))
    if store_id:
        ss_q = ss_q.where(StoreStockBatch.store_id == store_id)
    for s in (await db.execute(ss_q)).scalars().all():
        if not s.expiry_date or s.closing_stock_strips <= 0:
            continue
        days_to_exp = (s.expiry_date - now).days
        if days_to_exp > 90:
            continue
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
    summary = {"30d": 0, "60d": 0, "90d": 0, "total_value": 0}
    for i in items:
        summary[i["risk_level"]] += 1
        summary["total_value"] += i["value"]
    summary["total_value"] = round(summary["total_value"], 2)

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
                dt = datetime.strptime(m["month"] + "-01", "%Y-%m-%d")
                label = dt.strftime("%B %Y")
            except: label = m["month"]
            merged[m["month"]] = {"month": m["month"], "label": label, "count": 0, "value": 0}
        merged[m["month"]]["count"] += m["count"]
        merged[m["month"]]["value"] += m["value"]

    months_sorted = sorted(merged.values(), key=lambda x: x["month"])
    for m in months_sorted:
        m["value"] = round(m["value"], 2)

    # Summary via SQL counts
    expired_count = 0; within_30 = 0; within_90 = 0; total_val = 0
    d30 = now + timedelta(days=30); d90 = now + timedelta(days=90)

    if not store_id:
        expired_count += (await db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date < now))).scalar() or 0
        within_30 += (await db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date >= now, HOStockBatch.expiry_date <= d30))).scalar() or 0
        within_90 += (await db.execute(select(func.count(HOStockBatch.id)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0, HOStockBatch.expiry_date >= now, HOStockBatch.expiry_date <= d90))).scalar() or 0
        total_val += float((await db.execute(select(func.sum(HOStockBatch.landing_cost_value)).where(HOStockBatch.expiry_date.isnot(None), HOStockBatch.closing_stock > 0))).scalar() or 0)

    ss_exp_base = select(func.count(StoreStockBatch.id)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0)
    if store_id: ss_exp_base = ss_exp_base.where(StoreStockBatch.store_id == store_id)
    expired_count += (await db.execute(ss_exp_base.where(StoreStockBatch.expiry_date < now))).scalar() or 0
    within_30 += (await db.execute(ss_exp_base.where(StoreStockBatch.expiry_date >= now, StoreStockBatch.expiry_date <= d30))).scalar() or 0
    within_90 += (await db.execute(ss_exp_base.where(StoreStockBatch.expiry_date >= now, StoreStockBatch.expiry_date <= d90))).scalar() or 0
    ss_val_q = select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.expiry_date.isnot(None), StoreStockBatch.closing_stock_strips > 0)
    if store_id: ss_val_q = ss_val_q.where(StoreStockBatch.store_id == store_id)
    total_val += float((await db.execute(ss_val_q)).scalar() or 0)

    total_batches = sum(m["count"] for m in months_sorted)

    return {
        "months": months_sorted,
        "summary": {"total_batches": total_batches, "expired": expired_count, "within_30d": within_30, "within_90d": within_90, "total_value": round(total_val, 2)},
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
                "value": round(float(s.landing_cost_value or 0), 2),
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
            "value": round(float(s.cost_value or 0), 2),
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
    now = datetime.now(timezone.utc)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # Find dead stock (no sales, 60+ days)
    dead = []
    for s in (await db.execute(select(StoreStockBatch))).scalars().all():
        if s.closing_stock_strips <= 0 or (s.sales or 0) > 0:
            continue
        days = (now - s.created_at).days if s.created_at else 0
        if days > 60:
            dead.append(s)

    # Find demand by product
    demand = {}
    for s in (await db.execute(select(StoreStockBatch).where(StoreStockBatch.sales > 0))).scalars().all():
        pid = s.ho_product_id or s.store_product_id
        if pid:
            demand.setdefault(pid, []).append({"store_id": s.store_id, "sales": float(s.sales or 0)})

    # Also check CRM sales records for demand signal
    for sr in (await db.execute(select(SalesRecord).where(SalesRecord.invoice_date >= now - timedelta(days=90)))).scalars().all():
        if sr.product_id:
            demand.setdefault(sr.product_id, []).append({"store_id": sr.store_id, "sales": 1})

    suggestions = []
    for d in dead:
        pid = d.ho_product_id or d.store_product_id
        if pid not in demand:
            continue
        days_dead = (now - d.created_at).days if d.created_at else 0
        # Find best receiving store (highest demand, different store)
        best = None
        for buyer in demand[pid]:
            if buyer["store_id"] != d.store_id:
                if not best or buyer["sales"] > best["sales"]:
                    best = buyer
        if best:
            suggestions.append({
                "product_name": d.product_name, "product_id": pid,
                "from_store": stores_map.get(d.store_id, ""), "from_store_id": d.store_id,
                "to_store": stores_map.get(best["store_id"], ""), "to_store_id": best["store_id"],
                "quantity": round(d.closing_stock_strips, 1), "days_dead": days_dead,
                "value": round(float(d.cost_value or 0), 2),
                "reason": f"Dead {days_dead}d at {stores_map.get(d.store_id, '')}, demand at {stores_map.get(best['store_id'], '')}",
            })

    suggestions.sort(key=lambda x: -x["value"])
    total_value = round(sum(s["value"] for s in suggestions), 2)
    return {"suggestions": suggestions[:50], "total_suggestions": len(suggestions), "total_recoverable_value": total_value}


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

    for mp in due_items:
        # Check if task already exists for this customer today
        existing = (await db.execute(
            select(func.count(CRMTask.id)).where(and_(
                CRMTask.customer_id == mp.customer_id,
                CRMTask.created_at >= today_start,
                CRMTask.status == "pending",
            ))
        )).scalar() or 0
        if existing > 0:
            continue

        is_overdue = mp.next_due_date < today_start
        days_info = abs((now - mp.next_due_date).days)
        notes = f"{'OVERDUE' if is_overdue else 'DUE'}: {mp.medicine_name} ({'overdue by ' + str(days_info) + 'd' if is_overdue else 'due in ' + str(days_info) + 'd'})"

        db.add(CRMTask(
            customer_id=mp.customer_id,
            due_date=now, status="pending",
            notes=notes, created_by=user["user_id"],
        ))
        created += 1

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
        if store_id and (c.assigned_store_id or c.first_store_id) != store_id:
            continue
        result.append({
            "task_id": t.id, "customer_id": c.id,
            "customer_name": c.customer_name, "mobile": c.mobile_number,
            "store": stores_map.get(c.assigned_store_id or c.first_store_id, ""),
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "adherence": c.adherence_score,
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
    from sqlalchemy import union_all, literal_column, case

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
        "avg_ptr": round(float(r[2] or 0), 2), "avg_landing_cost": round(float(r[3] or 0), 2),
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
        "ptr": round(float(r[3] or 0), 2), "landing_cost": round(float(r[4] or 0), 2),
        "mrp": round(float(r[5] or 0), 2),
        "margin_pct": round((1 - float(r[3] or 0) / float(r[5])) * 100, 1) if r[5] and float(r[5]) > 0 else 0,
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
            store_stocks.append({"store_id": r[0], "store_name": stores_map.get(r[0], ""), "stock": round(qty, 1)})

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
    """Enhanced store scorecard with CLV-per-store and CRM metrics."""
    now = datetime.now(timezone.utc)
    stores = (await db.execute(select(Store).where(Store.is_active == True).order_by(Store.store_name))).scalars().all()

    results = []
    for store in stores:
        sid = store.id

        # Inventory metrics
        stock_value = float((await db.execute(
            select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.store_id == sid)
        )).scalar() or 0)
        total_stock = float((await db.execute(
            select(func.sum(StoreStockBatch.closing_stock_strips)).where(StoreStockBatch.store_id == sid)
        )).scalar() or 0)
        total_sales_units = float((await db.execute(
            select(func.sum(StoreStockBatch.sales)).where(StoreStockBatch.store_id == sid)
        )).scalar() or 0)
        turnover = round(total_sales_units / total_stock, 2) if total_stock > 0 else 0

        # CLV metrics
        customer_count = (await db.execute(
            select(func.count(CRMCustomer.id)).where(
                (CRMCustomer.first_store_id == sid) | (CRMCustomer.assigned_store_id == sid)
            )
        )).scalar() or 0
        rc_count = (await db.execute(
            select(func.count(CRMCustomer.id)).where(and_(
                (CRMCustomer.first_store_id == sid) | (CRMCustomer.assigned_store_id == sid),
                CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]),
            ))
        )).scalar() or 0
        total_clv = float((await db.execute(
            select(func.sum(CRMCustomer.clv_value)).where(
                (CRMCustomer.first_store_id == sid) | (CRMCustomer.assigned_store_id == sid)
            )
        )).scalar() or 0)
        high_value_count = (await db.execute(
            select(func.count(CRMCustomer.id)).where(and_(
                (CRMCustomer.first_store_id == sid) | (CRMCustomer.assigned_store_id == sid),
                CRMCustomer.clv_tier == "high",
            ))
        )).scalar() or 0

        # CRM metrics
        sales_revenue = float((await db.execute(
            select(func.sum(SalesRecord.total_amount)).where(SalesRecord.store_id == sid)
        )).scalar() or 0)
        overdue_meds = (await db.execute(
            select(func.count(MedicinePurchase.id)).where(and_(
                MedicinePurchase.store_id == sid,
                MedicinePurchase.status == "active",
                MedicinePurchase.next_due_date < now,
            ))
        )).scalar() or 0

        retention_pct = round(rc_count / customer_count * 100, 1) if customer_count > 0 else 0

        results.append({
            "store_id": sid, "store_name": store.store_name, "store_code": store.store_code,
            "stock_value": round(stock_value, 2), "total_stock": round(total_stock, 1),
            "turnover": turnover, "sales_revenue": round(sales_revenue, 2),
            "customer_count": customer_count, "rc_count": rc_count,
            "retention_pct": retention_pct, "high_value_customers": high_value_count,
            "total_clv": round(total_clv, 2), "avg_clv": round(total_clv / customer_count, 2) if customer_count > 0 else 0,
            "overdue_meds": overdue_meds,
        })

    results.sort(key=lambda x: -x["total_clv"])
    return {"stores": results}


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
            "total_qty": round(qty, 0), "invoice_count": cnt,
            "total_amount": round(amt, 2), "store_count": int(r[5] or 0),
            "avg_price": round(amt / qty, 2) if qty > 0 else 0,
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

    # Stock Value from StoreStockBatch (stock ledger)
    stock_value = float((await db.execute(
        select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.store_id == store_id)
    )).scalar() or 0)
    total_stock_units = float((await db.execute(
        select(func.sum(StoreStockBatch.closing_stock_strips)).where(StoreStockBatch.store_id == store_id)
    )).scalar() or 0)
    total_sku = (await db.execute(
        select(func.count(StoreStockBatch.id)).where(StoreStockBatch.store_id == store_id)
    )).scalar() or 0

    # Sales from SalesRecord ONLY (sales uploads)
    total_sales_count = (await db.execute(
        select(func.count(SalesRecord.id)).where(and_(
            SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to,
        ))
    )).scalar() or 0
    total_sales_value = float((await db.execute(
        select(func.sum(SalesRecord.total_amount)).where(and_(
            SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to,
        ))
    )).scalar() or 0)

    # Date-wise sales breakdown from SalesRecord
    from sqlalchemy import cast, Date
    daily_sales_q = (await db.execute(
        select(
            cast(SalesRecord.invoice_date, Date).label("sale_date"),
            func.count(SalesRecord.id).label("count"),
            func.sum(SalesRecord.total_amount).label("amount"),
        ).where(and_(
            SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to,
        )).group_by(cast(SalesRecord.invoice_date, Date)).order_by(cast(SalesRecord.invoice_date, Date))
    )).all()
    daily_sales = [{"date": str(r[0]), "invoices": int(r[1] or 0), "amount": round(float(r[2] or 0), 2)} for r in daily_sales_q]

    # Top selling products from SalesRecord - use SUM(quantity) for actual qty sold
    top_products_q = (await db.execute(
        select(SalesRecord.product_name,
               func.sum(SalesRecord.quantity).label("qty"),
               func.count(SalesRecord.id).label("cnt"),
               func.sum(SalesRecord.total_amount).label("amt"))
        .where(and_(SalesRecord.store_id == store_id, SalesRecord.invoice_date >= d_from, SalesRecord.invoice_date < d_to))
        .group_by(SalesRecord.product_name).order_by(func.sum(SalesRecord.total_amount).desc()).limit(20)
    )).all()
    top_products = [{"product": str(r[0]), "qty": round(float(r[1] or 0), 0), "count": int(r[2] or 0), "amount": round(float(r[3] or 0), 2)} for r in top_products_q]

    # Customer count for this store
    customer_count = (await db.execute(
        select(func.count(CRMCustomer.id)).where(
            (CRMCustomer.first_store_id == store_id) | (CRMCustomer.assigned_store_id == store_id)
        )
    )).scalar() or 0

    # Purchase data from PurchaseRecord
    total_purchase_amount = float((await db.execute(
        select(func.sum(PurchaseRecord.total_amount)).where(and_(
            PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to,
        ))
    )).scalar() or 0)
    total_purchase_count = (await db.execute(
        select(func.count(func.distinct(PurchaseRecord.entry_number))).where(and_(
            PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to,
        ))
    )).scalar() or 0

    # Top suppliers by purchase amount
    top_suppliers_q = (await db.execute(
        select(PurchaseRecord.supplier_name, func.sum(PurchaseRecord.total_amount).label("amt"), func.sum(PurchaseRecord.quantity).label("qty"))
        .where(and_(PurchaseRecord.store_id == store_id, PurchaseRecord.purchase_date >= d_from, PurchaseRecord.purchase_date < d_to))
        .group_by(PurchaseRecord.supplier_name).order_by(func.sum(PurchaseRecord.total_amount).desc()).limit(20)
    )).all()
    top_suppliers = [{"supplier": str(r[0]), "amount": round(float(r[1] or 0), 2), "qty": round(float(r[2] or 0), 0)} for r in top_suppliers_q]

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
    daily_purchases = [{"date": str(r[0]), "invoices": int(r[1] or 0), "amount": round(float(r[2] or 0), 2)} for r in daily_purchases_q]

    return {
        "store": {"id": store.id, "name": store.store_name, "code": store.store_code, "location": store.location},
        "stock": {"value": round(stock_value, 2), "units": round(total_stock_units, 1), "sku_count": total_sku},
        "sales": {"count": total_sales_count, "value": round(total_sales_value, 2), "period_from": d_from.isoformat(), "period_to": d_to.isoformat()},
        "purchases": {"count": total_purchase_count, "value": round(total_purchase_amount, 2)},
        "daily_sales": daily_sales,
        "daily_purchases": daily_purchases,
        "top_products": top_products,
        "top_suppliers": top_suppliers,
        "customer_count": customer_count,
    }


@router.get("/intel/store-dashboard-summary")
async def store_dashboard_summary(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """All stores summary: stock value + sales value."""
    now = datetime.now(timezone.utc)
    d30 = now - timedelta(days=30)
    stores = (await db.execute(select(Store).where(Store.is_active == True).order_by(Store.store_name))).scalars().all()

    result = []
    for s in stores:
        stock_value = float((await db.execute(
            select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.store_id == s.id)
        )).scalar() or 0)
        sales_value = float((await db.execute(
            select(func.sum(SalesRecord.total_amount)).where(and_(SalesRecord.store_id == s.id, SalesRecord.invoice_date >= d30))
        )).scalar() or 0)
        sales_count = (await db.execute(
            select(func.count(SalesRecord.id)).where(and_(SalesRecord.store_id == s.id, SalesRecord.invoice_date >= d30))
        )).scalar() or 0
        stock_units = float((await db.execute(
            select(func.sum(StoreStockBatch.closing_stock_strips)).where(StoreStockBatch.store_id == s.id)
        )).scalar() or 0)

        purchase_value = float((await db.execute(
            select(func.sum(PurchaseRecord.total_amount)).where(and_(PurchaseRecord.store_id == s.id, PurchaseRecord.purchase_date >= d30))
        )).scalar() or 0)

        if stock_value > 0 or sales_value > 0 or purchase_value > 0:
            result.append({
                "store_id": s.id, "store_name": s.store_name, "store_code": s.store_code,
                "stock_value": round(stock_value, 2), "stock_units": round(stock_units, 1),
                "sales_value": round(sales_value, 2), "sales_count": sales_count,
                "purchase_value": round(purchase_value, 2),
            })

    result.sort(key=lambda x: -x["sales_value"])
    return {"stores": result}


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
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Enforce store for store roles
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        if store_id != user["store_id"]:
            raise HTTPException(403, "You can only upload for your assigned store")
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()

    # Auto-detect header row
    df = None
    for skip in [0, 1, 2, 3]:
        try:
            test_df = pd.read_excel(BytesIO(content), header=skip)
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
            df = pd.read_excel(BytesIO(content))
        except Exception as e:
            raise HTTPException(400, f"Failed to read Excel: {str(e)}")
    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    # Map columns
    original_cols = list(df.columns)
    df.columns = [str(col).strip().lower().replace('_', ' ') for col in df.columns]
    mapped = {}
    for col in df.columns:
        if col in PURCHASE_COLUMNS:
            mapped[col] = PURCHASE_COLUMNS[col]
    missing = [f for f in PURCHASE_REQUIRED if f not in set(mapped.values())]
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Your columns: {original_cols}")
    df = df.rename(columns=mapped)

    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if not store:
        raise HTTPException(400, f"Store ID {store_id} does not exist")

    # Load existing entries for dedup
    existing = set()
    for r in (await db.execute(select(PurchaseRecord.entry_number, PurchaseRecord.product_name).where(PurchaseRecord.store_id == store_id))).all():
        if r[0]:
            existing.add((str(r[0]).strip(), str(r[1] or "").strip()))

    batch_id = str(uuid.uuid4())[:12]
    success, skipped, failed = 0, 0, 0
    records = []
    errors = []

    for idx, row in df.iterrows():
        try:
            product = str(row.get("product_name", "")).strip()
            supplier = str(row.get("supplier_name", "")).strip()
            if not product or product == "nan":
                failed += 1
                errors.append(f"Row {idx+2}: Missing product name")
                continue
            if not supplier or supplier == "nan":
                failed += 1
                errors.append(f"Row {idx+2}: Missing supplier name for '{product}'")
                continue

            entry_num = str(row.get("entry_number", "")).strip() if pd.notna(row.get("entry_number")) else None
            if entry_num in ("", "nan", "None"):
                entry_num = None
            if entry_num and (entry_num, product) in existing:
                skipped += 1
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
            if pid and pid.endswith(".0"):
                pid = pid[:-2]
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
        except Exception as e:
            failed += 1
            errors.append(f"Row {idx+2}: {str(e)[:80]}")

    for r in records:
        db.add(r)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to save: {str(e)[:200]}")

    # Save upload history
    try:
        from models import UploadHistory, UploadType
        db.add(UploadHistory(file_name=file.filename, upload_type=UploadType.PURCHASE_REPORT, store_id=store_id,
            uploaded_by=user["user_id"], total_records=len(df), success_records=success, failed_records=failed,
            error_details=f"Purchase upload. Dupes skipped: {skipped}"))
        await db.commit()
    except Exception:
        pass

    return {"message": "Purchase report uploaded", "total": len(df), "new_records": success, "skipped_duplicate": skipped, "failed": failed, "errors": errors[:20]}


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
            "quantity": r.quantity or 0, "total_amount": round(float(r.total_amount or 0), 2),
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
    suppliers = [{"supplier": r[0], "amount": round(float(r[1] or 0), 2), "qty": round(float(r[2] or 0), 0), "records": int(r[3] or 0)} for r in sup_q]

    # Product-wise top purchases
    prod_q = (await db.execute(
        select(PurchaseRecord.product_name, PurchaseRecord.product_id,
               func.sum(PurchaseRecord.total_amount).label("amt"), func.sum(PurchaseRecord.quantity).label("qty"))
        .where(base).group_by(PurchaseRecord.product_name, PurchaseRecord.product_id)
        .order_by(func.sum(PurchaseRecord.total_amount).desc()).limit(50)
    )).all()
    products = [{"product": r[0], "product_id": r[1] or "", "amount": round(float(r[2] or 0), 2), "qty": round(float(r[3] or 0), 0)} for r in prod_q]

    # Store-wise
    store_q = (await db.execute(
        select(PurchaseRecord.store_id, func.sum(PurchaseRecord.total_amount).label("amt"),
               func.sum(PurchaseRecord.quantity).label("qty"))
        .where(base)
        .group_by(PurchaseRecord.store_id).order_by(func.sum(PurchaseRecord.total_amount).desc())
    )).all()
    store_spending = [{"store_id": r[0], "store_name": stores_map.get(r[0], ""), "amount": round(float(r[1] or 0), 2), "qty": round(float(r[2] or 0), 0)} for r in store_q]

    # Sales vs Purchase comparison per product (matching by product_id)
    sales_q = (await db.execute(
        select(SalesRecord.product_id, func.sum(SalesRecord.quantity).label("sq"), func.sum(SalesRecord.total_amount).label("sa"))
        .where(base if base is not True else True)
        .group_by(SalesRecord.product_id)
    )).all()
    sales_map = {r[0]: {"qty": float(r[1] or 0), "amt": float(r[2] or 0)} for r in sales_q if r[0]}

    comparison = []
    for p in products[:30]:
        pid = p["product_id"]
        s = sales_map.get(pid, {"qty": 0, "amt": 0})
        comparison.append({
            "product": p["product"], "product_id": pid,
            "purchase_qty": p["qty"], "purchase_amt": p["amount"],
            "sales_qty": round(s["qty"], 0), "sales_amt": round(s["amt"], 2),
        })

    return {
        "total_purchase_amount": round(total_amount, 2),
        "total_purchase_qty": round(total_qty, 0),
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
