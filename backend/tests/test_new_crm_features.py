"""
Test new CRM features:
1. STORE_MANAGER role 
2. Store CRM Dashboard endpoints
3. Staff assignment
4. Staff performance
5. Enhanced refill due with stock info
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthAndBasics:
    """Test admin and CRM login work correctly"""
    
    def test_admin_login(self):
        """Admin login returns token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data, f"Missing token: {data}"
        assert "user" in data, f"Missing user: {data}"
        assert data["user"]["role"] == "ADMIN"
        
    def test_crm_login(self):
        """CRM staff login returns token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "crm@sahakar.com",
            "password": "crm123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "CRM_STAFF"


class TestStoreCRMDashboard:
    """Test store CRM dashboard endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_store_crm_dashboard_returns_structure(self, admin_token):
        """GET /api/crm/store-crm-dashboard returns expected structure"""
        response = requests.get(
            f"{BASE_URL}/api/crm/store-crm-dashboard",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify required keys exist
        assert "kpis" in data, f"Missing kpis: {data}"
        assert "new_customers" in data, f"Missing new_customers: {data}"
        assert "rc_purchases" in data, f"Missing rc_purchases: {data}"
        assert "upcoming_purchases" in data, f"Missing upcoming_purchases: {data}"
        
        # Verify KPI structure
        kpis = data["kpis"]
        assert "total_customers" in kpis, f"Missing total_customers in kpis: {kpis}"
        assert "rc_customers" in kpis, f"Missing rc_customers in kpis: {kpis}"
        assert "overdue" in kpis, f"Missing overdue in kpis: {kpis}"
        assert "due_today" in kpis, f"Missing due_today in kpis: {kpis}"
        assert "due_7days" in kpis, f"Missing due_7days in kpis: {kpis}"
        assert "new_in_range" in kpis, f"Missing new_in_range in kpis: {kpis}"
    
    def test_store_crm_dashboard_with_date_filter(self, admin_token):
        """Store CRM dashboard accepts date filters"""
        response = requests.get(
            f"{BASE_URL}/api/crm/store-crm-dashboard",
            params={"date_from": "2025-01-01", "date_to": "2026-01-31"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"


class TestStoreStaff:
    """Test store staff endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_get_store_staff_returns_list(self, admin_token):
        """GET /api/crm/store-staff returns staff list"""
        response = requests.get(
            f"{BASE_URL}/api/crm/store-staff",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "staff" in data, f"Missing staff key: {data}"
        assert isinstance(data["staff"], list), f"staff should be a list: {data}"
        # DB may be empty but structure should be correct
        
    def test_store_staff_with_store_filter(self, admin_token):
        """Store staff endpoint accepts store_id filter"""
        response = requests.get(
            f"{BASE_URL}/api/crm/store-staff",
            params={"store_id": 1},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200


class TestStaffPerformance:
    """Test staff performance endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_staff_performance_returns_structure(self, admin_token):
        """GET /api/crm/staff-performance returns expected structure"""
        response = requests.get(
            f"{BASE_URL}/api/crm/staff-performance",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "staff" in data, f"Missing staff: {data}"
        assert "period_days" in data, f"Missing period_days: {data}"
        assert isinstance(data["staff"], list)
        assert data["period_days"] == 30  # Default
        
    def test_staff_performance_custom_period(self, admin_token):
        """Staff performance accepts days parameter"""
        response = requests.get(
            f"{BASE_URL}/api/crm/staff-performance",
            params={"days": 7},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["period_days"] == 7


class TestRefillDueEnhanced:
    """Test enhanced refill due endpoint with stock info"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_refill_due_enhanced_returns_structure(self, admin_token):
        """GET /api/crm/refill-due-enhanced returns expected structure"""
        response = requests.get(
            f"{BASE_URL}/api/crm/refill-due-enhanced",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "items" in data, f"Missing items: {data}"
        assert "total" in data, f"Missing total: {data}"
        assert "page" in data, f"Missing page: {data}"
        assert "limit" in data, f"Missing limit: {data}"
        assert isinstance(data["items"], list)
        
    def test_refill_due_enhanced_item_fields(self, admin_token):
        """If items exist, verify new fields: in_stock, required, assigned_staff"""
        response = requests.get(
            f"{BASE_URL}/api/crm/refill-due-enhanced",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Items might be empty in test DB, but if present check structure
        if data["items"]:
            item = data["items"][0]
            # Verify new fields exist
            assert "in_stock" in item, f"Missing in_stock: {item}"
            assert "required" in item, f"Missing required: {item}"
            assert "assigned_staff" in item, f"Missing assigned_staff: {item}"
            assert "assigned_staff_id" in item, f"Missing assigned_staff_id: {item}"
            
    def test_refill_due_enhanced_category_filter(self, admin_token):
        """Enhanced refill due accepts category filter"""
        for category in ["overdue", "today", "3days", "7days"]:
            response = requests.get(
                f"{BASE_URL}/api/crm/refill-due-enhanced",
                params={"category": category},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200, f"Failed for category {category}"


class TestAssignStaff:
    """Test staff assignment to customers"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_assign_staff_requires_auth(self):
        """Assign staff endpoint requires authentication"""
        response = requests.put(
            f"{BASE_URL}/api/crm/customers/1/assign-staff",
            json={"staff_id": 1}
        )
        # Either 401 or 403 is acceptable for missing auth
        assert response.status_code in [401, 403], f"Expected 401 or 403, got {response.status_code}"
        
    def test_assign_staff_requires_correct_role(self, admin_token):
        """Assign staff endpoint requires ADMIN/STORE_MANAGER role"""
        # Admin should have access - test the endpoint exists
        response = requests.put(
            f"{BASE_URL}/api/crm/customers/999999/assign-staff",
            json={"staff_id": 1},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # Should get 404 for non-existent customer, not 403
        assert response.status_code == 404, f"Expected 404 for missing customer, got {response.status_code}"


class TestCustomerProfileAssignedStaff:
    """Test customer profile returns assigned staff info"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_customer_profile_has_assigned_staff_fields(self, admin_token):
        """GET /api/crm/customers/{id} returns assigned_staff_id and assigned_staff_name"""
        # First check stores exist
        stores_resp = requests.get(
            f"{BASE_URL}/api/stores",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if not stores_resp.json().get("stores"):
            pytest.skip("No stores in DB - can't create customer")
        
        store_id = stores_resp.json()["stores"][0]["id"]
        
        # Try to create or get existing
        customer_data = {
            "mobile_number": "9999888877",
            "customer_name": "TEST_StaffAssignCustomer",
            "store_id": store_id,
            "customer_type": "walkin"
        }
        
        create_resp = requests.post(
            f"{BASE_URL}/api/crm/customers",
            json=customer_data,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        if create_resp.status_code == 201 or create_resp.status_code == 200:
            customer_id = create_resp.json().get("id")
        elif "already exists" in create_resp.text:
            # Customer exists, search for it
            search_resp = requests.get(
                f"{BASE_URL}/api/crm/customers",
                params={"search": "9999888877"},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            if search_resp.status_code == 200 and search_resp.json().get("customers"):
                customer_id = search_resp.json()["customers"][0]["id"]
            else:
                pytest.skip("Could not find or create test customer")
        else:
            pytest.skip(f"Could not create customer: {create_resp.text}")
        
        # Get customer profile and verify fields
        response = requests.get(
            f"{BASE_URL}/api/crm/customers/{customer_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Failed to get customer: {response.text}"
        data = response.json()
        
        customer = data.get("customer", {})
        assert "assigned_staff_id" in customer, f"Missing assigned_staff_id: {customer}"
        assert "assigned_staff_name" in customer, f"Missing assigned_staff_name: {customer}"


class TestUserRoles:
    """Test STORE_MANAGER role exists in user endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sahakar.com",
            "password": "admin123"
        })
        return response.json().get("token")
    
    def test_can_create_store_manager_user(self, admin_token):
        """Verify STORE_MANAGER role can be used when creating users"""
        # First get list of stores
        stores_resp = requests.get(
            f"{BASE_URL}/api/stores",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        store_id = None
        if stores_resp.status_code == 200 and stores_resp.json().get("stores"):
            store_id = stores_resp.json()["stores"][0]["id"]
        
        # Try creating store manager user
        user_data = {
            "email": "TEST_storemanager@test.com",
            "password": "test123",
            "full_name": "TEST Store Manager",
            "role": "STORE_MANAGER",
            "store_id": store_id
        }
        
        response = requests.post(
            f"{BASE_URL}/api/users",
            json=user_data,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        # Either 201 (created) or 400 (already exists) is acceptable
        assert response.status_code in [200, 201, 400], f"Unexpected status: {response.status_code}: {response.text}"
        
        if response.status_code == 400 and "already exists" in response.text.lower():
            print("User already exists - role is valid")
        elif response.status_code in [200, 201]:
            print(f"Store manager user created successfully: {response.json()}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
