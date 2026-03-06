#!/usr/bin/env python3
"""
Backend API Testing for Batch C Intelligence Features
Tests supplier intelligence, purchase recommendation, and enhanced store performance APIs
"""

import requests
import sys
from datetime import datetime
import json

class BatchCIntelligenceTester:
    def __init__(self):
        self.base_url = "https://sahakar-inventory-ai.preview.emergentagent.com/api"
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        
    def run_test(self, name, method, endpoint, expected_status, data=None, auth_required=True):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if auth_required and self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        
        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                return True, response.json() if response.content else {}
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                self.log(f"   Response: {response.text[:200]}")
                self.failed_tests.append(f"{name}: {response.status_code} - {response.text[:100]}")
                return False, {}
                
        except Exception as e:
            self.log(f"❌ {name} - Exception: {str(e)}")
            self.failed_tests.append(f"{name}: Exception - {str(e)}")
            return False, {}
    
    def test_login(self):
        """Test admin login to get auth token"""
        self.log("=== Authentication Test ===")
        success, response = self.run_test(
            "Admin Login",
            "POST", 
            "auth/login",
            200,
            {"email": "admin@sahakar.com", "password": "admin123"},
            auth_required=False
        )
        
        if success and 'token' in response:
            self.token = response['token']
            self.log(f"🔑 Authentication successful, token received")
            return True
        return False
    
    def test_supplier_intelligence(self):
        """Test supplier intelligence endpoint"""
        self.log("\n=== Supplier Intelligence Tests ===")
        
        success, response = self.run_test(
            "Supplier Intelligence",
            "GET",
            "intel/supplier-intelligence", 
            200
        )
        
        if success:
            # Validate response structure
            required_keys = ['suppliers', 'total_suppliers', 'best_per_product']
            for key in required_keys:
                if key not in response:
                    self.log(f"❌ Missing key in response: {key}")
                    return False
            
            self.log(f"   📊 Found {response.get('total_suppliers', 0)} suppliers")
            self.log(f"   📦 Best supplier data for {len(response.get('best_per_product', []))} products")
            
            # Check suppliers structure
            if response['suppliers']:
                supplier = response['suppliers'][0]
                supplier_keys = ['supplier', 'product_count', 'avg_ptr', 'avg_landing_cost', 'sample_products']
                for key in supplier_keys:
                    if key not in supplier:
                        self.log(f"❌ Missing supplier key: {key}")
                        return False
            
            # Check best_per_product structure
            if response['best_per_product']:
                product = response['best_per_product'][0]
                product_keys = ['product_id', 'product_name', 'best_supplier', 'ptr', 'landing_cost', 'mrp', 'margin_pct']
                for key in product_keys:
                    if key not in product:
                        self.log(f"❌ Missing best_per_product key: {key}")
                        return False
            
            return True
        return False
    
    def test_purchase_recommendation(self):
        """Test purchase recommendation endpoint"""
        self.log("\n=== Purchase Recommendation Tests ===")
        
        # Test with sample product ID from agent context (P001 mentioned)
        product_ids = ["P001", "P002"]  # Based on agent context
        
        for product_id in product_ids:
            success, response = self.run_test(
                f"Purchase Recommendation for {product_id}",
                "GET",
                f"intel/purchase-recommendation/{product_id}",
                200
            )
            
            if success:
                # Validate response structure
                required_keys = ['product_id', 'product_name', 'recommendation', 'reason', 
                               'ho_stock', 'store_stocks', 'total_network', 'supplier_options']
                for key in required_keys:
                    if key not in response:
                        self.log(f"❌ Missing key in response: {key}")
                        return False
                
                recommendation = response.get('recommendation')
                if recommendation not in ['transfer', 'purchase', 'product_not_found']:
                    self.log(f"❌ Invalid recommendation type: {recommendation}")
                    return False
                
                self.log(f"   🎯 Recommendation for {product_id}: {recommendation}")
                self.log(f"   📦 Network stock: {response.get('total_network', 0)} units")
                
                if recommendation == 'transfer':
                    # Should have network stock
                    if response.get('total_network', 0) <= 0:
                        self.log(f"❌ Transfer recommended but no network stock")
                        return False
                elif recommendation == 'purchase':
                    # Should have supplier options
                    if not response.get('supplier_options'):
                        self.log(f"❌ Purchase recommended but no supplier options")
                        return False
        
        # Test with non-existent product
        success, response = self.run_test(
            "Purchase Recommendation for non-existent product",
            "GET", 
            "intel/purchase-recommendation/INVALID_ID",
            200
        )
        
        if success and response.get('recommendation') == 'product_not_found':
            self.log("   ✅ Correctly handled non-existent product")
        
        return True
    
    def test_store_performance(self):
        """Test enhanced store performance endpoint"""
        self.log("\n=== Enhanced Store Performance Tests ===")
        
        success, response = self.run_test(
            "Enhanced Store Performance",
            "GET",
            "intel/store-performance",
            200
        )
        
        if success:
            # Validate response structure
            if 'stores' not in response:
                self.log(f"❌ Missing 'stores' key in response")
                return False
            
            stores = response['stores']
            if not stores:
                self.log("⚠️  No stores found in response")
                return True
            
            # Check store structure
            store = stores[0]
            required_keys = [
                'store_id', 'store_name', 'store_code',
                'customer_count', 'rc_count', 'retention_pct', 
                'total_clv', 'avg_clv', 'high_value_customers',
                'stock_value', 'total_stock', 'turnover', 
                'sales_revenue', 'overdue_meds'
            ]
            
            for key in required_keys:
                if key not in store:
                    self.log(f"❌ Missing store key: {key}")
                    return False
            
            self.log(f"   🏪 Found {len(stores)} stores")
            self.log(f"   👥 Sample store customers: {store.get('customer_count', 0)}")
            self.log(f"   💰 Sample store CLV: {store.get('total_clv', 0)}")
            self.log(f"   📊 Sample retention: {store.get('retention_pct', 0)}%")
            
            return True
        return False
    
    def test_existing_endpoints(self):
        """Test that existing intelligence endpoints still work"""
        self.log("\n=== Existing Intelligence Endpoints Tests ===")
        
        endpoints = [
            ("Intelligence Dashboard", "intel/dashboard"),
            ("Demand Forecast", "intel/demand-forecast"),
            ("Expiry Risk", "intel/expiry-risk"),
            ("Redistribution", "intel/redistribution"),
        ]
        
        all_passed = True
        for name, endpoint in endpoints:
            success, _ = self.run_test(name, "GET", endpoint, 200)
            if not success:
                all_passed = False
        
        return all_passed
    
    def run_all_tests(self):
        """Run comprehensive test suite"""
        self.log("🚀 Starting Batch C Intelligence API Tests")
        self.log("=" * 60)
        
        # 1. Authentication
        if not self.test_login():
            self.log("❌ Authentication failed - stopping tests")
            return False
        
        # 2. New Batch C endpoints
        tests = [
            self.test_supplier_intelligence,
            self.test_purchase_recommendation, 
            self.test_store_performance,
            self.test_existing_endpoints
        ]
        
        for test_func in tests:
            try:
                test_func()
            except Exception as e:
                self.log(f"❌ Test function failed: {str(e)}")
        
        # 3. Results summary
        self.log("\n" + "=" * 60)
        self.log(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            self.log("\n❌ Failed Tests:")
            for failure in self.failed_tests:
                self.log(f"   • {failure}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"✨ Success Rate: {success_rate:.1f}%")
        
        return success_rate >= 80  # 80% success threshold


def main():
    """Main test runner"""
    tester = BatchCIntelligenceTester()
    
    try:
        success = tester.run_all_tests()
        return 0 if success else 1
    except KeyboardInterrupt:
        print("\n🛑 Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"💥 Fatal error: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())