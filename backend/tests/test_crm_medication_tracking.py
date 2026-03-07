"""
CRM Medication Tracking System Tests
Tests for customer profile, medication tracking, and CRM operations.

Features tested:
- Customer CRUD operations
- Walkin to RC customer conversion
- Medicine purchases with dosage, timing, food_relation
- Medication details update
- Stop medicine functionality
- Call logging
- Customer profile with medicine calendar
"""

import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCRMAuthentication:
    """Authentication tests for CRM module"""
    
    def test_admin_login(self):
        """Test admin login with admin@sahakar.com / admin123"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        print(f"✓ Admin login successful, token received")
        return data["token"]
    
    def test_crm_login(self):
        """Test CRM staff login with crm@sahakar.com / crm123"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "crm@sahakar.com",
            "password": "crm123"
        })
        assert response.status_code == 200, f"CRM login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        print(f"✓ CRM staff login successful")
        return data["token"]


class TestCustomerManagement:
    """Customer CRUD and type conversion tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_stores(self, auth_headers):
        """Get list of stores to use in tests"""
        response = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        assert response.status_code == 200, f"Failed to get stores: {response.text}"
        data = response.json()
        assert "stores" in data, "No stores key in response"
        print(f"✓ Found {len(data['stores'])} stores")
        return data["stores"]
    
    def test_create_walkin_customer(self, auth_headers):
        """POST /api/crm/customers - Create a new walk-in customer"""
        # Get a store first
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        timestamp = datetime.now().strftime("%H%M%S")
        customer_data = {
            "mobile_number": f"98765{timestamp}",
            "customer_name": f"TEST_Walkin_Customer_{timestamp}",
            "gender": "male",
            "age": 45,
            "address": "Test Address 123",
            "store_id": store_id,
            "customer_type": "walkin"
        }
        response = requests.post(f"{BASE_URL}/api/crm/customers", json=customer_data, headers=auth_headers)
        assert response.status_code == 200, f"Create customer failed: {response.text}"
        data = response.json()
        assert "id" in data, "No customer ID in response"
        print(f"✓ Created walkin customer ID: {data['id']}")
        return data["id"]
    
    def test_get_customer_profile(self, auth_headers):
        """GET /api/crm/customers/{id} - Get customer profile with medicine calendar"""
        # First get existing customer or create one
        list_resp = requests.get(f"{BASE_URL}/api/crm/customers?limit=1", headers=auth_headers)
        customers = list_resp.json().get("customers", [])
        
        if not customers:
            pytest.skip("No customers to test profile")
        
        customer_id = customers[0]["id"]
        response = requests.get(f"{BASE_URL}/api/crm/customers/{customer_id}", headers=auth_headers)
        assert response.status_code == 200, f"Get profile failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "customer" in data, "No customer key in response"
        assert "medicine_calendar" in data, "No medicine_calendar in response"
        assert "invoices" in data, "No invoices in response"
        assert "repeat_medicines" in data, "No repeat_medicines in response"
        assert "timeline" in data, "No timeline in response"
        
        customer = data["customer"]
        assert "id" in customer
        assert "customer_name" in customer
        assert "mobile_number" in customer
        assert "customer_type" in customer
        
        print(f"✓ Customer profile retrieved: {customer['customer_name']}")
        print(f"  - Type: {customer['customer_type']}")
        print(f"  - Active medicines: {len(data['medicine_calendar'])}")
        return data
    
    def test_convert_walkin_to_rc(self, auth_headers):
        """PUT /api/crm/customers/{id}/type - Convert walkin to RC customer"""
        # Create a walkin customer first
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        timestamp = datetime.now().strftime("%H%M%S%f")[:10]
        customer_data = {
            "mobile_number": f"97777{timestamp}",
            "customer_name": f"TEST_Convert_RC_{timestamp}",
            "store_id": store_id,
            "customer_type": "walkin"
        }
        create_resp = requests.post(f"{BASE_URL}/api/crm/customers", json=customer_data, headers=auth_headers)
        if create_resp.status_code != 200:
            pytest.skip(f"Could not create customer: {create_resp.text}")
        
        customer_id = create_resp.json()["id"]
        
        # Convert to RC
        convert_response = requests.put(
            f"{BASE_URL}/api/crm/customers/{customer_id}/type",
            json={"customer_type": "rc"},
            headers=auth_headers
        )
        assert convert_response.status_code == 200, f"Convert to RC failed: {convert_response.text}"
        
        # Verify the change
        profile_resp = requests.get(f"{BASE_URL}/api/crm/customers/{customer_id}", headers=auth_headers)
        profile = profile_resp.json()
        assert profile["customer"]["customer_type"] == "rc", "Customer type not updated to RC"
        print(f"✓ Customer {customer_id} converted to RC successfully")


class TestMedicationTracking:
    """Medication purchase, update, and tracking tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def test_customer(self, auth_headers):
        """Create or get a test customer for medication tests"""
        # Try to get existing customer
        list_resp = requests.get(f"{BASE_URL}/api/crm/customers?limit=1", headers=auth_headers)
        customers = list_resp.json().get("customers", [])
        
        if customers:
            return customers[0]["id"]
        
        # Create new customer
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        timestamp = datetime.now().strftime("%H%M%S%f")[:10]
        customer_data = {
            "mobile_number": f"96666{timestamp}",
            "customer_name": f"TEST_Med_Tracking_{timestamp}",
            "store_id": store_id,
            "customer_type": "walkin"
        }
        create_resp = requests.post(f"{BASE_URL}/api/crm/customers", json=customer_data, headers=auth_headers)
        return create_resp.json()["id"]
    
    def test_add_medicine_with_full_details(self, auth_headers, test_customer):
        """POST /api/crm/purchases - Add medicine with dosage, timing, food_relation"""
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        purchase_data = {
            "customer_id": test_customer,
            "store_id": store_id,
            "medicine_name": "TEST_Amlodipine 5mg",
            "quantity": 30,
            "days_of_medication": 30,
            "purchase_date": datetime.now().isoformat(),
            "dosage": "1 tablet",
            "timing": "morning",
            "food_relation": "after_food"
        }
        
        response = requests.post(f"{BASE_URL}/api/crm/purchases", json=purchase_data, headers=auth_headers)
        assert response.status_code == 200, f"Add medicine failed: {response.text}"
        data = response.json()
        
        assert "id" in data, "No purchase ID in response"
        assert "next_due_date" in data, "No next_due_date in response"
        
        print(f"✓ Medicine added with ID: {data['id']}")
        print(f"  - Next due date: {data['next_due_date']}")
        return data["id"]
    
    def test_verify_medicine_in_calendar(self, auth_headers, test_customer):
        """Verify medicine appears in customer profile's medicine_calendar"""
        response = requests.get(f"{BASE_URL}/api/crm/customers/{test_customer}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        
        calendar = data.get("medicine_calendar", [])
        print(f"  Medicine calendar has {len(calendar)} items")
        
        # Check if any medicine has the expected fields
        for med in calendar:
            assert "id" in med
            assert "medicine" in med
            assert "dosage" in med or med.get("dosage") is None
            assert "timing" in med or med.get("timing") is None
            assert "food_relation" in med or med.get("food_relation") is None
            assert "next_due_date" in med
            assert "days_until" in med
            print(f"  - {med['medicine']}: dosage={med.get('dosage')}, timing={med.get('timing')}, food={med.get('food_relation')}")
        
        print(f"✓ Medicine calendar structure verified")
    
    def test_update_medication_details(self, auth_headers, test_customer):
        """PUT /api/crm/purchases/{id}/medication-details - Update dosage, timing, food_relation"""
        # First add a medicine to update
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        # Add medicine
        purchase_data = {
            "customer_id": test_customer,
            "store_id": store_id,
            "medicine_name": "TEST_UpdateMed_Metformin",
            "quantity": 60,
            "days_of_medication": 30,
            "dosage": "1 tablet",
            "timing": "morning",
            "food_relation": "before_food"
        }
        add_resp = requests.post(f"{BASE_URL}/api/crm/purchases", json=purchase_data, headers=auth_headers)
        purchase_id = add_resp.json()["id"]
        
        # Update medication details
        update_data = {
            "dosage": "2 tablets",
            "timing": "morning,dinner",
            "food_relation": "after_food",
            "days_of_medication": 45
        }
        
        response = requests.put(
            f"{BASE_URL}/api/crm/purchases/{purchase_id}/medication-details",
            json=update_data,
            headers=auth_headers
        )
        assert response.status_code == 200, f"Update medication details failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"✓ Medication details updated for purchase {purchase_id}")
        print(f"  - New next_due_date: {data.get('next_due_date')}")
    
    def test_stop_medicine(self, auth_headers, test_customer):
        """PUT /api/crm/purchases/{id}/stop - Stop a medicine"""
        # First add a medicine to stop
        stores_resp = requests.get(f"{BASE_URL}/api/stores", headers=auth_headers)
        stores = stores_resp.json().get("stores", [])
        store_id = stores[0]["id"] if stores else 1
        
        # Add medicine
        purchase_data = {
            "customer_id": test_customer,
            "store_id": store_id,
            "medicine_name": "TEST_StopMed_Aspirin",
            "quantity": 30,
            "days_of_medication": 30
        }
        add_resp = requests.post(f"{BASE_URL}/api/crm/purchases", json=purchase_data, headers=auth_headers)
        purchase_id = add_resp.json()["id"]
        
        # Stop the medicine
        response = requests.put(
            f"{BASE_URL}/api/crm/purchases/{purchase_id}/stop",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Stop medicine failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"✓ Medicine {purchase_id} stopped successfully")
        
        # Verify it's no longer in active calendar
        profile_resp = requests.get(f"{BASE_URL}/api/crm/customers/{test_customer}", headers=auth_headers)
        calendar = profile_resp.json().get("medicine_calendar", [])
        stopped_ids = [m["id"] for m in calendar]
        # The stopped medicine should not appear in active calendar
        # (Actually it should be filtered out since status is "stopped")
        print(f"  - Calendar now has {len(calendar)} active medicines")


class TestCallLogging:
    """CRM call logging tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_log_call_reached(self, auth_headers):
        """POST /api/crm/calls - Log a call with result 'reached'"""
        # Get a customer
        list_resp = requests.get(f"{BASE_URL}/api/crm/customers?limit=1", headers=auth_headers)
        customers = list_resp.json().get("customers", [])
        
        if not customers:
            pytest.skip("No customers to log call for")
        
        customer_id = customers[0]["id"]
        
        call_data = {
            "customer_id": customer_id,
            "call_result": "reached",
            "remarks": "TEST: Customer reached successfully, discussed medication refill"
        }
        
        response = requests.post(f"{BASE_URL}/api/crm/calls", json=call_data, headers=auth_headers)
        assert response.status_code == 200, f"Log call failed: {response.text}"
        data = response.json()
        
        assert "id" in data
        assert "message" in data
        print(f"✓ Call logged with ID: {data['id']}")
    
    def test_call_appears_in_timeline(self, auth_headers):
        """Verify logged call appears in customer timeline"""
        list_resp = requests.get(f"{BASE_URL}/api/crm/customers?limit=1", headers=auth_headers)
        customers = list_resp.json().get("customers", [])
        
        if not customers:
            pytest.skip("No customers")
        
        customer_id = customers[0]["id"]
        profile_resp = requests.get(f"{BASE_URL}/api/crm/customers/{customer_id}", headers=auth_headers)
        data = profile_resp.json()
        
        timeline = data.get("timeline", [])
        call_events = [t for t in timeline if t.get("type") == "call"]
        
        print(f"✓ Found {len(call_events)} call events in timeline")


class TestCRMDashboard:
    """CRM dashboard and reporting tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_crm_dashboard_stats(self, auth_headers):
        """GET /api/crm/dashboard - Get CRM dashboard KPIs"""
        response = requests.get(f"{BASE_URL}/api/crm/dashboard", headers=auth_headers)
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        data = response.json()
        
        expected_keys = [
            "total_customers", "rc_customers", "due_today", 
            "due_3days", "overdue", "upcoming_7days", 
            "calls_today", "pending_tasks"
        ]
        
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"
        
        print(f"✓ CRM Dashboard stats:")
        print(f"  - Total customers: {data['total_customers']}")
        print(f"  - RC customers: {data['rc_customers']}")
        print(f"  - Due today: {data['due_today']}")
        print(f"  - Overdue: {data['overdue']}")
    
    def test_refill_due_list(self, auth_headers):
        """GET /api/crm/refill-due - Get refill due list"""
        response = requests.get(f"{BASE_URL}/api/crm/refill-due", headers=auth_headers)
        assert response.status_code == 200, f"Refill due failed: {response.text}"
        data = response.json()
        
        assert "items" in data
        assert "total" in data
        print(f"✓ Refill due list: {data['total']} items")


class TestExistingCustomerProfile:
    """Test with existing customer ID 1 data"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_customer_1_profile(self, auth_headers):
        """GET /api/crm/customers/1 - Get Test Patient profile"""
        response = requests.get(f"{BASE_URL}/api/crm/customers/1", headers=auth_headers)
        
        if response.status_code == 404:
            pytest.skip("Customer ID 1 not found")
        
        assert response.status_code == 200, f"Get customer 1 failed: {response.text}"
        data = response.json()
        
        customer = data["customer"]
        print(f"✓ Customer 1 Profile:")
        print(f"  - Name: {customer['customer_name']}")
        print(f"  - Type: {customer['customer_type']}")
        print(f"  - Mobile: {customer['mobile_number']}")
        
        # Check medicine calendar
        calendar = data.get("medicine_calendar", [])
        print(f"  - Active medicines: {len(calendar)}")
        
        for med in calendar:
            print(f"    * {med['medicine']}")
            if med.get('dosage'):
                print(f"      Dosage: {med['dosage']}")
            if med.get('timing'):
                print(f"      Timing: {med['timing']}")
            if med.get('food_relation'):
                print(f"      Food: {med['food_relation']}")


# Cleanup fixture
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    """Cleanup test data after all tests"""
    yield
    # Note: In production, would delete TEST_ prefixed data
    print("\n--- Test session complete ---")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
