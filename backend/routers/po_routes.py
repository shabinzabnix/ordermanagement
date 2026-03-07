from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import (
    Product, Store, StoreStockBatch, SalesRecord, PurchaseRecord,
    PurchaseOrder, PurchaseOrderItem, StoreRequest, StoreRequestItem,
    AuditLog,
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
        "products": [{"product_id": p.product_id, "product_name": p.product_name, "landing_cost": p.landing_cost or 0,
                       "mrp": p.mrp or 0, "primary_supplier": p.primary_supplier or ""} for p in products],
        "suppliers": sorted(suppliers),
        "total_products": len(products),
    }


    return {"suppliers": supplier_list[:100], "total": len(supplier_list)}


# ─── Store Purchase Request ─────────────────────────────────

class RequestItemReq(BaseModel):
    product_id: Optional[str] = None
    product_name: str
    quantity: float

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
        # Get landing cost from Product Master
        lcost = 0
        if item.product_id:
            prod = (await db.execute(select(Product).where(Product.product_id == item.product_id))).scalar_one_or_none()
            if prod:
                lcost = float(prod.landing_cost or 0)

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
            "quantity": item.quantity, "landing_cost": lcost,
            "estimated_value": est_value, "current_store_stock": store_stock,
            "pending_orders": pending,
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
            quantity=it["quantity"], landing_cost=it["landing_cost"],
            estimated_value=it["estimated_value"], current_store_stock=it["current_store_stock"],
            pending_orders=it["pending_orders"],
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
                "quantity": it.quantity, "landing_cost": it.landing_cost,
                "estimated_value": it.estimated_value, "current_store_stock": it.current_store_stock,
                "pending_orders": it.pending_orders,
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
    return {
        "po": {
            "id": po.id, "po_number": po.po_number, "store_name": smap.get(po.store_id, "HO"),
            "supplier_name": po.supplier_name, "po_type": po.po_type, "status": po.status,
            "total_qty": po.total_qty, "total_value": po.total_value,
            "remarks": po.remarks, "fulfillment_status": po.fulfillment_status,
        },
        "items": [{"id": it.id, "product_id": it.product_id, "product_name": it.product_name,
                    "is_registered": it.is_registered, "quantity": it.quantity,
                    "landing_cost": it.landing_cost, "estimated_value": it.estimated_value}
                   for it in items],
    }


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
    supplier_name: str = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    """Upload Excel: Sub Category, Product Name, Qty, Rate → creates POs grouped by sub-category."""
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()
    df = None
    for skip in [0, 1, 2, 3]:
        try:
            test_df = pd.read_excel(BytesIO(content), header=skip)
            if not test_df.empty and len(test_df.columns) >= 3:
                df = test_df; break
        except: continue
    if df is None:
        raise HTTPException(400, "Failed to read Excel")

    col_map = {"sub category": "sub_category", "subcategory": "sub_category", "category": "sub_category",
               "product name": "product_name", "product": "product_name", "name": "product_name",
               "qty": "quantity", "quantity": "quantity",
               "rate": "landing_cost", "cost": "landing_cost", "price": "landing_cost", "landing cost": "landing_cost",
               "ho id": "product_id", "product id": "product_id"}
    df.columns = [str(c).strip().lower().replace('_', ' ') for c in df.columns]
    df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

    if "product_name" not in df.columns or "quantity" not in df.columns:
        raise HTTPException(400, f"Required: Product Name, Qty. Your columns: {list(df.columns)}")

    # Group by sub_category
    groups = {}
    for _, row in df.iterrows():
        pname = str(row.get("product_name", "")).strip()
        if not pname or pname == "nan": continue
        subcat = str(row.get("sub_category", "General")).strip()
        if subcat == "nan": subcat = "General"
        if subcat not in groups: groups[subcat] = []
        pid = str(row.get("product_id", "")).strip() if pd.notna(row.get("product_id")) else None
        if pid and pid.endswith(".0"): pid = pid[:-2]
        if pid in ("", "nan", "None"): pid = None
        lcost = float(row.get("landing_cost", 0)) if pd.notna(row.get("landing_cost")) else 0
        qty = float(row.get("quantity", 0)) if pd.notna(row.get("quantity")) else 0
        groups[subcat].append({"product_id": pid, "product_name": pname, "quantity": qty, "landing_cost": lcost})

    created_pos = []
    for subcat, items in groups.items():
        total_qty = sum(it["quantity"] for it in items)
        total_value = sum(round(it["quantity"] * it["landing_cost"], 2) for it in items)
        po = PurchaseOrder(
            po_number=_gen_po_number(), supplier_name=supplier_name,
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
        created_pos.append({"po_number": po.po_number, "sub_category": subcat, "items": len(items), "value": round(total_value, 2)})

    await db.commit()
    return {"message": f"Created {len(created_pos)} POs by sub-category", "purchase_orders": created_pos}
