from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import (
    Product, Store, User, StoreStockBatch, SalesRecord, PurchaseRecord,
    PurchaseOrder, PurchaseOrderItem, StoreRequest, StoreRequestItem,
    AuditLog, POComment, POCategoryRule, RequestComment,
)
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional, List
import asyncio
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import uuid
import math

router = APIRouter()


async def _get_user_map(db):
    """Load all users as id->name map."""
    return {u.id: u.full_name for u in (await db.execute(select(User))).scalars().all()}


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
    return {"suppliers": supplier_list, "total": len(supplier_list)}

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


    return {"suppliers": supplier_list, "total": len(supplier_list)}

@router.get("/po/product-stock-info")
async def product_stock_info(
    product_id: str = Query(None),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    """Get product landing cost + stock across all stores. For store_staff, show only their store."""
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    user_store = user.get("store_id") if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") else None

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
        ss_q = select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("stock")).where(
            StoreStockBatch.ho_product_id == p.product_id).group_by(StoreStockBatch.store_id)
        if user_store:
            ss_q = ss_q.where(StoreStockBatch.store_id == user_store)
        stock_rows = (await db.execute(ss_q)).all()
        store_stock = [{"store_id": r[0], "store": smap.get(r[0], ""), "stock": math.floor(float(r[1] or 0) + 0.5)} for r in stock_rows if float(r[1] or 0) > 0]

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

    # Load PO category rules for auto-classification
    category_rules = {}
    for rule in (await db.execute(select(POCategoryRule))).scalars().all():
        for sc in rule.sub_categories.split(","):
            category_rules[sc.strip()] = rule.po_category

    # Bulk-fetch all product data, stock, and pending counts in 3 queries (not 3N)
    all_pids = [item.product_id for item in data.items if item.product_id]

    products_map: dict = {}
    stock_map: dict = {}
    pending_map: dict = {}

    if all_pids:
        prod_rows, stock_rows, pending_rows = await asyncio.gather(
            db.execute(select(Product).where(Product.product_id.in_(all_pids))),
            db.execute(
                select(StoreStockBatch.ho_product_id, func.sum(StoreStockBatch.closing_stock_strips).label("units"))
                .where(StoreStockBatch.store_id == data.store_id, StoreStockBatch.ho_product_id.in_(all_pids))
                .group_by(StoreStockBatch.ho_product_id)
            ),
            db.execute(
                select(StoreRequestItem.product_id, func.count(StoreRequestItem.id).label("cnt"))
                .join(StoreRequest, StoreRequestItem.request_id == StoreRequest.id)
                .where(
                    StoreRequest.store_id == data.store_id,
                    StoreRequest.status.in_(["pending", "approved"]),
                    StoreRequestItem.product_id.in_(all_pids),
                )
                .group_by(StoreRequestItem.product_id)
            ),
        )
        products_map = {p.product_id: p for p in prod_rows.scalars().all()}
        stock_map = {r[0]: float(r[1] or 0) for r in stock_rows.all()}
        pending_map = {r[0]: int(r[1] or 0) for r in pending_rows.all()}

    # Build items using pre-fetched maps
    total_value = 0
    items_data = []
    for item in data.items:
        lcost = 0
        po_cat = None
        if item.product_id and item.product_id in products_map:
            prod = products_map[item.product_id]
            lcost = float(prod.landing_cost or prod.ptr or 0)
            if prod.sub_category and prod.sub_category in category_rules:
                po_cat = category_rules[prod.sub_category]

        est_value = math.floor((lcost * item.quantity) * 100 + 0.5) / 100.0
        total_value += est_value

        items_data.append({
            "product_id": item.product_id, "product_name": item.product_name,
            "is_registered": item.is_registered,
            "quantity": item.quantity, "landing_cost": lcost,
            "estimated_value": est_value,
            "current_store_stock": stock_map.get(item.product_id, 0) if item.product_id else 0,
            "pending_orders": pending_map.get(item.product_id, 0) if item.product_id else 0,
            "has_prescription": item.has_prescription,
            "doctor_name": item.doctor_name, "clinic_location": item.clinic_location,
            "po_category": po_cat,
        })

    req = StoreRequest(
        store_id=data.store_id, request_reason=data.request_reason,
        customer_name=data.customer_name, customer_mobile=data.customer_mobile,
        status="pending", total_items=len(items_data), total_value=math.floor(total_value * 100 + 0.5) / 100.0,
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
            po_category=it["po_category"],
        ))

    await _log(db, user, f"Created store request: {len(items_data)} items, INR {total_value}", "store_request", req.id)
    await db.commit()

    # Notify HO about new store request
    from routers.notification_routes import notify_role
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    store_name = stores_map.get(data.store_id, "")
    await notify_role(db, ["ADMIN", "HO_STAFF"], f"New Store Request from {store_name}", f"{len(items_data)} items, Est. INR {math.floor(total_value * 100 + 0.5) / 100.0}", link="/store-request", entity_type="store_request", entity_id=req.id)
    await db.commit()

    return {"id": req.id, "total_value": math.floor(total_value * 100 + 0.5) / 100.0, "items": items_data}


