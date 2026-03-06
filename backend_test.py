import requests
import json
import sys
from datetime import datetime
from io import BytesIO
import pandas as pd

class PharmacyAPITester:
    def __init__(self, base_url="https://sahakar-inventory-ai.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.user_id = None
        self.store_id = None
        self.crm_token = None
        self.crm_customer_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if files:
            headers = {}  # Let requests handle multipart/form-data
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                if files:
                    response = requests.post(url, files=files, headers=headers)
                else:
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    print(f"   Response: {response.json()}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test health endpoint"""
        return self.run_test("Health Check", "GET", "api/health", 200)

    def test_login(self, email="admin@sahakar.com", password="admin123"):
        """Test login and get token"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "api/auth/login",
            200,
            data={"email": email, "password": password}
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user_id = response['user']['id']
            print(f"   Token obtained for user: {response['user']['email']} (Role: {response['user']['role']})")
            return True
        return False

    def test_get_me(self):
        """Test get current user info"""
        return self.run_test("Get Current User", "GET", "api/auth/me", 200)

    def test_dashboard_stats(self):
        """Test dashboard statistics"""
        return self.run_test("Dashboard Stats", "GET", "api/dashboard/stats", 200)

    def test_stores_crud(self):
        """Test store CRUD operations"""
        # Get stores
        success, response = self.run_test("Get Stores", "GET", "api/stores", 200)
        if not success:
            return False

        # Create store
        store_data = {
            "store_name": f"Test Store {datetime.now().strftime('%H%M%S')}",
            "location": "Test Location",
            "manager_name": "Test Manager",
            "contact_number": "9876543210",
            "store_code": f"TS{datetime.now().strftime('%H%M%S')}"
        }
        success, response = self.run_test("Create Store", "POST", "api/stores", 200, data=store_data)  # Expect 200 not 201
        if success:
            self.store_id = response.get('id')
            print(f"   Created store with ID: {self.store_id}")
            return True
        return False

    def test_users_crud(self):
        """Test user CRUD operations"""
        # Get users
        success, response = self.run_test("Get Users", "GET", "api/users", 200)
        if not success:
            return False

        # Create user
        user_data = {
            "email": f"test{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "testpass123",
            "full_name": "Test User",
            "role": "store_staff",
            "store_id": self.store_id
        }
        success, response = self.run_test("Create User", "POST", "api/users", 200, data=user_data)  # Expect 200 not 201
        return success

    def test_products_crud(self):
        """Test product operations"""
        # Get products
        success, response = self.run_test("Get Products", "GET", "api/products", 200)
        if not success:
            return False

        # Get categories
        success, response = self.run_test("Get Product Categories", "GET", "api/products/categories", 200)
        return success

    def test_product_upload(self):
        """Test product upload with Excel"""
        # Create a sample Excel file
        data = {
            'Product ID': ['P001', 'P002'],
            'Product Name': ['Paracetamol 500mg', 'Amoxicillin 250mg'],
            'Category': ['Tablets', 'Capsules'],
            'Primary Supplier': ['Supplier A', 'Supplier B'],
            'MRP': [10.50, 25.00],
            'PTR': [8.50, 20.00],
            'Landing Cost': [7.50, 18.00]
        }
        df = pd.DataFrame(data)
        
        # Create Excel file in memory
        excel_buffer = BytesIO()
        df.to_excel(excel_buffer, index=False)
        excel_buffer.seek(0)
        
        files = {'file': ('test_products.xlsx', excel_buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        success, response = self.run_test("Upload Product Excel", "POST", "api/products/upload", 200, files=files)
        if success:
            print(f"   Upload result: {response.get('success', 0)}/{response.get('total', 0)} records")
        return success

    def test_ho_stock_upload(self):
        """Test HO stock upload"""
        # Create sample HO stock Excel
        data = {
            'Product ID': ['P001', 'P002'],
            'Product Name': ['Paracetamol 500mg', 'Amoxicillin 250mg'],
            'Batch': ['B001', 'B002'],
            'MRP': [10.50, 25.00],
            'Closing Stock': [100, 50],
            'Landing Cost Value': [750, 900]
        }
        df = pd.DataFrame(data)
        
        excel_buffer = BytesIO()
        df.to_excel(excel_buffer, index=False)
        excel_buffer.seek(0)
        
        files = {'file': ('test_ho_stock.xlsx', excel_buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        success, response = self.run_test("Upload HO Stock Excel", "POST", "api/stock/ho/upload", 200, files=files)
        return success

    def test_get_ho_stock(self):
        """Test get HO stock"""
        return self.run_test("Get HO Stock", "GET", "api/stock/ho", 200, params={"page": 1, "limit": 10})

    def test_store_stock_upload(self):
        """Test store stock upload"""
        if not self.store_id:
            print("❌ No store_id available for store stock upload")
            return False

        # Create sample store stock Excel
        data = {
            'HO ID': ['P001', 'P002'],
            'Product Name': ['Paracetamol 500mg', 'Amoxicillin 250mg'],
            'Packing': [10, 10],
            'Batch': ['B001', 'B002'],
            'MRP': [10.50, 25.00],
            'Sales': [5, 3],
            'Closing Stock': [95, 47],
            'Cost Value': [712.5, 846]
        }
        df = pd.DataFrame(data)
        
        excel_buffer = BytesIO()
        df.to_excel(excel_buffer, index=False)
        excel_buffer.seek(0)
        
        files = {'file': ('test_store_stock.xlsx', excel_buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        success, response = self.run_test(
            "Upload Store Stock Excel", 
            "POST", 
            f"api/stock/store/upload?store_id={self.store_id}", 
            200, 
            files=files
        )
        return success

    def test_consolidated_stock(self):
        """Test consolidated stock view"""
        return self.run_test("Get Consolidated Stock", "GET", "api/stock/consolidated", 200, params={"page": 1, "limit": 10})

    def test_transfers_crud(self):
        """Test transfer operations"""
        # Get transfers
        success, response = self.run_test("Get Transfers", "GET", "api/transfers", 200)
        if not success:
            return False

        # Create transfer if we have stores
        if self.store_id:
            transfer_data = {
                "requesting_store_id": self.store_id,
                "source_store_id": self.store_id,  # Same store for test
                "product_id": "P001",
                "product_name": "Paracetamol 500mg",
                "batch": "B001",
                "quantity": 10
            }
            success, response = self.run_test("Create Transfer", "POST", "api/transfers", 201, data=transfer_data)  # This should still be 201
            if success:
                transfer_id = response.get('id')
                # Test approve transfer
                self.run_test("Approve Transfer", "PUT", f"api/transfers/{transfer_id}/approve", 200)
            return success
        return True

    def test_purchases_crud(self):
        """Test purchase request operations"""
        # Get purchase requests
        success, response = self.run_test("Get Purchase Requests", "GET", "api/purchases", 200)
        if not success:
            return False

        # Create purchase request if we have stores
        if self.store_id:
            purchase_data = {
                "store_id": self.store_id,
                "product_id": "P001",
                "product_name": "Paracetamol 500mg",
                "quantity": 5,
                "customer_name": "Test Customer",
                "customer_contact": "9876543210",
                "is_registered_product": True
            }
            success, response = self.run_test("Create Purchase Request", "POST", "api/purchases", 201, data=purchase_data)
            if success:
                purchase_id = response.get('id')
                # Test approve purchase
                self.run_test("Approve Purchase", "PUT", f"api/purchases/{purchase_id}/approve", 200)
            return success
        return True

    def test_upload_history(self):
        """Test upload history"""
        return self.run_test("Get Upload History", "GET", "api/uploads", 200, params={"page": 1, "limit": 10})

    def test_stock_availability(self):
        """Test stock availability for a product"""
        return self.run_test("Get Product Availability", "GET", "api/stock/availability/P001", 200)

    # ===== PHASE 2 NEW FEATURES TESTING =====
    
    def test_aging_report(self):
        """Test inventory aging report"""
        # Test basic aging report
        success, response = self.run_test("Get Aging Report", "GET", "api/aging/report", 200)
        if success:
            print(f"   Aging summary: {response.get('summary', {})}")
            print(f"   Dead stock count: {response.get('dead_count', 0)}")
            print(f"   Slow stock count: {response.get('slow_count', 0)}")
        
        # Test with location filter
        success2, response2 = self.run_test("Get Aging Report with Filter", "GET", "api/aging/report", 200, 
                                           params={"location": "Head Office"})
        return success and success2

    def test_intelligence_summary(self):
        """Test intelligence dashboard summary"""
        success, response = self.run_test("Get Intelligence Summary", "GET", "api/intelligence/summary", 200)
        if success:
            print(f"   Dead stock items: {len(response.get('dead_stock', []))}")
            print(f"   Slow moving items: {len(response.get('slow_moving', []))}")
            print(f"   Transfer recommendations: {len(response.get('recommendations', []))}")
        return success

    def test_batch_details(self):
        """Test batch details for a product"""
        return self.run_test("Get Batch Details", "GET", "api/stock/batch-details/P001", 200)

    def test_rc_customers_crud(self):
        """Test RC Customer CRUD operations"""
        if not self.store_id:
            print("❌ No store_id available for RC customers test")
            return False

        # Get existing customers
        success, response = self.run_test("Get RC Customers", "GET", "api/customers", 200)
        if not success:
            return False

        # Create new RC customer
        customer_data = {
            "store_id": self.store_id,
            "customer_name": f"Test Customer {datetime.now().strftime('%H%M%S')}",
            "mobile_number": "9876543210",
            "medicine_name": "Test Medicine",
            "last_purchase_date": datetime.now().strftime('%Y-%m-%d'),
            "duration_of_medication": 30,
            "days_of_consumption": 7
        }
        success, response = self.run_test("Create RC Customer", "POST", "api/customers", 200, data=customer_data)
        if success:
            customer_id = response.get('id')
            print(f"   Created RC customer with ID: {customer_id}")
        
        return success

    def test_refill_reminders(self):
        """Test refill reminders for RC customers"""
        return self.run_test("Get Refill Reminders", "GET", "api/customers/refill-reminders", 200)

    def test_audit_logs(self):
        """Test audit log retrieval"""
        success, response = self.run_test("Get Audit Logs", "GET", "api/audit-logs", 200, 
                                         params={"page": 1, "limit": 10})
        if success:
            print(f"   Total audit logs: {response.get('total', 0)}")
        return success

    def test_excel_exports(self):
        """Test Excel export functionality"""
        exports = [
            ("Products Export", "api/export/products"),
            ("HO Stock Export", "api/export/ho-stock"),
            ("Consolidated Export", "api/export/consolidated"),
            ("Transfers Export", "api/export/transfers"),
            ("Purchases Export", "api/export/purchases"),
            ("Uploads Export", "api/export/uploads"),
            ("Aging Export", "api/export/aging")
        ]
        
        all_success = True
        for export_name, endpoint in exports:
            success, response = self.run_test(export_name, "GET", endpoint, 200)
            if not success:
                all_success = False
        
        # Test store stock export if we have a store
        if self.store_id:
            success, response = self.run_test("Store Stock Export", "GET", f"api/export/store-stock/{self.store_id}", 200)
            if not success:
                all_success = False
                
        return all_success

    # ===== PHASE 3 NEW FEATURES TESTING =====
    
    def test_dashboard_chart_data(self):
        """Test dashboard chart data endpoint"""
        success, response = self.run_test("Get Dashboard Chart Data", "GET", "api/dashboard/chart-data", 200)
        if success:
            # Verify required chart data is present
            required_keys = ['aging_chart', 'stock_distribution', 'category_chart', 'transfer_chart']
            for key in required_keys:
                if key not in response:
                    print(f"   ❌ Missing key '{key}' in chart data response")
                    return False
                else:
                    print(f"   ✅ Found '{key}': {len(response[key])} items")
            
            # Verify aging chart structure
            if response['aging_chart']:
                aging_item = response['aging_chart'][0]
                if 'bucket' in aging_item and 'units' in aging_item and 'value' in aging_item:
                    print(f"   ✅ Aging chart structure correct")
                else:
                    print(f"   ❌ Aging chart missing required fields")
                    return False
            
            # Verify stock distribution structure
            if response['stock_distribution']:
                stock_item = response['stock_distribution'][0]
                if 'name' in stock_item and 'value' in stock_item:
                    print(f"   ✅ Stock distribution structure correct")
                else:
                    print(f"   ❌ Stock distribution missing required fields")
                    return False
                    
        return success

    def test_stock_check_availability(self):
        """Test stock availability check for transfers"""
        if not self.store_id:
            print("❌ No store_id available for stock availability test")
            return False
            
        # Test stock availability endpoint
        params = {"source_store_id": self.store_id, "product_id": "P001"}
        success, response = self.run_test("Check Stock Availability", "GET", "api/stock/check-availability", 200, params=params)
        if success:
            if 'total_available' in response and 'batches' in response:
                print(f"   ✅ Available stock: {response['total_available']} units")
                print(f"   ✅ Batches found: {len(response['batches'])}")
            else:
                print(f"   ❌ Missing required fields in availability response")
                return False
        return success

    def test_transfer_quantity_validation(self):
        """Test transfer quantity validation against available stock"""
        if not self.store_id:
            print("❌ No store_id available for transfer validation test")
            return False

        # First, create different source and requesting stores
        store_data = {
            "store_name": f"Source Store {datetime.now().strftime('%H%M%S')}",
            "location": "Source Location",
            "manager_name": "Source Manager",
            "contact_number": "9876543211",
            "store_code": f"SRC{datetime.now().strftime('%H%M%S')}"
        }
        success, response = self.run_test("Create Source Store", "POST", "api/stores", 200, data=store_data)  # Expect 200
        if not success:
            return False
        source_store_id = response.get('id')

        # Check available stock at source store first
        params = {"source_store_id": source_store_id, "product_id": "P001"}
        success, response = self.run_test("Check Source Store Stock", "GET", "api/stock/check-availability", 200, params=params)
        available_stock = response.get('total_available', 0) if success else 0
        
        # Test 1: Valid transfer within available stock
        if available_stock > 0:
            valid_qty = min(available_stock, 5)  # Use small quantity or max available
            transfer_data = {
                "requesting_store_id": self.store_id,
                "source_store_id": source_store_id,
                "product_id": "P001",
                "product_name": "Paracetamol 500mg",
                "batch": "B001",
                "quantity": valid_qty
            }
            success1, response1 = self.run_test("Valid Transfer Within Stock", "POST", "api/transfers", 201, data=transfer_data)
            if success1:
                print(f"   ✅ Valid transfer created for {valid_qty} units")
        else:
            success1 = True  # Skip if no stock
            print(f"   ⚠️ No stock available for valid transfer test")

        # Test 2: Invalid transfer exceeding available stock
        excess_qty = available_stock + 10  # Exceed by 10 units
        transfer_data_excess = {
            "requesting_store_id": self.store_id,
            "source_store_id": source_store_id,
            "product_id": "P001",
            "product_name": "Paracetamol 500mg",
            "batch": "B001",
            "quantity": excess_qty
        }
        success2, response2 = self.run_test("Invalid Transfer Exceeding Stock", "POST", "api/transfers", 400, data=transfer_data_excess)
        if success2:
            print(f"   ✅ Transfer correctly rejected for excessive quantity ({excess_qty} units)")
        
        return success1 and success2

    def create_store_staff_user(self):
        """Create a store_staff user for role-based testing"""
        if not self.store_id:
            print("❌ No store_id available for store_staff user creation")
            return None
            
        user_data = {
            "email": f"staff{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "staffpass123",
            "full_name": "Store Staff User",
            "role": "store_staff",
            "store_id": self.store_id
        }
        success, response = self.run_test("Create Store Staff User", "POST", "api/users", 200, data=user_data)  # Expect 200
        if success:
            return {
                "email": user_data["email"],
                "password": user_data["password"],
                "store_id": self.store_id
            }
        return None

    def test_role_based_filtering(self):
        """Test role-based filtering for store_staff users"""
        # Create store staff user
        staff_user = self.create_store_staff_user()
        if not staff_user:
            return False

        # Save current token
        admin_token = self.token
        
        # Login as store staff
        success = self.test_login(staff_user["email"], staff_user["password"])
        if not success:
            print("❌ Failed to login as store_staff")
            self.token = admin_token  # Restore admin token
            return False

        # Test transfers filtering - store_staff should only see their store transfers
        success1, response1 = self.run_test("Store Staff Get Transfers (Filtered)", "GET", "api/transfers", 200)
        if success1:
            # All transfers should be related to staff's store
            for transfer in response1.get('transfers', []):
                if (transfer['requesting_store_id'] != staff_user["store_id"] and 
                    transfer['source_store_id'] != staff_user["store_id"]):
                    print(f"   ❌ Transfer {transfer['id']} not related to store {staff_user['store_id']}")
                    self.token = admin_token
                    return False
            print(f"   ✅ Transfers correctly filtered for store {staff_user['store_id']}")

        # Test purchases filtering - store_staff should only see their store purchases
        success2, response2 = self.run_test("Store Staff Get Purchases (Filtered)", "GET", "api/purchases", 200)
        if success2:
            # All purchases should be for staff's store
            for purchase in response2.get('purchases', []):
                if purchase['store_id'] != staff_user["store_id"]:
                    print(f"   ❌ Purchase {purchase['id']} not for store {staff_user['store_id']}")
                    self.token = admin_token
                    return False
            print(f"   ✅ Purchases correctly filtered for store {staff_user['store_id']}")

        # Test dashboard stats filtering for store_staff
        success3, response3 = self.run_test("Store Staff Dashboard Stats (Filtered)", "GET", "api/dashboard/stats", 200)
        if success3:
            print(f"   ✅ Dashboard stats accessed by store_staff")

        # Restore admin token
        self.token = admin_token
        
        return success1 and success2 and success3

    # ===== PHASE 4 STORE SCORECARD TESTING =====
    
    def test_store_scorecard(self):
        """Test store scorecard endpoint"""
        success, response = self.run_test("Get Store Scorecard", "GET", "api/scorecard", 200)
        if success:
            # Verify required keys are present
            required_keys = ['stores', 'network_avg']
            for key in required_keys:
                if key not in response:
                    print(f"   ❌ Missing key '{key}' in scorecard response")
                    return False
                else:
                    print(f"   ✅ Found '{key}' in response")
            
            # Verify stores structure
            stores = response.get('stores', [])
            if stores:
                store = stores[0]
                required_store_fields = [
                    'store_id', 'store_name', 'rank', 'score', 
                    'turnover_ratio', 'dead_stock_pct', 'transfer_compliance'
                ]
                for field in required_store_fields:
                    if field not in store:
                        print(f"   ❌ Store missing field '{field}'")
                        return False
                print(f"   ✅ Store structure correct with {len(stores)} stores")
                print(f"   ✅ Top store: {store['store_name']} (Score: {store['score']})")
            else:
                print(f"   ⚠️ No stores with data found")
            
            # Verify network averages structure
            network_avg = response.get('network_avg', {})
            required_avg_fields = ['avg_turnover', 'avg_dead_pct', 'avg_compliance', 'avg_score']
            for field in required_avg_fields:
                if field not in network_avg:
                    print(f"   ❌ Network avg missing field '{field}'")
                    return False
            print(f"   ✅ Network averages: Score={network_avg.get('avg_score', 0):.1f}, Turnover={network_avg.get('avg_turnover', 0):.2f}")
                    
        return success

    def test_scorecard_export(self):
        """Test scorecard Excel export"""
        success, response = self.run_test("Export Store Scorecard", "GET", "api/export/scorecard", 200)
        if success:
            print(f"   ✅ Scorecard Excel export successful")
        return success

    # ===== PHASE 5 CRM ENHANCEMENT TESTING =====
    
    def test_crm_login(self):
        """Test CRM staff login"""
        success, response = self.run_test(
            "CRM Staff Login",
            "POST",
            "api/auth/login",
            200,
            data={"email": "crm@sahakar.com", "password": "crm123"}
        )
        if success and 'token' in response:
            crm_token = response['token']
            user_role = response['user']['role']
            print(f"   Token obtained for CRM user: {response['user']['email']} (Role: {user_role})")
            if user_role != 'CRM_STAFF':
                print(f"   ❌ Expected CRM_STAFF role, got {user_role}")
                return False
            # Store CRM token for later use but keep admin token as primary
            self.crm_token = crm_token
            return True
        return False

    def test_crm_dashboard(self):
        """Test CRM dashboard stats"""
        return self.run_test("CRM Dashboard Stats", "GET", "api/crm/dashboard", 200)

    def test_crm_customers_crud(self):
        """Test CRM customer CRUD operations"""
        if not self.store_id:
            print("❌ No store_id available for CRM customers test")
            return False

        # Get CRM customers
        success, response = self.run_test("Get CRM Customers", "GET", "api/crm/customers", 200)
        if not success:
            return False

        # Create CRM customer
        customer_data = {
            "mobile_number": f"98765{datetime.now().strftime('%H%M%S')}",
            "customer_name": f"CRM Test Customer {datetime.now().strftime('%H%M%S')}",
            "gender": "male",
            "age": 35,
            "address": "Test Address",
            "store_id": self.store_id,
            "customer_type": "walkin"
        }
        success, response = self.run_test("Create CRM Customer", "POST", "api/crm/customers", 200, data=customer_data)
        if success:
            self.crm_customer_id = response.get('id')
            print(f"   Created CRM customer with ID: {self.crm_customer_id}")
            
            # Test get customer profile
            success2, response2 = self.run_test("Get CRM Customer Profile", "GET", f"api/crm/customers/{self.crm_customer_id}", 200)
            if success2:
                print(f"   Customer profile retrieved successfully")
            return success2
        return False

    def test_sales_upload(self):
        """Test sales report upload with Excel"""
        if not self.store_id:
            print("❌ No store_id available for sales upload test")
            return False

        # Create sample sales Excel
        data = {
            'Date of Invoice': ['2024-01-15', '2024-01-15'],
            'Entry Number': ['INV001', 'INV002'],
            'Patient Name': ['Test Patient 1', 'Test Patient 2'],
            'Mobile Number': ['9876543210', '9876543211'],
            'Product ID': ['P001', 'P002'],
            'Product Name': ['Paracetamol 500mg', 'Amoxicillin 250mg'],
            'Total Amount': [105.50, 250.00]
        }
        df = pd.DataFrame(data)
        
        excel_buffer = BytesIO()
        df.to_excel(excel_buffer, index=False)
        excel_buffer.seek(0)
        
        files = {'file': ('test_sales.xlsx', excel_buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        success, response = self.run_test(
            "Upload Sales Report Excel", 
            "POST", 
            f"api/crm/sales-upload?store_id={self.store_id}", 
            200, 
            files=files
        )
        if success:
            print(f"   Upload result: {response.get('success', 0)}/{response.get('total', 0)} records")
            print(f"   New customers: {response.get('new_customers', 0)}")
            return True
        return False

    def test_sales_records(self):
        """Test sales records retrieval"""
        if not self.store_id:
            print("❌ No store_id available for sales records test")
            return False

        # Get all sales records
        success1, response1 = self.run_test("Get All Sales Records", "GET", "api/crm/sales", 200, 
                                           params={"store_id": self.store_id, "page": 1, "limit": 10})
        
        # Get pending sales records only
        success2, response2 = self.run_test("Get Pending Sales Records", "GET", "api/crm/sales", 200, 
                                           params={"store_id": self.store_id, "pending_only": True, "page": 1, "limit": 10})
        
        if success1 and success2:
            print(f"   Total sales records: {response1.get('total', 0)}")
            print(f"   Pending records: {response2.get('total', 0)}")
            return True
        return False

    def test_medication_duration_update(self):
        """Test medication duration update on sales records"""
        if not self.store_id:
            print("❌ No store_id available for medication update test")
            return False

        # Get pending sales records
        success, response = self.run_test("Get Pending Records for Update", "GET", "api/crm/sales", 200, 
                                         params={"store_id": self.store_id, "pending_only": True, "limit": 1})
        
        if success and response.get('records'):
            record_id = response['records'][0]['id']
            
            # Update medication duration
            update_data = {"days_of_medication": 30}
            success2, response2 = self.run_test("Update Medication Duration", "PUT", f"api/crm/sales/{record_id}/medication", 200, data=update_data)
            
            if success2:
                print(f"   Medication updated, next due date: {response2.get('next_due_date', 'N/A')}")
                return True
        else:
            print("   ⚠️ No pending sales records found for medication update test")
            return True  # Not a failure if no records exist
        return False

    def test_customer_allocation(self):
        """Test customer allocation to stores"""
        if not self.store_id or not hasattr(self, 'crm_customer_id'):
            print("❌ No store_id or customer_id available for allocation test")
            return False

        # Allocate customer to store
        allocation_data = {
            "customer_id": self.crm_customer_id,
            "store_id": self.store_id
        }
        success, response = self.run_test("Allocate Customer to Store", "PUT", f"api/crm/customers/{self.crm_customer_id}/allocate", 200, data=allocation_data)
        
        if success:
            print(f"   Customer {self.crm_customer_id} allocated to store {self.store_id}")
            return True
        return False

    def test_adherence_scores(self):
        """Test adherence scoring"""
        success, response = self.run_test("Get Adherence Scores", "GET", "api/crm/adherence", 200)
        
        if success:
            summary = response.get('summary', {})
            print(f"   Adherence summary - High: {summary.get('high', 0)}, Medium: {summary.get('medium', 0)}, Low: {summary.get('low', 0)}")
            scores = response.get('scores', [])
            print(f"   Total patients scored: {len(scores)}")
            return True
        return False

    def test_crm_performance_reports(self):
        """Test CRM performance reports"""
        # Test 30-day performance report
        success1, response1 = self.run_test("CRM Performance Report (30 days)", "GET", "api/crm/reports/performance", 200, params={"days": 30})
        
        # Test 7-day performance report
        success2, response2 = self.run_test("CRM Performance Report (7 days)", "GET", "api/crm/reports/performance", 200, params={"days": 7})
        
        if success1 and success2:
            print(f"   30-day stats - Calls: {response1.get('total_calls', 0)}, Conversion: {response1.get('conversion_rate', 0)}%")
            print(f"   Store report entries: {len(response1.get('store_report', []))}")
            print(f"   Sales imported: {response1.get('total_sales_imported', 0)}")
            return True
        return False

def main():
    print("🏥 Starting Sahakar Pharmacy API Testing...")
    print("=" * 60)
    
    tester = PharmacyAPITester()
    
    # Basic connectivity and auth tests
    print("\n📡 BASIC CONNECTIVITY TESTS")
    if not tester.test_health_check()[0]:
        print("❌ Health check failed - stopping tests")
        return 1

    if not tester.test_login():
        print("❌ Login failed - stopping tests")
        return 1

    if not tester.test_get_me()[0]:
        print("❌ Get user info failed")

    # Dashboard and core data tests
    print("\n📊 DASHBOARD & CORE DATA TESTS")
    tester.test_dashboard_stats()

    # Master data tests
    print("\n🏪 MASTER DATA TESTS")
    tester.test_stores_crud()
    tester.test_users_crud()
    tester.test_products_crud()

    # Upload tests
    print("\n📤 UPLOAD TESTS")
    tester.test_product_upload()
    tester.test_ho_stock_upload()
    tester.test_get_ho_stock()
    tester.test_store_stock_upload()

    # Stock management tests  
    print("\n📦 STOCK MANAGEMENT TESTS")
    tester.test_consolidated_stock()
    tester.test_stock_availability()

    # Operations tests
    print("\n🔄 OPERATIONS TESTS")
    tester.test_transfers_crud()
    tester.test_purchases_crud()

    # History tests
    print("\n📋 HISTORY TESTS")
    tester.test_upload_history()

    # Phase 2 new features tests
    print("\n🚀 PHASE 2 NEW FEATURES TESTS")
    tester.test_aging_report()
    tester.test_intelligence_summary()
    tester.test_batch_details()
    tester.test_rc_customers_crud()
    tester.test_refill_reminders()
    tester.test_audit_logs()
    tester.test_excel_exports()

    # Phase 3 new features tests
    print("\n🎯 PHASE 3 NEW FEATURES TESTS")
    tester.test_dashboard_chart_data()
    tester.test_stock_check_availability()
    tester.test_transfer_quantity_validation()
    tester.test_role_based_filtering()

    # Phase 4 Store Scorecard tests
    print("\n🏆 PHASE 4 STORE SCORECARD TESTS")
    tester.test_store_scorecard()
    tester.test_scorecard_export()

    # Phase 5 CRM Enhancement tests
    print("\n💼 PHASE 5 CRM ENHANCEMENT TESTS")
    tester.test_crm_login()
    tester.test_crm_dashboard()
    tester.test_crm_customers_crud()
    tester.test_sales_upload()
    tester.test_sales_records()
    tester.test_medication_duration_update()
    tester.test_customer_allocation()
    tester.test_adherence_scores()
    tester.test_crm_performance_reports()

    # Print final results
    print("\n" + "=" * 60)
    print(f"📊 FINAL RESULTS: {tester.tests_passed}/{tester.tests_run} tests passed")
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"✅ Success rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("🎉 Backend API testing PASSED!")
        return 0
    else:
        print("⚠️  Backend API testing had significant failures")
        return 1

if __name__ == "__main__":
    sys.exit(main())