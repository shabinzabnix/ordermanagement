from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, and_, or_
from database import get_db
from models import (
    Product, Store, User, HOStockBatch, StoreStockBatch,
    InterStoreTransfer, PurchaseRequest, UploadHistory,
    UploadType, TransferStatus, PurchaseStatus,
)
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import pandas as pd
from io import BytesIO
import json

router = APIRouter()

HO_STOCK_COLUMNS = {
    "product id": "product_id",
    "id": "product_id",
    "ho id": "product_id",
    "product name": "product_name",
    "product": "product_name",
    "name": "product_name",
    "item name": "product_name",
    "batch": "batch",
    "batch no": "batch",
    "mrp": "mrp",
    "closing stock": "closing_stock",
    "stock": "closing_stock",
    "qty": "closing_stock",
    "landing cost value": "landing_cost_value",
    "lcost value": "landing_cost_value",
    "cost value": "landing_cost_value",
    "expiry date": "expiry_date",
    "expiry": "expiry_date",
    "exp date": "expiry_date",
    "exp": "expiry_date",
}
HO_STOCK_REQUIRED = ["product_id", "batch", "closing_stock"]

STORE_STOCK_COLUMNS = {
    "ho_id": "ho_product_id",
    "ho id": "ho_product_id",
    "id": "store_product_id",
    "store product id": "store_product_id",
    "product name": "product_name",
    "product": "product_name",
    "name": "product_name",
    "item name": "product_name",
    "packing": "packing",
    "pack": "packing",
    "batch": "batch",
    "batch no": "batch",
    "mrp": "mrp",
    "sales": "sales",
    "sale": "sales",
    "closing stock": "closing_stock",
    "stock": "closing_stock",
    "qty": "closing_stock",
    "quantity": "closing_stock",
    "cost value": "cost_value",
    "value": "cost_value",
    "expiry date": "expiry_date",
    "expiry": "expiry_date",
    "exp date": "expiry_date",
    "exp": "expiry_date",
}
STORE_STOCK_REQUIRED = ["product_name", "batch", "closing_stock"]


def map_columns(df, column_map, required_fields):
    df.columns = [str(col).strip().lower().replace('_', ' ') for col in df.columns]
    mapped = {}
    for col in df.columns:
        if col in column_map:
            mapped[col] = column_map[col]
    mapped_fields = set(mapped.values())
    missing = [f for f in required_fields if f not in mapped_fields]
    if missing:
        return None, missing, {}
    df = df.rename(columns=mapped)
    keep_cols = list(dict.fromkeys([v for v in mapped.values() if v in df.columns]))
    df = df[keep_cols]
    return df, [], {}


# --- HO Stock ---

