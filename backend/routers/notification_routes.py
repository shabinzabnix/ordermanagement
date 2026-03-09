from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from database import get_db
from models import Notification, User
from auth import get_current_user
from datetime import datetime, timezone

router = APIRouter()


async def notify(db: AsyncSession, user_id: int, title: str, message: str, link: str = None, entity_type: str = None, entity_id: int = None):
    """Helper to create a notification for a user."""
    db.add(Notification(user_id=user_id, title=title, message=message, link=link, entity_type=entity_type, entity_id=entity_id))


async def notify_role(db: AsyncSession, roles: list, title: str, message: str, link: str = None, entity_type: str = None, entity_id: int = None, store_id: int = None):
    """Notify all users of given roles (optionally filtered by store)."""
    q = select(User).where(User.is_active == True, User.role.in_(roles))
    if store_id:
        q = q.where(User.store_id == store_id)
    users = (await db.execute(q)).scalars().all()
    for u in users:
        db.add(Notification(user_id=u.id, title=title, message=message, link=link, entity_type=entity_type, entity_id=entity_id))


@router.get("/notifications")
async def get_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user),
):
    query = select(Notification).where(Notification.user_id == user["user_id"])
    if unread_only:
        query = query.where(Notification.is_read == False)
    notifications = (await db.execute(query.order_by(Notification.created_at.desc()).limit(limit))).scalars().all()
    unread_count = (await db.execute(
        select(func.count(Notification.id)).where(Notification.user_id == user["user_id"], Notification.is_read == False)
    )).scalar() or 0

    return {
        "notifications": [{
            "id": n.id, "title": n.title, "message": n.message, "link": n.link,
            "entity_type": n.entity_type, "entity_id": n.entity_id,
            "is_read": n.is_read, "created_at": n.created_at.isoformat() if n.created_at else None,
        } for n in notifications],
        "unread_count": unread_count,
    }


@router.put("/notifications/{notification_id}/read")
async def mark_read(notification_id: int, db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    n = (await db.execute(select(Notification).where(Notification.id == notification_id, Notification.user_id == user["user_id"]))).scalar_one_or_none()
    if not n: raise HTTPException(404, "Not found")
    n.is_read = True
    await db.commit()
    return {"message": "Marked as read"}


@router.put("/notifications/read-all")
async def mark_all_read(db: AsyncSession = Depends(get_db), user: dict = Depends(get_current_user)):
    await db.execute(update(Notification).where(Notification.user_id == user["user_id"], Notification.is_read == False).values(is_read=True))
    await db.commit()
    return {"message": "All marked as read"}
