# Technology Stack

## Backend

### Language & Runtime
- Python 3.x
- FastAPI 0.110.1 — async web framework
- Uvicorn 0.25.0 — ASGI server

### Database
- PostgreSQL (hosted on Supabase)
- SQLAlchemy 2.0.48 — async ORM (`asyncpg` driver)
- asyncpg 0.31.0 — async PostgreSQL driver
- psycopg2-binary 2.9.11 — sync fallback driver

### Authentication & Security
- python-jose 3.5.0 — JWT encoding/decoding
- passlib 1.7.4 + bcrypt 4.0.1 — password hashing
- Account lockout after failed attempts, force password change support

### Data Processing
- pandas 3.0.1 — Excel parsing and data manipulation
- openpyxl 3.1.5 — Excel file read/write
- Pillow 12.1.1 — image handling (PO letterhead)

### AI / ML (optional integrations)
- google-generativeai 0.8.6 / google-genai 1.65.0 — Gemini AI
- openai 1.99.9 — OpenAI API
- litellm 1.80.0 — LLM abstraction layer

### Other Backend Libraries
- python-dotenv 1.2.1 — environment variable loading
- aiofiles 25.1.0 — async file I/O
- pydantic 2.12.5 — request/response validation
- boto3 1.42.58 — AWS SDK (S3 for file storage)
- starlette 0.37.2 — ASGI toolkit (CORS, GZip middleware)

### Code Quality
- black 26.1.0 — formatter
- flake8 7.3.0 — linter
- mypy 1.19.1 — type checker
- isort 8.0.0 — import sorter
- pytest 9.0.2 — test runner

## Frontend

### Language & Framework
- JavaScript (ES2020+), React 19.0.0
- react-router-dom 7.5.1 — client-side routing
- CRACO 7.1.0 — Create React App config override

### UI & Styling
- Tailwind CSS 3.4.17 — utility-first CSS
- shadcn/ui component pattern — Radix UI primitives wrapped with Tailwind
- Radix UI — full suite (Dialog, Select, Tabs, Toast, Popover, etc.)
- lucide-react 0.507.0 — icon library
- class-variance-authority + clsx + tailwind-merge — conditional class utilities
- next-themes 0.4.6 — dark/light theme support

### Data & Forms
- axios 1.8.4 — HTTP client
- react-hook-form 7.56.2 + @hookform/resolvers — form state management
- zod 3.24.4 — schema validation
- date-fns 4.1.0 — date utilities
- recharts 3.6.0 — charting library

### Build & Dev Tools
- postcss 8.4.49 + autoprefixer — CSS processing
- yarn 1.22.22 — package manager
- eslint 9.23.0 with react, react-hooks, jsx-a11y, import plugins

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql+asyncpg://...
SECRET_KEY=...
CORS_ORIGINS=http://localhost:3000
```

### Frontend (.env)
```
REACT_APP_BACKEND_URL=http://localhost:8000
```

## Development Commands

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

### Frontend
```bash
cd frontend
yarn install
yarn start          # dev server on port 3000
yarn build          # production build
```

### Testing
```bash
# Backend tests
cd backend
pytest tests/

# Root-level integration tests
python backend_test.py
python comprehensive_backend_test.py
python crm_backend_test.py
```

## Key Versions Summary
| Technology | Version |
|-----------|---------|
| FastAPI | 0.110.1 |
| SQLAlchemy | 2.0.48 |
| React | 19.0.0 |
| Tailwind CSS | 3.4.17 |
| pandas | 3.0.1 |
| pydantic | 2.12.5 |
| axios | 1.8.4 |
