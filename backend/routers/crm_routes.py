from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from database import get_db
from models import (
    CRMCustomer, MedicinePurchase, CRMCallLog, CRMTask, SalesRecord,
    Store, CustomerType, CallResult, AuditLog,
)
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import uuid

router = APIRouter()


async def _log(db, user, action, etype=None, eid=None):
    db.add(AuditLog(user_id=user.get("user_id", 0), user_name=user.get("full_name", ""),
                     action=action, entity_type=etype, entity_id=str(eid) if eid else None))


def _store_filter(user):
    """Returns store_id if user is store_staff, else None."""
    if user.get("role") == "STORE_STAFF" and user.get("store_id"):
        return user["store_id"]
    return None


# ─── CRM Dashboard Stats ──────────────────────────────────

@router.get("/crm/dashboard")
async def crm_dashboard(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    d3 = now + timedelta(days=3)
    d7 = now + timedelta(days=7)
    sf = _store_filter(user)

    total_customers = (await db.execute(select(func.count(CRMCustomer.id)))).scalar() or 0
    rc_customers = (await db.execute(
        select(func.count(CRMCustomer.id)).where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))
    )).scalar() or 0

    due_q = select(func.count(MedicinePurchase.id)).where(MedicinePurchase.status == "active")
    if sf:
        due_q = due_q.where(MedicinePurchase.store_id == sf)

    due_today = (await db.execute(due_q.where(and_(
        MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=1)
    )))).scalar() or 0
    due_3d = (await db.execute(due_q.where(and_(
        MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < d3
    )))).scalar() or 0
    overdue = (await db.execute(due_q.where(MedicinePurchase.next_due_date < today_start))).scalar() or 0
    upcoming_7d = (await db.execute(due_q.where(and_(
        MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < d7
    )))).scalar() or 0

    calls_today = (await db.execute(
        select(func.count(CRMCallLog.id)).where(CRMCallLog.created_at >= today_start)
    )).scalar() or 0
    pending_tasks = (await db.execute(
        select(func.count(CRMTask.id)).where(CRMTask.status == "pending")
    )).scalar() or 0

    return {
        "total_customers": total_customers, "rc_customers": rc_customers,
        "due_today": due_today, "due_3days": due_3d, "overdue": overdue,
        "upcoming_7days": upcoming_7d, "calls_today": calls_today,
        "pending_tasks": pending_tasks,
    }


# ─── Customer CRUD ─────────────────────────────────────────

class CustomerCreateReq(BaseModel):
    mobile_number: str
    customer_name: str
    gender: Optional[str] = None
    age: Optional[int] = None
    address: Optional[str] = None
    store_id: int
    customer_type: str = "walkin"


