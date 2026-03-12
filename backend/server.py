from fastapi import FastAPI, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from dotenv import load_dotenv
from pathlib import Path
import os
import logging
from database import init_db, async_session_maker
from models import User, UserRole, AuditLog
from auth import hash_password, decode_token
from routers.auth_routes import router as auth_router
from routers.data_routes import router as data_router
from routers.operations_routes import router as operations_router
from routers.phase2_routes import router as phase2_router
from routers.crm_routes import router as crm_router
from routers.intelligence_routes import router as intel_router
from routers.po_routes import router as po_router
from routers.recall_routes import router as recall_router
from routers.notification_routes import router as notif_router
from sqlalchemy import select

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI(title="Sahakar Pharmacy Inventory Platform")

# GZip compression — reduces response size 3-5x
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# Audit middleware - logs all POST/PUT/DELETE actions
@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.method in ("POST", "PUT", "DELETE") and "/api/" in request.url.path and response.status_code < 400:
        try:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                token_data = decode_token(auth.split(" ")[1])
                user_id = token_data.get("user_id", 0)
                user_name = token_data.get("full_name", "")
                path = request.url.path.replace("/api/", "")
                action = f"{request.method} /{path}"
                async with async_session_maker() as session:
                    session.add(AuditLog(user_id=user_id, user_name=user_name, action=action, entity_type=path.split("/")[0]))
                    await session.commit()
        except Exception:
            pass
    return response

app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(data_router, prefix="/api", tags=["Data"])
app.include_router(operations_router, prefix="/api", tags=["Operations"])
app.include_router(phase2_router, prefix="/api", tags=["Phase2"])
app.include_router(crm_router, prefix="/api", tags=["CRM"])
app.include_router(intel_router, prefix="/api", tags=["Intelligence"])
app.include_router(po_router, prefix="/api", tags=["PurchaseOrders"])
app.include_router(recall_router, prefix="/api", tags=["Recalls"])
app.include_router(notif_router, prefix="/api", tags=["Notifications"])


@app.on_event("startup")
async def startup():
    import asyncio
    # Retry DB connection up to 5 times
    for attempt in range(5):
        try:
            await init_db()
            break
        except Exception as e:
            logger.warning(f"DB connection attempt {attempt+1}/5 failed: {e}")
            if attempt < 4:
                await asyncio.sleep(3)
            else:
                logger.error("Could not connect to database after 5 attempts")
                raise

    # Migrate: add enum values
    from database import engine
    from sqlalchemy import text
    try:
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            for sql in [
                "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'crm_staff'",
                "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'DIRECTOR'",
                "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'STORE_MANAGER'",
                "ALTER TYPE uploadtype ADD VALUE IF NOT EXISTS 'SALES_REPORT'",
                "ALTER TYPE uploadtype ADD VALUE IF NOT EXISTS 'PURCHASE_REPORT'",
                "ALTER TYPE uploadtype ADD VALUE IF NOT EXISTS 'sales_report'",
                "ALTER TYPE uploadtype ADD VALUE IF NOT EXISTS 'purchase_report'",
            ]:
                try:
                    await conn.execute(text(sql))
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Enum migration failed: {e}")

    try:
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
            await conn.execute(text("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS quantity FLOAT DEFAULT 0"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_services TEXT"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT TRUE"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS has_prescription BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS doctor_name VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS clinic_location VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS po_category VARCHAR(50)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS selected_supplier VARCHAR(500)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS item_status VARCHAR(30) DEFAULT 'pending'"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS tat_days INTEGER"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS ho_remarks TEXT"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS tat_type VARCHAR(20)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(30)"))
            await conn.execute(text("ALTER TABLE store_request_items ADD COLUMN IF NOT EXISTS received_qty FLOAT DEFAULT 0"))
            await conn.execute(text("ALTER TABLE medicine_purchases ADD COLUMN IF NOT EXISTS dosage VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE medicine_purchases ADD COLUMN IF NOT EXISTS timing VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE medicine_purchases ADD COLUMN IF NOT EXISTS food_relation VARCHAR(50)"))
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
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS assigned_staff_id INTEGER REFERENCES users(id)"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS followup_date TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS followup_notes TEXT"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_crm_assigned_staff ON crm_customers(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL"))
        except Exception:
            pass
    except Exception as e:
        logger.warning(f"Migration block failed (non-critical): {e}")

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
