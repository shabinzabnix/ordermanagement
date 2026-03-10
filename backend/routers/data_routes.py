from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from database import get_db, async_session_maker
from models import Product, Store, User, UserRole, UploadHistory, UploadType, SalesRecord, TransactionComment, HOStockBatch, StoreStockBatch
from auth import get_current_user, require_roles, hash_password
from routers.operations_routes import HO_STOCK_COLUMNS, HO_STOCK_REQUIRED, STORE_STOCK_COLUMNS, STORE_STOCK_REQUIRED, map_columns
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from pathlib import Path
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



class ChunkReq(BaseModel):
    upload_id: str
    filename: str
    chunk_index: int
    total_chunks: int
    chunk_data: str
    upload_type: Optional[str] = "products"
    store_id: Optional[int] = None


_chunk_meta = {}  # upload_id -> metadata (no file data in memory)
UPLOAD_TMP = Path(__file__).parent.parent / "upload_tmp"
UPLOAD_TMP.mkdir(exist_ok=True)


@router.post("/upload-chunk")
async def receive_chunk(data: ChunkReq, user: dict = Depends(get_current_user)):
    """Receives file chunks, writes to temp file, processes when complete."""
    import base64, asyncio

    key = data.upload_id
    chunk_bytes = base64.b64decode(data.chunk_data)
    tmp_path = UPLOAD_TMP / f"{key}.tmp"
    meta_path = UPLOAD_TMP / f"{key}.meta"

    if key not in _chunk_meta:
        meta = {"received": set(), "filename": data.filename, "total": data.total_chunks,
                "upload_type": data.upload_type, "store_id": data.store_id, "user_id": user["user_id"]}
        _chunk_meta[key] = meta
        tmp_path.write_bytes(b"")
    else:
        meta = _chunk_meta[key]

    # Write chunk at correct offset
    with open(tmp_path, "r+b" if tmp_path.exists() else "wb") as f:
        f.seek(data.chunk_index * 600000)
        f.write(chunk_bytes)
    meta["received"].add(data.chunk_index)

    # Also persist meta to disk in case of restart
    import json as jlib
    meta_path.write_text(jlib.dumps({"filename": meta["filename"], "total": meta["total"],
        "upload_type": meta["upload_type"], "store_id": meta["store_id"], "user_id": meta["user_id"],
        "received": list(meta["received"])}))

    if len(meta["received"]) >= data.total_chunks:
        _chunk_meta.pop(key, None)
        file_path = str(tmp_path)

        async def bg():
            try:
                from database import async_session_maker
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                import logging; log = logging.getLogger(__name__)

                content = Path(file_path).read_bytes()
                Path(file_path).unlink(missing_ok=True)  # Clean up temp file
                Path(file_path.replace('.tmp', '.meta')).unlink(missing_ok=True)
                log.info(f"Processing chunked: {meta['filename']}, {len(content)} bytes, type={meta['upload_type']}")

                df = pd.read_excel(BytesIO(content))
                if df.empty:
                    del content
                    return
                async with async_session_maker() as bg_db:
                    if meta["upload_type"] == "products":
                        df_mapped, missing, _ = map_columns(df, PRODUCT_COLUMNS, PRODUCT_REQUIRED)
                        if missing: log.error(f"Missing: {missing}"); return
                        rows_data = []
                        for _, row in df_mapped.iterrows():
                            pid = str(row.get("product_id", "")).strip()
                            if pid.endswith(".0"): pid = pid[:-2]
                            if not pid: continue
                            rows_data.append({"product_id": pid, "product_name": str(row.get("product_name", "")).strip(),
                                "primary_supplier": str(row.get("primary_supplier", "")).strip() if pd.notna(row.get("primary_supplier")) else None,
                                "secondary_supplier": str(row.get("secondary_supplier", "")).strip() if pd.notna(row.get("secondary_supplier")) else None,
                                "least_price_supplier": str(row.get("least_price_supplier", "")).strip() if pd.notna(row.get("least_price_supplier")) else None,
                                "most_qty_supplier": str(row.get("most_qty_supplier", "")).strip() if pd.notna(row.get("most_qty_supplier")) else None,
                                "category": str(row.get("category", "")).strip() if pd.notna(row.get("category")) else None,
                                "sub_category": str(row.get("sub_category", "")).strip() if pd.notna(row.get("sub_category")) else None,
                                "rep": str(row.get("rep", "")).strip() if pd.notna(row.get("rep")) else None,
                                "mrp": float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                                "ptr": float(row.get("ptr", 0)) if pd.notna(row.get("ptr")) else 0,
                                "landing_cost": float(row.get("landing_cost", 0)) if pd.notna(row.get("landing_cost")) else 0})
                        for i in range(0, len(rows_data), 100):
                            stmt = pg_insert(Product).values(rows_data[i:i+100])
                            stmt = stmt.on_conflict_do_update(index_elements=['product_id'], set_={k: stmt.excluded[k] for k in ['product_name','primary_supplier','secondary_supplier','least_price_supplier','most_qty_supplier','category','sub_category','rep','mrp','ptr','landing_cost']})
                            await bg_db.execute(stmt); await bg_db.flush()
                        bg_db.add(UploadHistory(file_name=meta["filename"], upload_type=UploadType.PRODUCT_MASTER, uploaded_by=meta["user_id"], total_records=len(df), success_records=len(rows_data), failed_records=len(df)-len(rows_data)))

                    elif meta["upload_type"] == "ho_stock":
                        df_mapped, missing, _ = map_columns(df, HO_STOCK_COLUMNS, HO_STOCK_REQUIRED)
                        if missing: return
                        pnames = {p.product_id: p.product_name for p in (await bg_db.execute(select(Product))).scalars().all()}
                        await bg_db.execute(delete(HOStockBatch))
                        rows = []
                        for _, row in df_mapped.iterrows():
                            pid = str(row.get("product_id", "")).strip()
                            if pid.endswith(".0"): pid = pid[:-2]
                            batch = str(row.get("batch", "")).strip()
                            if not pid or not batch: continue
                            pn = str(row.get("product_name", "")).strip() if pd.notna(row.get("product_name")) else pnames.get(pid, "")
                            rows.append(HOStockBatch(product_id=pid, product_name=pn, batch=batch, mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                                closing_stock=float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0,
                                landing_cost_value=float(row.get("landing_cost_value", 0)) if pd.notna(row.get("landing_cost_value")) else 0,
                                expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                        for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                        bg_db.add(UploadHistory(file_name=meta["filename"], upload_type=UploadType.HO_STOCK, uploaded_by=meta["user_id"], total_records=len(df), success_records=len(rows), failed_records=len(df)-len(rows)))

                    elif meta["upload_type"] == "store_stock" and meta.get("store_id"):
                        sid = meta["store_id"]
                        df_mapped, missing, _ = map_columns(df, STORE_STOCK_COLUMNS, STORE_STOCK_REQUIRED)
                        if missing: return
                        await bg_db.execute(delete(StoreStockBatch).where(StoreStockBatch.store_id == sid))
                        rows = []
                        for _, row in df_mapped.iterrows():
                            pname = str(row.get("product_name", "")).strip(); batch = str(row.get("batch", "")).strip()
                            if not pname or not batch: continue
                            cs = float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0
                            pk = float(row.get("packing", 1)) if pd.notna(row.get("packing")) and float(row.get("packing", 0)) > 0 else 1
                            hpid = str(row.get("ho_product_id", "")).strip() if pd.notna(row.get("ho_product_id")) else None
                            if hpid in ("", "nan", "None"): hpid = None
                            if hpid and hpid.endswith(".0"): hpid = hpid[:-2]
                            rows.append(StoreStockBatch(store_id=sid, ho_product_id=hpid, product_name=pname, packing=pk, batch=batch,
                                mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0, sales=float(row.get("sales", 0)) if pd.notna(row.get("sales")) else 0,
                                closing_stock=cs, closing_stock_strips=cs/pk, cost_value=float(row.get("cost_value", 0)) if pd.notna(row.get("cost_value")) else 0,
                                expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                        for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                        bg_db.add(UploadHistory(file_name=meta["filename"], upload_type=UploadType.STORE_STOCK, store_id=sid, uploaded_by=meta["user_id"], total_records=len(df), success_records=len(rows), failed_records=len(df)-len(rows)))

                    elif meta["upload_type"] == "sales" and meta.get("store_id"):
                        sid = meta["store_id"]
                        from models import SalesRecord, CRMCustomer, CustomerType
                        from routers.crm_routes import SALES_COLUMNS

                        # Try multiple header rows (some files have title rows)
                        df_final = None
                        for skip in [0, 1, 2, 3]:
                            try:
                                test_df = pd.read_excel(BytesIO(content), skiprows=skip)
                                cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
                                matched = sum(1 for c in cols_lower if c in SALES_COLUMNS)
                                if matched >= 3 and test_df.shape[0] > 0:
                                    df_final = test_df
                                    break
                            except: continue
                        if df_final is None: df_final = df

                        df_final.columns = [str(c).strip().lower().replace('_', ' ') for c in df_final.columns]
                        mapped = {c: SALES_COLUMNS[c] for c in df_final.columns if c in SALES_COLUMNS}
                        df_final = df_final.rename(columns=mapped)
                        df_final = df_final.loc[:, ~df_final.columns.duplicated()]

                        success, skipped, failed, new_cust = 0, 0, 0, 0
                        existing_mobiles = {}
                        for c in (await bg_db.execute(select(CRMCustomer))).scalars().all():
                            existing_mobiles[c.mobile_number] = c.id
                        existing_entries = set()
                        for r in (await bg_db.execute(select(SalesRecord.entry_number, SalesRecord.product_name).where(SalesRecord.store_id == sid))).all():
                            existing_entries.add((str(r[0]), str(r[1])))

                        new_custs = {}
                        rows = []
                        for _, row in df_final.iterrows():
                            try:
                                pname = str(row.get("patient_name", "") or "").strip()
                                mobile = str(row.get("mobile_number", "") or "").strip().replace(".0", "")
                                product = str(row.get("product_name", "") or "").strip()
                                if not product or product == "nan": failed += 1; continue
                                entry = str(row.get("entry_number", "") or "").strip()
                                if entry.endswith(".0"): entry = entry[:-2]
                                if (entry, product) in existing_entries: skipped += 1; continue

                                inv_date = None
                                raw_date = row.get("invoice_date")
                                if raw_date is not None and str(raw_date) != "nan":
                                    try: inv_date = pd.Timestamp(raw_date).to_pydatetime().replace(tzinfo=timezone.utc)
                                    except: pass

                                cid = existing_mobiles.get(mobile)
                                if not cid and mobile and len(mobile) >= 10:
                                    if mobile not in new_custs: new_custs[mobile] = pname or "Unknown"

                                raw_total = row.get("total_amount")
                                total_amt = float(raw_total) if raw_total is not None and str(raw_total) != "nan" else 0
                                raw_qty = row.get("qty", row.get("quantity"))
                                qty = float(raw_qty) if raw_qty is not None and str(raw_qty) != "nan" else 0

                                rows.append(SalesRecord(store_id=sid, patient_name=pname, mobile_number=mobile,
                                    product_name=product, product_id=str(row.get("product_id", "") or "").strip() or None,
                                    entry_number=entry, invoice_date=inv_date, total_amount=total_amt, quantity=qty))
                                success += 1
                            except Exception:
                                failed += 1

                        # Create new customers
                        for mob, cname in new_custs.items():
                            c = CRMCustomer(mobile_number=mob, customer_name=cname, first_store_id=sid, assigned_store_id=sid, customer_type=CustomerType.WALKIN)
                            bg_db.add(c)
                        if new_custs:
                            await bg_db.flush()
                            for c in (await bg_db.execute(select(CRMCustomer).where(CRMCustomer.mobile_number.in_(new_custs.keys())))).scalars().all():
                                existing_mobiles[c.mobile_number] = c.id
                            new_cust = len(new_custs)

                        # Set customer_id on records
                        for r in rows:
                            if r.mobile_number: r.customer_id = existing_mobiles.get(r.mobile_number)

                        for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                        bg_db.add(UploadHistory(file_name=meta["filename"], upload_type=UploadType.SALES_REPORT, store_id=sid, uploaded_by=meta["user_id"],
                            total_records=len(df_final), success_records=success, failed_records=failed,
                            error_details=f"New customers: {new_cust}, Skipped: {skipped}"))

                    elif meta["upload_type"] == "purchase" and meta.get("store_id"):
                        sid = meta["store_id"]
                        from models import PurchaseRecord

                        # Try multiple header rows
                        df_p = None
                        purchase_cols = {"entry no": "entry_number", "entry number": "entry_number", "invoice no": "entry_number", "bill no": "entry_number",
                            "date": "purchase_date", "purchase date": "purchase_date",
                            "supplier": "supplier_name", "supplier name": "supplier_name", "party name": "supplier_name",
                            "ho id": "product_id", "product id": "product_id", "id": "product_id",
                            "name": "product_name", "product name": "product_name", "product": "product_name", "item name": "product_name",
                            "total": "total_amount", "total amount": "total_amount", "amount": "total_amount",
                            "qty": "quantity", "quantity": "quantity",
                            "batch": "batch", "batch no": "batch",
                            "expiry": "expiry_date", "expiary": "expiry_date", "expiry date": "expiry_date",
                            "mrp": "mrp", "l.cost": "landing_cost", "lcost": "landing_cost", "landing cost": "landing_cost",
                            "category": "category", "sub category": "sub_category"}
                        for skip in [0, 1, 2, 3]:
                            try:
                                test_df = pd.read_excel(BytesIO(content), skiprows=skip)
                                cols_lower = [str(c).strip().lower().replace('_', ' ') for c in test_df.columns]
                                matched = sum(1 for c in cols_lower if c in purchase_cols)
                                if matched >= 3 and test_df.shape[0] > 0:
                                    df_p = test_df; break
                            except: continue
                        if df_p is None: df_p = df

                        df_p.columns = [str(c).strip().lower().replace('_', ' ') for c in df_p.columns]
                        mapped = {c: purchase_cols[c] for c in df_p.columns if c in purchase_cols}
                        df_p = df_p.rename(columns=mapped)
                        # Remove duplicate columns (keep first)
                        df_p = df_p.loc[:, ~df_p.columns.duplicated()]

                        success, skipped, failed = 0, 0, 0
                        existing = set()
                        for r in (await bg_db.execute(select(PurchaseRecord.entry_number, PurchaseRecord.product_name).where(PurchaseRecord.store_id == sid))).all():
                            existing.add((str(r[0]), str(r[1])))

                        rows = []
                        for _, row in df_p.iterrows():
                            try:
                                product = str(row.get("product_name", "") or "").strip()
                                supplier = str(row.get("supplier_name", "") or "").strip()
                                if not product or product == "nan": failed += 1; continue
                                entry = str(row.get("entry_number", "") or "").strip()
                                if entry.endswith(".0"): entry = entry[:-2]
                                if (entry, product) in existing: skipped += 1; continue

                                pdate = None
                                raw_date = row.get("purchase_date")
                                if raw_date is not None and str(raw_date) != "nan":
                                    try: pdate = pd.Timestamp(raw_date).to_pydatetime().replace(tzinfo=timezone.utc)
                                    except: pass

                                pid = str(row.get("product_id", "") or "").strip()
                                if pid.endswith(".0"): pid = pid[:-2]
                                if pid in ("", "nan", "None", "0"): pid = None

                                raw_total = row.get("total_amount")
                                total_amt = float(raw_total) if raw_total is not None and str(raw_total) != "nan" else 0
                                raw_qty = row.get("quantity")
                                qty = float(raw_qty) if raw_qty is not None and str(raw_qty) != "nan" else 0

                                rows.append(PurchaseRecord(store_id=sid, product_name=product, product_id=pid, supplier_name=supplier,
                                    entry_number=entry, purchase_date=pdate, total_amount=total_amt, quantity=qty))
                                success += 1
                            except Exception as ex:
                                failed += 1
                                if failed <= 3: log.error(f"Purchase row fail: {ex}")

                        for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                        log.info(f"Purchase: inserted {len(rows)} rows, committing...")
                        bg_db.add(UploadHistory(file_name=meta["filename"], upload_type=UploadType.PURCHASE_REPORT, store_id=sid, uploaded_by=meta["user_id"],
                            total_records=len(df_p), success_records=success, failed_records=failed,
                            error_details=f"Skipped duplicates: {skipped}"))

                    await bg_db.commit()
                    del content  # Free memory after all processing
                    log.info(f"Chunk upload done: {meta['upload_type']}, {meta['filename']}")
            except Exception as e:
                import traceback
                import logging; logging.getLogger(__name__).error(f"Chunk process failed: {e}\n{traceback.format_exc()}")

        asyncio.create_task(bg())
        return {"message": f"All {data.total_chunks} chunks received. Processing in background.", "background": True, "complete": True}

    return {"message": f"Chunk {data.chunk_index + 1}/{data.total_chunks} received", "complete": False}


class ChunkedUploadReq(BaseModel):
    filename: str
    file_base64: str
    extra_params: Optional[dict] = None
    upload_type: Optional[str] = None
    store_id: Optional[int] = None


@router.post("/upload-chunked")
async def generic_chunked_upload(data: ChunkedUploadReq, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    """Generic chunked upload for ALL types — bypasses proxy body size limits."""
    import base64, asyncio
    content = base64.b64decode(data.file_base64)
    fname = data.filename
    uid = user["user_id"]
    utype = data.upload_type or "products"
    sid = data.store_id

    # Determine which URL to forward to internally
    async def bg():
        try:
            from database import async_session_maker
            from models import HOStockBatch, StoreStockBatch, Product, UploadHistory, UploadType as UT
            df = pd.read_excel(BytesIO(content))
            if df.empty: return
            import logging
            log = logging.getLogger(__name__)
            log.info(f"Chunked upload: type={utype}, rows={len(df)}, store={sid}")

            async with async_session_maker() as bg_db:
                if utype == "ho_stock":
                    df_mapped, missing, _ = map_columns(df, HO_STOCK_COLUMNS, HO_STOCK_REQUIRED)
                    if missing: log.error(f"Missing cols: {missing}"); return
                    from models import Product as Prod
                    pnames = {p.product_id: p.product_name for p in (await bg_db.execute(select(Prod))).scalars().all()}
                    await bg_db.execute(delete(HOStockBatch))
                    rows = []
                    for _, row in df_mapped.iterrows():
                        pid = str(row.get("product_id", "")).strip()
                        if pid.endswith(".0"): pid = pid[:-2]
                        batch = str(row.get("batch", "")).strip()
                        if not pid or not batch: continue
                        pn = str(row.get("product_name", "")).strip() if pd.notna(row.get("product_name")) else ""
                        if not pn or pn == "nan": pn = pnames.get(pid, "")
                        rows.append(HOStockBatch(product_id=pid, product_name=pn, batch=batch,
                            mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0,
                            closing_stock=float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0,
                            landing_cost_value=float(row.get("landing_cost_value", 0)) if pd.notna(row.get("landing_cost_value")) else 0,
                            expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                    for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                    await bg_db.commit()
                    bg_db.add(UploadHistory(file_name=fname, upload_type=UT.HO_STOCK, uploaded_by=uid, total_records=len(df), success_records=len(rows), failed_records=len(df)-len(rows)))

                elif utype == "store_stock" and sid:
                    df_mapped, missing, _ = map_columns(df, STORE_STOCK_COLUMNS, STORE_STOCK_REQUIRED)
                    if missing: log.error(f"Missing cols: {missing}"); return
                    await bg_db.execute(delete(StoreStockBatch).where(StoreStockBatch.store_id == sid))
                    rows = []
                    for _, row in df_mapped.iterrows():
                        pname = str(row.get("product_name", "")).strip()
                        batch = str(row.get("batch", "")).strip()
                        if not pname or not batch: continue
                        cs = float(row.get("closing_stock", 0)) if pd.notna(row.get("closing_stock")) else 0
                        pk = float(row.get("packing", 1)) if pd.notna(row.get("packing")) and float(row.get("packing", 0)) > 0 else 1
                        hpid = str(row.get("ho_product_id", "")).strip() if pd.notna(row.get("ho_product_id")) else None
                        if hpid in ("", "nan", "None"): hpid = None
                        if hpid and hpid.endswith(".0"): hpid = hpid[:-2]
                        spid = str(row.get("store_product_id", "")).strip() if pd.notna(row.get("store_product_id")) else None
                        if spid and spid.endswith(".0"): spid = spid[:-2]
                        rows.append(StoreStockBatch(store_id=sid, ho_product_id=hpid, store_product_id=spid, product_name=pname, packing=pk, batch=batch,
                            mrp=float(row.get("mrp", 0)) if pd.notna(row.get("mrp")) else 0, sales=float(row.get("sales", 0)) if pd.notna(row.get("sales")) else 0,
                            closing_stock=cs, closing_stock_strips=cs/pk, cost_value=float(row.get("cost_value", 0)) if pd.notna(row.get("cost_value")) else 0,
                            expiry_date=pd.Timestamp(row.get("expiry_date")).to_pydatetime().replace(tzinfo=timezone.utc) if pd.notna(row.get("expiry_date")) else None))
                    for i in range(0, len(rows), 100): bg_db.add_all(rows[i:i+100]); await bg_db.flush()
                    await bg_db.commit()
                    bg_db.add(UploadHistory(file_name=fname, upload_type=UT.STORE_STOCK, store_id=sid, uploaded_by=uid, total_records=len(df), success_records=len(rows), failed_records=len(df)-len(rows)))

                await bg_db.commit()
                log.info(f"Chunked upload complete: {utype}, {fname}")
        except Exception as e:
            import logging; logging.getLogger(__name__).error(f"Chunked upload failed: {e}")

    asyncio.create_task(bg())
    return {"message": f"File received ({len(content)//1024}KB). Processing in background. Refresh in 1-2 minutes.", "total": 0, "success": 0, "failed": 0, "errors": [], "background": True}


@router.post("/products/upload-chunked")
async def upload_products_chunked(data: ChunkedUploadReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN"))):
    """Accepts large files as base64 JSON to bypass proxy body size limits."""
    import base64, asyncio
    content = base64.b64decode(data.file_base64)
    fname = data.filename
    uid = user["user_id"]

    async def bg():
        try:
            df = pd.read_excel(BytesIO(content))
            if df.empty: return
            df_mapped, missing, _ = map_columns(df, PRODUCT_COLUMNS, PRODUCT_REQUIRED)
            if missing: return
            rows_data = []
            for idx, row in df_mapped.iterrows():
                product_id = str(row.get("product_id", "")).strip()
                if product_id.endswith(".0"): product_id = product_id[:-2]
                if not product_id: continue
                rows_data.append({
                    "product_id": product_id, "product_name": str(row.get("product_name", "")).strip(),
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
                })
            if rows_data:
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                async with async_session_maker() as bg_db:
                    BATCH = 100
                    for i in range(0, len(rows_data), BATCH):
                        stmt = pg_insert(Product).values(rows_data[i:i+BATCH])
                        stmt = stmt.on_conflict_do_update(index_elements=['product_id'],
                            set_={k: stmt.excluded[k] for k in ['product_name', 'primary_supplier', 'secondary_supplier', 'least_price_supplier', 'most_qty_supplier', 'category', 'sub_category', 'rep', 'mrp', 'ptr', 'landing_cost']})
                        await bg_db.execute(stmt); await bg_db.flush()
                    await bg_db.commit()
                    bg_db.add(UploadHistory(file_name=fname, upload_type=UploadType.PRODUCT_MASTER, uploaded_by=uid, total_records=len(df), success_records=len(rows_data), failed_records=len(df)-len(rows_data)))
                    await bg_db.commit()
        except Exception as e:
            import logging; logging.getLogger(__name__).error(f"Chunked upload failed: {e}")

    asyncio.create_task(bg())
    return {"message": f"File received ({len(content)//1024}KB). Processing in background. Refresh in 1-2 minutes.", "total": 0, "success": 0, "failed": 0, "errors": [], "background": True, "columns_matched": {}, "columns_unmatched": []}


@router.post("/products/upload")
async def upload_products(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN")),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files (.xlsx, .xls) are accepted")

    content = await file.read()
    file_size = len(content)

    # For large files (>500KB), process entirely in background
    if file_size > 500000:
        import asyncio
        filename = file.filename
        user_id = user["user_id"]

        async def bg_process():
            try:
                df = pd.read_excel(BytesIO(content))
                if df.empty: return
                df_mapped, missing, col_info = map_columns(df, PRODUCT_COLUMNS, PRODUCT_REQUIRED)
                if missing: return

                rows_data = []
                for idx, row in df_mapped.iterrows():
                    product_id = str(row.get("product_id", "")).strip()
                    if product_id.endswith(".0"): product_id = product_id[:-2]
                    if not product_id: continue
                    rows_data.append({
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
                    })

                if rows_data:
                    async with async_session_maker() as bg_db:
                        from sqlalchemy.dialects.postgresql import insert as pg_insert
                        BATCH = 100
                        for i in range(0, len(rows_data), BATCH):
                            batch = rows_data[i:i+BATCH]
                            stmt = pg_insert(Product).values(batch)
                            stmt = stmt.on_conflict_do_update(
                                index_elements=['product_id'],
                                set_={k: stmt.excluded[k] for k in ['product_name', 'primary_supplier', 'secondary_supplier', 'least_price_supplier', 'most_qty_supplier', 'category', 'sub_category', 'rep', 'mrp', 'ptr', 'landing_cost']}
                            )
                            await bg_db.execute(stmt)
                            await bg_db.flush()
                        await bg_db.commit()

                        bg_db.add(UploadHistory(file_name=filename, upload_type=UploadType.PRODUCT_MASTER, uploaded_by=user_id,
                            total_records=len(df), success_records=len(rows_data), failed_records=len(df)-len(rows_data)))
                        await bg_db.commit()
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"Background upload failed: {e}")

        asyncio.create_task(bg_process())
        return {"message": f"File received ({file_size//1024}KB). Processing {file.filename} in background. Refresh page in 1-2 minutes.",
                "total": 0, "success": 0, "failed": 0, "errors": [], "background": True,
                "columns_matched": {}, "columns_unmatched": []}

    # Small files: process immediately
    try:
        df = pd.read_excel(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel file: {str(e)}")
    if df.empty:
        raise HTTPException(400, "Excel file is empty")

    df_mapped, missing, col_info = map_columns(df, PRODUCT_COLUMNS, PRODUCT_REQUIRED)
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Your Excel columns: {col_meta.get('original_columns', [])}")

    success, failed, errors = 0, 0, []
    rows_data = []
    for idx, row in df_mapped.iterrows():
        try:
            product_id = str(row.get("product_id", "")).strip()
            if product_id.endswith(".0"): product_id = product_id[:-2]
            if not product_id:
                errors.append(f"Row {idx+2}: Missing product_id"); failed += 1; continue
            rows_data.append({
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
            })
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)}"); failed += 1

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
            "columns_matched": col_meta.get("matched", {}), "columns_unmatched": col_meta.get("unmatched", [])[:20]}


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

    # Delete the actual uploaded data based on upload type
    utype = upload.upload_type.value if hasattr(upload.upload_type, 'value') else upload.upload_type
    deleted_count = 0

    if utype == "ho_stock":
        result = await db.execute(delete(HOStockBatch))
        deleted_count = result.rowcount
    elif utype == "store_stock" and upload.store_id:
        result = await db.execute(delete(StoreStockBatch).where(StoreStockBatch.store_id == upload.store_id))
        deleted_count = result.rowcount
    elif utype == "product_master":
        result = await db.execute(delete(Product))
        deleted_count = result.rowcount
    elif utype in ("sales_report", "SALES_REPORT") and upload.store_id:
        from models import SalesRecord
        result = await db.execute(delete(SalesRecord).where(SalesRecord.store_id == upload.store_id))
        deleted_count = result.rowcount
    elif utype in ("purchase_report", "PURCHASE_REPORT") and upload.store_id:
        from models import PurchaseRecord
        result = await db.execute(delete(PurchaseRecord).where(PurchaseRecord.store_id == upload.store_id))
        deleted_count = result.rowcount

    await db.delete(upload)
    await db.commit()
    return {"message": f"Upload deleted. {deleted_count} records removed."}



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