@router.get("/po/store-requests")
async def list_store_requests(
    store_id: int = Query(None), status: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    from cache import get_cached, set_cached, cache_key
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        store_id = user["store_id"]
    ck = cache_key("store_requests", store_id, status, page, limit)
    cached = get_cached(ck, ttl=30)
    if cached: return cached

    query = select(StoreRequest)
    if store_id:
        query = query.where(StoreRequest.store_id == store_id)
    if status and status != "all":
        query = query.where(StoreRequest.status == status)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    reqs = (await db.execute(query.order_by(StoreRequest.created_at.desc()).offset((page-1)*limit).limit(limit))).scalars().all()

    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    umap = await _get_user_map(db)

    # Batch load ALL items for these requests in ONE query
    req_ids = [r.id for r in reqs]
    all_items = {}
    if req_ids:
        items_q = (await db.execute(select(StoreRequestItem).where(StoreRequestItem.request_id.in_(req_ids)))).scalars().all()
        for it in items_q:
            all_items.setdefault(it.request_id, []).append(it)

    result = []
    for r in reqs:
        items = all_items.get(r.id, [])
        result.append({
            "id": r.id, "store_id": r.store_id, "store_name": smap.get(r.store_id, ""),
            "request_reason": r.request_reason, "customer_name": r.customer_name,
            "customer_mobile": r.customer_mobile, "status": r.status,
            "total_items": r.total_items, "total_value": r.total_value,
            "po_id": r.po_id, "ho_remarks": r.ho_remarks,
            "requested_by": umap.get(r.requested_by, ""),
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
    return set_cached(ck, {"requests": result, "total": total}, ttl=30)


@router.get("/po/store-requests/{request_id}/stock-info")
async def request_stock_info(
    request_id: int,
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """For HO: show stock across all stores + sales trend for each product in request."""
    req = (await db.execute(select(StoreRequest).where(StoreRequest.id == request_id))).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found")
    items = (await db.execute(select(StoreRequestItem).where(StoreRequestItem.request_id == request_id))).scalars().all()
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    now = datetime.now(timezone.utc)

    # Batch load stock for ALL product IDs at once
    pids = [it.product_id for it in items if it.product_id]
    all_stock = {}
    if pids:
        stock_rows = (await db.execute(
            select(StoreStockBatch.ho_product_id, StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("stock"))
            .where(StoreStockBatch.ho_product_id.in_(pids))
            .group_by(StoreStockBatch.ho_product_id, StoreStockBatch.store_id)
        )).all()
        for r in stock_rows:
            all_stock.setdefault(r[0], []).append({"store": smap.get(r[1], ""), "stock": math.floor(float(r[2] or 0) + 0.5)})

    # Batch load 90d sales
    d90 = now - timedelta(days=90); d30 = now - timedelta(days=30)
    pnames = {it.product_id: it.product_name for it in items if it.product_id}
    all_sales_30 = {}; all_sales_90 = {}
    if pnames:
        for r in (await db.execute(
            select(SalesRecord.product_name, func.sum(SalesRecord.quantity))
            .where(SalesRecord.product_name.in_(pnames.values()), SalesRecord.invoice_date >= d30)
            .group_by(SalesRecord.product_name)
        )).all():
            all_sales_30[r[0]] = float(r[1] or 0)
        for r in (await db.execute(
            select(SalesRecord.product_name, func.sum(SalesRecord.quantity))
            .where(SalesRecord.product_name.in_(pnames.values()), SalesRecord.invoice_date >= d90)
            .group_by(SalesRecord.product_name)
        )).all():
            all_sales_90[r[0]] = float(r[1] or 0)

    product_info = []
    for it in items:
        store_stock = [s for s in all_stock.get(it.product_id, []) if s["stock"] > 0]
        sales_30 = all_sales_30.get(it.product_name, 0)
        sales_90 = all_sales_90.get(it.product_name, 0)

        product_info.append({
            "product_id": it.product_id, "product_name": it.product_name,
            "requested_qty": it.quantity, "landing_cost": it.landing_cost,
            "store_stock": store_stock, "sales_30d": math.floor(sales_30 + 0.5), "sales_90d": math.floor(sales_90 + 0.5),
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
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    total_qty = sum(it.quantity for it in data.items)
    total_value = sum(math.floor((it.quantity * it.landing_cost) * 100 + 0.5) / 100.0 for it in data.items)

    po = PurchaseOrder(
        po_number=_gen_po_number(), store_id=data.store_id,
        supplier_name=data.supplier_name, po_type=data.po_type,
        sub_category=data.sub_category, status="draft",
        total_qty=total_qty, total_value=math.floor(total_value * 100 + 0.5) / 100.0,
        remarks=data.remarks, created_by=user["user_id"],
    )
    db.add(po)
    await db.flush()

    for it in data.items:
        db.add(PurchaseOrderItem(
            po_id=po.id, product_id=it.product_id, product_name=it.product_name,
            is_registered=it.is_registered, quantity=it.quantity,
            landing_cost=it.landing_cost, estimated_value=math.floor((it.quantity * it.landing_cost) * 100 + 0.5) / 100.0,
        ))

    # Link to store request if provided
    if data.request_id:
        req = (await db.execute(select(StoreRequest).where(StoreRequest.id == data.request_id))).scalar_one_or_none()
        if req:
            req.po_id = po.id
            req.status = "po_created"

    await _log(db, user, f"Created PO {po.po_number}: {len(data.items)} items, INR {total_value}", "purchase_order", po.id)
    await db.commit()
    return {"id": po.id, "po_number": po.po_number, "total_value": math.floor(total_value * 100 + 0.5) / 100.0}


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
    umap = await _get_user_map(db)
    return {
        "orders": [{
            "id": p.id, "po_number": p.po_number, "store_name": smap.get(p.store_id, "HO"),
            "supplier_name": p.supplier_name, "po_type": p.po_type,
            "sub_category": p.sub_category, "status": p.status,
            "total_qty": p.total_qty, "total_value": p.total_value,
            "fulfillment_status": p.fulfillment_status,
            "created_by": umap.get(p.created_by, ""),
            "approved_by": umap.get(p.approved_by, "") if p.approved_by else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        } for p in pos],
        "total": total,
    }


@router.get("/po/category-rules")
async def get_category_rules(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    rules = (await db.execute(select(POCategoryRule).order_by(POCategoryRule.po_category))).scalars().all()
    return {"rules": [{"id": r.id, "po_category": r.po_category, "sub_categories": r.sub_categories.split(",") if r.sub_categories else []} for r in rules]}


class CategoryRuleReq(BaseModel):
    po_category: str
    sub_categories: List[str]


@router.post("/po/category-rules")
async def save_category_rule(data: CategoryRuleReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    existing = (await db.execute(select(POCategoryRule).where(POCategoryRule.po_category == data.po_category))).scalar_one_or_none()
    if existing:
        existing.sub_categories = ",".join(data.sub_categories)
    else:
        db.add(POCategoryRule(po_category=data.po_category, sub_categories=",".join(data.sub_categories)))
    await db.commit()
    return {"message": f"Rule saved for {data.po_category}"}


@router.delete("/po/category-rules/{rule_id}")
async def delete_category_rule(rule_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    r = (await db.execute(select(POCategoryRule).where(POCategoryRule.id == rule_id))).scalar_one_or_none()
    if r:
        await db.delete(r)
        await db.commit()
    return {"message": "Rule deleted"}


# ─── Purchase Review (for PO category items) ────────────────

@router.get("/po/purchase-review")
async def purchase_review(
    po_category: str = Query(None),
    status: str = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Get all store request items with PO category — full details per product."""
    from cache import get_cached, set_cached, cache_key
    ck = cache_key("purchase_review", po_category, status)
    cached = get_cached(ck, ttl=30)
    if cached: return cached

    query = select(StoreRequestItem)
    if po_category and po_category != "all":
        query = query.where(StoreRequestItem.po_category == po_category)
    elif po_category != "all":
        pass  # show all
    if status and status != "all":
        query = query.where(StoreRequestItem.item_status == status)

    items = (await db.execute(query.order_by(StoreRequestItem.id.desc()))).scalars().all()

    req_ids = set(it.request_id for it in items)
    req_map = {}
    if req_ids:
        for r in (await db.execute(select(StoreRequest).where(StoreRequest.id.in_(req_ids)))).scalars().all():
            req_map[r.id] = r
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    umap = await _get_user_map(db)
    now = datetime.now(timezone.utc)

    result = []
    for it in items:
        req = req_map.get(it.request_id)
        # Suppliers from Product Master
        suppliers = {}
        prod_info = {}
        if it.product_id:
            prod = (await db.execute(select(Product).where(Product.product_id == it.product_id))).scalar_one_or_none()
            if prod:
                if prod.primary_supplier: suppliers["primary"] = prod.primary_supplier
                if prod.secondary_supplier: suppliers["secondary"] = prod.secondary_supplier
                if prod.least_price_supplier: suppliers["least_price"] = prod.least_price_supplier
                if prod.most_qty_supplier: suppliers["most_qty"] = prod.most_qty_supplier
                prod_info = {"category": prod.category, "sub_category": prod.sub_category, "mrp": prod.mrp or 0, "ptr": prod.ptr or 0}

        # Stock across ALL stores
        store_stock = []
        if it.product_id:
            ss_q = (await db.execute(
                select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("stock"))
                .where(StoreStockBatch.ho_product_id == it.product_id)
                .group_by(StoreStockBatch.store_id)
            )).all()
            store_stock = [{"store": smap.get(r[0], ""), "stock": round(float(r[1] or 0), 0)} for r in ss_q if float(r[1] or 0) > 0]

        # Sales trend
        sales_30d = 0
        if it.product_id:
            sales_30d = float((await db.execute(
                select(func.sum(SalesRecord.quantity)).where(and_(
                    SalesRecord.product_id == it.product_id, SalesRecord.invoice_date >= now - timedelta(days=30)
                ))
            )).scalar() or 0)

        result.append({
            "id": it.id, "request_id": it.request_id,
            "store_name": smap.get(req.store_id, "") if req else "",
            "customer_name": req.customer_name if req else None,
            "customer_mobile": req.customer_mobile if req else None,
            "request_reason": req.request_reason if req else "",
            "requested_by": umap.get(req.requested_by, "") if req else "",
            "product_id": it.product_id, "product_name": it.product_name,
            "quantity": it.quantity, "landing_cost": it.landing_cost,
            "po_category": it.po_category, "item_status": it.item_status,
            "selected_supplier": it.selected_supplier,
            "tat_days": it.tat_days, "tat_type": it.tat_type, "ho_remarks": it.ho_remarks,
            "fulfillment_status": it.fulfillment_status,
            "suppliers": suppliers,
            "store_stock": store_stock,
            "total_network_stock": sum(s["stock"] for s in store_stock),
            "sales_30d": math.floor(sales_30d + 0.5),
            "product_info": prod_info,
            "created_at": req.created_at.isoformat() if req and req.created_at else None,
        })

    response = {"items": result, "total": len(result)}
    return set_cached(ck, response, ttl=30)


class UpdateItemReq(BaseModel):
    item_ids: List[int]
    supplier: Optional[str] = None
    status: Optional[str] = None
    tat_days: Optional[int] = None
    tat_type: Optional[str] = None
    ho_remarks: Optional[str] = None
    fulfillment_status: Optional[str] = None


@router.put("/po/purchase-review/update")
async def update_review_items(data: UpdateItemReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR"))):
    for iid in data.item_ids:
        it = (await db.execute(select(StoreRequestItem).where(StoreRequestItem.id == iid))).scalar_one_or_none()
        if it:
            if data.supplier: it.selected_supplier = data.supplier
            if data.status: it.item_status = data.status
            if data.tat_days is not None: it.tat_days = data.tat_days
            if data.tat_type is not None: it.tat_type = data.tat_type
            if data.ho_remarks is not None: it.ho_remarks = data.ho_remarks
            if data.fulfillment_status is not None: it.fulfillment_status = data.fulfillment_status
    await _log(db, user, f"Updated {len(data.item_ids)} items", "purchase_review")
    await db.commit()
    from cache import invalidate
    invalidate()
    return {"message": f"Updated {len(data.item_ids)} items"}


class RequestCommentReq(BaseModel):
    item_id: int
    message: str


@router.post("/po/request-comment")
async def add_request_comment(data: RequestCommentReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    db.add(RequestComment(item_id=data.item_id, user_name=user.get("full_name", ""), user_role=user.get("role", ""), message=data.message))
    await db.commit()
    return {"message": "Comment added"}


@router.get("/po/request-comments/{item_id}")
async def get_request_comments(item_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    comments = (await db.execute(select(RequestComment).where(RequestComment.item_id == item_id).order_by(RequestComment.created_at))).scalars().all()
    return {"comments": [{"id": c.id, "user_name": c.user_name, "user_role": c.user_role, "message": c.message,
                           "created_at": c.created_at.isoformat() if c.created_at else None} for c in comments]}


@router.post("/po/reconcile-received")
async def reconcile_received(
    store_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Match order_placed items against purchase uploads to update received status."""
    # Get all order_placed items for this store
    order_items = (await db.execute(
        select(StoreRequestItem)
        .join(StoreRequest, StoreRequestItem.request_id == StoreRequest.id)
        .where(and_(StoreRequest.store_id == store_id, StoreRequestItem.item_status == "order_placed"))
    )).scalars().all()

    if not order_items:
        return {"message": "No order_placed items to reconcile", "received": 0, "partial": 0, "pending": 0}

    # Get purchase records for this store
    purchase_map = {}
    for pr in (await db.execute(select(PurchaseRecord).where(PurchaseRecord.store_id == store_id))).scalars().all():
        pid = pr.product_id or ""
        pname = pr.product_name or ""
        key = pid if pid else pname.lower()
        purchase_map[key] = purchase_map.get(key, 0) + float(pr.quantity or 0)

    received = 0
    partial = 0
    still_pending = 0

    for it in order_items:
        key = it.product_id if it.product_id else (it.product_name or "").lower()
        purchased_qty = purchase_map.get(key, 0)

        if purchased_qty >= it.quantity:
            it.item_status = "received"
            it.fulfillment_status = "received"
            it.received_qty = it.quantity
            received += 1
        elif purchased_qty > 0:
            it.item_status = "partially_received"
            it.fulfillment_status = "partially_received"
            it.received_qty = purchased_qty
            partial += 1
        else:
            still_pending += 1

    await _log(db, user, f"Reconciled store {store_id}: {received} received, {partial} partial, {still_pending} pending", "reconciliation")
    await db.commit()
    return {"message": "Reconciliation complete", "received": received, "partial": partial, "pending": still_pending}


@router.get("/po/received-items")
async def get_received_items(
    store_id: int = Query(None),
    status: str = Query("all"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        store_id = user["store_id"]
    query = select(StoreRequestItem).join(StoreRequest, StoreRequestItem.request_id == StoreRequest.id).where(
        StoreRequestItem.item_status.in_(["order_placed", "received", "partially_received"])
    )
    if store_id:
        query = query.where(StoreRequest.store_id == store_id)
    if status != "all":
        query = query.where(StoreRequestItem.item_status == status)

    items = (await db.execute(query.order_by(StoreRequestItem.id.desc()))).scalars().all()
    req_ids = set(it.request_id for it in items)
    req_map = {}
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    if req_ids:
        for r in (await db.execute(select(StoreRequest).where(StoreRequest.id.in_(req_ids)))).scalars().all():
            req_map[r.id] = r

    return {"items": [{
        "id": it.id, "request_id": it.request_id,
        "store_name": smap.get(req_map[it.request_id].store_id, "") if it.request_id in req_map else "",
        "product_id": it.product_id, "product_name": it.product_name,
        "quantity": it.quantity, "received_qty": it.received_qty or 0,
        "landing_cost": it.landing_cost, "selected_supplier": it.selected_supplier,
        "item_status": it.item_status,
    } for it in items]}



@router.get("/po/all-comments")
async def get_all_comments(
    limit: int = Query(50),
    search: str = Query(None),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    comments = (await db.execute(select(RequestComment).order_by(RequestComment.created_at.desc()).limit(200))).scalars().all()
    item_ids = set(c.item_id for c in comments)
    item_map = {}
    req_map = {}
    if item_ids:
        for it in (await db.execute(select(StoreRequestItem).where(StoreRequestItem.id.in_(item_ids)))).scalars().all():
            item_map[it.id] = {"product_name": it.product_name, "request_id": it.request_id}
        req_ids = set(v["request_id"] for v in item_map.values() if v.get("request_id"))
        if req_ids:
            smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
            for r in (await db.execute(select(StoreRequest).where(StoreRequest.id.in_(req_ids)))).scalars().all():
                req_map[r.id] = {"store_name": smap.get(r.store_id, ""), "store_id": r.store_id}

    result = []
    for c in comments:
        info = item_map.get(c.item_id, {})
        rinfo = req_map.get(info.get("request_id"), {})
        entry = {"id": c.id, "item_id": c.item_id,
                 "request_id": info.get("request_id"),
                 "product_name": info.get("product_name", ""),
                 "store_name": rinfo.get("store_name", ""),
                 "user_name": c.user_name, "user_role": c.user_role, "message": c.message,
                 "created_at": c.created_at.isoformat() if c.created_at else None}
        if search:
            sl = search.lower()
            if sl not in entry["product_name"].lower() and sl not in entry["store_name"].lower() and sl not in str(entry["request_id"]) and sl not in entry["message"].lower():
                continue
        result.append(entry)
    return {"comments": result[:limit]}





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
                select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("stock"))
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
async def update_po(po_id: int, data: UpdatePOReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR"))):
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
            ev = math.floor((it.quantity * it.landing_cost) * 100 + 0.5) / 100.0
            total_qty += it.quantity; total_value += ev
            db.add(PurchaseOrderItem(po_id=po_id, product_id=it.product_id, product_name=it.product_name,
                is_registered=it.is_registered, quantity=it.quantity, landing_cost=it.landing_cost, estimated_value=ev))
        po.total_qty = total_qty; po.total_value = math.floor(total_value * 100 + 0.5) / 100.0
    po.updated_at = datetime.now(timezone.utc)
    await _log(db, user, f"Updated PO {po.po_number}", "purchase_order", po_id)
    await db.commit()
    return {"message": "PO updated"}


@router.delete("/po/{po_id}")
async def delete_po(po_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR"))):
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
    db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
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
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
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
    import base64
    from pathlib import Path

    po = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))).scalar_one_or_none()
    if not po:
        raise HTTPException(404, "PO not found")
    items = (await db.execute(select(PurchaseOrderItem).where(PurchaseOrderItem.po_id == po_id))).scalars().all()
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # Load letterhead as base64
    letterhead_b64 = ""
    lh_path = Path(__file__).parent.parent.parent / "frontend" / "public" / "letterhead.jpeg"
    if lh_path.exists():
        letterhead_b64 = base64.b64encode(lh_path.read_bytes()).decode()

    # Generate HTML for PDF
    items_html = ""
    for i, it in enumerate(items):
        items_html += f"""<tr>
            <td>{i+1}</td>
            <td>{it.product_id or '-'}</td>
            <td style="font-weight:500;">{it.product_name}</td>
            <td style="text-align:right;">{it.quantity:.0f}</td>
        </tr>"""

    html = f"""<!DOCTYPE html><html><head><style>
        @page {{ margin: 0; size: A4; }}
        body {{ font-family: 'Helvetica', sans-serif; margin: 0; padding: 0; position: relative; }}
        .page {{ position: relative; width: 210mm; min-height: 297mm; }}
        .letterhead {{ position: absolute; top: 0; left: 0; width: 100%; z-index: 0; }}
        .letterhead img {{ width: 100%; display: block; }}
        .content {{ position: relative; z-index: 1; padding: 240px 40px 100px 40px; }}
        .po-title {{ font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; text-align: center; text-decoration: underline; }}
        .info-grid {{ display: flex; justify-content: space-between; margin-bottom: 8px; }}
        .info-item {{ font-size: 10px; color: #475569; margin-bottom: 2px; }}
        .info-item b {{ color: #1e293b; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 8px; background: rgba(255,255,255,0.95); }}
        th {{ background: #f1f5f9; padding: 5px 6px; text-align: left; font-size: 9px; font-weight: 600; color: #64748b; text-transform: uppercase; border: 1px solid #e2e8f0; }}
        td {{ border: 1px solid #e2e8f0; padding: 4px 6px; font-size: 11px; }}
        .total-row {{ background: #f0f9ff; font-weight: 700; font-size: 12px; }}
        .sign-area {{ margin-top: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }}
    </style></head><body>
    <div class="page">
        <div class="letterhead">{'<img src="data:image/jpeg;base64,' + letterhead_b64 + '" />' if letterhead_b64 else ''}</div>
        <div class="content">
            <div class="po-title">PURCHASE ORDER</div>
            <div class="info-grid">
                <div>
                    <div class="info-item"><b>PO Number:</b> {po.po_number}</div>
                    <div class="info-item"><b>Date:</b> {po.created_at.strftime('%d %b %Y') if po.created_at else '-'}</div>
                    <div class="info-item"><b>Supplier:</b> {po.supplier_name or 'To be assigned'}</div>
                </div>
                <div style="text-align:right;">
                    <div class="info-item"><b>Sub Category:</b> {po.sub_category or '-'}</div>
                    <div class="info-item"><b>Status:</b> {po.status.upper()}</div>
                    <div class="info-item"><b>Store:</b> {smap.get(po.store_id, 'Head Office')}</div>
                </div>
            </div>
            <table>
                <thead><tr>
                    <th style="width:30px;">#</th><th>Product ID</th><th>Product Name</th>
                    <th style="text-align:right;">Qty</th>
                </tr></thead>
                <tbody>{items_html}
                <tr class="total-row">
                    <td colspan="3" style="padding:6px;border:1px solid #e2e8f0;"><b>TOTAL</b></td>
                    <td style="padding:6px;text-align:right;border:1px solid #e2e8f0;"><b>{po.total_qty:.0f}</b></td>
                </tr></tbody>
            </table>
            <div class="sign-area">
                <div>Prepared by: _________________</div>
                <div>Authorized Signature: _________________</div>
            </div>
        </div>
    </div>
    </body></html>"""

    return {"html": html, "po_number": po.po_number}


# ─── PO Category Rules Management ───────────────────────────