@router.post("/stock/ho/upload")
async def upload_ho_stock(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()
    file_size = len(content)

    # Large files: background processing
    if file_size > 500000:
        import asyncio
        fname = file.filename; uid = user["user_id"]
        async def bg():
            try:
                from database import async_session_maker
                df = pd.read_excel(BytesIO(content))
                if df.empty: return
                df_mapped, missing, _ = map_columns(df, HO_STOCK_COLUMNS, HO_STOCK_REQUIRED)
                if missing: return
                product_names = {}
                async with async_session_maker() as bg_db:
                    for p in (await bg_db.execute(select(Product))).scalars().all():
                        product_names[p.product_id] = p.product_name
                    await bg_db.execute(delete(HOStockBatch))
                    rows = []
                    for idx, row in df_mapped.iterrows():
                        pid = str(row.get("product_id", "")).strip()
                        if pid.endswith(".0"): pid = pid[:-2]
                        batch = str(row.get("batch", "")).strip()
                        if not pid or not batch: continue
                        pname = str(row.get("product_name", "")).strip() if pd.notna(row.get("product_name")) else ""
                        if not pname or pname == "nan": pname = product_names.get(pid, "")
                        rows.append(HOStockBatch(product_id=pid, product_name=pname, batch=batch,
                            mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                            closing_stock=float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0,
                            landing_cost_value=float(row.get("landing_cost_value", 0)) if pd.notna(row.get("landing_cost_value")) else 0,
                            expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                    BATCH = 100
                    for i in range(0, len(rows), BATCH):
                        bg_db.add_all(rows[i:i+BATCH]); await bg_db.flush()
                    await bg_db.commit()
                    bg_db.add(UploadHistory(file_name=fname, upload_type=UploadType.HO_STOCK, uploaded_by=uid, total_records=len(df_mapped), success_records=len(rows), failed_records=len(df_mapped)-len(rows)))
                    await bg_db.commit()
            except Exception as e:
                import logging; logging.getLogger(__name__).error(f"BG HO upload failed: {e}")
        asyncio.create_task(bg())
        return {"message": f"File received ({file_size//1024}KB). Processing in background. Refresh in 1-2 minutes.", "total": 0, "success": 0, "failed": 0, "errors": [], "background": True}

    try:
        df = pd.read_excel(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel: {str(e)}")
    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    df_mapped, missing, _col_info = map_columns(df, HO_STOCK_COLUMNS, HO_STOCK_REQUIRED)
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}")

    await db.execute(delete(HOStockBatch))

    # Pre-load product names from Product Master for fallback
    product_names = {}
    for p in (await db.execute(select(Product))).scalars().all():
        product_names[p.product_id] = p.product_name

    success, failed, errors = 0, 0, []
    rows_data = []
    for idx, row in df_mapped.iterrows():
        try:
            pid = str(row.get("product_id", "")).strip()
            if pid.endswith(".0"):
                pid = pid[:-2]
            batch = str(row.get("batch", "")).strip()
            if not pid or not batch:
                errors.append(f"Row {idx+2}: Missing product_id or batch")
                failed += 1
                continue
            pname = str(row.get("product_name", "")).strip() if pd.notna(row.get("product_name")) else ""
            if not pname or pname == "nan":
                pname = product_names.get(pid, "")
            rows_data.append({
                "product_id": pid, "product_name": pname, "batch": batch,
                "mrp": float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                "closing_stock": float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0,
                "landing_cost_value": float(row.get("landing_cost_value", 0)) if pd.notna(row.get("landing_cost_value")) else 0,
                "expiry_date": pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None,
            })
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)}")
            failed += 1

    # Bulk insert in batches
    if rows_data:
        BATCH = 100
        for i in range(0, len(rows_data), BATCH):
            db.add_all([HOStockBatch(**r) for r in rows_data[i:i+BATCH]])
            await db.flush()
        await db.commit()
    try:
        db.add(UploadHistory(file_name=file.filename, upload_type=UploadType.HO_STOCK, uploaded_by=user["user_id"],
            total_records=len(df_mapped), success_records=success, failed_records=failed,
            error_details=json.dumps(errors) if errors else None))
        await db.commit()
    except Exception:
        await db.rollback()
    return {"message": "HO stock upload complete", "total": len(df_mapped), "success": success, "failed": failed, "errors": errors[:20]}


@router.get("/stock/ho")
async def get_ho_stock(
    search: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = select(HOStockBatch)
    if search:
        query = query.where(
            (HOStockBatch.product_name.ilike(f"%{search}%")) | (HOStockBatch.product_id.ilike(f"%{search}%"))
        )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    query = query.order_by(HOStockBatch.product_name).offset((page - 1) * limit).limit(limit)
    stocks = (await db.execute(query)).scalars().all()
    return {
        "stocks": [
            {"id": s.id, "product_id": s.product_id, "product_name": s.product_name, "batch": s.batch,
             "mrp": s.mrp or 0, "closing_stock": s.closing_stock or 0, "landing_cost_value": s.landing_cost_value or 0}
            for s in stocks
        ],
        "total": total, "page": page, "limit": limit,
    }


# --- Store Stock ---

@router.post("/stock/store/upload")
async def upload_store_stock(
    store_id: int = Query(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "STORE_STAFF", "STORE_MANAGER")),
):
    # Enforce store for store roles
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        if store_id != user["store_id"]:
            raise HTTPException(403, "You can only upload for your assigned store")
    result = await db.execute(select(Store).where(Store.id == store_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Store not found")
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()
    file_size = len(content)

    # Large files: background processing
    if file_size > 500000:
        import asyncio
        fname = file.filename; uid = user["user_id"]
        async def bg():
            try:
                from database import async_session_maker
                df = pd.read_excel(BytesIO(content))
                if df.empty: return
                df_mapped, missing, _ = map_columns(df, STORE_STOCK_COLUMNS, STORE_STOCK_REQUIRED)
                if missing: return
                async with async_session_maker() as bg_db:
                    await bg_db.execute(delete(StoreStockBatch).where(StoreStockBatch.store_id == store_id))
                    rows = []
                    for idx, row in df_mapped.iterrows():
                        pname = str(row.get("product_name", "")).strip()
                        batch = str(row.get("batch", "")).strip()
                        if not pname or not batch: continue
                        closing_stock = float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0
                        packing = float(row.get("packing", 1)) if pd.notna(row.get("packing")) and float(row.get("packing", 0)) > 0 else 1
                        ho_pid = str(row.get("ho_product_id", "")).strip() if pd.notna(row.get("ho_product_id")) else None
                        if ho_pid in ("", "nan", "None"): ho_pid = None
                        if ho_pid and ho_pid.endswith(".0"): ho_pid = ho_pid[:-2]
                        store_pid = str(row.get("store_product_id", "")).strip() if pd.notna(row.get("store_product_id")) else None
                        if store_pid and store_pid.endswith(".0"): store_pid = store_pid[:-2]
                        rows.append(StoreStockBatch(store_id=store_id, ho_product_id=ho_pid, store_product_id=store_pid,
                            product_name=pname, packing=packing, batch=batch,
                            mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                            sales=float(row.get("sales", 0)) if pd.notna(row.get("sales")) else 0,
                            closing_stock=closing_stock, closing_stock_strips=closing_stock / packing,
                            cost_value=float(row.get("cost_value", 0)) if pd.notna(row.get("cost_value")) else 0,
                            expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                    BATCH = 100
                    for i in range(0, len(rows), BATCH):
                        bg_db.add_all(rows[i:i+BATCH]); await bg_db.flush()
                    await bg_db.commit()
                    bg_db.add(UploadHistory(file_name=fname, upload_type=UploadType.STORE_STOCK, store_id=store_id, uploaded_by=uid, total_records=len(df_mapped), success_records=len(rows), failed_records=len(df_mapped)-len(rows)))
                    await bg_db.commit()
            except Exception as e:
                import logging; logging.getLogger(__name__).error(f"BG Store upload failed: {e}")
        asyncio.create_task(bg())
        return {"message": f"File received ({file_size//1024}KB). Processing in background. Refresh in 1-2 minutes.", "total": 0, "success": 0, "failed": 0, "errors": [], "background": True}

    try:
        df = pd.read_excel(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel: {str(e)}")
    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    df_mapped, missing, _col_info = map_columns(df, STORE_STOCK_COLUMNS, STORE_STOCK_REQUIRED)
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}")

    await db.execute(delete(StoreStockBatch).where(StoreStockBatch.store_id == store_id))

    success, failed, errors = 0, 0, []
    rows_data = []
    for idx, row in df_mapped.iterrows():
        try:
            pname = str(row.get("product_name", "")).strip()
            batch = str(row.get("batch", "")).strip()
            if not pname or not batch:
                errors.append(f"Row {idx+2}: Missing product_name or batch")
                failed += 1
                continue
            closing_stock = float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0
            packing = float(row.get("packing", 1)) if pd.notna(row.get("packing")) and float(row.get("packing", 0)) > 0 else 1
            closing_stock_strips = closing_stock / packing
            ho_pid = str(row.get("ho_product_id", "")).strip() if pd.notna(row.get("ho_product_id")) else None
            if ho_pid in ("", "nan", "None"): ho_pid = None
            if ho_pid and ho_pid.endswith(".0"): ho_pid = ho_pid[:-2]
            store_pid = str(row.get("store_product_id", "")).strip() if pd.notna(row.get("store_product_id")) else None
            if store_pid and store_pid.endswith(".0"): store_pid = store_pid[:-2]
            rows_data.append(StoreStockBatch(
                store_id=store_id, ho_product_id=ho_pid, store_product_id=store_pid,
                product_name=pname, packing=packing, batch=batch,
                mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                sales=float(row.get("sales", 0)) if pd.notna(row.get("sales")) else 0,
                closing_stock=closing_stock, closing_stock_strips=closing_stock_strips,
                cost_value=float(row.get("cost_value", 0)) if pd.notna(row.get("cost_value")) else 0,
                expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None,
            ))
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)}")
            failed += 1

    # Bulk insert in batches
    if rows_data:
        BATCH = 100
        for i in range(0, len(rows_data), BATCH):
            db.add_all(rows_data[i:i+BATCH])
            await db.flush()
        await db.commit()
    try:
        db.add(UploadHistory(file_name=file.filename, upload_type=UploadType.STORE_STOCK, store_id=store_id, uploaded_by=user["user_id"],
            total_records=len(df_mapped), success_records=success, failed_records=failed,
            error_details=json.dumps(errors) if errors else None))
        await db.commit()
    except Exception:
        await db.rollback()
    return {"message": "Store stock upload complete", "total": len(df_mapped), "success": success, "failed": failed, "errors": errors[:20]}


@router.get("/stock/store/{store_id}")
async def get_store_stock(
    store_id: int,
    search: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Enforce store for store roles
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        if store_id != user["store_id"]:
            raise HTTPException(403, "You can only view your assigned store's stock")
    query = select(StoreStockBatch).where(StoreStockBatch.store_id == store_id)
    if search:
        query = query.where(
            (StoreStockBatch.product_name.ilike(f"%{search}%")) | (StoreStockBatch.ho_product_id.ilike(f"%{search}%"))
        )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    query = query.order_by(StoreStockBatch.product_name).offset((page - 1) * limit).limit(limit)
    stocks = (await db.execute(query)).scalars().all()
    return {
        "stocks": [
            {"id": s.id, "ho_product_id": s.ho_product_id, "store_product_id": s.store_product_id,
             "product_name": s.product_name, "packing": s.packing, "batch": s.batch,
             "mrp": s.mrp or 0, "sales": s.sales or 0, "closing_stock": s.closing_stock or 0,
             "closing_stock_strips": s.closing_stock_strips or 0, "cost_value": s.cost_value or 0}
            for s in stocks
        ],
        "total": total, "page": page, "limit": limit,
    }


# --- Consolidated Stock ---

@router.get("/stock/consolidated")
async def get_consolidated_stock(
    search: str = Query(None),
    category: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    stores = (await db.execute(select(Store).where(Store.is_active == True).order_by(Store.store_name))).scalars().all()

    # Get registered products from Product Master
    product_query = select(Product)
    if search:
        product_query = product_query.where(
            (Product.product_name.ilike(f"%{search}%")) | (Product.product_id.ilike(f"%{search}%"))
        )
    if category:
        product_query = product_query.where(Product.category == category)

    product_count = (await db.execute(select(func.count()).select_from(product_query.subquery()))).scalar()
    products = (await db.execute(
        product_query.order_by(Product.product_name).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    pids = [p.product_id for p in products]

    ho_result = await db.execute(
        select(HOStockBatch.product_id, func.sum(HOStockBatch.closing_stock).label("t"))
        .where(HOStockBatch.product_id.in_(pids)).group_by(HOStockBatch.product_id)
    )
    ho_stock = {r[0]: float(r[1] or 0) for r in ho_result.all()}

    store_result = await db.execute(
        select(StoreStockBatch.ho_product_id, StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("t"))
        .where(and_(StoreStockBatch.ho_product_id.in_(pids), StoreStockBatch.ho_product_id.isnot(None)))
        .group_by(StoreStockBatch.ho_product_id, StoreStockBatch.store_id)
    )
    store_stock = {}
    for r in store_result.all():
        store_stock.setdefault(r[0], {})[r[1]] = float(r[2] or 0)

    consolidated = []
    for p in products:
        ho = ho_stock.get(p.product_id, 0)
        sd = {}
        total_stock = ho
        for s in stores:
            qty = store_stock.get(p.product_id, {}).get(s.id, 0)
            sd[str(s.id)] = qty
            total_stock += qty
        consolidated.append({
            "product_id": p.product_id, "product_name": p.product_name,
            "category": p.category, "ho_stock": ho, "store_stock": sd, "total": total_stock, "is_local": False,
        })

    # Also include non-registered local store products (no ho_product_id or not in product master)
    local_q = (
        select(StoreStockBatch.product_name, StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("t"))
        .where(or_(StoreStockBatch.ho_product_id.is_(None), ~StoreStockBatch.ho_product_id.in_(pids) if pids else StoreStockBatch.ho_product_id.is_(None)))
        .where(StoreStockBatch.closing_stock_strips > 0)
        .group_by(StoreStockBatch.product_name, StoreStockBatch.store_id)
    )
    if search:
        local_q = local_q.where(StoreStockBatch.product_name.ilike(f"%{search}%"))

    local_rows = (await db.execute(local_q)).all()
    local_products = {}
    for r in local_rows:
        pname = r[0]
        if pname not in local_products:
            local_products[pname] = {"product_id": "LOCAL", "product_name": pname, "category": "Local Purchase", "ho_stock": 0, "store_stock": {}, "total": 0, "is_local": True}
        local_products[pname]["store_stock"][str(r[1])] = float(r[2] or 0)
        local_products[pname]["total"] += float(r[2] or 0)

    local_list = sorted(local_products.values(), key=lambda x: x["product_name"])
    total_with_local = product_count + len(local_products)

    # Merge: if on first page and there's room, append local products
    if page == 1 and len(consolidated) < limit:
        remaining = limit - len(consolidated)
        consolidated.extend(local_list[:remaining])
    elif (page - 1) * limit >= product_count:
        local_offset = (page - 1) * limit - product_count
        consolidated = local_list[local_offset:local_offset + limit]

    return {
        "consolidated": consolidated,
        "stores": [{"id": s.id, "store_name": s.store_name, "store_code": s.store_code} for s in stores],
        "total": total_with_local, "page": page, "limit": limit,
    }


# --- Transfers ---

class TransferCreate(BaseModel):
    requesting_store_id: int
    source_store_id: int
    product_id: str
    product_name: str
    batch: str = ""
    quantity: float


class TransferAction(BaseModel):
    rejection_reason: str = ""


@router.post("/transfers")
async def create_transfer(
    data: TransferCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Validate: source != requesting
    if data.requesting_store_id == data.source_store_id:
        raise HTTPException(400, "Source and requesting store cannot be the same")

    # Validate stock at source store
    stock_query = select(func.sum(StoreStockBatch.closing_stock_strips)).where(
        and_(
            StoreStockBatch.store_id == data.source_store_id,
            StoreStockBatch.ho_product_id == data.product_id,
        )
    )
    if data.batch:
        stock_query = stock_query.where(StoreStockBatch.batch == data.batch)
    available = (await db.execute(stock_query)).scalar() or 0

    # Also check HO stock if source is conceptually HO (store_id 0 isn't used, but check anyway)
    if available <= 0:
        ho_q = select(func.sum(HOStockBatch.closing_stock)).where(HOStockBatch.product_id == data.product_id)
        if data.batch:
            ho_q = ho_q.where(HOStockBatch.batch == data.batch)
        ho_available = (await db.execute(ho_q)).scalar() or 0
        if ho_available <= 0:
            raise HTTPException(400, f"No stock available for this product at the source. Available: 0 units")
        available = ho_available

    if data.quantity > available:
        raise HTTPException(400, f"Requested quantity ({data.quantity}) exceeds available stock ({available:.1f} units) at source store")

    transfer = InterStoreTransfer(
        requesting_store_id=data.requesting_store_id, source_store_id=data.source_store_id,
        product_id=data.product_id, product_name=data.product_name,
        batch=data.batch, quantity=data.quantity,
        status=TransferStatus.PENDING, requested_by=user["user_id"],
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

    # Notify HO + source store about new transfer request
    from routers.notification_routes import notify_role
    stores_map = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.is_active == True))).scalars().all()}
    await notify_role(db, ["ADMIN", "HO_STAFF"], f"New Transfer Request", f"{data.product_name} x{data.quantity} from {stores_map.get(data.source_store_id, '')} to {stores_map.get(data.requesting_store_id, '')}", link="/transfers", entity_type="transfer", entity_id=transfer.id)
    await notify_role(db, ["STORE_MANAGER", "STORE_STAFF"], f"New Transfer Request", f"{data.product_name} x{data.quantity} requested from your store", link="/transfers", entity_type="transfer", entity_id=transfer.id, store_id=data.source_store_id)
    await db.commit()

    return {"id": transfer.id, "status": "pending", "message": "Transfer request created", "available_stock": available}


@router.get("/transfers")
async def get_transfers(
    status: str = Query(None),
    store_id: int = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = select(InterStoreTransfer)
    if status:
        query = query.where(InterStoreTransfer.status == TransferStatus(status))
    # Role-based filtering: store_staff sees only their store
    effective_store = store_id
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        effective_store = user["store_id"]
    if effective_store:
        query = query.where(
            (InterStoreTransfer.requesting_store_id == effective_store) | (InterStoreTransfer.source_store_id == effective_store)
        )
    query = query.order_by(InterStoreTransfer.created_at.desc()).offset((page - 1) * limit).limit(limit)
    transfers = (await db.execute(query)).scalars().all()

    sids = set()
    for t in transfers:
        sids.add(t.requesting_store_id)
        sids.add(t.source_store_id)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    # User names
    uids = set()
    for t in transfers:
        if t.requested_by: uids.add(t.requested_by)
        if t.approved_by: uids.add(t.approved_by)
    umap = {}
    if uids:
        umap = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()}

    return {
        "transfers": [
            {"id": t.id, "requesting_store_id": t.requesting_store_id,
             "requesting_store_name": smap.get(t.requesting_store_id, ""),
             "source_store_id": t.source_store_id, "source_store_name": smap.get(t.source_store_id, ""),
             "product_id": t.product_id, "product_name": t.product_name,
             "batch": t.batch, "quantity": t.quantity,
             "status": t.status.value if isinstance(t.status, TransferStatus) else t.status,
             "rejection_reason": t.rejection_reason,
             "requested_by": umap.get(t.requested_by, ""),
             "approved_by": umap.get(t.approved_by, "") if t.approved_by else None,
             "created_at": t.created_at.isoformat() if t.created_at else None}
            for t in transfers
        ]
    }


@router.put("/transfers/{transfer_id}/approve")
async def approve_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "STORE_STAFF", "STORE_MANAGER")),
):
    transfer = (await db.execute(select(InterStoreTransfer).where(InterStoreTransfer.id == transfer_id))).scalar_one_or_none()
    if not transfer:
        raise HTTPException(404, "Transfer not found")
    if transfer.status != TransferStatus.PENDING:
        raise HTTPException(400, "Transfer is not pending")
    transfer.status = TransferStatus.APPROVED
    transfer.approved_by = user["user_id"]
    transfer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Transfer approved"}


@router.put("/transfers/{transfer_id}/reject")
async def reject_transfer(
    transfer_id: int,
    data: TransferAction,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "STORE_STAFF", "STORE_MANAGER")),
):
    transfer = (await db.execute(select(InterStoreTransfer).where(InterStoreTransfer.id == transfer_id))).scalar_one_or_none()
    if not transfer:
        raise HTTPException(404, "Transfer not found")
    if transfer.status != TransferStatus.PENDING:
        raise HTTPException(400, "Transfer is not pending")
    transfer.status = TransferStatus.REJECTED
    transfer.rejection_reason = data.rejection_reason
    transfer.approved_by = user["user_id"]
    transfer.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Transfer rejected"}