@router.get("/crm/customers")
async def list_customers(
    search: str = Query(None), store_id: int = Query(None),
    customer_type: str = Query(None), page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort_by: str = Query("name"),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    query = select(CRMCustomer)
    if search:
        query = query.where(or_(
            CRMCustomer.customer_name.ilike(f"%{search}%"),
            CRMCustomer.mobile_number.ilike(f"%{search}%"),
        ))
    if sf:
        query = query.where(CRMCustomer.first_store_id == sf)
    elif store_id:
        query = query.where(CRMCustomer.first_store_id == store_id)
    if customer_type and customer_type != "all":
        query = query.where(CRMCustomer.customer_type == CustomerType(customer_type))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    customers = (await db.execute(
        query.order_by(CRMCustomer.customer_name).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    sids = set(c.first_store_id for c in customers if c.first_store_id)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    cids = [c.id for c in customers]
    med_counts = {}
    invoice_counts = {}
    total_spent = {}
    if cids:
        mc_q = (await db.execute(
            select(MedicinePurchase.customer_id, func.count(MedicinePurchase.id).label("cnt"))
            .where(and_(MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active"))
            .group_by(MedicinePurchase.customer_id)
        )).all()
        med_counts = {r[0]: r[1] for r in mc_q}

        # Invoice count and total spent from SalesRecord
        inv_q = (await db.execute(
            select(
                SalesRecord.customer_id,
                func.count(func.distinct(SalesRecord.entry_number)).label("inv_cnt"),
                func.sum(SalesRecord.total_amount).label("total_amt"),
            )
            .where(SalesRecord.customer_id.in_(cids))
            .group_by(SalesRecord.customer_id)
        )).all()
        for r in inv_q:
            invoice_counts[r[0]] = int(r[1] or 0)
            total_spent[r[0]] = round(float(r[2] or 0), 2)

    result = [{
        "id": c.id, "mobile_number": c.mobile_number, "customer_name": c.customer_name,
        "gender": c.gender, "age": c.age, "address": c.address,
        "first_store_id": c.first_store_id, "store_name": smap.get(c.first_store_id, ""),
        "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
        "active_medicines": med_counts.get(c.id, 0),
        "invoice_count": invoice_counts.get(c.id, 0),
        "total_spent": total_spent.get(c.id, 0),
        "clv_value": round(float(c.clv_value or 0), 2), "clv_tier": c.clv_tier or "unknown",
        "chronic_tags": c.chronic_tags.split(",") if c.chronic_tags else [],
        "registration_date": c.registration_date.isoformat() if c.registration_date else None,
    } for c in customers]

    # Sort
    if sort_by == "invoices":
        result.sort(key=lambda x: -x["invoice_count"])
    elif sort_by == "spent":
        result.sort(key=lambda x: -x["total_spent"])

    return {"customers": result, "total": total, "page": page, "limit": limit}


@router.post("/crm/customers")
async def create_customer(data: CustomerCreateReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    existing = (await db.execute(select(CRMCustomer).where(CRMCustomer.mobile_number == data.mobile_number))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"Customer with mobile {data.mobile_number} already exists (ID: {existing.id})")
    c = CRMCustomer(
        mobile_number=data.mobile_number, customer_name=data.customer_name,
        gender=data.gender, age=data.age, address=data.address,
        first_store_id=data.store_id, customer_type=CustomerType(data.customer_type),
        created_by=user["user_id"],
    )
    db.add(c)
    await _log(db, user, f"Created CRM customer: {data.customer_name} ({data.mobile_number})", "crm_customer")
    await db.commit()
    await db.refresh(c)
    return {"id": c.id, "message": "Customer created"}


@router.get("/crm/customers/{customer_id}")
async def get_customer_profile(customer_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")

    smap = {}
    if c.first_store_id:
        s = (await db.execute(select(Store).where(Store.id == c.first_store_id))).scalar_one_or_none()
        if s:
            smap[s.id] = s.store_name

    # Get SalesRecord data (primary source - from sales uploads)
    sales = (await db.execute(
        select(SalesRecord).where(SalesRecord.customer_id == customer_id)
        .order_by(SalesRecord.invoice_date.desc())
    )).scalars().all()

    # Get MedicinePurchase data (for refill tracking)
    purchases = (await db.execute(
        select(MedicinePurchase).where(MedicinePurchase.customer_id == customer_id)
        .order_by(MedicinePurchase.purchase_date.desc())
    )).scalars().all()

    # Get store names
    all_sids = set()
    for s in sales:
        if s.store_id: all_sids.add(s.store_id)
    for p in purchases:
        if p.store_id: all_sids.add(p.store_id)
    if all_sids:
        for s in (await db.execute(select(Store).where(Store.id.in_(all_sids)))).scalars().all():
            smap[s.id] = s.store_name

    calls = (await db.execute(
        select(CRMCallLog).where(CRMCallLog.customer_id == customer_id)
        .order_by(CRMCallLog.created_at.desc()).limit(20)
    )).scalars().all()

    tasks = (await db.execute(
        select(CRMTask).where(CRMTask.customer_id == customer_id)
        .order_by(CRMTask.created_at.desc()).limit(10)
    )).scalars().all()

    # --- Purchase History grouped by invoice ---
    invoices = {}
    total_spent = 0
    for s in sales:
        inv_key = s.entry_number or f"inv_{s.id}"
        if inv_key not in invoices:
            invoices[inv_key] = {
                "entry_number": s.entry_number, "invoice_date": s.invoice_date.isoformat() if s.invoice_date else None,
                "store_name": smap.get(s.store_id, ""), "items": [], "total_amount": 0,
            }
        amt = float(s.total_amount or 0)
        invoices[inv_key]["items"].append({
            "product_id": s.product_id, "product_name": s.product_name,
            "amount": round(amt, 2), "days_of_medication": s.days_of_medication,
        })
        invoices[inv_key]["total_amount"] += amt
        total_spent += amt
    invoice_list = sorted(invoices.values(), key=lambda x: x.get("invoice_date") or "", reverse=True)
    for inv in invoice_list:
        inv["total_amount"] = round(inv["total_amount"], 2)
        inv["item_count"] = len(inv["items"])

    # --- Medicine-wise repeat analysis ---
    medicine_stats = {}
    for s in sales:
        med = s.product_name
        if med not in medicine_stats:
            medicine_stats[med] = {"count": 0, "total_amount": 0, "dates": [], "product_id": s.product_id}
        medicine_stats[med]["count"] += 1
        medicine_stats[med]["total_amount"] += float(s.total_amount or 0)
        if s.invoice_date:
            medicine_stats[med]["dates"].append(s.invoice_date.isoformat())
    repeat_medicines = [
        {"medicine": med, "purchase_count": d["count"], "total_amount": round(d["total_amount"], 2),
         "product_id": d["product_id"], "is_repeat": d["count"] > 1,
         "first_purchase": min(d["dates"]) if d["dates"] else None, "last_purchase": max(d["dates"]) if d["dates"] else None}
        for med, d in medicine_stats.items()
    ]
    repeat_medicines.sort(key=lambda x: -x["purchase_count"])

    # Build timeline from sales + calls
    timeline = []
    for s in sales[:50]:
        timeline.append({
            "type": "purchase", "date": s.invoice_date.isoformat() if s.invoice_date else None,
            "title": f"Purchased {s.product_name}", "subtitle": f"INR {float(s.total_amount or 0):.0f} at {smap.get(s.store_id, '')}",
        })
    for p in purchases:
        if p.next_due_date:
            timeline.append({
                "type": "refill", "date": p.purchase_date.isoformat() if p.purchase_date else None,
                "title": f"Refill tracked: {p.medicine_name}", "subtitle": f"{p.days_of_medication}d, due {p.next_due_date.strftime('%d %b %Y') if p.next_due_date else ''}",
            })
    for cl in calls:
        timeline.append({
            "type": "call", "date": cl.created_at.isoformat() if cl.created_at else None,
            "title": f"Call: {cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result}",
            "subtitle": cl.remarks or "", "caller": cl.caller_name,
        })
    timeline.sort(key=lambda x: x.get("date") or "", reverse=True)

    now = datetime.now(timezone.utc)
    medicine_calendar = []
    for p in purchases:
        if p.status == "active" and p.next_due_date:
            days_until = (p.next_due_date - now).days
            medicine_calendar.append({
                "id": p.id, "medicine": p.medicine_name, "quantity": p.quantity,
                "days_of_medication": p.days_of_medication,
                "purchase_date": p.purchase_date.isoformat() if p.purchase_date else None,
                "next_due_date": p.next_due_date.isoformat() if p.next_due_date else None,
                "days_until": days_until, "overdue": days_until < 0,
                "store_name": smap.get(p.store_id, ""),
            })
    medicine_calendar.sort(key=lambda x: x["days_until"])

    return {
        "customer": {
            "id": c.id, "mobile_number": c.mobile_number, "customer_name": c.customer_name,
            "gender": c.gender, "age": c.age, "address": c.address,
            "first_store_id": c.first_store_id, "store_name": smap.get(c.first_store_id, ""),
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "registration_date": c.registration_date.isoformat() if c.registration_date else None,
            "clv_value": round(float(c.clv_value or 0), 2),
            "clv_tier": c.clv_tier or "unknown",
            "adherence_score": c.adherence_score or "unknown",
            "chronic_tags": c.chronic_tags.split(",") if c.chronic_tags else [],
        },
        "medicine_calendar": medicine_calendar,
        "invoices": invoice_list[:50],
        "repeat_medicines": repeat_medicines[:50],
        "timeline": timeline[:50],
        "tasks": [{
            "id": t.id, "assigned_name": t.assigned_name, "due_date": t.due_date.isoformat() if t.due_date else None,
            "status": t.status, "notes": t.notes,
        } for t in tasks],
        "total_purchases": len(sales),
        "total_spent": round(total_spent, 2),
        "total_invoices": len(invoice_list),
        "unique_medicines": len(medicine_stats),
        "repeat_count": sum(1 for m in repeat_medicines if m["is_repeat"]),
        "total_calls": len(calls),
    }


# ─── Medicine Purchases ────────────────────────────────────

class PurchaseReq(BaseModel):
    customer_id: int
    store_id: int
    medicine_name: str
    quantity: float = 0
    days_of_medication: int = 0
    purchase_date: Optional[str] = None


@router.post("/crm/purchases")
async def add_purchase(data: PurchaseReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == data.customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")

    pdate = datetime.now(timezone.utc)
    if data.purchase_date:
        try:
            pdate = datetime.fromisoformat(data.purchase_date.replace("Z", "+00:00"))
            if pdate.tzinfo is None:
                pdate = pdate.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    next_due = pdate + timedelta(days=data.days_of_medication) if data.days_of_medication > 0 else None

    # Mark previous active purchases of same medicine as completed
    prev = (await db.execute(
        select(MedicinePurchase).where(and_(
            MedicinePurchase.customer_id == data.customer_id,
            MedicinePurchase.medicine_name == data.medicine_name,
            MedicinePurchase.status == "active",
        ))
    )).scalars().all()
    for p in prev:
        p.status = "completed"

    purchase = MedicinePurchase(
        customer_id=data.customer_id, store_id=data.store_id,
        medicine_name=data.medicine_name, quantity=data.quantity,
        days_of_medication=data.days_of_medication, purchase_date=pdate,
        next_due_date=next_due, status="active", created_by=user["user_id"],
    )
    db.add(purchase)

    # Auto RC classification: 3+ purchases of same medicine in 90 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    count = (await db.execute(
        select(func.count(MedicinePurchase.id)).where(and_(
            MedicinePurchase.customer_id == data.customer_id,
            MedicinePurchase.medicine_name == data.medicine_name,
            MedicinePurchase.purchase_date >= cutoff,
        ))
    )).scalar() or 0
    if count >= 2 and c.customer_type == CustomerType.WALKIN:
        c.customer_type = CustomerType.RC

    await _log(db, user, f"Added purchase: {data.medicine_name} for {c.customer_name}", "crm_purchase", data.customer_id)
    await db.commit()
    await db.refresh(purchase)
    return {"id": purchase.id, "next_due_date": next_due.isoformat() if next_due else None, "message": "Purchase recorded"}


@router.put("/crm/purchases/{purchase_id}/stop")
async def stop_medicine(purchase_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    p = (await db.execute(select(MedicinePurchase).where(MedicinePurchase.id == purchase_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Purchase not found")
    p.status = "stopped"
    await db.commit()
    return {"message": "Medicine marked as stopped"}


# ─── Refill Due Management ─────────────────────────────────

@router.get("/crm/refill-due")
async def refill_due_list(
    category: str = Query("all"),
    store_id: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    query = select(MedicinePurchase).where(MedicinePurchase.status == "active")
    if sf:
        query = query.where(MedicinePurchase.store_id == sf)
    elif store_id:
        query = query.where(MedicinePurchase.store_id == store_id)

    if category == "overdue":
        query = query.where(MedicinePurchase.next_due_date < today_start)
    elif category == "today":
        query = query.where(and_(MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=1)))
    elif category == "3days":
        query = query.where(and_(MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=3)))
    elif category == "7days":
        query = query.where(and_(MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=7)))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    items = (await db.execute(query.order_by(MedicinePurchase.next_due_date).offset((page - 1) * limit).limit(limit))).scalars().all()

    cids = set(i.customer_id for i in items)
    sids = set(i.store_id for i in items)
    cmap, smap = {}, {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # Search filter on customer name/mobile (post-query for simplicity)
    result = []
    for i in items:
        ci = cmap.get(i.customer_id, {})
        if search:
            s_lower = search.lower()
            if s_lower not in (ci.get("name", "").lower()) and s_lower not in (ci.get("mobile", "").lower()) and s_lower not in i.medicine_name.lower():
                continue
        days_until = (i.next_due_date - now).days if i.next_due_date else 0
        result.append({
            "id": i.id, "customer_id": i.customer_id,
            "customer_name": ci.get("name", ""), "mobile_number": ci.get("mobile", ""),
            "store_id": i.store_id, "store_name": smap.get(i.store_id, ""),
            "medicine_name": i.medicine_name, "quantity": i.quantity,
            "days_of_medication": i.days_of_medication,
            "purchase_date": i.purchase_date.isoformat() if i.purchase_date else None,
            "next_due_date": i.next_due_date.isoformat() if i.next_due_date else None,
            "days_until": days_until, "overdue": days_until < 0,
        })

    return {"items": result, "total": total, "page": page, "limit": limit}


# ─── CRM Call Logging ──────────────────────────────────────

class CallLogReq(BaseModel):
    customer_id: int
    purchase_id: Optional[int] = None
    call_result: str
    remarks: str = ""


@router.post("/crm/calls")
async def log_call(data: CallLogReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == data.customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")
    call = CRMCallLog(
        customer_id=data.customer_id, purchase_id=data.purchase_id,
        caller_name=user.get("full_name", ""), call_result=CallResult(data.call_result),
        remarks=data.remarks, created_by=user["user_id"],
    )
    db.add(call)
    await db.commit()
    await db.refresh(call)
    return {"id": call.id, "message": "Call logged"}


@router.get("/crm/calls")
async def list_calls(
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    calls = (await db.execute(
        select(CRMCallLog).order_by(CRMCallLog.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()
    cids = set(cl.customer_id for cl in calls)
    cmap = {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number}
    return {
        "calls": [{
            "id": cl.id, "customer_id": cl.customer_id,
            "customer_name": cmap.get(cl.customer_id, {}).get("name", ""),
            "mobile_number": cmap.get(cl.customer_id, {}).get("mobile", ""),
            "caller_name": cl.caller_name,
            "call_result": cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result,
            "remarks": cl.remarks,
            "created_at": cl.created_at.isoformat() if cl.created_at else None,
        } for cl in calls]
    }


# ─── CRM Tasks ─────────────────────────────────────────────

class TaskReq(BaseModel):
    customer_id: int
    assigned_to: Optional[int] = None
    assigned_name: str = ""
    due_date: Optional[str] = None
    notes: str = ""


@router.post("/crm/tasks")
async def create_task(data: TaskReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    dd = None
    if data.due_date:
        try:
            dd = datetime.fromisoformat(data.due_date.replace("Z", "+00:00"))
        except ValueError:
            dd = datetime.now(timezone.utc) + timedelta(days=1)
    task = CRMTask(
        customer_id=data.customer_id, assigned_to=data.assigned_to,
        assigned_name=data.assigned_name, due_date=dd, notes=data.notes,
        created_by=user["user_id"],
    )
    db.add(task)
    await db.commit()
    return {"id": task.id, "message": "Task created"}


@router.put("/crm/tasks/{task_id}/complete")
async def complete_task(task_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    t = (await db.execute(select(CRMTask).where(CRMTask.id == task_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Task not found")
    t.status = "completed"
    await db.commit()
    return {"message": "Task completed"}


# ─── Customer Search (by medicine) ─────────────────────────

@router.get("/crm/search")
async def search_customers_by_medicine(
    medicine: str = Query(None), mobile: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    if medicine:
        purchases = (await db.execute(
            select(MedicinePurchase).where(MedicinePurchase.medicine_name.ilike(f"%{medicine}%"))
            .order_by(MedicinePurchase.purchase_date.desc()).limit(50)
        )).scalars().all()
        cids = set(p.customer_id for p in purchases)
        if not cids:
            return {"results": []}
        customers = (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all()
        return {"results": [{"id": c.id, "name": c.customer_name, "mobile": c.mobile_number,
                             "type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type}
                            for c in customers]}
    if mobile:
        customers = (await db.execute(
            select(CRMCustomer).where(CRMCustomer.mobile_number.ilike(f"%{mobile}%")).limit(20)
        )).scalars().all()
        return {"results": [{"id": c.id, "name": c.customer_name, "mobile": c.mobile_number,
                             "type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type}
                            for c in customers]}
    return {"results": []}


# ─── Sales Report Upload ────────────────────────────────────

SALES_COLUMNS = {
    "date of invoice": "invoice_date", "invoice date": "invoice_date", "date": "invoice_date",
    "entry number": "entry_number", "entry no": "entry_number", "invoice no": "entry_number", "invoice number": "entry_number",
    "patient name": "patient_name", "customer name": "patient_name", "patient": "patient_name", "customer": "patient_name",
    "mobile number": "mobile_number", "mobile": "mobile_number", "phone": "mobile_number", "contact": "mobile_number",
    "product id": "product_id", "item code": "product_id", "ho id": "product_id",
    "product name": "product_name", "item name": "product_name", "medicine": "product_name", "product": "product_name",
    "total amount": "total_amount", "amount": "total_amount", "total": "total_amount", "net amount": "total_amount",
    "qty": "qty", "quantity": "qty",
    "batch": "batch", "batch no": "batch",
    "mrp": "mrp",
    "net": "net_amount",
    "category": "category",
    "expiary": "expiry_date", "expiry": "expiry_date", "expiry date": "expiry_date",
}
SALES_REQUIRED = ["patient_name", "mobile_number", "product_name"]


@router.post("/crm/sales-upload")
async def upload_sales_report(
    store_id: int = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()

    # Try reading with different header rows (some pharmacy software adds title rows)
    df = None
    header_row_used = 0
    for skip in [0, 1, 2, 3]:
        try:
            test_df = pd.read_excel(BytesIO(content), header=skip)
            if test_df.empty:
                continue
            # Check if actual column names exist (not "Unnamed:")
            cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
            matched = sum(1 for c in cols_lower if c in SALES_COLUMNS)
            if matched >= 3:  # At least 3 required columns found
                df = test_df
                header_row_used = skip
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
        if col in SALES_COLUMNS:
            mapped[col] = SALES_COLUMNS[col]
    mapped_fields = set(mapped.values())
    missing = [f for f in SALES_REQUIRED if f not in mapped_fields]
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Your Excel columns (row {header_row_used+1}): {original_cols}")
    df = df.rename(columns=mapped)

    # Validate store exists
    store_check = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if not store_check:
        raise HTTPException(400, f"Store ID {store_id} does not exist. Please create the store first.")

    batch_id = str(uuid.uuid4())[:12]
    success, failed, new_customers, updated_customers = 0, 0, 0, 0
    errors = []
    non_registered = 0

    # Pre-load existing customers by mobile for fast lookup
    existing_customers = {}
    for c in (await db.execute(select(CRMCustomer))).scalars().all():
        existing_customers[c.mobile_number] = c

    # Process all rows - collect data first, then bulk insert
    new_custs_to_add = {}  # mobile -> CRMCustomer
    sales_to_add = []

    for idx, row in df.iterrows():
        try:
            mobile = str(row.get("mobile_number", "")).strip().replace(" ", "").replace("-", "")
            name = str(row.get("patient_name", "")).strip()
            product = str(row.get("product_name", "")).strip()
            if not product or product == "nan":
                failed += 1
                continue
            if not name or name == "nan":
                name = "Unknown Customer"

            # Clean mobile
            mobile_clean = None
            if mobile and mobile != "nan" and mobile != "None" and mobile != "":
                digits = ''.join(filter(str.isdigit, mobile))
                if len(digits) > 10:
                    digits = digits[-10:]
                if len(digits) >= 10:
                    mobile_clean = digits

            # Parse invoice date
            inv_date = None
            raw_date = row.get("invoice_date")
            if pd.notna(raw_date):
                try:
                    if isinstance(raw_date, str):
                        for fmt in ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"]:
                            try:
                                inv_date = datetime.strptime(raw_date.strip(), fmt).replace(tzinfo=timezone.utc)
                                break
                            except ValueError:
                                continue
                    else:
                        inv_date = pd.Timestamp(raw_date).to_pydatetime().replace(tzinfo=timezone.utc)
                except Exception:
                    inv_date = datetime.now(timezone.utc)

            # Track new customer
            if mobile_clean and mobile_clean not in existing_customers and mobile_clean not in new_custs_to_add:
                new_custs_to_add[mobile_clean] = name
                new_customers += 1
            elif mobile_clean and mobile_clean in existing_customers:
                updated_customers += 1

            if not mobile_clean:
                non_registered += 1

            sales_to_add.append({
                "store_id": store_id, "mobile": mobile_clean, "name": name,
                "inv_date": inv_date or datetime.now(timezone.utc),
                "entry_number": str(row.get("entry_number", "")).strip() if pd.notna(row.get("entry_number")) else None,
                "product_id": str(row.get("product_id", "")).strip() if pd.notna(row.get("product_id")) else None,
                "product_name": product,
                "total_amount": float(row.get("total_amount", 0)) if pd.notna(row.get("total_amount")) else 0,
            })
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)[:80]}")
            failed += 1

    # Bulk insert new customers
    for mobile, cname in new_custs_to_add.items():
        db.add(CRMCustomer(
            mobile_number=mobile, customer_name=cname,
            first_store_id=store_id, assigned_store_id=store_id,
            customer_type=CustomerType.WALKIN, created_by=user["user_id"],
        ))
    try:
        await db.flush()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to create customers: {str(e)[:200]}")

    # Reload customer map with new IDs
    all_customers = {}
    for c in (await db.execute(select(CRMCustomer))).scalars().all():
        all_customers[c.mobile_number] = c.id

    # Bulk insert sales records
    for s in sales_to_add:
        cust_id = all_customers.get(s["mobile"]) if s["mobile"] else None
        db.add(SalesRecord(
            store_id=s["store_id"], customer_id=cust_id,
            invoice_date=s["inv_date"], entry_number=s["entry_number"],
            patient_name=s["name"], mobile_number=s["mobile"] or "",
            product_id=s["product_id"], product_name=s["product_name"],
            total_amount=s["total_amount"], upload_batch_id=batch_id,
        ))

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to save sales records: {str(e)[:200]}")
    return {
        "message": "Sales report uploaded",
        "total": len(df), "success": success, "failed": failed,
        "new_customers": new_customers, "updated_customers": updated_customers,
        "non_registered": non_registered,
        "batch_id": batch_id, "errors": errors[:20],
    }


# ─── Sales Records (for medication duration update) ────────

@router.get("/crm/sales")
async def list_sales(
    store_id: int = Query(None), customer_id: int = Query(None),
    pending_only: bool = Query(False),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    query = select(SalesRecord)
    if sf:
        query = query.where(SalesRecord.store_id == sf)
    elif store_id:
        query = query.where(SalesRecord.store_id == store_id)
    if customer_id:
        query = query.where(SalesRecord.customer_id == customer_id)
    if pending_only:
        query = query.where(SalesRecord.medication_updated == False)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    records = (await db.execute(query.order_by(SalesRecord.invoice_date.desc()).offset((page - 1) * limit).limit(limit))).scalars().all()

    sids = set(r.store_id for r in records)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    return {
        "records": [{
            "id": r.id, "store_id": r.store_id, "store_name": smap.get(r.store_id, ""),
            "customer_id": r.customer_id, "patient_name": r.patient_name, "mobile_number": r.mobile_number,
            "invoice_date": r.invoice_date.isoformat() if r.invoice_date else None,
            "entry_number": r.entry_number, "product_name": r.product_name,
            "total_amount": r.total_amount or 0, "days_of_medication": r.days_of_medication,
            "next_due_date": r.next_due_date.isoformat() if r.next_due_date else None,
            "medication_updated": r.medication_updated,
        } for r in records],
        "total": total, "page": page, "limit": limit,
    }


class UpdateMedicationReq(BaseModel):
    days_of_medication: int


@router.put("/crm/sales/{record_id}/medication")
async def update_medication_days(
    record_id: int, data: UpdateMedicationReq,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    r = (await db.execute(select(SalesRecord).where(SalesRecord.id == record_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Record not found")

    r.days_of_medication = data.days_of_medication
    r.next_due_date = (r.invoice_date or datetime.now(timezone.utc)) + timedelta(days=data.days_of_medication)
    r.medication_updated = True

    # Also create/update MedicinePurchase for refill tracking
    if r.customer_id and r.product_name:
        prev = (await db.execute(select(MedicinePurchase).where(and_(
            MedicinePurchase.customer_id == r.customer_id,
            MedicinePurchase.medicine_name == r.product_name,
            MedicinePurchase.status == "active",
        )))).scalars().all()
        for p in prev:
            p.status = "completed"

        db.add(MedicinePurchase(
            customer_id=r.customer_id, store_id=r.store_id,
            medicine_name=r.product_name, quantity=0,
            days_of_medication=data.days_of_medication,
            purchase_date=r.invoice_date or datetime.now(timezone.utc),
            next_due_date=r.next_due_date, status="active",
            created_by=user["user_id"],
        ))

        # Auto RC classification
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        count = (await db.execute(select(func.count(SalesRecord.id)).where(and_(
            SalesRecord.customer_id == r.customer_id,
            SalesRecord.product_name == r.product_name,
            SalesRecord.invoice_date >= cutoff,
        )))).scalar() or 0
        if count >= 3:
            cust = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == r.customer_id))).scalar_one_or_none()
            if cust and cust.customer_type == CustomerType.WALKIN:
                cust.customer_type = CustomerType.RC

    await db.commit()
    return {"message": "Medication updated", "next_due_date": r.next_due_date.isoformat() if r.next_due_date else None}


# ─── Customer Allocation ────────────────────────────────────

class AllocationReq(BaseModel):
    customer_id: int
    store_id: int


@router.put("/crm/customers/{customer_id}/allocate")
async def allocate_customer(
    customer_id: int, data: AllocationReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")
    c.assigned_store_id = data.store_id
    await _log(db, user, f"Allocated customer {c.customer_name} to store {data.store_id}", "crm_allocation", customer_id)
    await db.commit()
    return {"message": "Customer allocated"}


# ─── Adherence Scoring ──────────────────────────────────────

@router.get("/crm/adherence")
async def adherence_scores(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Rule-based adherence scoring for all customers with active medicines."""
    now = datetime.now(timezone.utc)
    sf = _store_filter(user)

    mp_q = select(MedicinePurchase).where(MedicinePurchase.status == "active")
    if sf:
        mp_q = mp_q.where(MedicinePurchase.store_id == sf)
    elif store_id:
        mp_q = mp_q.where(MedicinePurchase.store_id == store_id)

    purchases = (await db.execute(mp_q)).scalars().all()
    cids = set(p.customer_id for p in purchases)
    if not cids:
        return {"scores": [], "summary": {"high": 0, "medium": 0, "low": 0, "unknown": 0}}

    cmap = {c.id: c for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all()}
    sids = set(p.store_id for p in purchases)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    customer_scores = {}
    for p in purchases:
        cid = p.customer_id
        if cid not in customer_scores:
            customer_scores[cid] = {"delays": [], "medicines": []}
        if p.next_due_date:
            delay = (now - p.next_due_date).days
            customer_scores[cid]["delays"].append(delay)
        customer_scores[cid]["medicines"].append(p.medicine_name)

    results = []
    summary = {"high": 0, "medium": 0, "low": 0}
    for cid, data in customer_scores.items():
        c = cmap.get(cid)
        if not c:
            continue
        max_delay = max(data["delays"]) if data["delays"] else 0
        if max_delay <= 3:
            score = "high"
        elif max_delay <= 10:
            score = "medium"
        else:
            score = "low"
        summary[score] += 1
        # Update on customer record
        c.adherence_score = score
        results.append({
            "customer_id": cid, "customer_name": c.customer_name, "mobile": c.mobile_number,
            "store_name": smap.get(c.assigned_store_id or c.first_store_id, ""),
            "adherence": score, "max_delay_days": max_delay,
            "active_medicines": len(set(data["medicines"])),
        })

    await db.commit()
    results.sort(key=lambda x: -x["max_delay_days"])
    return {"scores": results, "summary": summary}


# ─── CRM Performance Reports ────────────────────────────────

@router.get("/crm/reports/performance")
async def crm_performance(
    days: int = Query(30),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)

    # Calls in period
    total_calls = (await db.execute(
        select(func.count(CRMCallLog.id)).where(CRMCallLog.created_at >= cutoff)
    )).scalar() or 0

    # Call results breakdown
    call_results = (await db.execute(
        select(CRMCallLog.call_result, func.count(CRMCallLog.id).label("cnt"))
        .where(CRMCallLog.created_at >= cutoff)
        .group_by(CRMCallLog.call_result)
    )).all()
    result_breakdown = {r[0].value if hasattr(r[0], 'value') else r[0]: r[1] for r in call_results}

    confirmed = result_breakdown.get("confirmed", 0)
    conversion_rate = round(confirmed / total_calls * 100, 1) if total_calls > 0 else 0

    # Store-wise customer counts
    store_customers = (await db.execute(
        select(CRMCustomer.assigned_store_id, func.count(CRMCustomer.id).label("cnt"))
        .where(CRMCustomer.assigned_store_id.isnot(None))
        .group_by(CRMCustomer.assigned_store_id)
    )).all()
    sids = set(r[0] for r in store_customers if r[0])
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    store_report = []
    for r in store_customers:
        sid = r[0]
        if not sid:
            continue
        cust_count = r[1]
        # RC customers in this store
        rc_count = (await db.execute(
            select(func.count(CRMCustomer.id)).where(and_(
                CRMCustomer.assigned_store_id == sid,
                CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]),
            ))
        )).scalar() or 0
        # Overdue in this store
        overdue = (await db.execute(
            select(func.count(MedicinePurchase.id)).where(and_(
                MedicinePurchase.store_id == sid,
                MedicinePurchase.status == "active",
                MedicinePurchase.next_due_date < now,
            ))
        )).scalar() or 0
        retention_pct = round(rc_count / cust_count * 100, 1) if cust_count > 0 else 0
        store_report.append({
            "store_id": sid, "store_name": smap.get(sid, ""),
            "total_customers": cust_count, "rc_customers": rc_count,
            "retention_pct": retention_pct, "overdue": overdue,
        })
    store_report.sort(key=lambda x: -x["retention_pct"])

    # Sales upload stats
    total_sales_records = (await db.execute(
        select(func.count(SalesRecord.id)).where(SalesRecord.created_at >= cutoff)
    )).scalar() or 0
    pending_medication = (await db.execute(
        select(func.count(SalesRecord.id)).where(SalesRecord.medication_updated == False)
    )).scalar() or 0

    return {
        "period_days": days,
        "total_calls": total_calls,
        "call_results": result_breakdown,
        "conversion_rate": conversion_rate,
        "store_report": store_report,
        "total_sales_imported": total_sales_records,
        "pending_medication_updates": pending_medication,
    }


# ─── Customer Lifetime Value ────────────────────────────────

CHRONIC_MEDICINE_MAP = {
    "diabetes": ["metformin", "glimepiride", "insulin", "gliclazide", "voglibose", "sitagliptin", "dapagliflozin", "pioglitazone", "glucophage", "januvia", "jardiance", "amaryl", "galvus"],
    "blood_pressure": ["amlodipine", "telmisartan", "losartan", "ramipril", "enalapril", "olmesartan", "atenolol", "metoprolol", "nifedipine", "valsartan", "clinidipine", "cilnidipine", "arkamin"],
    "thyroid": ["thyronorm", "levothyroxine", "eltroxin", "thyrox", "thyroid"],
    "cardiac": ["aspirin", "atorvastatin", "clopidogrel", "rosuvastatin", "ecosprin", "clopilet", "ticagrelor", "prasugrel", "warfarin", "rivaroxaban"],
    "respiratory": ["montelukast", "salbutamol", "budesonide", "formoterol", "deriphyllin", "asthalin", "seroflo", "budecort"],
    "mental_health": ["escitalopram", "sertraline", "fluoxetine", "clonazepam", "alprazolam", "olanzapine", "quetiapine", "lithium"],
}


@router.post("/crm/calculate-clv")
async def calculate_clv(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    """Batch calculate CLV for all customers."""
    now = datetime.now(timezone.utc)
    one_year_ago = now - timedelta(days=365)
    customers = (await db.execute(select(CRMCustomer))).scalars().all()
    updated = 0

    for c in customers:
        # Sum total_amount from SalesRecord in last 365 days
        total = (await db.execute(
            select(func.sum(SalesRecord.total_amount)).where(and_(
                SalesRecord.customer_id == c.id,
                SalesRecord.invoice_date >= one_year_ago,
            ))
        )).scalar() or 0
        total = float(total)

        # Also count from MedicinePurchase if no SalesRecord
        if total == 0:
            purchase_count = (await db.execute(
                select(func.count(MedicinePurchase.id)).where(and_(
                    MedicinePurchase.customer_id == c.id,
                    MedicinePurchase.purchase_date >= one_year_ago,
                ))
            )).scalar() or 0
            total = float(purchase_count) * 500  # Estimated avg per purchase

        tier = "high" if total >= 10000 else "medium" if total >= 5000 else "low"
        c.clv_value = round(total, 2)
        c.clv_tier = tier

        # Auto-upgrade high-value customers
        if tier == "high" and c.customer_type == CustomerType.WALKIN:
            c.customer_type = CustomerType.HIGH_VALUE

        updated += 1

    await db.commit()
    return {"message": f"CLV calculated for {updated} customers", "updated": updated}


@router.get("/crm/clv-report")
async def clv_report(
    tier: str = Query("all"),
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    query = select(CRMCustomer)
    if sf:
        query = query.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    elif store_id:
        query = query.where(or_(CRMCustomer.first_store_id == store_id, CRMCustomer.assigned_store_id == store_id))
    if tier and tier != "all":
        query = query.where(CRMCustomer.clv_tier == tier)

    customers = (await db.execute(query.order_by(CRMCustomer.clv_value.desc()))).scalars().all()
    sids = set()
    for c in customers:
        if c.first_store_id: sids.add(c.first_store_id)
        if c.assigned_store_id: sids.add(c.assigned_store_id)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    summary = {"high": 0, "medium": 0, "low": 0, "total_value": 0}
    result = []
    for c in customers:
        t = c.clv_tier or "low"
        if t in summary:
            summary[t] += 1
        summary["total_value"] += float(c.clv_value or 0)
        result.append({
            "id": c.id, "customer_name": c.customer_name, "mobile": c.mobile_number,
            "store_name": smap.get(c.assigned_store_id or c.first_store_id, ""),
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "clv_value": round(float(c.clv_value or 0), 2), "clv_tier": t,
            "adherence": c.adherence_score or "unknown",
            "chronic_tags": c.chronic_tags.split(",") if c.chronic_tags else [],
        })

    summary["total_value"] = round(summary["total_value"], 2)
    return {"customers": result[:200], "summary": summary}


# ─── Chronic Patient Identification ──────────────────────────

@router.post("/crm/detect-chronic")
async def detect_chronic_patients(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    """Auto-detect chronic conditions from medicine purchase patterns."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    customers = (await db.execute(select(CRMCustomer))).scalars().all()
    tagged = 0

    for c in customers:
        # Get all medicines purchased by this customer
        medicines_q = await db.execute(
            select(SalesRecord.product_name, func.count(SalesRecord.id).label("cnt"))
            .where(and_(SalesRecord.customer_id == c.id, SalesRecord.invoice_date >= cutoff))
            .group_by(SalesRecord.product_name)
        )
        medicines = {str(r[0]).lower(): int(r[1]) for r in medicines_q.all()}

        # Also check MedicinePurchase
        mp_q = await db.execute(
            select(MedicinePurchase.medicine_name, func.count(MedicinePurchase.id).label("cnt"))
            .where(and_(MedicinePurchase.customer_id == c.id, MedicinePurchase.purchase_date >= cutoff))
            .group_by(MedicinePurchase.medicine_name)
        )
        for r in mp_q.all():
            key = str(r[0]).lower()
            medicines[key] = medicines.get(key, 0) + int(r[1])

        # Detect chronic conditions
        detected_tags = set()
        for condition, keywords in CHRONIC_MEDICINE_MAP.items():
            for med_name, count in medicines.items():
                if count >= 3:  # 3+ purchases in 90 days
                    for kw in keywords:
                        if kw in med_name:
                            detected_tags.add(condition)
                            break

        if detected_tags:
            c.chronic_tags = ",".join(sorted(detected_tags))
            if c.customer_type == CustomerType.WALKIN or c.customer_type == CustomerType.RC:
                c.customer_type = CustomerType.CHRONIC
            tagged += 1
        elif not c.chronic_tags:
            c.chronic_tags = None

    await db.commit()
    return {"message": f"Chronic detection complete. {tagged} patients tagged.", "tagged": tagged}


@router.get("/crm/chronic-report")
async def chronic_report(
    condition: str = Query("all"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    query = select(CRMCustomer).where(CRMCustomer.chronic_tags.isnot(None))
    if sf:
        query = query.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    customers = (await db.execute(query.order_by(CRMCustomer.customer_name))).scalars().all()

    sids = set()
    for c in customers:
        if c.first_store_id: sids.add(c.first_store_id)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}

    # Filter by condition
    result = []
    condition_counts = {}
    for c in customers:
        tags = c.chronic_tags.split(",") if c.chronic_tags else []
        for t in tags:
            condition_counts[t] = condition_counts.get(t, 0) + 1
        if condition != "all" and condition not in tags:
            continue
        result.append({
            "id": c.id, "customer_name": c.customer_name, "mobile": c.mobile_number,
            "store_name": smap.get(c.first_store_id, ""),
            "chronic_tags": tags, "adherence": c.adherence_score or "unknown",
            "clv_tier": c.clv_tier or "unknown",
        })

    return {"patients": result, "total": len(result), "condition_breakdown": condition_counts}


# ─── Customer Purchase History by Mobile ─────────────────────

@router.get("/crm/purchase-history/{mobile}")
async def customer_purchase_history(
    mobile: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Complete purchase history for a customer by mobile number, grouped by invoice."""
    from sqlalchemy import cast, Date

    # Clean mobile
    mobile_clean = ''.join(filter(str.isdigit, mobile))
    if len(mobile_clean) > 10:
        mobile_clean = mobile_clean[-10:]

    # Find customer
    customer = (await db.execute(
        select(CRMCustomer).where(CRMCustomer.mobile_number == mobile_clean)
    )).scalar_one_or_none()
    if not customer:
        # Try partial match
        customer = (await db.execute(
            select(CRMCustomer).where(CRMCustomer.mobile_number.ilike(f"%{mobile_clean}%"))
        )).scalar_one_or_none()
    if not customer:
        return {"customer": None, "invoices": [], "total_spent": 0, "total_invoices": 0, "total_items": 0}

    smap = {}
    if customer.first_store_id:
        s = (await db.execute(select(Store).where(Store.id == customer.first_store_id))).scalar_one_or_none()
        if s: smap[s.id] = s.store_name

    # Get all sales records for this customer
    records = (await db.execute(
        select(SalesRecord).where(SalesRecord.customer_id == customer.id)
        .order_by(SalesRecord.invoice_date.desc())
    )).scalars().all()

    # Get store names for all records
    for r in records:
        if r.store_id and r.store_id not in smap:
            s = (await db.execute(select(Store).where(Store.id == r.store_id))).scalar_one_or_none()
            if s: smap[s.id] = s.store_name

    # Group by entry_number (invoice)
    invoices = {}
    for r in records:
        inv_key = r.entry_number or f"no_inv_{r.id}"
        if inv_key not in invoices:
            invoices[inv_key] = {
                "entry_number": r.entry_number,
                "invoice_date": r.invoice_date.isoformat() if r.invoice_date else None,
                "store_name": smap.get(r.store_id, ""),
                "store_id": r.store_id,
                "items": [],
                "total_amount": 0,
            }
        item_amount = float(r.total_amount or 0)
        invoices[inv_key]["items"].append({
            "product_id": r.product_id,
            "product_name": r.product_name,
            "amount": round(item_amount, 2),
            "days_of_medication": r.days_of_medication,
            "next_due_date": r.next_due_date.isoformat() if r.next_due_date else None,
        })
        invoices[inv_key]["total_amount"] += item_amount

    # Round totals
    invoice_list = []
    for inv in invoices.values():
        inv["total_amount"] = round(inv["total_amount"], 2)
        inv["item_count"] = len(inv["items"])
        invoice_list.append(inv)

    total_spent = round(sum(inv["total_amount"] for inv in invoice_list), 2)

    return {
        "customer": {
            "id": customer.id, "name": customer.customer_name, "mobile": customer.mobile_number,
            "type": customer.customer_type.value if hasattr(customer.customer_type, 'value') else customer.customer_type,
            "store": smap.get(customer.first_store_id or customer.assigned_store_id, ""),
            "clv_value": round(float(customer.clv_value or 0), 2),
            "adherence": customer.adherence_score or "unknown",
            "chronic_tags": customer.chronic_tags.split(",") if customer.chronic_tags else [],
        },
        "invoices": invoice_list,
        "total_spent": total_spent,
        "total_invoices": len(invoice_list),
        "total_items": sum(inv["item_count"] for inv in invoice_list),
    }
