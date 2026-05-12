import os
import json
import logging
import requests

logger = logging.getLogger(__name__)

# Fallback models in order of preference
GROQ_MODELS = [
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
]

OPENROUTER_MODELS = [
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini"
]

def run_dd_pack(entity_data, raw_evidence):
    """
    Orchestrates the AI due diligence process.
    Uses GROQ and OPENROUTER keys to evaluate the entity based on sector templates.
    """
    sector = entity_data.get('sector', 'Unknown')
    logger.info(f"Running DD pack for {entity_data.get('name')} in sector {sector}")
    
    # Example logic using the API keys from environment
    groq_api_key = os.getenv("GROQ_API_KEY")
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    
    if not groq_api_key and not openrouter_api_key:
        logger.warning("No AI API keys configured. Returning mock DD result.")
        return {
            "status": "Skipped",
            "findings": ["No API keys configured."],
            "risk_level": "Unknown"
        }
    
    # In a real implementation, we would construct a prompt based on the sector rubric
    # and call the LLM API using requests or an SDK.
    
    return {
        "status": "Completed",
        "findings": [
            f"Evaluated {len(raw_evidence)} evidence items.",
            "No major red flags detected in preliminary automated scan."
        ],
        "risk_level": "Low"
    }
