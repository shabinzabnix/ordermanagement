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

## P0 - Remaining (Phase 2)
- Inventory Aging Report (0-30, 30-60, 60-90, 90+ days)
- RC Customer Management (recurring customers, refill reminders)
- Staff Audit Log (all actions with staff name, timestamp)
- Intelligent Inventory Engine (dead stock detection, transfer suggestions)

## P1 - Enhancements
- Pagination on all list views
- Export to Excel from all tables
- Batch-level detail views
- Advanced search and filtering
- Email notifications for transfers/purchases

## P2 - Future
- Demand prediction / AI forecasting
- Auto reorder suggestions
- Dead stock alerts automation
- Mobile-responsive optimization
- Redis caching for high-traffic endpoints
- Celery background workers for large uploads
