from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import User, UserRole
from auth import verify_password, create_token, get_current_user
from pydantic import BaseModel

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    role_val = user.role.value if isinstance(user.role, UserRole) else user.role
    token = create_token(user.id, user.email, role_val, user.full_name, user.store_id)

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": role_val,
            "store_id": user.store_id,
            "allowed_services": user.allowed_services,
        },
    }


@router.get("/me")
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role_val = user.role.value if isinstance(user.role, UserRole) else user.role
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": role_val,
        "store_id": user.store_id,
        "allowed_services": user.allowed_services,
    }


from auth import require_roles


@router.post("/impersonate/{user_id}")
async def impersonate_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles("ADMIN")),
):
    """Admin-only: generate a token to act as another user."""
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "User not found")
    role_val = target.role.value if isinstance(target.role, UserRole) else target.role
    token = create_token(target.id, target.email, role_val, target.full_name, target.store_id)
    return {
        "token": token,
        "user": {
            "id": target.id, "email": target.email, "full_name": target.full_name,
            "role": role_val, "store_id": target.store_id,
            "allowed_services": target.allowed_services,
        },
    }
