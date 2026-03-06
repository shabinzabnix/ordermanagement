from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
import os
import logging
from database import init_db, async_session_maker
from models import User, UserRole
from auth import hash_password
from routers.auth_routes import router as auth_router
from routers.data_routes import router as data_router
from routers.operations_routes import router as operations_router
from routers.phase2_routes import router as phase2_router
from routers.crm_routes import router as crm_router
from sqlalchemy import select

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI(title="Sahakar Pharmacy Inventory Platform")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(data_router, prefix="/api", tags=["Data"])
app.include_router(operations_router, prefix="/api", tags=["Operations"])
app.include_router(phase2_router, prefix="/api", tags=["Phase2"])
app.include_router(crm_router, prefix="/api", tags=["CRM"])


@app.on_event("startup")
async def startup():
    await init_db()
    async with async_session_maker() as session:
        result = await session.execute(select(User).where(User.email == "admin@sahakar.com"))
        admin = result.scalar_one_or_none()
        if not admin:
            session.add(User(
                email="admin@sahakar.com",
                password_hash=hash_password("admin123"),
                full_name="System Admin",
                role=UserRole.ADMIN,
                is_active=True,
            ))
            await session.commit()
            logging.info("Default admin user created: admin@sahakar.com / admin123")


@app.get("/api/health")
async def health():
    return {"status": "healthy"}


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
