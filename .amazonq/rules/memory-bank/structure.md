# Project Structure

## Directory Layout

```
ordermanagement/
├── backend/                    # FastAPI Python backend
│   ├── routers/                # Route handlers grouped by domain
│   │   ├── auth_routes.py      # Login, JWT, user management
│   │   ├── data_routes.py      # Products, stores, stock uploads
│   │   ├── operations_routes.py# Transfers, purchase requests
│   │   ├── crm_routes.py       # CRM customers, sales, call logs
│   │   ├── intelligence_routes.py # Analytics, forecasting, expiry
│   │   ├── po_routes.py        # Purchase Orders
│   │   ├── phase2_routes.py    # Aging, audit logs, advanced features
│   │   ├── recall_routes.py    # Product recalls
│   │   ├── notification_routes.py # In-app notifications
│   │   └── __init__.py
│   ├── tests/                  # Backend pytest test files
│   ├── upload_tmp/             # Temporary Excel upload storage
│   ├── server.py               # FastAPI app entry point, middleware
│   ├── models.py               # SQLAlchemy ORM models
│   ├── database.py             # Async DB engine, session factory
│   ├── auth.py                 # JWT encode/decode, password hashing
│   ├── cache.py                # Server-side caching utilities
│   ├── requirements.txt        # Python dependencies
│   └── .env                    # Backend environment variables
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── pages/              # One file per page/route (~45 pages)
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui component library wrappers
│   │   │   ├── DashboardLayout.js  # Main nav/sidebar shell
│   │   │   ├── ChatPopup.js    # Per-item comment/chat UI
│   │   │   ├── Pagination.js   # Reusable pagination component
│   │   │   ├── NotificationBell.js # Header notification icon
│   │   │   ├── FollowupButton.js   # CRM follow-up action
│   │   │   └── UploadProgress.js   # Excel upload progress indicator
│   │   ├── contexts/
│   │   │   └── AuthContext.js  # Global auth state (user, token, role)
│   │   ├── hooks/
│   │   │   ├── use-toast.js    # Toast notification hook
│   │   │   └── useSales90d.js  # Custom hook for 90-day sales data
│   │   ├── lib/
│   │   │   ├── api.js          # Axios instance, interceptors, cachedGet
│   │   │   ├── uploadHelper.js # Excel upload utilities
│   │   │   └── utils.js        # cn() and shared helpers
│   │   ├── App.js              # Router config, protected routes
│   │   └── index.js            # React entry point
│   ├── public/
│   │   ├── letterhead.jpeg     # PO PDF letterhead image
│   │   └── logo.png
│   ├── package.json            # Dependencies (React 19, Radix UI, Recharts)
│   ├── tailwind.config.js      # Tailwind CSS config
│   ├── craco.config.js         # CRA override config
│   └── postcss.config.js       # PostCSS with Tailwind + Autoprefixer
│
├── tests/                      # Root-level integration tests
├── memory/                     # PRD and project memory docs
├── test_reports/               # JSON test iteration reports
├── .amazonq/rules/memory-bank/ # This memory bank
└── .emergent/                  # Emergent agent config and summary
```

## Core Components & Relationships

### Backend Architecture
- `server.py` bootstraps FastAPI, registers all routers under `/api/*`, and runs startup DB migrations
- `models.py` defines all 25+ SQLAlchemy ORM models — single source of truth for schema
- `database.py` provides async SQLAlchemy engine and `async_session_maker`
- Each router file is a self-contained domain module using `APIRouter`
- Audit middleware in `server.py` automatically logs all write operations

### Frontend Architecture
- `App.js` defines all routes; protected routes check `AuthContext` for role-based access
- `DashboardLayout.js` wraps all authenticated pages with sidebar navigation
- `lib/api.js` is the single Axios instance used by all pages — handles auth headers and 401 redirects
- `components/ui/` contains shadcn/ui primitives (Button, Dialog, Table, etc.)
- Pages are flat files in `src/pages/` — no nested routing subdirectories

### Data Flow
```
Excel Upload → Backend Router → pandas parsing → SQLAlchemy bulk insert → PostgreSQL
Frontend Page → api.js (Axios) → FastAPI Router → SQLAlchemy async session → PostgreSQL
JWT Token → localStorage (pharmacy_token) → Authorization header on every request
```

## Architectural Patterns
- Domain-driven router separation (auth, data, operations, crm, intelligence, po, recall, notifications)
- Async-first backend: all DB operations use `async with async_session_maker()`
- Schema migrations handled inline at startup via raw SQL `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Client-side GET caching in `api.js` with 60-second TTL (`cachedGet`)
- Role-based access enforced both in backend route dependencies and frontend route guards
- Excel as primary data ingestion format for all bulk operations (openpyxl + pandas)
