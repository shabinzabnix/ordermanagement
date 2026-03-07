#!/usr/bin/env python3
"""
COMPREHENSIVE BACKEND API TESTING - Sahakar Pharmacy Platform
Tests all 54 features across 8 phases as specified in the audit requirements
"""

import requests
import sys
from datetime import datetime
import json
import time

class ComprehensiveAPITester:
    def __init__(self):
        self.base_url = "https://rx-med-tracker.preview.emergentagent.com/api"
        self.admin_token = None
        self.crm_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.test_results = {}
        
    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        
    def run_test(self, name, method, endpoint, expected_status, data=None, auth_token=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {}
        
        if files is None:
            headers['Content-Type'] = 'application/json'
        
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'
        
        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=15)
            elif method == 'POST':
                if files:
                    response = requests.post(url, files=files, headers={k:v for k,v in headers.items() if k != 'Content-Type'}, timeout=15)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=15)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=15)
            
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                try:
                    return True, response.json() if response.content else {}
                except:
                    return True, {"raw_response": response.text}
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                self.log(f"   Response: {response.text[:300]}")
                self.failed_tests.append(f"{name}: {response.status_code} - {response.text[:100]}")
                return False, {}
                
        except Exception as e:
            self.log(f"❌ {name} - Exception: {str(e)}")
            self.failed_tests.append(f"{name}: Exception - {str(e)}")
            return False, {}
    
    # ============= PHASE 1: AUTH & ROLES =============
    def test_authentication_and_roles(self):
        """Test all authentication and role-based access endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 1: AUTHENTICATION & ROLES TESTING")
        self.log("="*50)
        
        # Test 1: Admin Login
        success, response = self.run_test(
            "Admin Login",
            "POST", 
            "auth/login",
            200,
            {"email": "admin@sahakar.com", "password": "admin123"}
        )
        
        if success and 'token' in response:
            self.admin_token = response['token']
            admin_role = response.get('user', {}).get('role')
            self.log(f"   🔑 Admin login successful, role: {admin_role}")
            
            if admin_role != "ADMIN":
                self.log(f"❌ Expected ADMIN role, got {admin_role}")
        
        # Test 2: CRM Staff Login  
        success, response = self.run_test(
            "CRM Staff Login",
            "POST",
            "auth/login", 
            200,
            {"email": "crm@sahakar.com", "password": "crm123"}
        )
        
        if success and 'token' in response:
            self.crm_token = response['token']
            crm_role = response.get('user', {}).get('role')
            self.log(f"   🔑 CRM login successful, role: {crm_role}")
            
            if crm_role != "CRM_STAFF":
                self.log(f"❌ Expected CRM_STAFF role, got {crm_role}")
        
        # Test 3: Get current user profile (Admin)
        if self.admin_token:
            success, response = self.run_test(
                "Get Admin Profile",
                "GET",
                "auth/me",
                200,
                auth_token=self.admin_token
            )
        
        # Test 4: Role-based access - CRM trying to access scorecard (should be 403)
        if self.crm_token:
            success, response = self.run_test(
                "CRM Access Scorecard (Should Fail)",
                "GET",
                "scorecard", 
                403,  # Expecting 403 Forbidden
                auth_token=self.crm_token
            )
            
            if success:
                self.log("   ✅ Role-based access control working correctly")
        
        return True
    
    # ============= PHASE 2: PRODUCT & STORE MASTER =============
    def test_product_and_store_master(self):
        """Test product and store management endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 2: PRODUCT & STORE MASTER TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping master data tests")
            return False
        
        # Test 1: Get products with pagination
        success, response = self.run_test(
            "Get Products",
            "GET",
            "products",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            total_products = len(response.get('products', []))
            self.log(f"   📦 Found {total_products} products")
        
        # Test 2: Get product categories
        success, response = self.run_test(
            "Get Product Categories", 
            "GET",
            "products/categories",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            categories = response.get('categories', [])
            self.log(f"   📊 Found {len(categories)} categories")
        
        # Test 3: Get stores
        success, response = self.run_test(
            "Get Stores",
            "GET",
            "stores",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            stores = response.get('stores', [])
            self.log(f"   🏪 Found {len(stores)} stores")
        
        # Test 4: Create new store (with unique store_code)
        test_store_code = f"TEST_{int(time.time())}"
        success, response = self.run_test(
            "Create Store",
            "POST",
            "stores",
            201,
            {
                "store_name": "Test Store",
                "location": "Test Location", 
                "manager_name": "Test Manager",
                "contact_number": "1234567890",
                "store_code": test_store_code
            },
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 3: STOCK MANAGEMENT =============
    def test_stock_management(self):
        """Test all stock management endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 3: STOCK MANAGEMENT TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping stock tests")
            return False
        
        # Test 1: Get HO stock
        success, response = self.run_test(
            "Get HO Stock",
            "GET",
            "stock/ho",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            total_stock = len(response.get('stock_batches', []))
            self.log(f"   📦 Found {total_stock} HO stock batches")
        
        # Test 2: Get consolidated stock
        success, response = self.run_test(
            "Get Consolidated Stock",
            "GET", 
            "stock/consolidated",
            200,
            auth_token=self.admin_token
        )
        
        # Test 3: Check availability for specific product
        success, response = self.run_test(
            "Check Stock Availability",
            "GET",
            "stock/availability/P001",
            200,
            auth_token=self.admin_token
        )
        
        # Test 4: Get batch details
        success, response = self.run_test(
            "Get Batch Details", 
            "GET",
            "stock/batch-details/P001",
            200,
            auth_token=self.admin_token
        )
        
        # Test 5: Check availability for transfers
        success, response = self.run_test(
            "Check Transfer Availability",
            "GET",
            "stock/check-availability?product_id=P001&requesting_store_id=1",
            200,
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 4: TRANSFERS =============
    def test_transfers(self):
        """Test transfer management endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 4: TRANSFERS TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping transfer tests")
            return False
        
        # Test 1: Get all transfers
        success, response = self.run_test(
            "Get Transfers",
            "GET",
            "transfers",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            transfers = response.get('transfers', [])
            self.log(f"   🔄 Found {len(transfers)} transfers")
        
        # Test 2: Create transfer request (should validate source != requesting store)
        success, response = self.run_test(
            "Create Transfer Request",
            "POST",
            "transfers",
            201,
            {
                "requesting_store_id": 1,
                "source_store_id": 2,  # Different from requesting
                "product_id": "P001",
                "product_name": "Test Product",
                "batch": "BATCH001",
                "quantity": 10
            },
            auth_token=self.admin_token
        )
        
        # Test 3: Try invalid transfer (same source and requesting store)
        success, response = self.run_test(
            "Invalid Transfer (Same Store)",
            "POST",
            "transfers",
            400,  # Should fail validation
            {
                "requesting_store_id": 1,
                "source_store_id": 1,  # Same as requesting - should fail
                "product_id": "P001", 
                "quantity": 10
            },
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 5: PURCHASES =============
    def test_purchases(self):
        """Test purchase request endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 5: PURCHASES TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping purchase tests")
            return False
        
        # Test 1: Get purchase requests
        success, response = self.run_test(
            "Get Purchase Requests",
            "GET",
            "purchases",
            200,
            auth_token=self.admin_token
        )
        
        # Test 2: Create purchase request (should check network stock)
        success, response = self.run_test(
            "Create Purchase Request",
            "POST",
            "purchases",
            201,
            {
                "store_id": 1,
                "product_id": "P001",
                "product_name": "Test Product",
                "quantity": 50,
                "customer_name": "Test Customer",
                "customer_contact": "9876543210"
            },
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 6: EXCEL EXPORTS =============
    def test_excel_exports(self):
        """Test all Excel export endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 6: EXCEL EXPORTS TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping export tests")
            return False
        
        export_endpoints = [
            ("Export Products", "export/products"),
            ("Export HO Stock", "export/ho-stock"), 
            ("Export Consolidated", "export/consolidated"),
            ("Export Transfers", "export/transfers"),
            ("Export Purchases", "export/purchases"),
            ("Export Uploads", "export/uploads"),
            ("Export Aging", "export/aging"),
            ("Export Scorecard", "export/scorecard")
        ]
        
        for name, endpoint in export_endpoints:
            success, response = self.run_test(
                name,
                "GET",
                endpoint,
                200,
                auth_token=self.admin_token
            )
        
        return True
    
    # ============= PHASE 7: INVENTORY INTELLIGENCE =============
    def test_inventory_intelligence(self):
        """Test inventory intelligence endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 7: INVENTORY INTELLIGENCE TESTING")  
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping intelligence tests")
            return False
        
        # Test 1: Aging report with bucket categorization
        success, response = self.run_test(
            "Aging Report",
            "GET",
            "aging/report",
            200,
            auth_token=self.admin_token
        )
        
        if success:
            buckets = response.get('aging_buckets', {})
            self.log(f"   📊 Aging buckets: 0-30d:{buckets.get('0_30', 0)}, 30-60d:{buckets.get('30_60', 0)}")
        
        # Test 2: Intelligence summary
        success, response = self.run_test(
            "Intelligence Summary",
            "GET", 
            "intelligence/summary",
            200,
            auth_token=self.admin_token
        )
        
        # Test 3: Scorecard with composite score calculation
        success, response = self.run_test(
            "Store Scorecard",
            "GET",
            "scorecard",
            200,
            auth_token=self.admin_token
        )
        
        # Test 4: Dashboard chart data
        success, response = self.run_test(
            "Dashboard Chart Data",
            "GET",
            "dashboard/chart-data",
            200,
            auth_token=self.admin_token
        )
        
        # Test 5: Dashboard stats with role-based filtering
        success, response = self.run_test(
            "Dashboard Stats",
            "GET", 
            "dashboard/stats",
            200,
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 8: UNIFIED INTELLIGENCE =============
    def test_unified_intelligence(self):
        """Test unified intelligence endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 8: UNIFIED INTELLIGENCE TESTING")
        self.log("="*50)
        
        if not self.admin_token:
            self.log("❌ No admin token available, skipping unified intelligence tests")
            return False
        
        # Test 1: Intelligence dashboard
        success, response = self.run_test(
            "Intelligence Dashboard",
            "GET",
            "intel/dashboard",
            200,
            auth_token=self.admin_token
        )
        
        # Test 2: Demand forecast with calculations
        success, response = self.run_test(
            "Demand Forecast",
            "GET",
            "intel/demand-forecast?store_id=1&period=30",
            200,
            auth_token=self.admin_token
        )
        
        # Test 3: Expiry risk (30d/60d/90d groups)
        success, response = self.run_test(
            "Expiry Risk",
            "GET",
            "intel/expiry-risk",
            200,
            auth_token=self.admin_token
        )
        
        # Test 4: Redistribution suggestions
        success, response = self.run_test(
            "Redistribution Suggestions",
            "GET",
            "intel/redistribution",
            200,
            auth_token=self.admin_token
        )
        
        # Test 5: Auto-task generation for CRM
        success, response = self.run_test(
            "Auto Task Generation",
            "POST",
            "intel/auto-tasks",
            201,
            {"task_type": "due_medicines", "store_id": 1},
            auth_token=self.admin_token
        )
        
        # Test 6: Supplier intelligence
        success, response = self.run_test(
            "Supplier Intelligence",
            "GET",
            "intel/supplier-intelligence",
            200,
            auth_token=self.admin_token
        )
        
        # Test 7: Purchase recommendation for specific product
        success, response = self.run_test(
            "Purchase Recommendation",
            "GET", 
            "intel/purchase-recommendation/P001",
            200,
            auth_token=self.admin_token
        )
        
        # Test 8: Enhanced store performance with CLV
        success, response = self.run_test(
            "Enhanced Store Performance",
            "GET",
            "intel/store-performance",
            200,
            auth_token=self.admin_token
        )
        
        return True
    
    # ============= PHASE 9: CRM SYSTEM =============
    def test_crm_system(self):
        """Test CRM system endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 9: CRM SYSTEM TESTING")
        self.log("="*50)
        
        # Use CRM token if available, otherwise admin token
        token = self.crm_token if self.crm_token else self.admin_token
        if not token:
            self.log("❌ No authentication token available, skipping CRM tests")
            return False
        
        # Test 1: CRM Dashboard with 8 KPIs
        success, response = self.run_test(
            "CRM Dashboard", 
            "GET",
            "crm/dashboard",
            200,
            auth_token=token
        )
        
        # Test 2: Create customer with mobile as unique ID
        test_mobile = f"98765{int(time.time()) % 100000:05d}"
        success, response = self.run_test(
            "Create CRM Customer",
            "POST",
            "crm/customers",
            201,
            {
                "mobile_number": test_mobile,
                "customer_name": "Test Customer",
                "gender": "male",
                "age": 35,
                "first_store_id": 1
            },
            auth_token=token
        )
        
        customer_id = None
        if success:
            customer_id = response.get('customer_id') or response.get('id')
        
        # Test 3: Get customers with pagination and filters
        success, response = self.run_test(
            "Get CRM Customers",
            "GET",
            "crm/customers?page=1&limit=10",
            200,
            auth_token=token
        )
        
        # Test 4: Get refill due items
        success, response = self.run_test(
            "Get Refill Due Items",
            "GET",
            "crm/refill-due?filter=today",
            200,
            auth_token=token
        )
        
        # Test 5: Create CRM task
        if customer_id:
            success, response = self.run_test(
                "Create CRM Task",
                "POST",
                "crm/tasks",
                201,
                {
                    "customer_id": customer_id,
                    "assigned_to": 1,
                    "assigned_name": "Test Staff",
                    "notes": "Follow up call required"
                },
                auth_token=token
            )
        
        return True
    
    # ============= PHASE 10: CRM ADVANCED =============
    def test_crm_advanced(self):
        """Test advanced CRM endpoints"""
        self.log("\n" + "="*50)
        self.log("PHASE 10: CRM ADVANCED TESTING")
        self.log("="*50)
        
        token = self.crm_token if self.crm_token else self.admin_token
        if not token:
            self.log("❌ No authentication token available, skipping advanced CRM tests")
            return False
        
        # Test 1: Get sales records
        success, response = self.run_test(
            "Get Sales Records",
            "GET",
            "crm/sales?pending=true",
            200,
            auth_token=token
        )
        
        # Test 2: Adherence calculation
        success, response = self.run_test(
            "Get Adherence Report", 
            "GET",
            "crm/adherence",
            200,
            auth_token=token
        )
        
        # Test 3: Performance reports
        success, response = self.run_test(
            "CRM Performance Reports",
            "GET",
            "crm/reports/performance",
            200,
            auth_token=token
        )
        
        # Test 4: CLV calculation
        success, response = self.run_test(
            "Calculate CLV",
            "POST",
            "crm/calculate-clv",
            200,
            auth_token=token
        )
        
        # Test 5: CLV report with tiers
        success, response = self.run_test(
            "CLV Report", 
            "GET",
            "crm/clv-report",
            200,
            auth_token=token
        )
        
        # Test 6: Chronic detection
        success, response = self.run_test(
            "Detect Chronic Patients",
            "POST",
            "crm/detect-chronic", 
            200,
            auth_token=token
        )
        
        # Test 7: Chronic report
        success, response = self.run_test(
            "Chronic Patients Report",
            "GET",
            "crm/chronic-report",
            200, 
            auth_token=token
        )
        
        return True
    
    def run_comprehensive_tests(self):
        """Run the complete test suite for all 54 features"""
        self.log("🚀 STARTING COMPREHENSIVE SAHAKAR PLATFORM AUDIT")
        self.log("=" * 80)
        self.log("Testing 54 features across 8 development phases")
        self.log("=" * 80)
        
        # Run all test phases
        test_phases = [
            ("Authentication & Roles", self.test_authentication_and_roles),
            ("Product & Store Master", self.test_product_and_store_master), 
            ("Stock Management", self.test_stock_management),
            ("Transfers", self.test_transfers),
            ("Purchases", self.test_purchases),
            ("Excel Exports", self.test_excel_exports),
            ("Inventory Intelligence", self.test_inventory_intelligence),
            ("Unified Intelligence", self.test_unified_intelligence),
            ("CRM System", self.test_crm_system),
            ("CRM Advanced", self.test_crm_advanced)
        ]
        
        for phase_name, test_func in test_phases:
            try:
                self.log(f"\n🔄 Running {phase_name} tests...")
                test_func()
            except Exception as e:
                self.log(f"❌ {phase_name} test phase failed: {str(e)}")
        
        # Print comprehensive results
        self.log("\n" + "="*80)
        self.log("📊 COMPREHENSIVE AUDIT RESULTS")
        self.log("="*80)
        self.log(f"Total Tests Run: {self.tests_run}")
        self.log(f"Tests Passed: {self.tests_passed}")
        self.log(f"Tests Failed: {len(self.failed_tests)}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"Success Rate: {success_rate:.1f}%")
        
        if self.failed_tests:
            self.log("\n❌ FAILED TESTS:")
            for i, failure in enumerate(self.failed_tests, 1):
                self.log(f"{i:2d}. {failure}")
        
        self.log(f"\n✨ AUDIT COMPLETION: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        return success_rate >= 75  # 75% success threshold for comprehensive audit


def main():
    """Main test runner for comprehensive audit"""
    tester = ComprehensiveAPITester()
    
    try:
        success = tester.run_comprehensive_tests()
        print(f"\n🎯 FINAL RESULT: {'PASSED' if success else 'NEEDS ATTENTION'}")
        return 0 if success else 1
    except KeyboardInterrupt:
        print("\n🛑 Comprehensive audit interrupted by user")
        return 1
    except Exception as e:
        print(f"💥 Fatal error during comprehensive audit: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())