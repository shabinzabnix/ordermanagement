from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from database import get_db
from models import (
    CRMCustomer, MedicinePurchase, CRMCallLog, CRMTask, SalesRecord,
    Store, CustomerType, CallResult, AuditLog, User, StoreStockBatch,
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
    """Returns store_id if user is store_staff or store_manager, else None."""
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
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

    # For sort by invoices/spent, we need to join with SalesRecord aggregation
    if sort_by in ("invoices", "spent"):
        from sqlalchemy import outerjoin, literal_column
        sales_agg = (
            select(
                SalesRecord.customer_id,
                func.count(func.distinct(SalesRecord.entry_number)).label("inv_cnt"),
                func.sum(SalesRecord.total_amount).label("total_amt"),
            ).group_by(SalesRecord.customer_id)
        ).subquery()

        joined_q = (
            select(CRMCustomer, sales_agg.c.inv_cnt, sales_agg.c.total_amt)
            .outerjoin(sales_agg, CRMCustomer.id == sales_agg.c.customer_id)
        )
        # Apply same filters
        if search:
            joined_q = joined_q.where(or_(CRMCustomer.customer_name.ilike(f"%{search}%"), CRMCustomer.mobile_number.ilike(f"%{search}%")))
        if sf:
            joined_q = joined_q.where(CRMCustomer.first_store_id == sf)
        elif store_id:
            joined_q = joined_q.where(CRMCustomer.first_store_id == store_id)
        if customer_type and customer_type != "all":
            joined_q = joined_q.where(CRMCustomer.customer_type == CustomerType(customer_type))

        if sort_by == "invoices":
            joined_q = joined_q.order_by(func.coalesce(sales_agg.c.inv_cnt, 0).desc())
        else:
            joined_q = joined_q.order_by(func.coalesce(sales_agg.c.total_amt, 0).desc())

        joined_q = joined_q.offset((page - 1) * limit).limit(limit)
        rows = (await db.execute(joined_q)).all()
        customers = [r[0] for r in rows]
        # Pre-fill invoice/spent from joined data
        invoice_prefill = {r[0].id: int(r[1] or 0) for r in rows}
        spent_prefill = {r[0].id: round(float(r[2] or 0), 2) for r in rows}
    else:
        customers = (await db.execute(
            query.order_by(CRMCustomer.customer_name).offset((page - 1) * limit).limit(limit)
        )).scalars().all()
        invoice_prefill = None
        spent_prefill = None

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

        # Invoice count and total spent - use prefill if available, otherwise query
        if invoice_prefill is not None:
            invoice_counts = invoice_prefill
            total_spent = spent_prefill
        else:
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
                "dosage": p.dosage, "timing": p.timing, "food_relation": p.food_relation,
            })
    medicine_calendar.sort(key=lambda x: x["days_until"])

    # Get assigned staff name
    assigned_staff_name = ""
    if c.assigned_staff_id:
        staff = (await db.execute(select(User).where(User.id == c.assigned_staff_id))).scalar_one_or_none()
        if staff: assigned_staff_name = staff.full_name

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
            "assigned_staff_id": c.assigned_staff_id,
            "assigned_staff_name": assigned_staff_name,
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
        "call_logs": [{
            "id": cl.id, "caller_name": cl.caller_name or "",
            "call_result": cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result,
            "remarks": cl.remarks or "",
            "date": cl.created_at.isoformat() if cl.created_at else None,
        } for cl in calls],
    }


# ─── Medicine Purchases ────────────────────────────────────

class PurchaseReq(BaseModel):
    customer_id: int
    store_id: int
    medicine_name: str
    quantity: float = 0
    days_of_medication: int = 0
    purchase_date: Optional[str] = None
    dosage: Optional[str] = None
    timing: Optional[str] = None
    food_relation: Optional[str] = None


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
        dosage=data.dosage, timing=data.timing, food_relation=data.food_relation,
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



class UpdateCustomerTypeReq(BaseModel):
    customer_type: str