# --- Purchase Requests ---

class PurchaseCreate(BaseModel):
    store_id: int
    product_id: Optional[str] = None
    product_name: str
    brand_name: Optional[str] = None
    quantity: float
    customer_name: str
    customer_contact: str
    is_registered_product: bool = True
    purchase_reason: str = "customer_enquiry"


@router.post("/purchases")
async def create_purchase_request(
    data: PurchaseCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    network_info = None
    if data.is_registered_product and data.product_id:
        ho_total = (await db.execute(
            select(func.sum(HOStockBatch.closing_stock)).where(HOStockBatch.product_id == data.product_id)
        )).scalar() or 0

        store_q = (await db.execute(
            select(StoreStockBatch.store_id, func.sum(StoreStockBatch.closing_stock_strips).label("t"))
            .where(StoreStockBatch.ho_product_id == data.product_id)
            .group_by(StoreStockBatch.store_id)
        )).all()
        store_stocks = {r[0]: float(r[1] or 0) for r in store_q}  # Access by index and convert to float

        store_names = {}
        if store_stocks:
            store_names = {s.id: s.store_name for s in
                          (await db.execute(select(Store).where(Store.id.in_(store_stocks.keys())))).scalars().all()}

        network_info = json.dumps({
            "ho_stock": ho_total,
            "store_stock": {store_names.get(sid, f"Store {sid}"): qty for sid, qty in store_stocks.items()},
            "total_network": ho_total + sum(store_stocks.values()),
        })

    status = PurchaseStatus.PENDING
    if network_info:
        info = json.loads(network_info)
        if info.get("total_network", 0) > 0:
            status = PurchaseStatus.TRANSFER_SUGGESTED

    purchase = PurchaseRequest(
        store_id=data.store_id, product_id=data.product_id, product_name=data.product_name,
        brand_name=data.brand_name, quantity=data.quantity,
        customer_name=data.customer_name, customer_contact=data.customer_contact,
        is_registered_product=data.is_registered_product, purchase_reason=data.purchase_reason,
        status=status, network_stock_info=network_info, requested_by=user["user_id"],
    )
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase)
    return {
        "id": purchase.id, "status": status.value,
        "network_stock_info": json.loads(network_info) if network_info else None,
        "message": "Transfer suggested - stock available in network" if status == PurchaseStatus.TRANSFER_SUGGESTED else "Purchase request created",
    }


