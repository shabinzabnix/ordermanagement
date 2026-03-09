from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Enum as SQLEnum, Index
from database import Base
from datetime import datetime, timezone
import enum


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    HO_STAFF = "HO_STAFF"
    STORE_MANAGER = "STORE_MANAGER"
    STORE_STAFF = "STORE_STAFF"
    CRM_STAFF = "CRM_STAFF"
    DIRECTOR = "DIRECTOR"


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
    SALES_REPORT = "sales_report"
    PURCHASE_REPORT = "purchase_report"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    allowed_services = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    force_password_change = Column(Boolean, default=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class LoginActivity(Base):
    __tablename__ = "login_activity"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    success = Column(Boolean, default=False)
    ip_address = Column(String(100))
    user_agent = Column(String(500))
    failure_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
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
    # CRM verification stage
    crm_status = Column(String(20), default="pending")
    crm_verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    crm_remarks = Column(Text, nullable=True)
    crm_verified_at = Column(DateTime(timezone=True), nullable=True)
    # HO approval stage
    ho_status = Column(String(20), default="pending")
    assigned_supplier = Column(String(255), nullable=True)
    ho_remarks = Column(Text, nullable=True)
    ho_approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    ho_approved_at = Column(DateTime(timezone=True), nullable=True)
    tat_days = Column(Integer, nullable=True)
    expected_delivery = Column(DateTime(timezone=True), nullable=True)
    # Fulfillment tracking
    fulfillment_status = Column(String(20), default="not_started")
    fulfillment_updated_at = Column(DateTime(timezone=True), nullable=True)
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
    assigned_staff_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    followup_date = Column(DateTime(timezone=True), nullable=True)
    followup_notes = Column(Text, nullable=True)
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
    dosage = Column(String(100), nullable=True)
    timing = Column(String(100), nullable=True)
    food_relation = Column(String(50), nullable=True)
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
    quantity = Column(Float, default=0)
    total_amount = Column(Float, default=0)
    days_of_medication = Column(Integer, nullable=True)
    next_due_date = Column(DateTime(timezone=True), nullable=True)
    medication_updated = Column(Boolean, default=False)
    upload_batch_id = Column(String(100))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PurchaseRecord(Base):
    __tablename__ = "purchase_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    purchase_date = Column(DateTime(timezone=True), index=True)
    entry_number = Column(String(100))
    supplier_name = Column(String(500), index=True)
    product_id = Column(String(100), index=True)
    product_name = Column(String(500))
    quantity = Column(Float, default=0)
    total_amount = Column(Float, default=0)
    upload_batch_id = Column(String(100))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    po_number = Column(String(50), unique=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    supplier_name = Column(String(500))
    po_type = Column(String(30), default="manual")
    sub_category = Column(String(255), nullable=True)
    status = Column(String(30), default="draft")
    total_qty = Column(Float, default=0)
    total_value = Column(Float, default=0)
    remarks = Column(Text, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    fulfillment_status = Column(String(30), default="pending")
    received_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    product_id = Column(String(100), nullable=True)
    product_name = Column(String(500), nullable=False)
    is_registered = Column(Boolean, default=True)
    quantity = Column(Float, default=0)
    landing_cost = Column(Float, default=0)
    estimated_value = Column(Float, default=0)


class StoreRequest(Base):
    __tablename__ = "store_requests"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    request_reason = Column(String(50), default="stock_refill")
    customer_name = Column(String(255), nullable=True)
    customer_mobile = Column(String(50), nullable=True)
    status = Column(String(30), default="pending")
    total_items = Column(Integer, default=0)
    total_value = Column(Float, default=0)
    ho_remarks = Column(Text, nullable=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    requested_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class StoreRequestItem(Base):
    __tablename__ = "store_request_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(Integer, ForeignKey("store_requests.id"), nullable=False, index=True)
    product_id = Column(String(100), nullable=True)
    product_name = Column(String(500), nullable=False)
    is_registered = Column(Boolean, default=True)
    quantity = Column(Float, default=0)
    landing_cost = Column(Float, default=0)
    estimated_value = Column(Float, default=0)
    current_store_stock = Column(Float, default=0)
    pending_orders = Column(Integer, default=0)
    has_prescription = Column(Boolean, default=False)
    doctor_name = Column(String(255), nullable=True)
    clinic_location = Column(String(500), nullable=True)
    po_category = Column(String(50), nullable=True)
    selected_supplier = Column(String(500), nullable=True)
    item_status = Column(String(30), default="pending")
    tat_days = Column(Integer, nullable=True)
    tat_type = Column(String(20), nullable=True)
    ho_remarks = Column(Text, nullable=True)
    fulfillment_status = Column(String(30), nullable=True)
    received_qty = Column(Float, default=0)

class POComment(Base):
    __tablename__ = "po_comments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    user_name = Column(String(255))
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class POCategoryRule(Base):
    __tablename__ = "po_category_rules"
    id = Column(Integer, primary_key=True, autoincrement=True)
    po_category = Column(String(50), nullable=False)
    sub_categories = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class RequestComment(Base):
    __tablename__ = "request_comments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(Integer, ForeignKey("store_request_items.id"), nullable=False, index=True)
    user_name = Column(String(255))
    user_role = Column(String(50))
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class ProductRecall(Base):
    __tablename__ = "product_recalls"
    id = Column(Integer, primary_key=True, autoincrement=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    product_id = Column(String(100), nullable=True, index=True)
    product_name = Column(String(500), nullable=False)
    quantity = Column(Float, default=0)
    assigned_staff_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(30), default="pending")
    remarks = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class TransactionComment(Base):
    __tablename__ = "transaction_comments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(Integer, nullable=False, index=True)
    user_name = Column(String(255))
    user_role = Column(String(50))
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    link = Column(String(500), nullable=True)
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(Integer, nullable=True)
    is_read = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
