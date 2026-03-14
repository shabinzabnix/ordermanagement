# Development Guidelines

## Backend Patterns

### Router Structure
Every router file follows this exact pattern:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import SomeModel
from auth import get_current_user, require_roles
from pydantic import BaseModel

router = APIRouter()

class SomeRequest(BaseModel):
    field: str

@router.post("/endpoint")
async def handler(data: SomeRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    ...
```

- All routers use `APIRouter()` — never define routes directly on `app`
- All DB operations are `async` using `AsyncSession` from `get_db` dependency
- Pydantic `BaseModel` classes are defined inline in the router file (not in a separate schemas file)
- Role enforcement uses `Depends(require_roles("ROLE_NAME"))` or `Depends(get_current_user)`

### Database Access Pattern
```python
# Standard query pattern
result = await db.execute(select(Model).where(Model.field == value))
obj = result.scalar_one_or_none()

# Bulk fetch
items = (await db.execute(select(Model).order_by(Model.created_at.desc()))).scalars().all()

# Insert
db.add(Model(field=value))
await db.commit()

# Update — mutate the ORM object, then commit
obj.field = new_value
await db.commit()
```

- Always use `scalar_one_or_none()` for single-row queries (never `first()`)
- Always `await db.commit()` after writes — no `db.refresh()` unless return value needed
- Never use raw SQL for business logic — only for migrations in `server.py`

### Error Handling
```python
if not obj:
    raise HTTPException(404, "Resource not found")
if not authorized:
    raise HTTPException(403, "Insufficient permissions")
```
- Use `HTTPException` with numeric status code and plain string detail
- No custom exception classes — keep it simple
- Wrap non-critical operations in `try/except Exception: pass` (especially migrations)

### Enum Pattern
```python
class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    HO_STAFF = "HO_STAFF"

# When returning enum values in responses, always extract .value:
role_val = user.role.value if isinstance(user.role, UserRole) else user.role
```
- All enums inherit from both `str` and `enum.Enum`
- Always guard enum `.value` access with `isinstance` check

### Model Conventions
```python
class MyModel(Base):
    __tablename__ = "my_models"
    id = Column(Integer, primary_key=True, autoincrement=True)
    # ... fields ...
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
```
- All timestamps use `DateTime(timezone=True)` with UTC lambdas — never `func.now()`
- Primary keys are always `Integer, primary_key=True, autoincrement=True`
- String FKs (product_id) are `String(100)` — not Integer FKs — because product IDs come from Excel
- Add `index=True` on any column used in WHERE clauses

### Schema Migrations
- Never use Alembic — all migrations are inline `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `server.py` startup
- New columns must be added both to the SQLAlchemy model AND to the startup migration block
- Always use `IF NOT EXISTS` to make migrations idempotent

### Security Patterns
- Rate limiting: check `LoginActivity` table for recent failures within a time window
- Account lockout: increment `failed_attempts`, set `locked_until` after threshold
- Password validation: minimum 8 chars, 1 uppercase, 1 number (enforced via `validate_password_strength`)
- JWT tokens contain: `user_id`, `email`, `role`, `full_name`, `store_id`

---

## Frontend Patterns

### API Calls
```javascript
import api, { cachedGet, downloadExcel } from '../lib/api';

// Standard mutation
const res = await api.post('/endpoint', { field: value });

// Cached GET (60s TTL) — use for reference data
const res = await cachedGet('/products/search', { q: query });

// Excel download
await downloadExcel('/report/export', 'filename.xlsx');
```
- All API calls go through `lib/api.js` — never create a new axios instance
- Use `cachedGet` for read-heavy reference data (products, stores)
- Token is auto-attached via request interceptor — never manually set headers
- 401 responses auto-redirect to `/login` via response interceptor

### Auth & Role Checks
```javascript
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

const { user } = useContext(AuthContext);
const isAdmin = user?.role === 'ADMIN';
const isHO = ['ADMIN', 'HO_STAFF'].includes(user?.role);
```
- Always use optional chaining (`user?.role`) — user may be null during loading
- Role strings match backend enum values exactly (uppercase)

### Component Structure (Pages)
```javascript
import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import DashboardLayout from '../components/DashboardLayout';

export default function SomePage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/endpoint');
      setData(res.data.items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return <DashboardLayout><div>...</div></DashboardLayout>;
}
```
- All pages are default exports wrapped in `DashboardLayout`
- Local state with `useState` — no Redux or Zustand
- Data fetching in `useEffect` calling an async function
- Always `setLoading(false)` in `finally` block

### UI Components
```jsx
// Use shadcn/ui primitives from components/ui/
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

// Radix UI components in ui/ are thin re-exports:
// const Component = PrimitivePkg.Root
// export { Component, ComponentTrigger, ComponentContent }
```
- `components/ui/` files are thin wrappers — never add business logic there
- Use `lucide-react` for all icons
- Use `cn()` from `lib/utils.js` for conditional class merging

### Tailwind CSS Conventions
- Use Tailwind utility classes directly — no custom CSS files except `App.css` / `index.css`
- Color palette follows shadcn/ui CSS variables (`bg-background`, `text-foreground`, `border`, etc.)
- Responsive: use `sm:`, `md:`, `lg:` prefixes for breakpoints
- PostCSS config: only `tailwindcss` and `autoprefixer` plugins

### Excel Upload Pattern
```javascript
const handleUpload = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/upload/endpoint', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  // res.data contains { success_records, failed_records, error_details }
};
```
- All uploads use `multipart/form-data` with a `file` field
- Backend returns `{ success_records, failed_records, total_records, error_details }`
- Show `UploadProgress` component during upload

### Pagination Pattern
```javascript
const [page, setPage] = useState(1);
const [total, setTotal] = useState(0);
const PAGE_SIZE = 50;

// Pass to API
const res = await api.get('/items', { params: { page, page_size: PAGE_SIZE } });
setTotal(res.data.total);

// Render
<Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
```
- Use the shared `Pagination` component from `components/Pagination.js`
- Default page size is 50 for most lists

---

## Naming Conventions

### Backend
- Router files: `{domain}_routes.py`
- Model classes: PascalCase matching table name in singular (`StoreRequestItem`)
- Table names: snake_case plural (`store_request_items`)
- Route functions: snake_case verbs (`get_customers`, `create_purchase_order`)
- Pydantic models: PascalCase with suffix (`LoginRequest`, `ChangePasswordReq`)

### Frontend
- Page files: PascalCase with `Page` suffix (`CustomerProfilePage.js`)
- Component files: PascalCase (`DashboardLayout.js`, `ChatPopup.js`)
- Hook files: camelCase with `use` prefix (`useSales90d.js`)
- API endpoints: kebab-case matching backend routes

---

## In-Progress Feature: Customer Medication Tracking
The `MedicinePurchase` model has `dosage`, `timing`, and `food_relation` columns added via migration. The `CustomerProfilePage.js` needs UI to:
1. Convert Walk-in → RC customer (update `customer_type` field on `CRMCustomer`)
2. Add/edit medication schedules with dosage, timing (morning/lunch/dinner), food relation (before/after), next due date
3. Backend endpoints for this feature are in `crm_routes.py`
