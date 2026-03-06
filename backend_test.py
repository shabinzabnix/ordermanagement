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
        success, response = self.run_test("Create Store", "POST", "api/stores", 201, data=store_data)
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
        success, response = self.run_test("Create User", "POST", "api/users", 201, data=user_data)
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
            success, response = self.run_test("Create Transfer", "POST", "api/transfers", 201, data=transfer_data)
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