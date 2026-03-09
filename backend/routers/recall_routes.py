from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from models import ProductRecall, Store, User, Product
from auth import get_current_user, require_roles
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import pandas as pd
from io import BytesIO

router = APIRouter()


class RecallCreateReq(BaseModel):
    store_id: int
    product_id: Optional[str] = None
    product_name: str
    quantity: float
    assigned_staff_id: Optional[int] = None
    remarks: Optional[str] = None


@router.post("/recalls")
async def create_recall(data: RecallCreateReq, db: AsyncSession = Depends(get_db), user: dict = Depends(require_roles("ADMIN", "HO_STAFF"))):
    recall = ProductRecall(
        store_id=data.store_id, product_id=data.product_id, product_name=data.product_name,
        quantity=data.quantity, assigned_staff_id=data.assigned_staff_id,
        remarks=data.remarks, status="pending", created_by=user["user_id"],
    )
    db.add(recall)
    await db.commit()
    await db.refresh(recall)

    from routers.notification_routes import notify_role
    await notify_role(db, ["STORE_MANAGER", "STORE_STAFF"], "Product Recall Request", f"{data.product_name} x{data.quantity} - return requested by HO", link="/recalls", entity_type="recall", entity_id=recall.id, store_id=data.store_id)
    await db.commit()

    return {"id": recall.id, "message": "Recall request created"}


@router.post("/recalls/bulk-upload")
async def bulk_recall_upload(
    store_id: int = Query(...),
    file: UploadFile = File(...),
    assigned_staff_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles("ADMIN", "HO_STAFF")),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")
    content = await file.read()
    try:
        df = pd.read_excel(BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Failed to read Excel: {str(e)}")
    if df.empty:
        raise HTTPException(400, "Excel is empty")

    df.columns = [str(c).strip().lower().replace('_', ' ') for c in df.columns]
    col_map = {"ho id": "product_id", "ho_id": "product_id", "product id": "product_id", "id": "product_id",
               "product name": "product_name", "name": "product_name", "product": "product_name",
               "qty": "quantity", "quantity": "quantity", "return qty": "quantity", "return quantity": "quantity"}
    mapped = {}
    for c in df.columns:
        if c in col_map: mapped[c] = col_map[c]
    if "product_name" not in set(mapped.values()):
        raise HTTPException(400, f"Missing 'Product Name' column. Your columns: {list(df.columns)}")
    df = df.rename(columns=mapped)

    success, failed, errors = 0, 0, []
    for idx, row in df.iterrows():
        try:
            pname = str(row.get("product_name", "")).strip()
            if not pname or pname == "nan": failed += 1; continue
            pid = str(row.get("product_id", "")).strip() if pd.notna(row.get("product_id")) else None
            if pid and pid.endswith(".0"): pid = pid[:-2]
            if pid in ("", "nan", "None"): pid = None
            qty = float(row.get("quantity", 0)) if pd.notna(row.get("quantity")) else 0

            db.add(ProductRecall(
                store_id=store_id, product_id=pid, product_name=pname,
                quantity=qty, assigned_staff_id=assigned_staff_id,
                status="pending", created_by=user["user_id"],
            ))
            success += 1
        except Exception as e:
            errors.append(f"Row {idx+2}: {str(e)[:80]}")
            failed += 1

    await db.commit()
    return {"message": f"{success} recall requests created", "success": success, "failed": failed, "errors": errors[:20]}


@router.get("/recalls")
async def list_recalls(
    store_id: int = Query(None), status: str = Query(None),
    page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    query = select(ProductRecall)
    if user.get("role") in ("STORE_STAFF", "STORE_MANAGER") and user.get("store_id"):
        query = query.where(ProductRecall.store_id == user["store_id"])
    elif store_id:
        query = query.where(ProductRecall.store_id == store_id)
    if status and status != "all":
        query = query.where(ProductRecall.status == status)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    items = (await db.execute(query.order_by(ProductRecall.created_at.desc()).offset((page - 1) * limit).limit(limit))).scalars().all()

    sids = set(i.store_id for i in items)
    uids = set()
    for i in items:
        if i.assigned_staff_id: uids.add(i.assigned_staff_id)
        if i.created_by: uids.add(i.created_by)
    smap = {s.id: s.store_name for s in (await db.execute(select(Store).where(Store.id.in_(sids)))).scalars().all()} if sids else {}
    umap = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()} if uids else {}

    return {
        "recalls": [{
            "id": r.id, "store_id": r.store_id, "store_name": smap.get(r.store_id, ""),
            "product_id": r.product_id, "product_name": r.product_name,
            "quantity": r.quantity, "status": r.status, "remarks": r.remarks,
            "assigned_staff": umap.get(r.assigned_staff_id, "") if r.assigned_staff_id else "",
            "created_by": umap.get(r.created_by, ""),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in items],
        "total": total, "page": page, "limit": limit,
    }


@router.put("/recalls/{recall_id}/status")
async def update_recall_status(
    recall_id: int, status: str = Query(...),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    r = (await db.execute(select(ProductRecall).where(ProductRecall.id == recall_id))).scalar_one_or_none()
    if not r: raise HTTPException(404, "Recall not found")
    r.status = status
    r.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": f"Recall status updated to {status}"}
