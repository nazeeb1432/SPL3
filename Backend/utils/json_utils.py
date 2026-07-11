"""Utilities for safe JSON handling"""
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

def safe_json_loads(content: str, default_value: Any = None) -> Any:
    """Safely parse JSON content with detailed error logging"""
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error at position {e.pos}: {e.msg}")
        logger.debug(f"Problem content: {content[max(0, e.pos-50):min(len(content), e.pos+50)]}")
        return default_value

def validate_llm_response(content: str, required_fields: list) -> Optional[Dict]:
    """Validate LLM response has required fields and is valid JSON"""
    try:
        data = json.loads(content)
        if not isinstance(data, dict):
            logger.error(f"Expected dict response, got {type(data)}")
            return None
            
        missing = [field for field in required_fields if field not in data]
        if missing:
            logger.error(f"Missing required fields: {missing}")
            return None
            
        return data
        
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in LLM response: {e}")
        logger.debug(f"Raw response: {content}")
        return None