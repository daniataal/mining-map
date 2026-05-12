import logging

logger = logging.getLogger(__name__)

def calculate_operational_score(signals):
    """
    Build an operational score using multiple signals.
    Example weights:
    - vessel movement
    - satellite signal
    - news signal
    - trade signal
    - ownership signal
    - manual review signal
    """
    score = 50.0 # Default starting score
    explanation = "Initial baseline score."
    
    # Process signals...
    
    status = _determine_status(score)
    return score, status, explanation

def _determine_status(score):
    if score >= 80:
        return 'ACTIVE'
    elif score >= 60:
        return 'LIKELY_ACTIVE'
    elif score >= 40:
        return 'DEGRADED'
    elif score >= 20:
        return 'LIKELY_INACTIVE'
    elif score > 0:
        return 'INACTIVE'
    else:
        return 'UNKNOWN'
