import requests
import sys
from datetime import datetime, timezone, timedelta
import json

class CRMAPITester:
    def __init__(self, base_url="https://rx-med-tracker.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.created_customer_id = None
        self.created_purchase_id = None
        self.created_call_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params or {})
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, params=params or {})
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, params=params or {})

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    resp_json = response.json()
                    if 'id' in resp_json:
                        print(f"   Created ID: {resp_json['id']}")
                    return True, resp_json
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_detail = response.json()
                    print(f"   Error: {error_detail}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_login(self):
        """Test login and get token"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "admin@sahakar.com", "password": "admin123"}
        )
        print(f"   Login response: {response}")
        if success and 'token' in response:
            self.token = response['token']
            print(f"   Token acquired: {self.token[:20]}...")
            return True
        elif success and 'access_token' in response:
            self.token = response['access_token']
            print(f"   Token acquired: {self.token[:20]}...")
            return True
        return False

    def test_crm_dashboard(self):
        """Test CRM dashboard KPI stats"""
        success, response = self.run_test(
            "CRM Dashboard Stats",
            "GET",
            "crm/dashboard",
            200
        )
        if success:
            required_keys = ['total_customers', 'rc_customers', 'due_today', 'overdue', 'due_3days', 'upcoming_7days', 'calls_today', 'pending_tasks']
            for key in required_keys:
                if key not in response:
                    print(f"   Missing key: {key}")
                    return False
            print(f"   Total Customers: {response.get('total_customers', 0)}")
            print(f"   RC Customers: {response.get('rc_customers', 0)}")
            print(f"   Due Today: {response.get('due_today', 0)}")
            print(f"   Overdue: {response.get('overdue', 0)}")
        return success

    def test_list_customers(self):
        """Test customer listing with pagination"""
        success, response = self.run_test(
            "List Customers",
            "GET",
            "crm/customers",
            200,
            params={"page": 1, "limit": 10}
        )
        if success:
            if 'customers' not in response:
                print(f"   Missing customers array")
                return False
            print(f"   Found {len(response['customers'])} customers")
            print(f"   Total customers: {response.get('total', 0)}")
        return success

    def test_create_customer(self):
        """Test customer creation with mobile as unique ID"""
        test_mobile = f"98765{datetime.now().strftime('%H%M%S')}"
        success, response = self.run_test(
            "Create CRM Customer",
            "POST",
            "crm/customers",
            200,
            data={
                "mobile_number": test_mobile,
                "customer_name": "Test Customer Auto",
                "gender": "Male",
                "age": 35,
                "address": "Test Address 123",
                "store_id": 1,
                "customer_type": "walkin"
            }
        )
        if success and 'id' in response:
            self.created_customer_id = response['id']
            print(f"   Customer created with ID: {self.created_customer_id}")
            return True
        return False

    def test_duplicate_customer(self):
        """Test that duplicate mobile numbers are rejected"""
        test_mobile = f"98765{datetime.now().strftime('%H%M%S')}"
        # First create with mobile
        success1, _ = self.run_test(
            "Create Customer for Duplicate Test",
            "POST",
            "crm/customers",
            200,
            data={
                "mobile_number": test_mobile,
                "customer_name": "First Customer",
                "store_id": 1,
                "customer_type": "walkin"
            }
        )
        if not success1:
            return False
            
        # Now try duplicate
        success2, _ = self.run_test(
            "Create Duplicate Customer (Should Fail)",
            "POST",
            "crm/customers",
            400,  # Should fail with 400
            data={
                "mobile_number": test_mobile,
                "customer_name": "Duplicate Customer", 
                "store_id": 1,
                "customer_type": "walkin"
            }
        )
        return success2

    def test_get_customer_profile(self):
        """Test getting full customer profile"""
        if not self.created_customer_id:
            print("   Skipping: No customer available")
            return True
            
        success, response = self.run_test(
            "Get Customer Profile",
            "GET", 
            f"crm/customers/{self.created_customer_id}",
            200
        )
        if success:
            required_sections = ['customer', 'medicine_calendar', 'timeline', 'tasks']
            for section in required_sections:
                if section not in response:
                    print(f"   Missing section: {section}")
                    return False
            print(f"   Customer: {response['customer']['customer_name']}")
            print(f"   Medicine Calendar items: {len(response['medicine_calendar'])}")
            print(f"   Timeline items: {len(response['timeline'])}")
        return success

    def test_add_purchase(self):
        """Test adding medicine purchase with auto next_due_date calculation"""
        if not self.created_customer_id:
            print("   Skipping: No customer available")
            return True
            
        success, response = self.run_test(
            "Add Medicine Purchase", 
            "POST",
            "crm/purchases",
            200,
            data={
                "customer_id": self.created_customer_id,
                "store_id": 1,
                "medicine_name": "Metformin 500mg",
                "quantity": 30,
                "days_of_medication": 30,
                "purchase_date": datetime.now(timezone.utc).isoformat()
            }
        )
        if success and 'id' in response:
            self.created_purchase_id = response['id']
            if 'next_due_date' in response:
                print(f"   Purchase created with ID: {self.created_purchase_id}")
                print(f"   Next due date: {response['next_due_date']}")
                return True
            else:
                print("   Missing next_due_date in response")
                return False
        return False

    def test_rc_auto_classification(self):
        """Test auto RC classification after 3 purchases of same medicine in 90 days"""
        if not self.created_customer_id:
            print("   Skipping: No customer available")
            return True
            
        # Add 2 more purchases of same medicine 
        for i in range(2):
            success, _ = self.run_test(
                f"Add Purchase {i+2} for RC Classification",
                "POST",
                "crm/purchases", 
                200,
                data={
                    "customer_id": self.created_customer_id,
                    "store_id": 1, 
                    "medicine_name": "Metformin 500mg",
                    "quantity": 30,
                    "days_of_medication": 30,
                    "purchase_date": (datetime.now(timezone.utc) - timedelta(days=i*20)).isoformat()
                }
            )
            if not success:
                return False
        
        # Check if customer is now classified as RC
        success, response = self.run_test(
            "Check RC Auto-Classification",
            "GET",
            f"crm/customers/{self.created_customer_id}",
            200
        )
        if success:
            customer_type = response.get('customer', {}).get('customer_type')
            if customer_type == 'rc':
                print(f"   ✅ Customer auto-classified as RC")
                return True
            else:
                print(f"   ❌ Customer type is {customer_type}, expected 'rc'")
                return False
        return False

    def test_refill_due_list(self):
        """Test refill due management with filters"""
        success, response = self.run_test(
            "Get Refill Due List - All",
            "GET",
            "crm/refill-due",
            200,
            params={"category": "all", "limit": 20}
        )
        if not success:
            return False
            
        # Test overdue filter
        success2, response2 = self.run_test(
            "Get Refill Due List - Overdue",
            "GET", 
            "crm/refill-due",
            200,
            params={"category": "overdue", "limit": 20}
        )
        if not success2:
            return False
            
        # Test today filter  
        success3, response3 = self.run_test(
            "Get Refill Due List - Today",
            "GET",
            "crm/refill-due", 
            200,
            params={"category": "today", "limit": 20}
        )
        if success3:
            print(f"   All items: {len(response.get('items', []))}")
            print(f"   Overdue items: {len(response2.get('items', []))}")
            print(f"   Due today items: {len(response3.get('items', []))}")
        return success3

    def test_log_crm_call(self):
        """Test CRM call logging"""
        if not self.created_customer_id:
            print("   Skipping: No customer available") 
            return True
            
        success, response = self.run_test(
            "Log CRM Call",
            "POST",
            "crm/calls",
            200,
            data={
                "customer_id": self.created_customer_id,
                "purchase_id": self.created_purchase_id,
                "call_result": "reached",
                "remarks": "Customer confirmed purchase for next month"
            }
        )
        if success and 'id' in response:
            self.created_call_id = response['id']
            print(f"   Call logged with ID: {self.created_call_id}")
        return success

    def test_stop_medicine(self):
        """Test stopping a medicine purchase"""
        if not self.created_purchase_id:
            print("   Skipping: No purchase available")
            return True
            
        success, response = self.run_test(
            "Stop Medicine Purchase",
            "PUT",
            f"crm/purchases/{self.created_purchase_id}/stop",
            200
        )
        return success

    def test_customer_search(self):
        """Test customer search functionality"""
        # Search by medicine
        success1, response1 = self.run_test(
            "Search Customers by Medicine",
            "GET",
            "crm/search",
            200,
            params={"medicine": "Metformin"}
        )
        
        # Search by mobile
        success2, response2 = self.run_test(
            "Search Customers by Mobile", 
            "GET",
            "crm/search",
            200,
            params={"mobile": "987"}
        )
        
        if success1 and success2:
            print(f"   Medicine search results: {len(response1.get('results', []))}")
            print(f"   Mobile search results: {len(response2.get('results', []))}")
        return success1 and success2

def main():
    print("🏥 Starting CRM API Testing...")
    print("=" * 60)
    
    tester = CRMAPITester()
    
    # Authentication
    if not tester.test_login():
        print("\n❌ Authentication failed, stopping tests")
        return 1
    
    # Core CRM Tests
    tests = [
        tester.test_crm_dashboard,
        tester.test_list_customers, 
        tester.test_create_customer,
        tester.test_duplicate_customer,
        tester.test_get_customer_profile,
        tester.test_add_purchase,
        tester.test_rc_auto_classification,
        tester.test_refill_due_list,
        tester.test_log_crm_call,
        tester.test_stop_medicine,
        tester.test_customer_search
    ]
    
    for test in tests:
        try:
            test()
        except Exception as e:
            print(f"❌ Test {test.__name__} failed with error: {str(e)}")
    
    # Print results
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All CRM API tests passed!")
        return 0
    else:
        print(f"⚠️  {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())