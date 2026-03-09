from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from models import Product, Store, User, UserRole, UploadHistory, UploadType, SalesRecord, TransactionComment
from auth import get_current_user, require_roles, hash_password
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import json

router = APIRouter()

PRODUCT_COLUMNS = {
    "product id": "product_id",
    "id": "product_id",
    "ho id": "product_id",
    "ho_id": "product_id",
    "item code": "product_id",
    "code": "product_id",
    "product name": "product_name",
    "name": "product_name",
    "item name": "product_name",
    "primary supplier": "primary_supplier",
    "primary suplier": "primary_supplier",
    "supplier": "primary_supplier",
    "secondary supplier": "secondary_supplier",
    "secondary suplier": "secondary_supplier",
    "least price supplier": "least_price_supplier",
    "least price suplier": "least_price_supplier",
    "most qty supplier": "most_qty_supplier",
    "most qty suplier": "most_qty_supplier",
    "category": "category",
    "sub category": "sub_category",
    "rep": "rep",
    "representative": "rep",
    "mrp": "mrp",
    "ptr": "ptr",
    "landing cost": "landing_cost",
    "l cost": "landing_cost",
    "l.cost": "landing_cost",
    "lcost": "landing_cost",
    "l. cost": "landing_cost",
    "purchase price": "landing_cost",
}
PRODUCT_REQUIRED = ["product_id", "product_name"]


def map_columns(df, column_map, required_fields):
    original_cols = list(df.columns)
    df.columns = [str(col).strip().lower().replace('_', ' ') for col in df.columns]
    mapped = {}
    for col in df.columns:
        if col in column_map:
            mapped[col] = column_map[col]
    mapped_fields = set(mapped.values())
    missing = [f for f in required_fields if f not in mapped_fields]
    if missing:
        return None, missing, {"original_columns": original_cols, "matched": mapped, "unmatched": [c for c in df.columns if c not in mapped]}
    df = df.rename(columns=mapped)
    keep_cols = list(dict.fromkeys([v for v in mapped.values() if v in df.columns]))
    df = df[keep_cols]
    return df, [], {"original_columns": original_cols, "matched": mapped, "unmatched": [c for c in original_cols if str(c).strip().lower().replace('_', ' ') not in mapped]}


# --- Products ---

