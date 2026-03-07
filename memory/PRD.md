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

## What's Been Implemented (Phase 3 - March 2026)
23. Store Performance Scorecard - ranks stores by composite score (Turnover 40% + Stock Health 30% + Compliance 30%)
24. Per-store radar chart showing 5 dimensions: Turnover, Stock Health, Compliance, Sales Velocity, Freshness
25. Performance Comparison bar chart across all stores
26. Network average KPIs (Avg Score, Avg Turnover, Avg Dead Stock, Avg Compliance)
27. Scorecard Excel export with all metrics

## What's Been Implemented (Phase 4 - CRM System - March 2026)
28. Central CRM Customer Master - unified profiles by mobile number, customer classification (RC/walkin/chronic/high_value)
29. Medicine Purchase Tracking - auto next_due_date calculation, auto RC classification (3 purchases in 90 days)
30. Patient Medicine Calendar - per-customer view of active medicines, due dates, overdue alerts
31. Refill Due Management Dashboard - filterable by category (overdue/today/3d/7d), store, search
32. CRM Calling System - call logging with results (reached/not_reachable/callback/confirmed/discontinued) + remarks
33. Customer Timeline - unified view of purchases + calls + interactions
34. CRM Dashboard - 8 KPIs (customers, RC, due counts, calls, tasks)
35. CRM Task Management - assign follow-ups to staff
36. Store-level access control for CRM data

## What's Been Implemented (Phase 5 - CRM Enhancement - March 2026)
37. Separate CRM Portal Login (/crm-login) with crm_staff role - CRM users only see CRM modules
38. Daily Sales Report Excel Upload - auto-creates/updates customer profiles from pharmacy software export
39. Medication Duration Manual Entry - CRM staff sets days of medication per sale, triggers refill tracking
40. Store Allocation - auto-assign on upload + manual reassignment by CRM manager
41. CRM Performance Reports - call conversion rates, store-wise customer retention, sales import stats
42. Rule-based Adherence Scoring - High (on-time), Medium (5-10d delay), Low (15+d overdue)
43. Bulk Customer Import via sales data upload

## What's Been Implemented (Phase 6 - Intelligence Layer Batch A - March 2026)
44. Unified Intelligence Dashboard - Admin Control Center with 3 sections: Inventory, Customer, Operations (9 clickable widgets)
45. Demand Forecasting Engine - Rule-based using CRM sales (primary) + store stock sales (fallback). Avg daily sales x 30d = reorder qty. Shows urgency (critical/low/normal)
46. Expiry Risk Detection - Optional expiry_date column in stock uploads. Alerts for 30d/60d/90d expiry windows with at-risk value tracking
47. Dead Stock Auto Redistribution Engine - Detects dead stock with demand at other stores, generates transfer recommendations with recoverable value
48. CRM Task Automation - Auto-generates daily CRM call lists from due/overdue medicines. One-click task generation from Intelligence Dashboard

## What's Been Implemented (Phase 7 - Intelligence Layer Batch B - March 2026)
49. Customer Lifetime Value (CLV) - Calculates annual purchase value from SalesRecords. Tiers: High (>=10K), Medium (5-10K), Low (<5K). Auto-upgrades high-value customers
50. Chronic Patient Identification Engine - Auto-detects diabetes/BP/thyroid/cardiac/respiratory/mental_health from medicine patterns (3+ purchases of same chronic medicine in 90 days). Tags visible on customer profiles and CRM dashboard

## What's Been Implemented (Phase 8 - Intelligence Layer Batch C - March 2026)
51. Supplier Intelligence Module - Analyzes suppliers from Product Master: product coverage, avg PTR, avg landing cost. Best supplier per product with margin % calculation
52. Smart Purchase Recommendation Engine - Checks HO stock + all store stock first (recommends transfer if available), then recommends best supplier (lowest PTR) if purchase needed
53. Enhanced Store Performance Dashboard - CLV-per-store metrics: total CLV, avg CLV, high-value customer count, retention %, overdue medicines, sales revenue
54. Database Indexing Optimization - 9 composite indexes added for: sales_records, medicine_purchases, store_stock_batches, crm_customers, inter_store_transfers, ho_stock_batches. Supports 50K+ products, 30+ stores, 100K+ customers

## What's Been Implemented (Phase 9 - Customer Profile Enhancement - March 2026)
55. Walk-in to RC Customer Conversion - one-click conversion from customer profile page
56. Medication Schedule Manager - detailed medication tracking with dosage, timing (morning/lunch/dinner), food relation (before/after/with food)
57. Medication Detail Editing - edit dosage, timing, food relation for any active medicine, auto-recalculates next due date
58. Stop Medicine functionality - deactivate medicines from calendar
59. Enhanced Medicine Calendar - visual indicators for dosage, timing icons (sun/coffee/moon), food relation badges

## P0 - Remaining
- Email notifications (SendGrid/Resend) for transfers, purchases, refill reminders
- SMS notifications via Twilio for RC customers
- Weekly dead stock report emails to store managers
- Advanced reporting with date range filters

## P1 - Enhancements
- Mobile-responsive optimization
- Product edit/delete from UI

## P2 - Future
- AI-powered demand prediction / forecasting (replace rule-based)
- WhatsApp integration for customer reminders
- Redis caching for high-traffic endpoints
- Celery background workers for large uploads (10K+ rows)
- Barcode/QR scanning integration
