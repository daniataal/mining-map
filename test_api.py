import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000"

def test_delete_flow():
    # 1. Create a test license
    new_license = {
        "company": "TEST_DELETE_COMPANY",
        "country": "Ghana",
        "lat": 0.0,
        "lng": 0.0,
        "status": "Operating"
    }
    
    print("Creating test license...")
    try:
        res = requests.post(f"{BASE_URL}/licenses", json=new_license)
        print(f"Create status: {res.status_code}")
        if res.status_code != 200:
            print(res.text)
            return
            
        data = res.json()
        lic_id = data['id']
        print(f"Created ID: {lic_id}")
        
    except Exception as e:
        print(f"Failed to connect: {e}")
        return

    # 2. Try to delete it
    print(f"Deleting ID: {lic_id}")
    res = requests.delete(f"{BASE_URL}/licenses/{lic_id}")
    print(f"Delete status: {res.status_code}")
    print(res.text)

if __name__ == "__main__":
    test_delete_flow()
