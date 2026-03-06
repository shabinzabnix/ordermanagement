from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from database import get_db
from models import (
    CRMCustomer, MedicinePurchase, CRMCallLog, CRMTask,
    Store, CustomerType, CallResult, AuditLog,
)
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta

router = APIRouter()


async def _log(db, user, action, etype=None, eid=None):
    db.add(AuditLog(user_id=user.get("user_id", 0), user_name=user.get("full_name", ""),
                     action=action, entity_type=etype, entity_id=str(eid) if eid else None))


def _store_filter(user):
    """Returns store_id if user is store_staff, else None."""
    if user.get("role") == "store_staff" and user.get("store_id"):
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

    # Get active medicine count per customer
    cids = [c.id for c in customers]
    med_counts = {}
    if cids:
        mc_q = (await db.execute(
            select(MedicinePurchase.customer_id, func.count(MedicinePurchase.id).label("cnt"))
            .where(and_(MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active"))
            .group_by(MedicinePurchase.customer_id)
        )).all()
        med_counts = {r[0]: r[1] for r in mc_q}

    return {
        "customers": [{
            "id": c.id, "mobile_number": c.mobile_number, "customer_name": c.customer_name,
            "gender": c.gender, "age": c.age, "address": c.address,
            "first_store_id": c.first_store_id, "store_name": smap.get(c.first_store_id, ""),
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "active_medicines": med_counts.get(c.id, 0),
            "registration_date": c.registration_date.isoformat() if c.registration_date else None,
        } for c in customers],
        "total": total, "page": page, "limit": limit,
    }


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

    purchases = (await db.execute(
        select(MedicinePurchase).where(MedicinePurchase.customer_id == customer_id)
        .order_by(MedicinePurchase.purchase_date.desc())
    )).scalars().all()

    # Get store names for purchases
    psids = set(p.store_id for p in purchases)
    if psids:
        for s in (await db.execute(select(Store).where(Store.id.in_(psids)))).scalars().all():
            smap[s.id] = s.store_name

    calls = (await db.execute(
        select(CRMCallLog).where(CRMCallLog.customer_id == customer_id)
        .order_by(CRMCallLog.created_at.desc()).limit(20)
    )).scalars().all()

    tasks = (await db.execute(
        select(CRMTask).where(CRMTask.customer_id == customer_id)
        .order_by(CRMTask.created_at.desc()).limit(10)
    )).scalars().all()

    # Build timeline
    timeline = []
    for p in purchases:
        timeline.append({
            "type": "purchase", "date": p.purchase_date.isoformat() if p.purchase_date else None,
            "title": f"Purchased {p.medicine_name}", "subtitle": f"Qty: {p.quantity}, {p.days_of_medication} days at {smap.get(p.store_id, '')}",
            "status": p.status,
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
        },
        "medicine_calendar": medicine_calendar,
        "timeline": timeline[:30],
        "tasks": [{
            "id": t.id, "assigned_name": t.assigned_name, "due_date": t.due_date.isoformat() if t.due_date else None,
            "status": t.status, "notes": t.notes,
        } for t in tasks],
        "total_purchases": len(purchases),
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
