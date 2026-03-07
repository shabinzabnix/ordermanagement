from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import (
    Product, Store, StoreStockBatch, SalesRecord, PurchaseRecord,
    PurchaseOrder, PurchaseOrderItem, StoreRequest, StoreRequestItem,
    AuditLog, POComment,
)
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import uuid

router = APIRouter()


async def _log(db, user, action, etype=None, eid=None):
    db.add(AuditLog(user_id=user.get("user_id", 0), user_name=user.get("full_name", ""),
                     action=action, entity_type=etype, entity_id=str(eid) if eid else None))


def _gen_po_number():
    return f"PO-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"



@router.get("/po/suppliers")
async def get_supplier_list(
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Get unique supplier names from Product Master for dropdown."""
    suppliers = set()
    for field in [Product.primary_supplier, Product.secondary_supplier, Product.least_price_supplier, Product.most_qty_supplier]:
        result = await db.execute(select(field).distinct().where(field.isnot(None)))
        for r in result.all():
            if r[0] and str(r[0]).strip():
                suppliers.add(str(r[0]).strip())
    supplier_list = sorted(suppliers)
    if search:
        sl = search.lower()
        supplier_list = [s for s in supplier_list if sl in s.lower()]

@router.get("/po/subcategory-data")
async def get_subcategory_data(
    sub_category: str = Query(...),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Get products + suppliers for a specific sub-category."""
    products = (await db.execute(
        select(Product).where(Product.sub_category == sub_category).order_by(Product.product_name)
    )).scalars().all()

    suppliers = set()
    for p in products:
        for s in [p.primary_supplier, p.secondary_supplier, p.least_price_supplier, p.most_qty_supplier]:
            if s and str(s).strip():
                suppliers.add(str(s).strip())

    return {
        "products": [{"product_id": p.product_id, "product_name": p.product_name,
                       "landing_cost": p.landing_cost or p.ptr or 0,
                       "mrp": p.mrp or 0, "ptr": p.ptr or 0,
                       "primary_supplier": p.primary_supplier or ""} for p in products],
        "suppliers": sorted(suppliers),
        "total_products": len(products),
    }


    return {"suppliers": supplier_list[:100], "total": len(supplier_list)}

@router.get("/po/product-stock-info")
async def product_stock_info(
    product_id: str = Query(None),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Get product landing cost + stock across all stores. For store_staff, show only their store."""
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    user_store = user.get("store_id") if user.get("role") == "STORE_STAFF" else None

    products = []
    if product_id:
        prods = (await db.execute(select(Product).where(Product.product_id == product_id))).scalars().all()
    elif search and len(search) >= 2:
        prods = (await db.execute(select(Product).where(Product.product_name.ilike(f"%{search}%")).limit(15))).scalars().all()
    else:
        return {"products": []}

    for p in prods:
        # Use landing_cost, fallback to ptr if 0
        lcost = p.landing_cost or p.ptr or 0

        # Stock per store
        ss_q = select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock).label("stock")).where(
            StoreStockBatch.ho_product_id == p.product_id).group_by(StoreStockBatch.store_id)
        if user_store:
            ss_q = ss_q.where(StoreStockBatch.store_id == user_store)
        stock_rows = (await db.execute(ss_q)).all()
        store_stock = [{"store_id": r[0], "store": smap.get(r[0], ""), "stock": round(float(r[1] or 0), 0)} for r in stock_rows if float(r[1] or 0) > 0]

        products.append({
            "product_id": p.product_id, "product_name": p.product_name,
            "landing_cost": lcost, "mrp": p.mrp or 0, "ptr": p.ptr or 0,
            "primary_supplier": p.primary_supplier or "",
            "store_stock": store_stock,
            "total_stock": sum(s["stock"] for s in store_stock),
        })
    return {"products": products}




# ─── Store Purchase Request ─────────────────────────────────

class RequestItemReq(BaseModel):
    product_id: Optional[str] = None
    product_name: str
    is_registered: bool = True
    quantity: float
    has_prescription: bool = False
    doctor_name: Optional[str] = None
    clinic_location: Optional[str] = None

class StoreRequestReq(BaseModel):
    store_id: int
    request_reason: str
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    items: List[RequestItemReq]


@router.post("/po/store-request")
async def create_store_request(
    data: StoreRequestReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if data.request_reason in ("emergency_purchase", "customer_enquiry") and (not data.customer_name or not data.customer_mobile):
        raise HTTPException(400, "Customer name and mobile required for emergency/customer enquiry")
    if not data.items:
        raise HTTPException(400, "At least one product required")

    # Calculate values and check stock/pending for each item
    total_value = 0
    items_data = []
    for item in data.items:
        # Get landing cost from Product Master (fallback to PTR)
        lcost = 0
        if item.product_id:
            prod = (await db.execute(select(Product).where(Product.product_id == item.product_id))).scalar_one_or_none()
            if prod:
                lcost = float(prod.landing_cost or prod.ptr or 0)

        est_value = round(lcost * item.quantity, 2)
        total_value += est_value

        # Current store stock
        store_stock = float((await db.execute(
            select(func.sum(StoreStockBatch.closing_stock)).where(and_(
                StoreStockBatch.store_id == data.store_id,
                StoreStockBatch.ho_product_id == item.product_id,
            ))
        )).scalar() or 0) if item.product_id else 0

        # Pending orders for this product at this store
        pending = (await db.execute(
            select(func.count(StoreRequestItem.id))
            .join(StoreRequest, StoreRequestItem.request_id == StoreRequest.id)
            .where(and_(
                StoreRequest.store_id == data.store_id,
                StoreRequest.status.in_(["pending", "approved"]),
                StoreRequestItem.product_id == item.product_id,
            ))
        )).scalar() or 0 if item.product_id else 0

        items_data.append({
            "product_id": item.product_id, "product_name": item.product_name,
            "is_registered": item.is_registered,
            "quantity": item.quantity, "landing_cost": lcost,
            "estimated_value": est_value, "current_store_stock": store_stock,
            "pending_orders": pending,
            "has_prescription": item.has_prescription,
            "doctor_name": item.doctor_name, "clinic_location": item.clinic_location,
        })

    req = StoreRequest(
        store_id=data.store_id, request_reason=data.request_reason,
        customer_name=data.customer_name, customer_mobile=data.customer_mobile,
        status="pending", total_items=len(items_data), total_value=round(total_value, 2),
        requested_by=user["user_id"],
    )
    db.add(req)
    await db.flush()

    for it in items_data:
        db.add(StoreRequestItem(
            request_id=req.id, product_id=it["product_id"], product_name=it["product_name"],
            is_registered=it["is_registered"],
            quantity=it["quantity"], landing_cost=it["landing_cost"],
            estimated_value=it["estimated_value"], current_store_stock=it["current_store_stock"],
            pending_orders=it["pending_orders"],
            has_prescription=it["has_prescription"],
            doctor_name=it["doctor_name"], clinic_location=it["clinic_location"],
        ))

    await _log(db, user, f"Created store request: {len(items_data)} items, INR {total_value}", "store_request", req.id)
    await db.commit()
    return {"id": req.id, "total_value": round(total_value, 2), "items": items_data}


@router.get("/po/store-requests")
async def list_store_requests(
    store_id: int = Query(None), status: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    if user.get("role") == "STORE_STAFF" and user.get("store_id"):
        store_id = user["store_id"]
    query = select(StoreRequest)
    if store_id:
        query = query.where(StoreRequest.store_id == store_id)
    if status and status != "all":
        query = query.where(StoreRequest.status == status)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    reqs = (await db.execute(query.order_by(StoreRequest.created_at.desc()).offset((page-1)*limit).limit(limit))).scalars().all()

    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    result = []
    for r in reqs:
        items = (await db.execute(select(StoreRequestItem).where(StoreRequestItem.request_id == r.id))).scalars().all()
        result.append({
            "id": r.id, "store_id": r.store_id, "store_name": smap.get(r.store_id, ""),
            "request_reason": r.request_reason, "customer_name": r.customer_name,
            "customer_mobile": r.customer_mobile, "status": r.status,
            "total_items": r.total_items, "total_value": r.total_value,
            "po_id": r.po_id, "ho_remarks": r.ho_remarks,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "items": [{
                "id": it.id, "product_id": it.product_id, "product_name": it.product_name,
                "is_registered": it.is_registered,
                "quantity": it.quantity, "landing_cost": it.landing_cost,
                "estimated_value": it.estimated_value, "current_store_stock": it.current_store_stock,
                "pending_orders": it.pending_orders,
                "has_prescription": it.has_prescription,
                "doctor_name": it.doctor_name, "clinic_location": it.clinic_location,
            } for it in items],
        })
    return {"requests": result, "total": total}


@router.get("/po/store-requests/{request_id}/stock-info")
async def request_stock_info(
    request_id: int,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    """For HO: show stock across all stores + sales trend for each product in request."""
    req = (await db.execute(select(StoreRequest).where(StoreRequest.id == request_id))).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found")
    items = (await db.execute(select(StoreRequestItem).where(StoreRequestItem.request_id == request_id))).scalars().all()
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    now = datetime.now(timezone.utc)

    product_info = []
    for it in items:
        # Stock across all stores
        stock_q = (await db.execute(
            select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock).label("stock"))
            .where(StoreStockBatch.ho_product_id == it.product_id)
            .group_by(StoreStockBatch.store_id)
        )).all() if it.product_id else []
        store_stock = [{"store": smap.get(r[0], ""), "stock": round(float(r[1] or 0), 0)} for r in stock_q if float(r[1] or 0) > 0]

        # Sales trend (last 30/60/90 days)
        sales_30 = 0; sales_90 = 0
        if it.product_id:
            sales_30 = float((await db.execute(
                select(func.sum(SalesRecord.quantity)).where(and_(
                    SalesRecord.product_id == it.product_id, SalesRecord.invoice_date >= now - timedelta(days=30)
                ))
            )).scalar() or 0)
            sales_90 = float((await db.execute(
                select(func.sum(SalesRecord.quantity)).where(and_(
                    SalesRecord.product_id == it.product_id, SalesRecord.invoice_date >= now - timedelta(days=90)
                ))
            )).scalar() or 0)

        product_info.append({
            "product_id": it.product_id, "product_name": it.product_name,
            "requested_qty": it.quantity, "landing_cost": it.landing_cost,
            "store_stock": store_stock, "sales_30d": round(sales_30, 0), "sales_90d": round(sales_90, 0),
        })

    return {"request_id": request_id, "store_name": smap.get(req.store_id, ""), "products": product_info}


# ─── Purchase Order (PO) ────────────────────────────────────

class POItemReq(BaseModel):
    product_id: Optional[str] = None
    product_name: str
    is_registered: bool = True
    quantity: float
    landing_cost: float = 0

class CreatePOReq(BaseModel):
    store_id: Optional[int] = None
    supplier_name: str
    po_type: str = "manual"
    sub_category: Optional[str] = None
    items: List[POItemReq]
    remarks: str = ""
    request_id: Optional[int] = None


@router.post("/po/create")
async def create_purchase_order(
    data: CreatePOReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    total_qty = sum(it.quantity for it in data.items)
    total_value = sum(round(it.quantity * it.landing_cost, 2) for it in data.items)

    po = PurchaseOrder(
        po_number=_gen_po_number(), store_id=data.store_id,
        supplier_name=data.supplier_name, po_type=data.po_type,
        sub_category=data.sub_category, status="draft",
        total_qty=total_qty, total_value=round(total_value, 2),
        remarks=data.remarks, created_by=user["user_id"],
    )
    db.add(po)
    await db.flush()

    for it in data.items:
        db.add(PurchaseOrderItem(
            po_id=po.id, product_id=it.product_id, product_name=it.product_name,
            is_registered=it.is_registered, quantity=it.quantity,
            landing_cost=it.landing_cost, estimated_value=round(it.quantity * it.landing_cost, 2),
        ))

    # Link to store request if provided
    if data.request_id:
        req = (await db.execute(select(StoreRequest).where(StoreRequest.id == data.request_id))).scalar_one_or_none()
        if req:
            req.po_id = po.id
            req.status = "po_created"

    await _log(db, user, f"Created PO {po.po_number}: {len(data.items)} items, INR {total_value}", "purchase_order", po.id)
    await db.commit()
    return {"id": po.id, "po_number": po.po_number, "total_value": round(total_value, 2)}


@router.get("/po/list")
async def list_purchase_orders(
    status: str = Query(None), store_id: int = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    query = select(PurchaseOrder)
    if status and status != "all":
        query = query.where(PurchaseOrder.status == status)
    if store_id:
        query = query.where(PurchaseOrder.store_id == store_id)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    pos = (await db.execute(query.order_by(PurchaseOrder.created_at.desc()).offset((page-1)*limit).limit(limit))).scalars().all()

    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    return {
        "orders": [{
            "id": p.id, "po_number": p.po_number, "store_name": smap.get(p.store_id, "HO"),
            "supplier_name": p.supplier_name, "po_type": p.po_type,
            "sub_category": p.sub_category, "status": p.status,
            "total_qty": p.total_qty, "total_value": p.total_value,
            "fulfillment_status": p.fulfillment_status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        } for p in pos],
        "total": total,
    }


@router.get("/po/{po_id}")
async def get_po_detail(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    items = (await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))).scalars().all()
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # Fetch stock for each item across all stores
    items_with_stock = []
    for it in items:
        store_stock = []
        if it.product_id:
            ss_q = (await db.execute(
                select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock).label("stock"))
                .where(StoreStockBatch.ho_product_id == it.product_id)
                .group_by(StoreStockBatch.store_id)
            )).all()
            store_stock = [{"store": smap.get(r[0], ""), "stock": round(float(r[1] or 0), 0)} for r in ss_q if float(r[1] or 0) > 0]
        items_with_stock.append({
            "id": it.id, "product_id": it.product_id, "product_name": it.product_name,
            "is_registered": it.is_registered, "quantity": it.quantity,
            "landing_cost": it.landing_cost, "estimated_value": it.estimated_value,
            "store_stock": store_stock, "total_stock": sum(s["stock"] for s in store_stock),
        })

    # Comments
    comments = (await db.execute(
        select(POComment).where(POComment.po_id == po_id).order_by(POComment.created_at.desc())
    )).scalars().all()

    # Activity log for this PO
    activities = (await db.execute(
        select(AuditLog).where(and_(AuditLog.entity_type == "purchase_order", AuditLog.entity_id == str(po_id)))
        .order_by(AuditLog.created_at.desc()).limit(20)
    )).scalars().all()

    return {
        "po": {
            "id": po.id, "po_number": po.po_number, "store_id": po.store_id,
            "store_name": smap.get(po.store_id, "HO"),
            "supplier_name": po.supplier_name, "po_type": po.po_type, "status": po.status,
            "total_qty": po.total_qty, "total_value": po.total_value,
            "remarks": po.remarks, "fulfillment_status": po.fulfillment_status,
            "created_at": po.created_at.isoformat() if po.created_at else None,
        },
        "items": items_with_stock,
        "comments": [{"id": c.id, "user_name": c.user_name, "message": c.message,
                       "created_at": c.created_at.isoformat() if c.created_at else None} for c in comments],
        "activity_log": [{"user_name": a.user_name, "action": a.action,
                          "created_at": a.created_at.isoformat() if a.created_at else None} for a in activities],
    }


class UpdatePOReq(BaseModel):
    supplier_name: Optional[str] = None
    remarks: Optional[str] = None
    items: Optional[List[POItemReq]] = None


@router.put("/po/{po_id}/update")
async def update_po(po_id: int, data: UpdatePOReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF"))):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    if po.status not in ("draft",):
        raise HTTPException(400, "Only draft POs can be modified")
    if data.supplier_name:
        po.supplier_name = data.supplier_name
    if data.remarks is not None:
        po.remarks = data.remarks
    if data.items is not None:
        # Delete existing items and replace
        await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))
        from sqlalchemy import delete
        await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))
        total_qty = 0; total_value = 0
        for it in data.items:
            ev = round(it.quantity * it.landing_cost, 2)
            total_qty += it.quantity; total_value += ev
            db.add(PurchaseOrderItem(po_id=po_id, product_id=it.product_id, product_name=it.product_name,
                is_registered=it.is_registered, quantity=it.quantity, landing_cost=it.landing_cost, estimated_value=ev))
        po.total_qty = total_qty; po.total_value = round(total_value, 2)
    po.updated_at = datetime.now(timezone.utc)
    await _log(db, user, f"Updated PO {po.po_number}", "purchase_order", po_id)
    await db.commit()
    return {"message": "PO updated"}


@router.delete("/po/{po_id}")
async def delete_po(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF"))):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    if po.status not in ("draft", "rejected"):
        raise HTTPException(400, "Only draft or rejected POs can be deleted")
    from sqlalchemy import delete
    await db.execute(delete(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))
    await db.delete(po)
    await _log(db, user, f"Deleted PO {po.po_number}", "purchase_order", po_id)
    await db.commit()
    return {"message": "PO deleted"}


class POCommentReq(BaseModel):
    message: str


@router.post("/po/{po_id}/comment")
async def add_po_comment(po_id: int, data: POCommentReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    db.add(POComment(po_id=po_id, user_name=user.get("full_name", ""), message=data.message))
    await _log(db, user, f"Commented on PO {po.po_number}: {data.message[:50]}", "purchase_order", po_id)
    await db.commit()
    return {"message": "Comment added"}


@router.put("/po/{po_id}/approve")
async def approve_po(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    po.status = "approved"
    po.approved_by = user["user_id"]
    po.approved_at = datetime.now(timezone.utc)
    await _log(db, user, f"Approved PO {po.po_number}", "purchase_order", po_id)
    await db.commit()
    return {"message": "PO approved"}


@router.put("/po/{po_id}/reject")
async def reject_po(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    po.status = "rejected"
    await db.commit()
    return {"message": "PO rejected"}


@router.put("/po/{po_id}/fulfillment")
async def update_po_fulfillment(
    po_id: int, status: str = Query(...),
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    po.fulfillment_status = status
    if status == "received":
        po.received_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": f"PO fulfillment: {status}"}


# ─── PO Upload by Sub Category ──────────────────────────────

@router.post("/po/upload-subcategory")
async def upload_po_by_subcategory(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    """Upload Excel: HO ID, Product Name, Qty. Auto-categorizes by sub_category from Product Master."""
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()
    df = None
    for skip in [0, 1, 2, 3]:
        try:
            test_df = pd.read_excel(BytesIO(content), header=skip)
            if not test_df.empty and len(test_df.columns) >= 2:
                cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
                if any(c in cols_lower for c in ["product name", "product", "name"]):
                    df = test_df; break
        except: continue
    if df is None:
        raise HTTPException(400, "Failed to read Excel")

    col_map = {"product name": "product_name", "product": "product_name", "name": "product_name",
               "qty": "quantity", "quantity": "quantity",
               "ho id": "product_id", "product id": "product_id", "id": "product_id",
               "rate": "landing_cost", "cost": "landing_cost", "lcost": "landing_cost"}
    df.columns = [str(c).strip().lower().replace('_', ' ') for c in df.columns]
    df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

    if "product_name" not in df.columns or "quantity" not in df.columns:
        raise HTTPException(400, f"Required: Product Name + Qty. Your columns: {list(df.columns)}")

    # Pre-load product master for sub_category + landing_cost lookup
    all_products = {}
    for p in (await db.execute(select(Product))).scalars().all():
        all_products[p.product_id] = p
        all_products[p.product_name.lower()] = p

    # Group by sub_category (auto-detected from Product Master)
    groups = {}
    unmatched = 0
    for _, row in df.iterrows():
        pname = str(row.get("product_name", "")).strip()
        if not pname or pname == "nan": continue
        pid = str(row.get("product_id", "")).strip() if pd.notna(row.get("product_id")) else None
        if pid and pid.endswith(".0"): pid = pid[:-2]
        if pid in ("", "nan", "None"): pid = None

        # Lookup from Product Master
        prod = all_products.get(pid) if pid else all_products.get(pname.lower())
        subcat = prod.sub_category if prod and prod.sub_category else "Uncategorized"
        lcost = float(row.get("landing_cost", 0)) if pd.notna(row.get("landing_cost")) else 0
        if lcost == 0 and prod:
            lcost = float(prod.landing_cost or prod.ptr or 0)
        if not prod:
            unmatched += 1

        qty = float(row.get("quantity", 0)) if pd.notna(row.get("quantity")) else 0
        if subcat not in groups: groups[subcat] = []
        groups[subcat].append({"product_id": pid or (prod.product_id if prod else None),
                               "product_name": pname, "quantity": qty, "landing_cost": lcost})

    created_pos = []
    for subcat, items in groups.items():
        total_qty = sum(it["quantity"] for it in items)
        total_value = sum(round(it["quantity"] * it["landing_cost"], 2) for it in items)
        po = PurchaseOrder(
            po_number=_gen_po_number(), supplier_name="",
            po_type="subcategory_upload", sub_category=subcat,
            status="draft", total_qty=total_qty, total_value=round(total_value, 2),
            created_by=user["user_id"],
        )
        db.add(po)
        await db.flush()
        for it in items:
            db.add(PurchaseOrderItem(
                po_id=po.id, product_id=it["product_id"], product_name=it["product_name"],
                is_registered=bool(it["product_id"]), quantity=it["quantity"],
                landing_cost=it["landing_cost"], estimated_value=round(it["quantity"] * it["landing_cost"], 2),
            ))
        created_pos.append({"po_id": po.id, "po_number": po.po_number, "sub_category": subcat,
                            "items": len(items), "value": round(total_value, 2)})

    await _log(db, user, f"Uploaded PO Excel: {len(created_pos)} POs from {len(df)} rows", "purchase_order")
    await db.commit()
    return {"message": f"Created {len(created_pos)} POs by sub-category", "purchase_orders": created_pos,
            "unmatched_products": unmatched}


# ─── PO PDF Generation ──────────────────────────────────────

@router.get("/po/{po_id}/pdf")
async def generate_po_pdf(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Generate PO PDF with letterhead."""
    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    items = (await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))).scalars().all()
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # Generate HTML for PDF
    items_html = ""
    for i, it in enumerate(items):
        items_html += f"""<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">{i+1}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">{it.product_id or '-'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:500;">{it.product_name}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;">{it.quantity}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;">{it.landing_cost:.2f}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-weight:600;">{it.estimated_value:.2f}</td>
        </tr>"""

    html = f"""<!DOCTYPE html><html><head><style>
        @page {{ margin: 0; size: A4; }}
        body {{ font-family: 'Helvetica', sans-serif; margin: 0; padding: 0; }}
        .letterhead {{ width: 100%; height: 160px; background: url('/letterhead.jpeg') center top no-repeat; background-size: 100% auto; }}
        .content {{ padding: 20px 40px; }}
        .po-title {{ font-size: 20px; font-weight: 700; color: #0f172a; margin: 10px 0; }}
        .info-row {{ display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; color: #475569; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 15px; }}
        th {{ background: #f1f5f9; padding: 8px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; }}
        .total-row {{ background: #f0f9ff; font-weight: 700; font-size: 14px; }}
        .footer {{ position: fixed; bottom: 0; width: 100%; height: 50px; background: #475569; display: flex; align-items: center; justify-content: center; }}
        .footer span {{ color: white; font-size: 13px; font-weight: 600; }}
    </style></head><body>
    <div class="letterhead"></div>
    <div class="content">
        <div class="po-title">PURCHASE ORDER</div>
        <div style="display:flex;justify-content:space-between;">
            <div>
                <div class="info-row"><b>PO Number:</b>&nbsp;{po.po_number}</div>
                <div class="info-row"><b>Date:</b>&nbsp;{po.created_at.strftime('%d %b %Y') if po.created_at else '-'}</div>
                <div class="info-row"><b>Supplier:</b>&nbsp;{po.supplier_name or 'To be assigned'}</div>
            </div>
            <div style="text-align:right;">
                <div class="info-row"><b>Sub Category:</b>&nbsp;{po.sub_category or '-'}</div>
                <div class="info-row"><b>Status:</b>&nbsp;{po.status.upper()}</div>
                <div class="info-row"><b>Store:</b>&nbsp;{smap.get(po.store_id, 'Head Office')}</div>
            </div>
        </div>
        <table>
            <thead><tr>
                <th style="width:40px;">#</th><th>Product ID</th><th>Product Name</th>
                <th style="text-align:right;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Value</th>
            </tr></thead>
            <tbody>{items_html}
            <tr class="total-row">
                <td colspan="3" style="padding:10px 8px;">TOTAL</td>
                <td style="padding:10px 8px;text-align:right;">{po.total_qty}</td>
                <td style="padding:10px 8px;"></td>
                <td style="padding:10px 8px;text-align:right;">INR {po.total_value:,.2f}</td>
            </tr></tbody>
        </table>
        <div style="margin-top:40px;font-size:11px;color:#94a3b8;">
            <p>Authorized Signature: _______________________</p>
        </div>
    </div>
    <div class="footer"><span>www.starlex.in</span></div>
    </body></html>"""

    return {"html": html, "po_number": po.po_number}
