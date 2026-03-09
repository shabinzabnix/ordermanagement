from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import User, UserRole, LoginActivity
from auth import verify_password, create_token, get_current_user, require_roles
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
import re

router = APIRouter()

RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_MINUTES = 15
ACCOUNT_LOCK_ATTEMPTS = 10


def validate_password_strength(password: str):
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not re.search(r'[A-Z]', password):
        raise HTTPException(400, "Password must contain at least one uppercase letter")
    if not re.search(r'[0-9]', password):
        raise HTTPException(400, "Password must contain at least one number")


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(data: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")[:500]
    now = datetime.now(timezone.utc)

    # Rate limiting: check recent failed attempts for this email
    cutoff = now - timedelta(minutes=RATE_LIMIT_MINUTES)
    recent_fails = (await db.execute(
        select(LoginActivity).where(
            LoginActivity.email == data.email, LoginActivity.success == False,
            LoginActivity.created_at >= cutoff,
        )
    )).scalars().all()

    if len(recent_fails) >= RATE_LIMIT_ATTEMPTS:
        db.add(LoginActivity(email=data.email, success=False, ip_address=ip, user_agent=ua, failure_reason="rate_limited"))
        await db.commit()
        raise HTTPException(429, f"Too many failed attempts. Please try again after {RATE_LIMIT_MINUTES} minutes.")

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user:
        db.add(LoginActivity(email=data.email, success=False, ip_address=ip, user_agent=ua, failure_reason="user_not_found"))
        await db.commit()
        raise HTTPException(401, "Invalid email or password")

    # Check account lock
    if user.locked_until and user.locked_until > now:
        db.add(LoginActivity(email=data.email, user_id=user.id, success=False, ip_address=ip, user_agent=ua, failure_reason="account_locked"))
        await db.commit()
        raise HTTPException(403, "Account is locked due to too many failed attempts. Contact admin.")

    if not user.is_active:
        db.add(LoginActivity(email=data.email, user_id=user.id, success=False, ip_address=ip, user_agent=ua, failure_reason="account_inactive"))
        await db.commit()
        raise HTTPException(403, "Account is deactivated")

    if not verify_password(data.password, user.password_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        # Auto-lock after 10 consecutive failures
        if user.failed_attempts >= ACCOUNT_LOCK_ATTEMPTS:
            user.locked_until = now + timedelta(hours=1)
            user.is_active = False
        db.add(LoginActivity(email=data.email, user_id=user.id, success=False, ip_address=ip, user_agent=ua, failure_reason="wrong_password"))
        await db.commit()
        remaining = RATE_LIMIT_ATTEMPTS - len(recent_fails) - 1
        raise HTTPException(401, f"Invalid email or password. {max(0, remaining)} attempts remaining.")

    # Success — reset counters
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login = now
    db.add(LoginActivity(email=data.email, user_id=user.id, success=True, ip_address=ip, user_agent=ua))
    await db.commit()

    role_val = user.role.value if isinstance(user.role, UserRole) else user.role
    token = create_token(user.id, user.email, role_val, user.full_name, user.store_id)

    return {
        "token": token,
        "user": {
            "id": user.id, "email": user.email, "full_name": user.full_name,
            "role": role_val, "store_id": user.store_id,
            "allowed_services": user.allowed_services,
            "force_password_change": user.force_password_change or False,
        },
    }


@router.get("/me")
async def get_me(db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    result = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    role_val = user.role.value if isinstance(user.role, UserRole) else user.role
    return {
        "id": user.id, "email": user.email, "full_name": user.full_name,
        "role": role_val, "store_id": user.store_id,
        "allowed_services": user.allowed_services,
        "force_password_change": user.force_password_change or False,
    }


@router.post("/impersonate/{user_id}")
async def impersonate_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_roles("ADMIN"))):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "User not found")
    role_val = target.role.value if isinstance(target.role, UserRole) else target.role
    token = create_token(target.id, target.email, role_val, target.full_name, target.store_id)
    return {
        "token": token,
        "user": {"id": target.id, "email": target.email, "full_name": target.full_name,
                 "role": role_val, "store_id": target.store_id, "allowed_services": target.allowed_services},
    }


class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(data: ChangePasswordReq, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    from auth import hash_password
    user = (await db.execute(select(User).where(User.id == current_user["user_id"]))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    validate_password_strength(data.new_password)
    user.password_hash = hash_password(data.new_password)
    user.force_password_change = False
    await db.commit()
    return {"message": "Password changed successfully"}


@router.get("/login-activity")
async def get_login_activity(
    email: str = None, limit: int = 50,
    db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_roles("ADMIN")),
):
    query = select(LoginActivity).order_by(LoginActivity.created_at.desc()).limit(limit)
    if email:
        query = select(LoginActivity).where(LoginActivity.email == email).order_by(LoginActivity.created_at.desc()).limit(limit)
    activities = (await db.execute(query)).scalars().all()
    return {"activities": [{
        "id": a.id, "email": a.email, "user_id": a.user_id, "success": a.success,
        "ip_address": a.ip_address, "user_agent": a.user_agent[:100] if a.user_agent else "",
        "failure_reason": a.failure_reason,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in activities]}


@router.post("/unlock/{user_id}")
async def unlock_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_roles("ADMIN"))):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    user.failed_attempts = 0
    user.locked_until = None
    user.is_active = True
    await db.commit()
    return {"message": f"User {user.full_name} unlocked"}


# CRM Login (separate for CRM staff)
@router.post("/crm-login")
async def crm_login(data: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")[:500]
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        db.add(LoginActivity(email=data.email, success=False, ip_address=ip, user_agent=ua, failure_reason="crm_login_failed"))
        await db.commit()
        raise HTTPException(401, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(403, "Account deactivated")
    role_val = user.role.value if isinstance(user.role, UserRole) else user.role
    user.last_login = datetime.now(timezone.utc)
    db.add(LoginActivity(email=data.email, user_id=user.id, success=True, ip_address=ip, user_agent=ua))
    await db.commit()
    token = create_token(user.id, user.email, role_val, user.full_name, user.store_id)
    return {"token": token, "user": {"id": user.id, "email": user.email, "full_name": user.full_name,
            "role": role_val, "store_id": user.store_id, "allowed_services": user.allowed_services}}