@router.get("/purchases")
async def get_purchase_requests(
    status: str = Query(None),
    store_id: int = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = select(PurchaseRequest)
    if status:
        query = query.where(PurchaseRequest.status == PurchaseStatus(status))
    # Role-based filtering: store_staff sees only their store
    effective_store = store_id
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        effective_store = user["store_id"]
    if effective_store:
        query = query.where(PurchaseRequest.store_id == effective_store)
    query = query.order_by(PurchaseRequest.created_at.desc()).offset((page - 1) * limit).limit(limit)
    purchases = (await db.execute(query)).scalars().all()

    sids = set(p.store_id for p in purchases)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    return {
        "purchases": [
            {"id": p.id, "store_id": p.store_id, "store_name": smap.get(p.store_id, ""),
             "product_id": p.product_id, "product_name": p.product_name,
             "brand_name": p.brand_name, "quantity": p.quantity,
             "customer_name": p.customer_name, "customer_contact": p.customer_contact,
             "is_registered_product": p.is_registered_product,
             "purchase_reason": p.purchase_reason or "customer_enquiry",
             "status": p.status.value if isinstance(p.status, PurchaseStatus) else p.status,
             "crm_status": p.crm_status or "pending",
             "crm_remarks": p.crm_remarks,
             "ho_status": p.ho_status or "pending",
             "assigned_supplier": p.assigned_supplier,
             "ho_remarks": p.ho_remarks,
             "tat_days": p.tat_days,
             "expected_delivery": p.expected_delivery.isoformat() if p.expected_delivery else None,
             "fulfillment_status": p.fulfillment_status or "not_started",
             "network_stock_info": json.loads(p.network_stock_info) if p.network_stock_info else None,
             "created_at": p.created_at.isoformat() if p.created_at else None}
            for p in purchases
        ]
    }


@router.put("/purchases/{purchase_id}/crm-verify")
async def crm_verify_purchase(
    purchase_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    """CRM team verifies customer enquiry before forwarding to HO."""
    purchase = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == purchase_id))).scalar_one_or_none()
    if not purchase:
        raise HTTPException(404, "Purchase request not found")
    purchase.crm_status = "verified"
    purchase.crm_verified_by = user["user_id"]
    purchase.crm_verified_at = datetime.now(timezone.utc)
    purchase.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Purchase verified by CRM"}


