from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import (
    Product, Store, HOStockBatch, StoreStockBatch,
    InterStoreTransfer, PurchaseRequest, SalesRecord,
    CRMCustomer, MedicinePurchase, CRMTask, CRMCallLog,
    TransferStatus, PurchaseStatus, CustomerType,
)
from auth import get_current_user, require_roles
from datetime import datetime, timezone, timedelta

router = APIRouter()


# ─── Unified Intelligence Dashboard ──────────────────────

@router.get("/intel/dashboard")
async def intel_dashboard(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
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
        },
    }


# ─── Demand Forecasting Engine ────────────────────────────

@router.get("/intel/demand-forecast")
async def demand_forecast(
    store_id: int = Query(None),
    days: int = Query(30),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    """Rule-based demand forecasting using CRM sales + store stock sales."""
    now = datetime.now(timezone.utc)
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    cutoff_30 = now - timedelta(days=30)
    cutoff_60 = now - timedelta(days=60)
    cutoff_90 = now - timedelta(days=90)

    # Gather sales data from CRM SalesRecords (primary)
    sr_query = select(SalesRecord)
    if store_id:
        sr_query = sr_query.where(SalesRecord.store_id == store_id)
    sales_records = (await db.execute(sr_query.where(SalesRecord.invoice_date >= cutoff_90))).scalars().all()

    # Aggregate by product + store
    product_sales = {}  # key: (product_name, store_id) -> {d30, d60, d90, amount}
    for sr in sales_records:
        key = (sr.product_name, sr.store_id)
        if key not in product_sales:
            product_sales[key] = {"d30": 0, "d60": 0, "d90": 0, "amount": 0, "pid": sr.product_id}
        product_sales[key]["d90"] += 1
        product_sales[key]["amount"] += float(sr.total_amount or 0)
        if sr.invoice_date and sr.invoice_date >= cutoff_60:
            product_sales[key]["d60"] += 1
        if sr.invoice_date and sr.invoice_date >= cutoff_30:
            product_sales[key]["d30"] += 1

    # Fallback: use store stock batch sales column
    ss_query = select(StoreStockBatch).where(StoreStockBatch.sales > 0)
    if store_id:
        ss_query = ss_query.where(StoreStockBatch.store_id == store_id)
    for ss in (await db.execute(ss_query)).scalars().all():
        key = (ss.product_name, ss.store_id)
        if key not in product_sales:
            product_sales[key] = {"d30": float(ss.sales or 0), "d60": float(ss.sales or 0), "d90": float(ss.sales or 0),
                                  "amount": 0, "pid": ss.ho_product_id or ss.store_product_id}

    # Get current stock levels
    stock_levels = {}
    for ss in (await db.execute(select(StoreStockBatch))).scalars().all():
        key = (ss.product_name, ss.store_id)
        stock_levels[key] = stock_levels.get(key, 0) + float(ss.closing_stock_strips or 0)

    # Calculate forecasts
    forecasts = []
    for (product, sid), data in product_sales.items():
        avg_daily_30 = data["d30"] / 30 if data["d30"] > 0 else 0
        avg_daily_60 = data["d60"] / 60 if data["d60"] > 0 else 0
        avg_daily_90 = data["d90"] / 90 if data["d90"] > 0 else 0
        best_avg = max(avg_daily_30, avg_daily_60, avg_daily_90)
        reorder_qty = round(best_avg * days, 0)
        current_stock = stock_levels.get((product, sid), 0)
        days_of_stock = round(current_stock / best_avg, 0) if best_avg > 0 else 999

        if reorder_qty > 0:
            forecasts.append({
                "product_name": product, "product_id": data.get("pid", ""),
                "store_id": sid, "store_name": stores_map.get(sid, ""),
                "sales_30d": data["d30"], "sales_60d": data["d60"], "sales_90d": data["d90"],
                "avg_daily": round(best_avg, 2),
                "reorder_qty": reorder_qty,
                "current_stock": round(current_stock, 1),
                "days_of_stock": min(days_of_stock, 999),
                "urgency": "critical" if days_of_stock < 7 else "low" if days_of_stock < 15 else "normal",
            })

    forecasts.sort(key=lambda x: x["days_of_stock"])
    return {"forecasts": forecasts[:200], "total": len(forecasts), "forecast_days": days}


# ─── Expiry Risk Detection ────────────────────────────────

@router.get("/intel/expiry-risk")
async def expiry_risk(
    risk_level: str = Query("all"),
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
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


# ─── Dead Stock Redistribution ────────────────────────────

@router.get("/intel/redistribution")
async def redistribution_suggestions(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
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
