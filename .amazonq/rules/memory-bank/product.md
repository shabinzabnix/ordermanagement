# Product Overview

## Project Name
Sahakar Pharmacy Inventory Intelligence Platform

## Purpose
A comprehensive enterprise-grade platform for managing pharmacy retail network operations. It centralizes inventory, procurement, CRM, and analytics across multiple store locations under a single Head Office umbrella.

## Key Features

### Inventory Management
- Product Master with bulk Excel upload (supplier details, pricing, categories)
- HO and Store stock uploads with batch/expiry tracking and unit conversion (tablets → strips)
- Consolidated network-wide stock report across all locations
- Inter-store transfer system with approval workflow

### Procurement & Purchasing
- Store Request workflow: multi-stage approval (Pending → Approved → Order Placed → Received/Partially Received)
- Per-item status tracking and integrated chat/comment system on requests
- PO Manager: Head Office creates Purchase Orders manually, from Excel, or from approved store requests
- PDF generation with company letterhead for POs

### CRM & Customer Management
- Customer profiles identified by mobile number (Walk-in, RC, Chronic, High Value types)
- Sales Report Excel upload to populate purchase history
- Medicine due tracking and refill management
- Medication schedule manager (dosage, timing, food relation, next due date)
- Walk-in to RC customer conversion

### Intelligence & Analytics
- Unified Intelligence Dashboard with KPIs across inventory, customers, and operations
- Demand Forecasting with reorder suggestions
- Expiry Risk detection and Dead Stock redistribution engine
- Supplier Intelligence, CLV calculation, Chronic Patient identification
- Store-wise scorecards and Top Selling Products

### System Features
- Full Audit Logging via HTTP middleware (all POST/PUT/DELETE)
- Service-based access control: Admins assign specific modules per user
- Notifications system
- Product Recall management

## Target Users
| Role | Access |
|------|--------|
| Admin | Full system access, user management, store setup |
| HO Staff | Stock uploads, PO management, transfer approvals |
| Store Manager | Store stock, requests, transfers |
| Store Staff | Store-level operations |
| CRM Staff | Customer profiles, sales uploads, refill management |
| Director | Read-only analytics and intelligence dashboards |

## Use Cases
- Pharmacy retail chain managing 5–50+ store locations
- Head Office coordinating procurement and stock redistribution
- CRM team managing chronic patient medication adherence and refill reminders
- Directors monitoring network-wide performance and intelligence insights
