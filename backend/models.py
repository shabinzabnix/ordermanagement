from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Enum as SQLEnum, Index
from database import Base
from datetime import datetime, timezone
import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    HO_STAFF = "ho_staff"
    STORE_STAFF = "store_staff"


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