@router.put("/purchases/{purchase_id}/crm-reject")
async def crm_reject_purchase(
    purchase_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    purchase = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == purchase_id))).scalar_one_or_none()
    if not purchase:
        raise HTTPException(404, "Purchase request not found")
    purchase.crm_status = "rejected"
    purchase.crm_verified_by = user["user_id"]
    purchase.crm_verified_at = datetime.now(timezone.utc)
    purchase.status = PurchaseStatus.REJECTED
    purchase.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Purchase rejected by CRM"}


class CRMRemarkReq(BaseModel):
    remarks: str


@router.put("/purchases/{purchase_id}/crm-remarks")
async def add_crm_remarks(
    purchase_id: int, data: CRMRemarkReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "CRM_STAFF")),
):
    purchase = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == purchase_id))).scalar_one_or_none()
    if not purchase:
        raise HTTPException(404, "Purchase request not found")
    purchase.crm_remarks = data.remarks
    purchase.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "CRM remarks updated"}


class HOApproveReq(BaseModel):
    supplier: str
    tat_days: int = 0
    ho_remarks: str = ""


@router.put("/purchases/{purchase_id}/ho-approve")
async def ho_approve_purchase(
    purchase_id: int, data: HOApproveReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """HO approves with supplier assignment and TAT."""
    purchase = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == purchase_id))).scalar_one_or_none()
    if not purchase:
        raise HTTPException(404, "Purchase request not found")
    purchase.ho_status = "approved"
    purchase.assigned_supplier = data.supplier
    purchase.tat_days = data.tat_days
    purchase.ho_remarks = data.ho_remarks
    purchase.ho_approved_by = user["user_id"]
    purchase.ho_approved_at = datetime.now(timezone.utc)
    purchase.expected_delivery = datetime.now(timezone.utc) + timedelta(days=data.tat_days) if data.tat_days > 0 else None
    purchase.status = PurchaseStatus.APPROVED
    purchase.fulfillment_status = "ordered"
    purchase.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Purchase approved by HO", "expected_delivery": purchase.expected_delivery.isoformat() if purchase.expected_delivery else None}