@router.put("/crm/customers/{customer_id}/type")
async def update_customer_type(customer_id: int, data: UpdateCustomerTypeReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")
    c.customer_type = CustomerType(data.customer_type)
    await db.commit()
    return {"message": f"Customer type updated to {data.customer_type}"}


class UpdateMedicationDetailReq(BaseModel):
    dosage: Optional[str] = None
    timing: Optional[str] = None
    food_relation: Optional[str] = None
    days_of_medication: Optional[int] = None


@router.put("/crm/purchases/{purchase_id}/medication-details")
async def update_medication_details(purchase_id: int, data: UpdateMedicationDetailReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    p = (await db.execute(select(MedicinePurchase).where(MedicinePurchase.id == purchase_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Purchase not found")
    if data.dosage is not None: p.dosage = data.dosage
    if data.timing is not None: p.timing = data.timing
    if data.food_relation is not None: p.food_relation = data.food_relation
    if data.days_of_medication is not None:
        p.days_of_medication = data.days_of_medication
        if p.purchase_date:
            p.next_due_date = p.purchase_date + timedelta(days=data.days_of_medication)
    await db.commit()
    return {"message": "Medication details updated", "next_due_date": p.next_due_date.isoformat() if p.next_due_date else None}



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
            cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
            matched = sum(1 for c in cols_lower if c in SALES_COLUMNS)
            if matched >= 3:
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

    # Load existing entry_numbers for this store to skip duplicates
    existing_entries = set()
    existing_q = (await db.execute(
        select(SalesRecord.entry_number, SalesRecord.product_name)
        .where(SalesRecord.store_id == store_id)
    )).all()
    for r in existing_q:
        if r[0]:
            existing_entries.add((str(r[0]).strip(), str(r[1] or "").strip()))

    batch_id = str(uuid.uuid4())[:12]
    success, failed, new_customers, updated_customers = 0, 0, 0, 0
    skipped_duplicate = 0
    errors = []
    non_registered = 0

    # Pre-load existing customers by mobile for fast lookup
    existing_customers = {}
    for c in (await db.execute(select(CRMCustomer))).scalars().all():
        existing_customers[c.mobile_number] = c

    # Process all rows - collect data first, then bulk insert
    new_custs_to_add = {}
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

            # Parse entry_number
            entry_num = str(row.get("entry_number", "")).strip() if pd.notna(row.get("entry_number")) else None
            if entry_num in ("", "nan", "None"):
                entry_num = None

            # Skip if this entry_number + product already exists for this store
            if entry_num and (entry_num, product) in existing_entries:
                skipped_duplicate += 1
                continue

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
                "entry_number": entry_num,
                "product_id": str(row.get("product_id", "")).strip().replace(".0", "") if pd.notna(row.get("product_id")) else None,
                "product_name": product,
                "quantity": float(row.get("qty", 0)) if pd.notna(row.get("qty")) else (float(row.get("quantity", 0)) if pd.notna(row.get("quantity")) else 0),
                "total_amount": float(row.get("total_amount", 0)) if pd.notna(row.get("total_amount")) else 0,
            })
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)[:80]}")
            failed += 1

    # Verify user exists in DB (token may be stale after data clear)
    valid_user_id = None
    user_check = (await db.execute(select(CRMCustomer.id).limit(0))).all()  # just to keep session alive
    from models import User as UserModel
    u_exists = (await db.execute(select(UserModel.id).where(UserModel.id == user["user_id"]))).scalar_one_or_none()
    valid_user_id = u_exists if u_exists else None

    # Bulk insert new customers
    for mobile, cname in new_custs_to_add.items():
        db.add(CRMCustomer(
            mobile_number=mobile, customer_name=cname,
            first_store_id=store_id, assigned_store_id=store_id,
            customer_type=CustomerType.WALKIN, created_by=valid_user_id,
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
            quantity=s["quantity"], total_amount=s["total_amount"],
            upload_batch_id=batch_id,
        ))

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Failed to save sales records: {str(e)[:200]}")
    return {
        "message": "Sales report uploaded",
        "total": len(df), "new_records": success, "skipped_duplicate": skipped_duplicate, "failed": failed,
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


# ─── Store CRM Dashboard ────────────────────────────────────

@router.get("/crm/store-crm-dashboard")
async def store_crm_dashboard(
    date_from: str = Query(None), date_to: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Parse date filters
    d_from = today_start - timedelta(days=7)
    d_to = now
    if date_from:
        try: d_from = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        except: pass
    if date_to:
        try: d_to = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        except: pass

    # KPIs
    cust_q = select(func.count(CRMCustomer.id))
    rc_q = select(func.count(CRMCustomer.id)).where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))
    if sf:
        cust_q = cust_q.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
        rc_q = rc_q.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    total_customers = (await db.execute(cust_q)).scalar() or 0
    rc_customers = (await db.execute(rc_q)).scalar() or 0

    due_q = select(func.count(MedicinePurchase.id)).where(MedicinePurchase.status == "active")
    if sf: due_q = due_q.where(MedicinePurchase.store_id == sf)
    overdue = (await db.execute(due_q.where(MedicinePurchase.next_due_date < today_start))).scalar() or 0
    due_today = (await db.execute(due_q.where(and_(MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=1))))).scalar() or 0
    due_7d = (await db.execute(due_q.where(and_(MedicinePurchase.next_due_date >= today_start, MedicinePurchase.next_due_date < today_start + timedelta(days=7))))).scalar() or 0

    # New customers in date range
    nc_q = select(CRMCustomer).where(CRMCustomer.created_at >= d_from, CRMCustomer.created_at < d_to)
    if sf: nc_q = nc_q.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    new_customers_list = (await db.execute(nc_q.order_by(CRMCustomer.created_at.desc()).limit(50))).scalars().all()
    new_customers = [{
        "id": c.id, "name": c.customer_name, "mobile": c.mobile_number,
        "type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
        "date": c.created_at.isoformat() if c.created_at else None,
    } for c in new_customers_list]

    # RC customer recent purchases (from MedicinePurchase)
    rc_cids_q = select(CRMCustomer.id).where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))
    if sf: rc_cids_q = rc_cids_q.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    rc_cids = [r[0] for r in (await db.execute(rc_cids_q)).all()]

    rc_purchases = []
    if rc_cids:
        rp_q = select(MedicinePurchase).where(
            MedicinePurchase.customer_id.in_(rc_cids),
            MedicinePurchase.purchase_date >= d_from, MedicinePurchase.purchase_date < d_to,
        ).order_by(MedicinePurchase.purchase_date.desc()).limit(50)
        if sf: rp_q = rp_q.where(MedicinePurchase.store_id == sf)
        rp_items = (await db.execute(rp_q)).scalars().all()
        rp_cmap = {}
        rp_cids = set(p.customer_id for p in rp_items)
        if rp_cids:
            for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(rp_cids)))).scalars().all():
                rp_cmap[c.id] = c.customer_name
        rc_purchases = [{
            "id": p.id, "customer_id": p.customer_id, "customer_name": rp_cmap.get(p.customer_id, ""),
            "medicine": p.medicine_name, "quantity": p.quantity, "dosage": p.dosage, "timing": p.timing,
            "date": p.purchase_date.isoformat() if p.purchase_date else None,
            "next_due": p.next_due_date.isoformat() if p.next_due_date else None,
        } for p in rp_items]

    # Upcoming RC purchases (by due date)
    upcoming_q = select(MedicinePurchase).where(
        MedicinePurchase.status == "active",
        MedicinePurchase.next_due_date >= today_start,
        MedicinePurchase.next_due_date < today_start + timedelta(days=14),
    )
    if sf: upcoming_q = upcoming_q.where(MedicinePurchase.store_id == sf)
    if rc_cids: upcoming_q = upcoming_q.where(MedicinePurchase.customer_id.in_(rc_cids))
    upcoming_items = (await db.execute(upcoming_q.order_by(MedicinePurchase.next_due_date))).scalars().all()
    up_cids = set(p.customer_id for p in upcoming_items)
    up_cmap = {}
    if up_cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(up_cids)))).scalars().all():
            up_cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number}
    upcoming = [{
        "id": p.id, "customer_id": p.customer_id,
        "customer_name": up_cmap.get(p.customer_id, {}).get("name", ""),
        "mobile": up_cmap.get(p.customer_id, {}).get("mobile", ""),
        "medicine": p.medicine_name, "quantity": p.quantity,
        "due_date": p.next_due_date.isoformat() if p.next_due_date else None,
        "days_until": (p.next_due_date - now).days if p.next_due_date else 0,
    } for p in upcoming_items]

    return {
        "kpis": {
            "total_customers": total_customers, "rc_customers": rc_customers,
            "overdue": overdue, "due_today": due_today, "due_7days": due_7d,
            "new_in_range": len(new_customers),
        },
        "new_customers": new_customers,
        "rc_purchases": rc_purchases,
        "upcoming_purchases": upcoming,
    }


