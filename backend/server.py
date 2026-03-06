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
from routers.intelligence_routes import router as intel_router
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
app.include_router(intel_router, prefix="/api", tags=["Intelligence"])


@app.on_event("startup")
async def startup():
    await init_db()
    # Migrate: add crm_staff enum value (requires autocommit)
    from database import engine
    from sqlalchemy import text
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            await conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'crm_staff'"))
        except Exception:
            pass
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS assigned_store_id INTEGER REFERENCES stores(id)"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS adherence_score VARCHAR(20) DEFAULT 'unknown'"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS clv_value FLOAT DEFAULT 0"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS clv_tier VARCHAR(20) DEFAULT 'unknown'"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS chronic_tags TEXT"))
            await conn.execute(text("ALTER TABLE ho_stock_batches ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE store_stock_batches ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS purchase_reason VARCHAR(50) DEFAULT 'customer_enquiry'"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS crm_status VARCHAR(20) DEFAULT 'pending'"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS crm_verified_by INTEGER"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS crm_remarks TEXT"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS crm_verified_at TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS ho_status VARCHAR(20) DEFAULT 'pending'"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS assigned_supplier VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS ho_remarks TEXT"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS ho_approved_by INTEGER"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS ho_approved_at TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS tat_days INTEGER"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS expected_delivery TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(20) DEFAULT 'not_started'"))
            await conn.execute(text("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS fulfillment_updated_at TIMESTAMP WITH TIME ZONE"))
            # Performance indexes
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_customer_product ON sales_records(customer_id, product_name)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales_records(store_id, invoice_date)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_medpurchase_customer_status ON medicine_purchases(customer_id, status)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_medpurchase_due ON medicine_purchases(next_due_date) WHERE status = 'active'"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_store_stock_product ON store_stock_batches(ho_product_id, store_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_crm_customer_type ON crm_customers(customer_type)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_crm_customer_store ON crm_customers(assigned_store_id)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_transfer_status ON inter_store_transfers(status)"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_ho_stock_expiry ON ho_stock_batches(expiry_date) WHERE expiry_date IS NOT NULL"))
        except Exception:
            pass
    # Ensure new tables exist
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
        # Create default CRM user
        crm_result = await session.execute(select(User).where(User.email == "crm@sahakar.com"))
        if not crm_result.scalar_one_or_none():
            session.add(User(
                email="crm@sahakar.com",
                password_hash=hash_password("crm123"),
                full_name="CRM Manager",
                role=UserRole.CRM_STAFF,
                is_active=True,
            ))
            await session.commit()
            logging.info("Default CRM user created: crm@sahakar.com / crm123")


@app.get("/api/health")
async def health():
    return {"status": "healthy"}


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
