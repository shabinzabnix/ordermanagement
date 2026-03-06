from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Enum as SQLEnum, Index
from database import Base
from datetime import datetime, timezone
import enum


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    HO_STAFF = "HO_STAFF"
    STORE_STAFF = "STORE_STAFF"
    CRM_STAFF = "CRM_STAFF"


class TransferStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PurchaseStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    TRANSFER_SUGGESTED = "transfer_suggested"


class UploadType(str, enum.Enum):
    PRODUCT_MASTER = "product_master"
    HO_STOCK = "ho_stock"
    STORE_STOCK = "store_stock"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Store(Base):
    __tablename__ = "stores"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_name = Column(String(255), nullable=False)
    location = Column(String(500))
    manager_name = Column(String(255))
    contact_number = Column(String(50))
    store_code = Column(String(50), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(100), unique=True, nullable=False, index=True)
    product_name = Column(String(500), nullable=False)
    primary_supplier = Column(String(255))
    secondary_supplier = Column(String(255))
    least_price_supplier = Column(String(255))
    most_qty_supplier = Column(String(255))
    category = Column(String(255), index=True)
    sub_category = Column(String(255))
    rep = Column(String(255))
    mrp = Column(Float, default=0)
    ptr = Column(Float, default=0)
    landing_cost = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class HOStockBatch(Base):
    __tablename__ = "ho_stock_batches"
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(100), nullable=False, index=True)
    product_name = Column(String(500))
    batch = Column(String(100), index=True)
    mrp = Column(Float, default=0)
    closing_stock = Column(Float, default=0)
    landing_cost_value = Column(Float, default=0)
    expiry_date = Column(DateTime(timezone=True), nullable=True)
    upload_id = Column(Integer, ForeignKey("upload_history.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class StoreStockBatch(Base):
    __tablename__ = "store_stock_batches"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    ho_product_id = Column(String(100), nullable=True, index=True)
    store_product_id = Column(String(100))
    product_name = Column(String(500))
    packing = Column(Float, default=1)
    batch = Column(String(100), index=True)
    mrp = Column(Float, default=0)
    sales = Column(Float, default=0)
    closing_stock = Column(Float, default=0)
    closing_stock_strips = Column(Float, default=0)
    cost_value = Column(Float, default=0)
    expiry_date = Column(DateTime(timezone=True), nullable=True)
    upload_id = Column(Integer, ForeignKey("upload_history.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class InterStoreTransfer(Base):
    __tablename__ = "inter_store_transfers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    requesting_store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    source_store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    product_id = Column(String(100), nullable=False)
    product_name = Column(String(500))
    batch = Column(String(100))
    quantity = Column(Float, default=0)
    status = Column(SQLEnum(TransferStatus), default=TransferStatus.PENDING)
    rejection_reason = Column(Text, nullable=True)
    requested_by = Column(Integer, ForeignKey("users.id"))
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PurchaseRequest(Base):
    __tablename__ = "purchase_requests"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    product_id = Column(String(100), nullable=True)
    product_name = Column(String(500), nullable=False)
    brand_name = Column(String(255), nullable=True)
    quantity = Column(Float, default=0)
    customer_name = Column(String(255))
    customer_contact = Column(String(50))
    is_registered_product = Column(Boolean, default=True)
    purchase_reason = Column(String(50), default="customer_enquiry")
    status = Column(SQLEnum(PurchaseStatus), default=PurchaseStatus.PENDING)
    network_stock_info = Column(Text, nullable=True)
    requested_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class UploadHistory(Base):
    __tablename__ = "upload_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(String(500), nullable=False)
    upload_type = Column(SQLEnum(UploadType), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    total_records = Column(Integer, default=0)
    success_records = Column(Integer, default=0)
    failed_records = Column(Integer, default=0)
    error_details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RCCustomer(Base):
    __tablename__ = "rc_customers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    customer_name = Column(String(255), nullable=False)
    mobile_number = Column(String(50), nullable=False)
    medicine_name = Column(String(500), nullable=False)
    last_purchase_date = Column(DateTime(timezone=True))
    duration_of_medication = Column(Integer, default=0)
    days_of_consumption = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_name = Column(String(255))
    action = Column(String(500), nullable=False)
    entity_type = Column(String(100))
    entity_id = Column(String(100))
    details = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CustomerType(str, enum.Enum):
    WALKIN = "walkin"
    RC = "rc"
    CHRONIC = "chronic"
    HIGH_VALUE = "high_value"


class CallResult(str, enum.Enum):
    REACHED = "reached"
    NOT_REACHABLE = "not_reachable"
    CALLBACK = "callback"
    CONFIRMED = "confirmed"
    DISCONTINUED = "discontinued"


class CRMCustomer(Base):
    __tablename__ = "crm_customers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    mobile_number = Column(String(50), unique=True, nullable=False, index=True)
    customer_name = Column(String(255), nullable=False)
    gender = Column(String(20))
    age = Column(Integer)
    address = Column(Text)
    first_store_id = Column(Integer, ForeignKey("stores.id"))
    assigned_store_id = Column(Integer, ForeignKey("stores.id"))
    customer_type = Column(SQLEnum(CustomerType), default=CustomerType.WALKIN)
    adherence_score = Column(String(20), default="unknown")
    clv_value = Column(Float, default=0)
    clv_tier = Column(String(20), default="unknown")
    chronic_tags = Column(Text, nullable=True)
    registration_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MedicinePurchase(Base):
    __tablename__ = "medicine_purchases"
    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("crm_customers.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    medicine_name = Column(String(500), nullable=False, index=True)
    quantity = Column(Float, default=0)
    days_of_medication = Column(Integer, default=0)
    purchase_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    next_due_date = Column(DateTime(timezone=True), index=True)
    status = Column(String(20), default="active")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CRMCallLog(Base):
    __tablename__ = "crm_call_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("crm_customers.id"), nullable=False, index=True)
    purchase_id = Column(Integer, ForeignKey("medicine_purchases.id"), nullable=True)
    caller_name = Column(String(255))
    call_result = Column(SQLEnum(CallResult), nullable=False)
    remarks = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CRMTask(Base):
    __tablename__ = "crm_tasks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("crm_customers.id"), nullable=False, index=True)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    assigned_name = Column(String(255))
    due_date = Column(DateTime(timezone=True))
    status = Column(String(20), default="pending")
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SalesRecord(Base):
    __tablename__ = "sales_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("crm_customers.id"), nullable=True, index=True)
    invoice_date = Column(DateTime(timezone=True))
    entry_number = Column(String(100))
    patient_name = Column(String(255))
    mobile_number = Column(String(50), index=True)
    product_id = Column(String(100))
    product_name = Column(String(500))
    total_amount = Column(Float, default=0)
    days_of_medication = Column(Integer, nullable=True)
    next_due_date = Column(DateTime(timezone=True), nullable=True)
    medication_updated = Column(Boolean, default=False)
    upload_batch_id = Column(String(100))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
