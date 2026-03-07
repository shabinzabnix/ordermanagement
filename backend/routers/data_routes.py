from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from models import Product, Store, User, UserRole, UploadHistory, UploadType
from auth import get_current_user, require_roles, hash_password
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
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
                "landing_cost": p.landing_cost or 0,
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

    for idx, row in df_mapped.iterrows():
        try:
            product_id = str(row.get("product_id", "")).strip()
            if product_id.endswith(".0"):
                product_id = product_id[:-2]
            if not product_id:
                errors.append(f"Row {idx+2}: Missing product_id")
                failed += 1
                continue

            result = await db.execute(select(Product).where(Product.product_id == product_id))
            existing = result.scalar_one_or_none()

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

            if existing:
                for key, value in data.items():
                    setattr(existing, key, value)
                existing.updated_at = datetime.now(timezone.utc)
            else:
                db.add(Product(**data))

            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)}")
            failed += 1

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
    result = await db.execute(select(Store).where(Store.is_active == True).order_by(Store.store_name))
    stores = result.scalars().all()
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


@router.get("/users")
async def get_users(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    result = await db.execute(select(User).order_by(User.full_name))
    users = result.scalars().all()
    return {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "full_name": u.full_name,
                "role": u.role.value if isinstance(u.role, UserRole) else u.role,
                "store_id": u.store_id,
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
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Email already exists")
    new_user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role=UserRole(data.role.upper()),
        store_id=data.store_id,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {"id": new_user.id, "email": new_user.email, "full_name": new_user.full_name, "role": new_user.role.value}


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
    return {
        "uploads": [
            {
                "id": u.id,
                "file_name": u.file_name,
                "upload_type": u.upload_type.value if isinstance(u.upload_type, UploadType) else u.upload_type,
                "store_id": u.store_id,
                "uploaded_by": u.uploaded_by,
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
