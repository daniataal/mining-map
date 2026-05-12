import pytest
from backend.services.dd.orchestrator import run_dd_pack

def test_run_dd_pack():
    entity_data = {"name": "Test Mine", "sector": "mining"}
    raw_evidence = [{"source": "GDELT", "content": "test"}]
    
    result = run_dd_pack(entity_data, raw_evidence)
    
    assert "status" in result
    assert result["status"] in ["Completed", "Skipped"]
    assert "findings" in result
    assert "risk_level" in result