# ─── Assign RC Customer to Staff ─────────────────────────────

class AssignStaffReq(BaseModel):
    staff_id: int


@router.put("/crm/customers/{customer_id}/assign-staff")
async def assign_customer_to_staff(
    customer_id: int, data: AssignStaffReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "STORE_MANAGER")),
):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")
    staff = (await db.execute(select(User).where(User.id == data.staff_id))).scalar_one_or_none()
    if not staff:
        raise HTTPException(404, "Staff member not found")
    c.assigned_staff_id = data.staff_id
    await _log(db, user, f"Assigned customer {c.customer_name} to staff {staff.full_name}", "crm_assignment", customer_id)
    await db.commit()
    return {"message": f"Customer assigned to {staff.full_name}"}


# ─── Store Staff List (for assignment dropdown) ──────────────

@router.get("/crm/store-staff")
async def get_store_staff(
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    sid = sf or store_id
    q = select(User).where(User.is_active == True)
    if sid:
        q = q.where(User.store_id == sid)
    q = q.where(User.role.in_(["STORE_STAFF", "STORE_MANAGER"]))
    staff = (await db.execute(q.order_by(User.full_name))).scalars().all()
    return {"staff": [{"id": s.id, "name": s.full_name, "email": s.email, "role": s.role.value if hasattr(s.role, 'value') else s.role} for s in staff]}


# ─── Staff Performance Dashboard ─────────────────────────────

@router.get("/crm/staff-performance")
async def staff_performance(
    store_id: int = Query(None), days: int = Query(30),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    sid = sf or store_id
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)

    # Get store staff
    q = select(User).where(User.is_active == True, User.role.in_(["STORE_STAFF", "STORE_MANAGER"]))
    if sid: q = q.where(User.store_id == sid)
    staff_list = (await db.execute(q.order_by(User.full_name))).scalars().all()

    results = []
    for s in staff_list:
        # Assigned RC customers
        assigned = (await db.execute(
            select(func.count(CRMCustomer.id)).where(CRMCustomer.assigned_staff_id == s.id)
        )).scalar() or 0

        # Calls made in period
        calls = (await db.execute(
            select(func.count(CRMCallLog.id)).where(CRMCallLog.created_by == s.id, CRMCallLog.created_at >= cutoff)
        )).scalar() or 0

        # Confirmed calls (conversion)
        confirmed = (await db.execute(
            select(func.count(CRMCallLog.id)).where(
                CRMCallLog.created_by == s.id, CRMCallLog.created_at >= cutoff,
                CRMCallLog.call_result == CallResult.CONFIRMED,
            )
        )).scalar() or 0

        # Overdue refills under their watch
        overdue_count = 0
        assigned_cids = [r[0] for r in (await db.execute(
            select(CRMCustomer.id).where(CRMCustomer.assigned_staff_id == s.id)
        )).all()]
        if assigned_cids:
            overdue_count = (await db.execute(
                select(func.count(MedicinePurchase.id)).where(
                    MedicinePurchase.customer_id.in_(assigned_cids),
                    MedicinePurchase.status == "active",
                    MedicinePurchase.next_due_date < now,
                )
            )).scalar() or 0

        # Tasks completed
        tasks_done = (await db.execute(
            select(func.count(CRMTask.id)).where(CRMTask.assigned_to == s.id, CRMTask.status == "completed")
        )).scalar() or 0

        conversion_rate = round(confirmed / calls * 100, 1) if calls > 0 else 0

        results.append({
            "staff_id": s.id, "name": s.full_name, "email": s.email,
            "role": s.role.value if hasattr(s.role, 'value') else s.role,
            "assigned_customers": assigned, "calls_made": calls,
            "confirmed_calls": confirmed, "conversion_rate": conversion_rate,
            "overdue_refills": overdue_count, "tasks_completed": tasks_done,
        })

    results.sort(key=lambda x: -x["assigned_customers"])
    return {"staff": results, "period_days": days}


# ─── Enhanced Refill Due with Stock Info ──────────────────────

@router.get("/crm/refill-due-enhanced")
async def refill_due_enhanced(
    category: str = Query("all"),
    store_id: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    target_store = sf or (int(store_id) if store_id else None)

    query = select(MedicinePurchase).where(MedicinePurchase.status == "active")
    if sf:
        query = query.where(MedicinePurchase.store_id == sf)
    elif store_id:
        query = query.where(MedicinePurchase.store_id == int(store_id))

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
            cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number, "assigned_staff_id": c.assigned_staff_id}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # Get stock info for medicines at the target store
    stock_map = {}
    if target_store:
        medicine_names = set(i.medicine_name for i in items)
        if medicine_names:
            # Match by product name in store stock
            for mn in medicine_names:
                stock_q = select(func.sum(StoreStockBatch.closing_stock_strips)).where(
                    StoreStockBatch.store_id == target_store,
                    StoreStockBatch.product_name.ilike(f"%{mn}%"),
                )
                stock_val = (await db.execute(stock_q)).scalar() or 0
                stock_map[mn] = float(stock_val)

    # Staff name map
    staff_ids = set(ci.get("assigned_staff_id") for ci in cmap.values() if ci.get("assigned_staff_id"))
    staff_map = {}
    if staff_ids:
        for u in (await db.execute(select(User).where(User.id.in_(staff_ids)))).scalars().all():
            staff_map[u.id] = u.full_name

    result = []
    for i in items:
        ci = cmap.get(i.customer_id, {})
        if search:
            s_lower = search.lower()
            if s_lower not in ci.get("name", "").lower() and s_lower not in ci.get("mobile", "").lower() and s_lower not in i.medicine_name.lower():
                continue
        days_until = (i.next_due_date - now).days if i.next_due_date else 0
        in_stock = stock_map.get(i.medicine_name, 0)
        required = max(0, (i.quantity or 0) - in_stock)
        staff_id = ci.get("assigned_staff_id")
        result.append({
            "id": i.id, "customer_id": i.customer_id,
            "customer_name": ci.get("name", ""), "mobile_number": ci.get("mobile", ""),
            "store_id": i.store_id, "store_name": smap.get(i.store_id, ""),
            "medicine_name": i.medicine_name, "quantity": i.quantity,
            "days_of_medication": i.days_of_medication,
            "purchase_date": i.purchase_date.isoformat() if i.purchase_date else None,
            "next_due_date": i.next_due_date.isoformat() if i.next_due_date else None,
            "days_until": days_until, "overdue": days_until < 0,
            "in_stock": in_stock, "required": required,
            "assigned_staff": staff_map.get(staff_id, "") if staff_id else "",
            "assigned_staff_id": staff_id,
        })

    return {"items": result, "total": total, "page": page, "limit": limit}


# ─── Repeat Medicine Purchases ────────────────────────────────

@router.get("/crm/repeat-purchases")
async def repeat_purchases(
    store_id: int = Query(None),
    min_count: int = Query(2, ge=2),
    search: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Customers purchasing the same medicine repeatedly (2+ times)."""
    sf = _store_filter(user)
    target_store = sf or (int(store_id) if store_id else None)

    # Aggregate: customer_id + product_name -> count, total_amount, min/max date
    agg_q = (
        select(
            SalesRecord.customer_id,
            SalesRecord.product_name,
            SalesRecord.product_id,
            func.count(SalesRecord.id).label("purchase_count"),
            func.sum(SalesRecord.total_amount).label("total_spent"),
            func.sum(SalesRecord.quantity).label("total_qty"),
            func.min(SalesRecord.invoice_date).label("first_date"),
            func.max(SalesRecord.invoice_date).label("last_date"),
        )
        .where(SalesRecord.customer_id.isnot(None))
        .group_by(SalesRecord.customer_id, SalesRecord.product_name, SalesRecord.product_id)
        .having(func.count(SalesRecord.id) >= min_count)
    )
    if target_store:
        agg_q = agg_q.where(SalesRecord.store_id == target_store)

    # Subquery for total count
    sub = agg_q.subquery()
    total = (await db.execute(select(func.count()).select_from(sub))).scalar() or 0

    # Fetch page
    rows = (await db.execute(
        agg_q.order_by(func.count(SalesRecord.id).desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()

    # Get customer names
    cids = set(r[0] for r in rows if r[0])
    cmap = {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            cmap[c.id] = {
                "name": c.customer_name, "mobile": c.mobile_number,
                "type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
                "store_id": c.first_store_id,
            }

    # Get store names
    sids = set(ci.get("store_id") for ci in cmap.values() if ci.get("store_id"))
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # Check if medicine is tracked (has active MedicinePurchase)
    tracked_set = set()
    if cids:
        tracked = (await db.execute(
            select(MedicinePurchase.customer_id, MedicinePurchase.medicine_name)
            .where(MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active")
        )).all()
        tracked_set = set((r[0], r[1]) for r in tracked)

    result = []
    for r in rows:
        cid, product_name, product_id, count, spent, qty, first_d, last_d = r
        ci = cmap.get(cid, {})
        if search:
            sl = search.lower()
            if sl not in ci.get("name", "").lower() and sl not in ci.get("mobile", "").lower() and sl not in (product_name or "").lower():
                continue
        # Days between first and last purchase
        span_days = (last_d - first_d).days if first_d and last_d else 0
        avg_interval = round(span_days / (count - 1), 1) if count > 1 and span_days > 0 else 0
        is_tracked = (cid, product_name) in tracked_set

        result.append({
            "customer_id": cid, "customer_name": ci.get("name", ""), "mobile": ci.get("mobile", ""),
            "customer_type": ci.get("type", "walkin"),
            "store_name": smap.get(ci.get("store_id"), ""),
            "product_name": product_name, "product_id": product_id,
            "purchase_count": count, "total_spent": round(float(spent or 0), 2),
            "total_qty": float(qty or 0),
            "first_purchase": first_d.isoformat() if first_d else None,
            "last_purchase": last_d.isoformat() if last_d else None,
            "avg_interval_days": avg_interval,
            "is_tracked": is_tracked,
        })

    return {"items": result, "total": total, "page": page, "limit": limit}


# ─── RC Customers List (store-wise) ──────────────────────────

@router.get("/crm/rc-customers")
async def rc_customers_list(
    store_id: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)

    query = select(CRMCustomer).where(
        CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC])
    )
    if sf:
        query = query.where(or_(CRMCustomer.first_store_id == sf, CRMCustomer.assigned_store_id == sf))
    elif store_id:
        query = query.where(or_(CRMCustomer.first_store_id == store_id, CRMCustomer.assigned_store_id == store_id))

    if search:
        query = query.where(or_(
            CRMCustomer.customer_name.ilike(f"%{search}%"),
            CRMCustomer.mobile_number.ilike(f"%{search}%"),
        ))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    customers = (await db.execute(
        query.order_by(CRMCustomer.customer_name).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    cids = [c.id for c in customers]
    sids = set()
    staff_ids = set()
    for c in customers:
        if c.first_store_id: sids.add(c.first_store_id)
        if c.assigned_store_id: sids.add(c.assigned_store_id)
        if c.assigned_staff_id: staff_ids.add(c.assigned_staff_id)

    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}
    staff_map = {}
    if staff_ids:
        for u in (await db.execute(select(User).where(User.id.in_(staff_ids)))).scalars().all():
            staff_map[u.id] = u.full_name

    # Active medicines count + overdue count per customer
    med_info = {}
    overdue_info = {}
    now = datetime.now(timezone.utc)
    if cids:
        med_q = (await db.execute(
            select(MedicinePurchase.customer_id, func.count(MedicinePurchase.id))
            .where(MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active")
            .group_by(MedicinePurchase.customer_id)
        )).all()
        med_info = {r[0]: r[1] for r in med_q}

        overdue_q = (await db.execute(
            select(MedicinePurchase.customer_id, func.count(MedicinePurchase.id))
            .where(MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active", MedicinePurchase.next_due_date < now)
            .group_by(MedicinePurchase.customer_id)
        )).all()
        overdue_info = {r[0]: r[1] for r in overdue_q}

    # Total spent per customer
    spent_info = {}
    if cids:
        spent_q = (await db.execute(
            select(SalesRecord.customer_id, func.sum(SalesRecord.total_amount))
            .where(SalesRecord.customer_id.in_(cids))
            .group_by(SalesRecord.customer_id)
        )).all()
        spent_info = {r[0]: round(float(r[1] or 0), 2) for r in spent_q}

    # Store-wise summary (for HO view)
    store_summary = {}
    if not sf:
        ss_q = (await db.execute(
            select(CRMCustomer.first_store_id, func.count(CRMCustomer.id))
            .where(CRMCustomer.customer_type.in_([CustomerType.RC, CustomerType.CHRONIC]))
            .group_by(CRMCustomer.first_store_id)
        )).all()
        for r in ss_q:
            sid = r[0]
            if sid:
                store_summary[sid] = {"count": r[1], "name": smap.get(sid, "")}

    result = []
    for c in customers:
        result.append({
            "id": c.id, "customer_name": c.customer_name, "mobile_number": c.mobile_number,
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "store_name": smap.get(c.first_store_id, ""),
            "store_id": c.first_store_id,
            "active_medicines": med_info.get(c.id, 0),
            "overdue_count": overdue_info.get(c.id, 0),
            "total_spent": spent_info.get(c.id, 0),
            "assigned_staff": staff_map.get(c.assigned_staff_id, "") if c.assigned_staff_id else "",
            "chronic_tags": c.chronic_tags.split(",") if c.chronic_tags else [],
            "adherence": c.adherence_score or "unknown",
            "clv_value": round(float(c.clv_value or 0), 2),
            "registration_date": c.registration_date.isoformat() if c.registration_date else None,
        })

    return {
        "customers": result, "total": total, "page": page, "limit": limit,
        "store_summary": [{"store_id": k, "store_name": v["name"], "rc_count": v["count"]} for k, v in store_summary.items()] if store_summary else [],
    }


# ─── Sales-Based Call Tasks (Previous Day) ────────────────────

@router.get("/crm/sales-call-tasks")
async def sales_call_tasks(
    date: str = Query(None),
    store_id: int = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Returns customers from previous day's sales for CRM follow-up calls."""
    sf = _store_filter(user)
    target_store = sf or (int(store_id) if store_id else None)
    now = datetime.now(timezone.utc)

    if date:
        try: day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except: day_start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day_start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    # Get sales from that day, grouped by customer
    sales_q = (
        select(
            SalesRecord.customer_id,
            func.count(SalesRecord.id).label("item_count"),
            func.sum(SalesRecord.total_amount).label("invoice_total"),
            func.max(SalesRecord.entry_number).label("last_invoice"),
        )
        .where(SalesRecord.customer_id.isnot(None), SalesRecord.invoice_date >= day_start, SalesRecord.invoice_date < day_end)
        .group_by(SalesRecord.customer_id)
    )
    if target_store:
        sales_q = sales_q.where(SalesRecord.store_id == target_store)

    total_sub = sales_q.subquery()
    total = (await db.execute(select(func.count()).select_from(total_sub))).scalar() or 0

    rows = (await db.execute(
        sales_q.order_by(func.sum(SalesRecord.total_amount).desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()

    cids = [r[0] for r in rows if r[0]]
    cmap = {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            cmap[c.id] = c

    # Check if already called today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    called_today = set()
    if cids:
        called_q = (await db.execute(
            select(CRMCallLog.customer_id).where(
                CRMCallLog.customer_id.in_(cids),
                CRMCallLog.created_at >= today_start,
            )
        )).all()
        called_today = set(r[0] for r in called_q)

    # Get previous purchases for each customer (medicines)
    med_map = {}
    if cids:
        for mp in (await db.execute(
            select(MedicinePurchase).where(
                MedicinePurchase.customer_id.in_(cids), MedicinePurchase.status == "active"
            )
        )).scalars().all():
            med_map.setdefault(mp.customer_id, []).append({
                "medicine": mp.medicine_name, "dosage": mp.dosage,
                "next_due": mp.next_due_date.isoformat() if mp.next_due_date else None,
            })

    # Previous call history
    call_history = {}
    if cids:
        for cl in (await db.execute(
            select(CRMCallLog).where(CRMCallLog.customer_id.in_(cids))
            .order_by(CRMCallLog.created_at.desc()).limit(200)
        )).scalars().all():
            call_history.setdefault(cl.customer_id, []).append({
                "caller": cl.caller_name, "result": cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result,
                "remarks": cl.remarks, "date": cl.created_at.isoformat() if cl.created_at else None,
            })

    # Store names
    sids = set(c.first_store_id for c in cmap.values() if c.first_store_id)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    result = []
    for r in rows:
        cid, item_count, invoice_total, last_invoice = r
        c = cmap.get(cid)
        if not c: continue
        result.append({
            "customer_id": cid,
            "customer_name": c.customer_name, "mobile": c.mobile_number,
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "store_name": smap.get(c.first_store_id, ""),
            "invoice_total": round(float(invoice_total or 0), 2),
            "item_count": item_count, "last_invoice": last_invoice,
            "already_called": cid in called_today,
            "active_medicines": med_map.get(cid, []),
            "call_history": (call_history.get(cid, []))[:5],
            "adherence": c.adherence_score or "unknown",
            "clv_value": round(float(c.clv_value or 0), 2),
        })

    return {"tasks": result, "total": total, "page": page, "limit": limit, "sales_date": day_start.strftime("%Y-%m-%d")}


# ─── Full Customer Detail for Call Popup ──────────────────────

class UpdateCustomerReq(BaseModel):
    customer_name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    address: Optional[str] = None
    customer_type: Optional[str] = None


@router.put("/crm/customers/{customer_id}/update")
async def update_customer_details(customer_id: int, data: UpdateCustomerReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")
    if data.customer_name is not None: c.customer_name = data.customer_name
    if data.gender is not None: c.gender = data.gender
    if data.age is not None: c.age = data.age
    if data.address is not None: c.address = data.address
    if data.customer_type is not None: c.customer_type = CustomerType(data.customer_type)
    await _log(db, user, f"Updated customer {c.customer_name}", "crm_customer", customer_id)
    await db.commit()
    return {"message": "Customer updated"}


@router.get("/crm/customers/{customer_id}/call-detail")
async def customer_call_detail(customer_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Full customer detail for call popup: profile, purchases, medicines, calls, stats."""
    c = (await db.execute(select(CRMCustomer).where(CRMCustomer.id == customer_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Customer not found")

    smap = {}
    if c.first_store_id:
        s = (await db.execute(select(Store).where(Store.id == c.first_store_id))).scalar_one_or_none()
        if s: smap[s.id] = s.store_name

    # Total stats from sales
    stats = (await db.execute(
        select(
            func.count(func.distinct(SalesRecord.entry_number)).label("invoices"),
            func.sum(SalesRecord.total_amount).label("total_spent"),
            func.count(SalesRecord.id).label("total_items"),
        ).where(SalesRecord.customer_id == customer_id)
    )).one()
    total_invoices = int(stats[0] or 0)
    total_spent = round(float(stats[1] or 0), 2)
    total_items = int(stats[2] or 0)

    # Recent purchases (last 10 invoices)
    recent_sales = (await db.execute(
        select(SalesRecord).where(SalesRecord.customer_id == customer_id)
        .order_by(SalesRecord.invoice_date.desc()).limit(30)
    )).scalars().all()

    invoices = {}
    for sr in recent_sales:
        inv_key = sr.entry_number or f"inv_{sr.id}"
        if inv_key not in invoices:
            invoices[inv_key] = {"entry_number": sr.entry_number, "date": sr.invoice_date.isoformat() if sr.invoice_date else None, "items": [], "total": 0}
        invoices[inv_key]["items"].append({"product": sr.product_name, "amount": round(float(sr.total_amount or 0), 2)})
        invoices[inv_key]["total"] += float(sr.total_amount or 0)
    invoice_list = sorted(invoices.values(), key=lambda x: x.get("date") or "", reverse=True)[:10]
    for inv in invoice_list: inv["total"] = round(inv["total"], 2)

    # Active medicines
    medicines = (await db.execute(
        select(MedicinePurchase).where(MedicinePurchase.customer_id == customer_id, MedicinePurchase.status == "active")
        .order_by(MedicinePurchase.next_due_date)
    )).scalars().all()
    med_list = [{
        "id": m.id, "medicine": m.medicine_name, "dosage": m.dosage, "timing": m.timing,
        "food_relation": m.food_relation, "days": m.days_of_medication, "quantity": m.quantity,
        "next_due": m.next_due_date.isoformat() if m.next_due_date else None,
    } for m in medicines]

    # All call history
    calls = (await db.execute(
        select(CRMCallLog).where(CRMCallLog.customer_id == customer_id)
        .order_by(CRMCallLog.created_at.desc()).limit(20)
    )).scalars().all()
    call_list = [{
        "id": cl.id, "caller": cl.caller_name, "result": cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result,
        "remarks": cl.remarks, "date": cl.created_at.isoformat() if cl.created_at else None,
    } for cl in calls]

    # Assigned staff
    staff_name = ""
    if c.assigned_staff_id:
        su = (await db.execute(select(User).where(User.id == c.assigned_staff_id))).scalar_one_or_none()
        if su: staff_name = su.full_name

    return {
        "profile": {
            "id": c.id, "customer_name": c.customer_name, "mobile_number": c.mobile_number,
            "gender": c.gender, "age": c.age, "address": c.address,
            "customer_type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
            "store_name": smap.get(c.first_store_id, ""), "store_id": c.first_store_id,
            "adherence": c.adherence_score or "unknown",
            "clv_value": round(float(c.clv_value or 0), 2), "clv_tier": c.clv_tier or "unknown",
            "chronic_tags": c.chronic_tags.split(",") if c.chronic_tags else [],
            "assigned_staff": staff_name, "assigned_staff_id": c.assigned_staff_id,
            "registration_date": c.registration_date.isoformat() if c.registration_date else None,
        },
        "stats": {"total_invoices": total_invoices, "total_spent": total_spent, "total_items": total_items},
        "recent_invoices": invoice_list,
        "active_medicines": med_list,
        "call_history": call_list,
    }


# ─── Daily CRM Activity Report ────────────────────────────────

@router.get("/crm/daily-report")
async def daily_crm_report(
    date: str = Query(None),
    store_id: int = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    target_store = sf or (int(store_id) if store_id else None)

    # Parse date (defaults to today)
    now = datetime.now(timezone.utc)
    if date:
        try:
            day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    # ─── Calls ───
    call_q = select(CRMCallLog).where(CRMCallLog.created_at >= day_start, CRMCallLog.created_at < day_end)
    calls = (await db.execute(call_q.order_by(CRMCallLog.created_at.desc()))).scalars().all()

    # Map customer & caller names
    call_cids = set(cl.customer_id for cl in calls)
    call_cmap = {}
    if call_cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(call_cids)))).scalars().all():
            call_cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number}

    call_results = {}
    call_list = []
    for cl in calls:
        r = cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result
        call_results[r] = call_results.get(r, 0) + 1
        ci = call_cmap.get(cl.customer_id, {})
        call_list.append({
            "id": cl.id, "customer_name": ci.get("name", ""), "mobile": ci.get("mobile", ""),
            "caller_name": cl.caller_name or "", "call_result": r, "remarks": cl.remarks or "",
            "time": cl.created_at.strftime("%H:%M") if cl.created_at else "",
        })

    # ─── New Customers (onboarded today) ───
    nc_q = select(CRMCustomer).where(CRMCustomer.created_at >= day_start, CRMCustomer.created_at < day_end)
    if target_store:
        nc_q = nc_q.where(or_(CRMCustomer.first_store_id == target_store, CRMCustomer.assigned_store_id == target_store))
    new_customers = (await db.execute(nc_q.order_by(CRMCustomer.created_at.desc()))).scalars().all()
    nc_sids = set(c.first_store_id for c in new_customers if c.first_store_id)
    nc_smap = {}
    if nc_sids:
        nc_smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(nc_sids)))).scalars().all()}

    new_list = [{
        "id": c.id, "name": c.customer_name, "mobile": c.mobile_number,
        "type": c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type,
        "store": nc_smap.get(c.first_store_id, ""),
        "time": c.created_at.strftime("%H:%M") if c.created_at else "",
    } for c in new_customers]

    # ─── Conversions (walkin → RC today) ───
    # Check audit logs for type conversions today
    conv_q = select(AuditLog).where(
        AuditLog.created_at >= day_start, AuditLog.created_at < day_end,
        AuditLog.action.ilike("%type%"),
    )
    conv_logs = (await db.execute(conv_q.order_by(AuditLog.created_at.desc()))).scalars().all()
    conversions = [{
        "user_name": a.user_name, "action": a.action,
        "time": a.created_at.strftime("%H:%M") if a.created_at else "",
    } for a in conv_logs]

    # ─── Medicines Added Today ───
    med_q = select(MedicinePurchase).where(
        MedicinePurchase.created_at >= day_start, MedicinePurchase.created_at < day_end,
    )
    if target_store:
        med_q = med_q.where(MedicinePurchase.store_id == target_store)
    meds_added = (await db.execute(med_q.order_by(MedicinePurchase.created_at.desc()))).scalars().all()
    med_cids = set(m.customer_id for m in meds_added)
    med_uids = set(m.created_by for m in meds_added if m.created_by)
    med_cmap = {}
    med_umap = {}
    if med_cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(med_cids)))).scalars().all():
            med_cmap[c.id] = c.customer_name
    if med_uids:
        for u in (await db.execute(select(User).where(User.id.in_(med_uids)))).scalars().all():
            med_umap[u.id] = u.full_name

    med_list = [{
        "id": m.id, "customer_name": med_cmap.get(m.customer_id, ""),
        "medicine": m.medicine_name, "dosage": m.dosage, "timing": m.timing,
        "days": m.days_of_medication,
        "done_by": med_umap.get(m.created_by, ""),
        "time": m.created_at.strftime("%H:%M") if m.created_at else "",
    } for m in meds_added]

    # ─── Sales Uploads Today ───
    from models import UploadHistory, UploadType
    upload_q = select(UploadHistory).where(
        UploadHistory.created_at >= day_start, UploadHistory.created_at < day_end,
    )
    uploads = (await db.execute(upload_q.order_by(UploadHistory.created_at.desc()))).scalars().all()
    upload_uids = set(u.uploaded_by for u in uploads if u.uploaded_by)
    upload_umap = {}
    if upload_uids:
        for u in (await db.execute(select(User).where(User.id.in_(upload_uids)))).scalars().all():
            upload_umap[u.id] = u.full_name
    upload_list = [{
        "file": u.file_name, "type": u.upload_type.value if hasattr(u.upload_type, 'value') else u.upload_type,
        "records": u.total_records, "success": u.success_records, "failed": u.failed_records,
        "uploaded_by": upload_umap.get(u.uploaded_by, ""),
        "time": u.created_at.strftime("%H:%M") if u.created_at else "",
    } for u in uploads]

    # ─── Staff Activity Summary ───
    staff_activity = {}
    for cl in calls:
        name = cl.caller_name or "Unknown"
        if name not in staff_activity:
            staff_activity[name] = {"calls": 0, "confirmed": 0, "reached": 0}
        staff_activity[name]["calls"] += 1
        r = cl.call_result.value if hasattr(cl.call_result, 'value') else cl.call_result
        if r == "confirmed": staff_activity[name]["confirmed"] += 1
        if r == "reached": staff_activity[name]["reached"] += 1

    staff_summary = [{"name": k, **v} for k, v in staff_activity.items()]
    staff_summary.sort(key=lambda x: -x["calls"])

    # ─── Tasks completed today ───
    task_q = select(CRMTask).where(CRMTask.status == "completed")
    tasks_done = (await db.execute(
        select(func.count(CRMTask.id)).where(CRMTask.status == "completed")
    )).scalar() or 0

    return {
        "date": day_start.strftime("%Y-%m-%d"),
        "summary": {
            "total_calls": len(calls),
            "call_results": call_results,
            "confirmed": call_results.get("confirmed", 0),
            "new_customers": len(new_list),
            "conversions": len(conversions),
            "medicines_added": len(med_list),
            "uploads": len(upload_list),
            "tasks_completed": tasks_done,
        },
        "calls": call_list,
        "new_customers": new_list,
        "conversions": conversions,
        "medicines_added": med_list,
        "uploads": upload_list,
        "staff_summary": staff_summary,
    }


# ─── Daily Customer & Invoice Details ─────────────────────────

@router.get("/crm/daily-invoices")
async def daily_invoices(
    date: str = Query(None),
    store_id: int = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    sf = _store_filter(user)
    target_store = sf or (int(store_id) if store_id else None)
    now = datetime.now(timezone.utc)

    if date:
        try: day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except: day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    # Get invoices grouped by entry_number + customer
    inv_q = (
        select(
            SalesRecord.entry_number,
            SalesRecord.customer_id,
            SalesRecord.patient_name,
            SalesRecord.mobile_number,
            SalesRecord.store_id,
            func.sum(SalesRecord.total_amount).label("total"),
            func.count(SalesRecord.id).label("items"),
            func.min(SalesRecord.invoice_date).label("inv_date"),
        )
        .where(SalesRecord.invoice_date >= day_start, SalesRecord.invoice_date < day_end)
        .group_by(SalesRecord.entry_number, SalesRecord.customer_id, SalesRecord.patient_name, SalesRecord.mobile_number, SalesRecord.store_id)
    )
    if target_store:
        inv_q = inv_q.where(SalesRecord.store_id == target_store)

    total = (await db.execute(select(func.count()).select_from(inv_q.subquery()))).scalar() or 0
    rows = (await db.execute(
        inv_q.order_by(func.min(SalesRecord.invoice_date).desc())
        .offset((page - 1) * limit).limit(limit)
    )).all()

    # Store names
    sids = set(r[4] for r in rows if r[4])
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # Customer types
    cids = set(r[1] for r in rows if r[1])
    ctype_map = {}
    if cids:
        for c in (await db.execute(select(CRMCustomer).where(CRMCustomer.id.in_(cids)))).scalars().all():
            ctype_map[c.id] = c.customer_type.value if hasattr(c.customer_type, 'value') else c.customer_type

    invoices = []
    for r in rows:
        invoices.append({
            "entry_number": r[0], "customer_id": r[1],
            "customer_name": r[2] or "Unknown", "mobile": r[3] or "",
            "store_id": r[4], "store_name": smap.get(r[4], ""),
            "total_amount": round(float(r[5] or 0), 2), "item_count": int(r[6] or 0),
            "invoice_date": r[7].isoformat() if r[7] else None,
            "customer_type": ctype_map.get(r[1], "walkin"),
        })

    # Summary KPIs
    total_amount_q = select(func.sum(SalesRecord.total_amount)).where(SalesRecord.invoice_date >= day_start, SalesRecord.invoice_date < day_end)
    total_customers_q = select(func.count(func.distinct(SalesRecord.customer_id))).where(SalesRecord.invoice_date >= day_start, SalesRecord.invoice_date < day_end, SalesRecord.customer_id.isnot(None))
    if target_store:
        total_amount_q = total_amount_q.where(SalesRecord.store_id == target_store)
        total_customers_q = total_customers_q.where(SalesRecord.store_id == target_store)

    day_total = round(float((await db.execute(total_amount_q)).scalar() or 0), 2)
    day_customers = (await db.execute(total_customers_q)).scalar() or 0

    return {
        "invoices": invoices, "total": total, "page": page, "limit": limit,
        "date": day_start.strftime("%Y-%m-%d"),
        "summary": {"total_amount": day_total, "total_invoices": total, "total_customers": day_customers},
    }


# ─── RC Conversion Candidates ─────────────────────────────────

@router.get("/crm/rc-candidates")
async def rc_candidates(
    store_id: int = Query(None),
    min_purchases: int = Query(2, ge=2),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Walk-in customers who bought the same medicine 2+ times in 90 days — candidates for RC conversion."""
    sf = _store_filter(user)
    target_store = sf or (int(store_id) if store_id else None)
    now = datetime.now(timezone.utc)
    d90 = now - timedelta(days=90)

    # Find walkin customers with repeat medicine purchases in 90 days
    agg_q = (
        select(
            SalesRecord.customer_id,
            SalesRecord.product_name,
            func.count(SalesRecord.id).label("purchase_count"),
            func.sum(SalesRecord.total_amount).label("total_spent"),
            func.min(SalesRecord.invoice_date).label("first_date"),
            func.max(SalesRecord.invoice_date).label("last_date"),
        )
        .where(SalesRecord.customer_id.isnot(None), SalesRecord.invoice_date >= d90)
        .group_by(SalesRecord.customer_id, SalesRecord.product_name)
        .having(func.count(SalesRecord.id) >= min_purchases)
    )
    if target_store:
        agg_q = agg_q.where(SalesRecord.store_id == target_store)

    rows = (await db.execute(agg_q.order_by(func.count(SalesRecord.id).desc()))).all()

    # Filter to only walkin customers
    cids = set(r[0] for r in rows if r[0])
    cmap = {}
    if cids:
        for c in (await db.execute(
            select(CRMCustomer).where(CRMCustomer.id.in_(cids), CRMCustomer.customer_type == CustomerType.WALKIN)
        )).scalars().all():
            cmap[c.id] = {"name": c.customer_name, "mobile": c.mobile_number, "store_id": c.first_store_id}

    sids = set(ci["store_id"] for ci in cmap.values() if ci.get("store_id"))
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # Build grouped result: customer → list of repeat medicines
    candidates = {}
    for r in rows:
        cid = r[0]
        if cid not in cmap:
            continue
        ci = cmap[cid]
        if cid not in candidates:
            candidates[cid] = {
                "customer_id": cid, "customer_name": ci["name"], "mobile": ci["mobile"],
                "store_name": smap.get(ci.get("store_id"), ""),
                "repeat_medicines": [], "total_repeat_purchases": 0, "total_spent": 0,
            }
        span = (r[5] - r[4]).days if r[4] and r[5] else 0
        candidates[cid]["repeat_medicines"].append({
            "medicine": r[1], "count": int(r[2]),
            "spent": round(float(r[3] or 0), 2),
            "first": r[4].isoformat() if r[4] else None,
            "last": r[5].isoformat() if r[5] else None,
            "avg_interval": round(span / (int(r[2]) - 1), 1) if int(r[2]) > 1 and span > 0 else 0,
        })
        candidates[cid]["total_repeat_purchases"] += int(r[2])
        candidates[cid]["total_spent"] += float(r[3] or 0)

    result = sorted(candidates.values(), key=lambda x: -x["total_repeat_purchases"])
    for r in result:
        r["total_spent"] = round(r["total_spent"], 2)

    return {"candidates": result[:100], "total": len(result)}
