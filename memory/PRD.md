# Sahakar Hyper Pharmacy - Inventory Intelligence Platform PRD

## Original Problem Statement
Enterprise-grade inventory intelligence platform for Sahakar Hyper Pharmacy Network (30+ stores, 50K+ SKUs). Centralized system for cross-store stock visibility, intelligent transfer suggestions, purchase validation, batch-wise inventory tracking, and demand-based redistribution.

## Architecture
- **Backend**: FastAPI + PostgreSQL (SQLAlchemy async + asyncpg)
- **Frontend**: React + Tailwind CSS + Shadcn/UI
- **Auth**: JWT-based with 3 roles (admin, ho_staff, store_staff)
- **Excel Processing**: Pandas + Openpyxl with flexible column mapping
- **Database**: PostgreSQL with indexed tables for products, stores, stock batches, transfers, purchases

## User Personas
1. **Admin**: Full system access - manage users, stores, products, view all reports
2. **HO Staff**: Monitor stock, purchase requests, approve transfers, view batch inventory
3. **Store Staff**: Upload store stock, create purchase/transfer requests

## Core Requirements
- Excel bulk upload for products, HO stock, store stock
- Flexible column mapping (by header name, case-insensitive)
- Unit conversion: tablets to strips (closing_stock / packing)
- Upload history tracking
- Cross-store stock consolidation
- Inter-store transfer workflow (request → approve/reject)
- Purchase request validation against network stock

## What's Been Implemented (Phase 1 - March 2026)
1. JWT Authentication with role-based access (admin, ho_staff, store_staff)
2. Product Master with Excel bulk upload and search/filter
3. Store Master CRUD
4. Head Office Stock Upload (Excel with batch tracking)
5. Store Stock Upload (Excel with unit conversion)
6. Consolidated Stock Report (network-wide view)
7. Inter-Store Transfer System (create, approve, reject)
8. Purchase Request Validation (checks network stock, suggests transfers)
9. User Management (create users with roles)
10. Upload History tracking
11. Admin Dashboard with KPI cards and recent activity

## What's Been Implemented (Phase 2 - March 2026)
12. Inventory Aging Report with bucket summary (0-30, 30-60, 60-90, 90+)
13. Intelligent Inventory Engine - dead stock (60+ days no sales), slow moving (30+ days), excess detection
14. Enhanced Dashboard with 8 KPIs, Dead Stock Alerts, Transfer Recommendations
15. Excel Export for all 8 tables (Products, HO Stock, Store Stock, Consolidated, Transfers, Purchases, Uploads, Aging)
16. RC Customer Management with refill reminders (in-app dashboard)
17. Staff Audit Log tracking all user actions
18. Batch-level detail views per product

## What's Been Implemented (Phase 2.5 - March 2026)
19. Dashboard Charts with Recharts (Aging Distribution BarChart, Stock Distribution PieChart)
20. Role-based data filtering (store_staff sees only their store's transfers, purchases, dashboard stats)
21. Transfer quantity validation (checks source store stock, shows availability indicator, blocks excess transfers)
22. Auto-store selection for store_staff users across all forms

## P0 - Remaining (Phase 3)
- Email notifications (SendGrid/Resend) for transfers, purchases, refill reminders
- SMS notifications via Twilio for RC customers
- Weekly dead stock report emails to store managers
- Advanced reporting with date range filters

## P1 - Enhancements
- Mobile-responsive optimization
- Product edit/delete from UI
- Transfer quantity validation against actual stock
- Role-based data filtering (store staff sees only their store)
- Dashboard charts with Recharts

## P2 - Future
- Demand prediction / AI forecasting
- Auto reorder suggestions
- WhatsApp integration for customer reminders
- Redis caching for high-traffic endpoints
- Celery background workers for large uploads (10K+ rows)
- Barcode/QR scanning integration