class FulfillmentReq(BaseModel):
    fulfillment_status: str
    ho_remarks: str = ""


@router.put("/purchases/{purchase_id}/fulfillment")
async def update_fulfillment(
    purchase_id: int, data: FulfillmentReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF", "DIRECTOR")),
):
    """Update fulfillment status: ordered → dispatched → delivered."""
    purchase = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == purchase_id))).scalar_one_or_none()
    if not purchase:
        raise HTTPException(404, "Purchase request not found")
    purchase.fulfillment_status = data.fulfillment_status
    if data.ho_remarks:
        purchase.ho_remarks = data.ho_remarks
    purchase.fulfillment_updated_at = datetime.now(timezone.utc)
    purchase.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": f"Fulfillment updated to {data.fulfillment_status}"}


# --- Stock Availability ---

@router.get("/stock/availability/{product_id}")
async def get_product_availability(
    product_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    ho_batches = (await db.execute(
        select(HOStockBatch.batch, HOStockBatch.closing_stock, HOStockBatch.mrp)
        .where(HOStockBatch.product_id == product_id)
    )).all()
    store_batches = (await db.execute(
        select(StoreStockBatch.store_id, StoreStockBatch.batch, StoreStockBatch.closing_stock_strips, StoreStockBatch.mrp)
        .where(StoreStockBatch.ho_product_id == product_id)
    )).all()
    sids = set(b.store_id for b in store_batches)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    availability = []
    for b in ho_batches:
        if b.closing_stock > 0:
            availability.append({"location": "Head Office", "batch": b.batch, "stock": b.closing_stock, "mrp": b.mrp})
    for b in store_batches:
        if b.closing_stock_strips > 0:
            availability.append({"location": smap.get(b.store_id, f"Store {b.store_id}"),
                                 "store_id": b.store_id, "batch": b.batch, "stock": b.closing_stock_strips, "mrp": b.mrp})
    return {"availability": availability}


# --- Dashboard Stats ---

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    from cache import get_cached, set_cached
    is_store_staff = user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id")
    user_store_id = user.get("store_id") if is_store_staff else None
    cache_key = f"dashboard_stats_{user_store_id or 'all'}"
    cached = get_cached(cache_key, ttl=60)
    if cached: return cached

    total_products = (await db.execute(select(func.count(Product.id)))).scalar() or 0

    if user_store_id:
        total_stores = 1
        ho_stock_value = 0
        ho_stock_units = 0
        # Store-specific stock value
        store_stock_value = float((await db.execute(select(func.sum(StoreStockBatch.cost_value)).where(StoreStockBatch.store_id == user_store_id))).scalar() or 0)
        store_stock_units = float((await db.execute(select(func.sum(StoreStockBatch.closing_stock_strips)).where(StoreStockBatch.store_id == user_store_id))).scalar() or 0)
    else:
        total_stores = (await db.execute(select(func.count(Store.id)).where(Store.is_active == True))).scalar() or 0
        ho_stock_value = (await db.execute(select(func.sum(HOStockBatch.landing_cost_value)))).scalar() or 0
        ho_stock_units = (await db.execute(select(func.sum(HOStockBatch.closing_stock)))).scalar() or 0
        store_stock_value = ho_stock_value
        store_stock_units = ho_stock_units

    transfer_q = select(func.count(InterStoreTransfer.id)).where(InterStoreTransfer.status == TransferStatus.PENDING)
    purchase_q = select(func.count(PurchaseRequest.id)).where(
        PurchaseRequest.status.in_([PurchaseStatus.PENDING, PurchaseStatus.TRANSFER_SUGGESTED])
    )
    if user_store_id:
        transfer_q = transfer_q.where(
            (InterStoreTransfer.requesting_store_id == user_store_id) | (InterStoreTransfer.source_store_id == user_store_id)
        )
        purchase_q = purchase_q.where(PurchaseRequest.store_id == user_store_id)

    pending_transfers = (await db.execute(transfer_q)).scalar() or 0
    pending_purchases = (await db.execute(purchase_q)).scalar() or 0

    recent_uploads_q = select(UploadHistory).order_by(UploadHistory.created_at.desc()).limit(5)
    recent_transfers_q = select(InterStoreTransfer).order_by(InterStoreTransfer.created_at.desc()).limit(5)
    if user_store_id:
        recent_uploads_q = recent_uploads_q.where(or_(UploadHistory.store_id == user_store_id, UploadHistory.store_id.is_(None)))
        recent_transfers_q = recent_transfers_q.where((InterStoreTransfer.requesting_store_id == user_store_id) | (InterStoreTransfer.source_store_id == user_store_id))
    recent_uploads = (await db.execute(recent_uploads_q)).scalars().all()
    recent_transfers = (await db.execute(recent_transfers_q)).scalars().all()

    sids = set()
    for t in recent_transfers:
        sids.add(t.requesting_store_id)
        sids.add(t.source_store_id)
    smap = {}
    if sids:
        smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()}

    result = {
        "total_products": total_products,
        "total_stores": total_stores,
        "ho_stock_value": round(store_stock_value if user_store_id else ho_stock_value, 2),
        "ho_stock_units": store_stock_units if user_store_id else ho_stock_units,
        "pending_transfers": pending_transfers,
        "pending_purchases": pending_purchases,
        "recent_uploads": [
            {"id": u.id, "file_name": u.file_name,
             "upload_type": u.upload_type.value if isinstance(u.upload_type, UploadType) else u.upload_type,
             "total_records": u.total_records, "success_records": u.success_records,
             "created_at": u.created_at.isoformat() if u.created_at else None}
            for u in recent_uploads
        ],
        "recent_transfers": [
            {"id": t.id, "requesting_store": smap.get(t.requesting_store_id, ""),
             "source_store": smap.get(t.source_store_id, ""),
             "product_name": t.product_name, "quantity": t.quantity,
             "status": t.status.value if isinstance(t.status, TransferStatus) else t.status,
             "created_at": t.created_at.isoformat() if t.created_at else None}
            for t in recent_transfers
        ],
    }
    return set_cached(cache_key, result, ttl=60)