@router.get("/products")
async def get_products(
    search: str = Query(None),
    category: str = Query(None),
    sub_category: str = Query(None),
    supplier: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = select(Product)
    if search:
        query = query.where(
            (Product.product_name.ilike(f"%{search}%"))
            | (Product.product_id.ilike(f"%{search}%"))
        )
    if category:
        query = query.where(Product.category == category)
    if sub_category:
        query = query.where(Product.sub_category == sub_category)
    if supplier:
        query = query.where(
            (Product.primary_supplier == supplier) | (Product.secondary_supplier == supplier) |
            (Product.least_price_supplier == supplier) | (Product.most_qty_supplier == supplier)
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.order_by(Product.product_name).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    products = result.scalars().all()

    return {
        "products": [
            {
                "id": p.id,
                "product_id": p.product_id,
                "product_name": p.product_name,
                "primary_supplier": p.primary_supplier,
                "secondary_supplier": p.secondary_supplier,
                "least_price_supplier": p.least_price_supplier,
                "most_qty_supplier": p.most_qty_supplier,
                "category": p.category,
                "sub_category": p.sub_category,
                "rep": p.rep,
                "mrp": p.mrp or 0,
                "ptr": p.ptr or 0,
                "landing_cost": p.landing_cost or p.ptr or 0,
            }
            for p in products
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/products/categories")
async def get_categories(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(Product.category).distinct().where(Product.category.isnot(None))
    )
    return {"categories": [r[0] for r in result.all() if r[0]]}


@router.get("/products/sub-categories")
async def get_sub_categories(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(Product.sub_category).distinct().where(Product.sub_category.isnot(None))
    )
    return {"sub_categories": [r[0] for r in result.all() if r[0]]}


@router.post("/products/upload")
async def upload_products(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files (.xlsx, .xls) are accepted")

    content = await file.read()
    try:
        df = pd.read_excel(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel file: {str(e)}")

    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    df_mapped, missing, col_info = map_columns(df, PRODUCT_COLUMNS, PRODUCT_REQUIRED)
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Your Excel columns: {col_info.get('original_columns', [])}")

    success = 0
    failed = 0
    errors = []

    # Build all data first, then bulk upsert
    rows_data = []
    for idx, row in df_mapped.iterrows():
        try:
            product_id = str(row.get("product_id", "")).strip()
            if product_id.endswith(".0"):
                product_id = product_id[:-2]
            if not product_id:
                errors.append(f"Row {idx+2}: Missing product_id")
                failed += 1
                continue

            data = {
                "product_id": product_id,
                "product_name": str(row.get("product_name", "")).strip(),
                "primary_supplier": str(row.get("primary_supplier", "")).strip() if pd.notna(row.get("primary_supplier")) else None,
                "secondary_supplier": str(row.get("secondary_supplier", "")).strip() if pd.notna(row.get("secondary_supplier")) else None,
                "least_price_supplier": str(row.get("least_price_supplier", "")).strip() if pd.notna(row.get("least_price_supplier")) else None,
                "most_qty_supplier": str(row.get("most_qty_supplier", "")).strip() if pd.notna(row.get("most_qty_supplier")) else None,
                "category": str(row.get("category", "")).strip() if pd.notna(row.get("category")) else None,
                "sub_category": str(row.get("sub_category", "")).strip() if pd.notna(row.get("sub_category")) else None,
                "rep": str(row.get("rep", "")).strip() if pd.notna(row.get("rep")) else None,
                "mrp": float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                "ptr": float(row.get("ptr", 0)) if pd.notna(row.get("ptr")) else 0,
                "landing_cost": float(row.get("landing_cost", 0)) if pd.notna(row.get("landing_cost")) else 0,
            }
            rows_data.append(data)
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)}")
            failed += 1

    # Bulk upsert using PostgreSQL ON CONFLICT
    if rows_data:
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        BATCH = 100
        for i in range(0, len(rows_data), BATCH):
            batch = rows_data[i:i+BATCH]
            stmt = pg_insert(Product).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=['product_id'],
                set_={k: stmt.excluded[k] for k in ['product_name', 'primary_supplier', 'secondary_supplier', 'least_price_supplier', 'most_qty_supplier', 'category', 'sub_category', 'rep', 'mrp', 'ptr', 'landing_cost']}
            )
            await db.execute(stmt)
            await db.flush()
        await db.commit()

    try:
        upload = UploadHistory(
            file_name=file.filename,
            upload_type=UploadType.PRODUCT_MASTER,
            uploaded_by=user["user_id"],
            total_records=len(df_mapped),
            success_records=success,
            failed_records=failed,
            error_details=json.dumps(errors) if errors else None,
        )
        db.add(upload)
        await db.commit()
    except Exception:
        await db.rollback()

    return {"message": "Upload complete", "total": len(df_mapped), "success": success, "failed": failed, "errors": errors[:20],
            "columns_matched": col_info.get("matched", {}), "columns_unmatched": col_info.get("unmatched", [])[:20]}


# --- Stores ---

class StoreCreate(BaseModel):
    store_name: str
    location: str = ""
    manager_name: str = ""
    contact_number: str = ""
    store_code: str


class StoreUpdate(BaseModel):
    store_name: Optional[str] = None
    location: Optional[str] = None
    manager_name: Optional[str] = None
    contact_number: Optional[str] = None


@router.get("/stores")
async def get_stores(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    query = select(Store).where(Store.is_active == True).order_by(Store.store_name)
    # Store roles can only see their own store
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        query = query.where(Store.id == user["store_id"])
    stores = (await db.execute(query)).scalars().all()
    return {
        "stores": [
            {
                "id": s.id,
                "store_name": s.store_name,
                "location": s.location,
                "manager_name": s.manager_name,
                "contact_number": s.contact_number,
                "store_code": s.store_code,
            }
            for s in stores
        ]
    }


@router.post("/stores")
async def create_store(
    data: StoreCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    result = await db.execute(select(Store).where(Store.store_code == data.store_code))
    if result.scalar_one_or_none():
        raise HTTPException(400, f"Store code '{data.store_code}' already exists")
    store = Store(**data.model_dump())
    db.add(store)
    await db.commit()
    await db.refresh(store)
    return {
        "id": store.id,
        "store_name": store.store_name,
        "location": store.location,
        "manager_name": store.manager_name,
        "contact_number": store.contact_number,
        "store_code": store.store_code,
    }


@router.put("/stores/{store_id}")
async def update_store(
    store_id: int,
    data: StoreUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(404, "Store not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(store, key, value)
    await db.commit()
    await db.refresh(store)
    return {"id": store.id, "store_name": store.store_name, "store_code": store.store_code}


@router.delete("/stores/{store_id}")
async def delete_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(404, "Store not found")
    store.is_active = False
    await db.commit()
    return {"message": "Store deleted"}


# --- Users ---

class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    role: str
    store_id: Optional[int] = None
    allowed_services: Optional[str] = None


@router.get("/users")
async def get_users(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    result = await db.execute(select(User).where(~User.email.like("deleted_%")).order_by(User.full_name))
    users = result.scalars().all()
    return {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "full_name": u.full_name,
                "role": u.role.value if isinstance(u.role, UserRole) else u.role,
                "store_id": u.store_id,
                "allowed_services": u.allowed_services,
                "is_active": u.is_active,
            }
            for u in users
        ]
    }


@router.post("/users")
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    # Password strength validation
    if len(data.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    import re
    if not re.search(r'[A-Z]', data.password):
        raise HTTPException(400, "Password must contain at least one uppercase letter")
    if not re.search(r'[0-9]', data.password):
        raise HTTPException(400, "Password must contain at least one number")
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Email already exists")
    new_user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role=UserRole(data.role.upper()),
        store_id=data.store_id,
        allowed_services=data.allowed_services,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {"id": new_user.id, "email": new_user.email, "full_name": new_user.full_name, "role": new_user.role.value}


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    store_id: Optional[int] = None
    allowed_services: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/users/{user_id}")
async def update_user(user_id: int, data: UserUpdate, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u: raise HTTPException(404, "User not found")
    if data.full_name is not None: u.full_name = data.full_name
    if data.role is not None: u.role = UserRole(data.role.upper())
    if data.store_id is not None: u.store_id = data.store_id
    if data.allowed_services is not None: u.allowed_services = data.allowed_services
    if data.password: u.password_hash = hash_password(data.password)
    if data.is_active is not None: u.is_active = data.is_active
    await db.commit()
    return {"message": "User updated"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u: raise HTTPException(404, "User not found")
    if u.id == user["user_id"]: raise HTTPException(400, "Cannot delete yourself")
    # Soft delete: deactivate instead of hard delete (preserves audit trail)
    u.is_active = False
    u.email = f"deleted_{u.id}_{u.email}"
    await db.commit()
    return {"message": "User deactivated and removed"}


# --- Upload History ---

@router.get("/uploads")
async def get_uploads(
    upload_type: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = select(UploadHistory)
    if upload_type:
        query = query.where(UploadHistory.upload_type == UploadType(upload_type))
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.order_by(UploadHistory.created_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    uploads = result.scalars().all()

    # Get user names
    uids = set(u.uploaded_by for u in uploads if u.uploaded_by)
    umap = {}
    if uids:
        umap = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()}

    return {
        "uploads": [
            {
                "id": u.id,
                "file_name": u.file_name,
                "upload_type": u.upload_type.value if isinstance(u.upload_type, UploadType) else u.upload_type,
                "store_id": u.store_id,
                "uploaded_by": u.uploaded_by,
                "uploaded_by_name": umap.get(u.uploaded_by, ""),
                "total_records": u.total_records,
                "success_records": u.success_records,
                "failed_records": u.failed_records,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in uploads
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }



@router.delete("/uploads/{upload_id}")
async def delete_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    upload = (await db.execute(select(UploadHistory).where(UploadHistory.id == upload_id))).scalar_one_or_none()
    if not upload:
        raise HTTPException(404, "Upload not found")
    await db.delete(upload)
    await db.commit()
    return {"message": "Upload record deleted"}



# ─── Product 90-Day Sales Lookup ──────────────────────────────

class Sales90dReq(BaseModel):
    product_names: List[str]


@router.post("/products/sales-90d")
async def product_sales_90d(
    data: Sales90dReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Returns 90-day total sales qty for given product names across all stores."""
    if not data.product_names:
        return {"sales": {}}

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    names = data.product_names[:500]  # cap at 500

    rows = (await db.execute(
        select(
            SalesRecord.product_name,
            func.sum(SalesRecord.quantity).label("total_qty"),
            func.sum(SalesRecord.total_amount).label("total_amount"),
            func.count(SalesRecord.id).label("sale_count"),
        )
        .where(SalesRecord.product_name.in_(names), SalesRecord.invoice_date >= cutoff)
        .group_by(SalesRecord.product_name)
    )).all()

    sales = {}
    for r in rows:
        sales[r[0]] = {
            "qty": round(float(r[1] or 0), 1),
            "amount": round(float(r[2] or 0), 2),
            "count": int(r[3] or 0),
        }

    return {"sales": sales}



# ─── Product Profile Detail ───────────────────────────────────

@router.get("/products/{product_id}/profile")
async def product_profile(
    product_id: str,
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    from models import HOStockBatch, StoreStockBatch, Store, InterStoreTransfer, SalesRecord, PurchaseRecord
    now = datetime.now(timezone.utc)
    d90 = now - timedelta(days=90)

    product = (await db.execute(select(Product).where(Product.product_id == product_id))).scalar_one_or_none()
    if not product:
        return {"error": "Product not found"}

    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}

    # Supplier info
    suppliers = []
    if product.primary_supplier: suppliers.append({"type": "Primary", "name": product.primary_supplier})
    if product.secondary_supplier: suppliers.append({"type": "Secondary", "name": product.secondary_supplier})
    if product.least_price_supplier: suppliers.append({"type": "Least Price", "name": product.least_price_supplier})
    if product.most_qty_supplier: suppliers.append({"type": "Most Qty", "name": product.most_qty_supplier})

    # HO Stock
    ho_stock = float((await db.execute(select(func.sum(HOStockBatch.closing_stock)).where(HOStockBatch.product_id == product_id))).scalar() or 0)

    # Store stock breakdown
    store_stocks = []
    ss_q = (await db.execute(
        select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("stock"))
        .where(StoreStockBatch.ho_product_id == product_id)
        .group_by(StoreStockBatch.store_id)
    )).all()
    for r in ss_q:
        store_stocks.append({"store": stores_map.get(r[0], ""), "stock": round(float(r[1] or 0), 1)})

    # Sales (90d) by store
    sales_by_store = []
    sr_q = (await db.execute(
        select(SalesRecord.store_id, func.sum(SalesRecord.quantity).label("qty"), func.sum(SalesRecord.total_amount).label("amt"), func.count(SalesRecord.id).label("cnt"))
        .where(SalesRecord.product_name == product.product_name, SalesRecord.invoice_date >= d90)
        .group_by(SalesRecord.store_id)
    )).all()
    total_sales_qty = 0; total_sales_amt = 0
    for r in sr_q:
        qty = round(float(r[1] or 0), 1); amt = round(float(r[2] or 0), 2)
        sales_by_store.append({"store": stores_map.get(r[0], ""), "qty": qty, "amount": amt, "invoices": int(r[3] or 0)})
        total_sales_qty += qty; total_sales_amt += amt

    # Purchases (90d) by store
    purchases_by_store = []
    pr_q = (await db.execute(
        select(PurchaseRecord.store_id, func.sum(PurchaseRecord.quantity).label("qty"), func.sum(PurchaseRecord.total_amount).label("amt"))
        .where(PurchaseRecord.product_id == product_id, PurchaseRecord.purchase_date >= d90)
        .group_by(PurchaseRecord.store_id)
    )).all()
    total_purchase_qty = 0; total_purchase_amt = 0
    for r in pr_q:
        qty = round(float(r[1] or 0), 1); amt = round(float(r[2] or 0), 2)
        purchases_by_store.append({"store": stores_map.get(r[0], ""), "qty": qty, "amount": amt})
        total_purchase_qty += qty; total_purchase_amt += amt

    # Recent transfers
    transfers = (await db.execute(
        select(InterStoreTransfer).where(InterStoreTransfer.product_id == product_id)
        .order_by(InterStoreTransfer.created_at.desc()).limit(10)
    )).scalars().all()
    transfer_list = [{
        "from": stores_map.get(t.source_store_id, ""), "to": stores_map.get(t.requesting_store_id, ""),
        "qty": t.quantity, "status": t.status.value if hasattr(t.status, 'value') else t.status,
        "date": t.created_at.isoformat() if t.created_at else None,
    } for t in transfers]

    # Margin calculation
    margin_pct = round((1 - (product.ptr or 0) / product.mrp) * 100, 1) if product.mrp and product.mrp > 0 else 0

    return {
        "product": {
            "product_id": product.product_id, "product_name": product.product_name,
            "category": product.category, "sub_category": product.sub_category, "rep": product.rep,
            "mrp": product.mrp or 0, "ptr": product.ptr or 0, "landing_cost": product.landing_cost or 0,
            "margin_pct": margin_pct,
        },
        "suppliers": suppliers,
        "stock": {"ho": ho_stock, "stores": store_stocks, "total": ho_stock + sum(s["stock"] for s in store_stocks)},
        "sales_90d": {"total_qty": total_sales_qty, "total_amount": round(total_sales_amt, 2), "by_store": sales_by_store},
        "purchases_90d": {"total_qty": total_purchase_qty, "total_amount": round(total_purchase_amt, 2), "by_store": purchases_by_store},
        "transfers": transfer_list,
    }



# ─── Transaction Comments (generic chat for transfers, POs, recalls) ──

class CommentReq(BaseModel):
    entity_type: str
    entity_id: int
    message: str


@router.post("/comments")
async def add_comment(data: CommentReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    db.add(TransactionComment(
        entity_type=data.entity_type, entity_id=data.entity_id,
        user_name=user.get("full_name", ""), user_role=user.get("role", ""),
        message=data.message,
    ))

    # Notify relevant users about new comment
    from routers.notification_routes import notify_role
    from models import InterStoreTransfer, ProductRecall, PurchaseOrder
    link_map = {"transfer": "/transfers", "recall": "/recalls", "po": "/po-management"}
    link = link_map.get(data.entity_type, "/")
    sender = user.get("full_name", "User")

    # Notify HO for store messages, notify store for HO messages
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER"):
        await notify_role(db, ["ADMIN", "HO_STAFF"], f"New message on {data.entity_type} #{data.entity_id}", f"{sender}: {data.message[:100]}", link=link, entity_type=data.entity_type, entity_id=data.entity_id)
    else:
        # Find store_id from the entity and notify that store
        store_id = None
        if data.entity_type == "transfer":
            t = (await db.execute(select(InterStoreTransfer).where(InterStoreTransfer.id == data.entity_id))).scalar_one_or_none()
            if t: store_id = t.requesting_store_id
        elif data.entity_type == "recall":
            r = (await db.execute(select(ProductRecall).where(ProductRecall.id == data.entity_id))).scalar_one_or_none()
            if r: store_id = r.store_id
        if store_id:
            await notify_role(db, ["STORE_MANAGER", "STORE_STAFF"], f"New message on {data.entity_type} #{data.entity_id}", f"{sender}: {data.message[:100]}", link=link, entity_type=data.entity_type, entity_id=data.entity_id, store_id=store_id)

    await db.commit()
    return {"message": "Comment added"}


@router.get("/comments/{entity_type}/{entity_id}")
async def get_comments(entity_type: str, entity_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    comments = (await db.execute(
        select(TransactionComment).where(TransactionComment.entity_type == entity_type, TransactionComment.entity_id == entity_id)
        .order_by(TransactionComment.created_at)
    )).scalars().all()
    return {"comments": [{
        "id": c.id, "user_name": c.user_name, "user_role": c.user_role, "message": c.message,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    } for c in comments]}
