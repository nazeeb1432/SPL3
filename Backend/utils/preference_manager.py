"""User preference management"""
from typing import Dict, Any, Optional
import logging
from datetime import datetime
from pydantic import BaseModel
from utils.config import ConfigManager

logger = logging.getLogger(__name__)

class UserPreferences(BaseModel):
    """User preferences model"""
    mode: str = "balanced"  # balanced|aggressive
    default_intensity: int = 3
    cache_duration: int = 0
    last_updated: Optional[datetime] = None

class PreferenceManager:
    """Manages user preferences and settings"""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        # Get preferences - no need to create defaults here since get_user_filters handles it
        self.preferences = self._load_preferences()
        
    def _load_preferences(self) -> Dict[str, Any]:
        """Load user preferences from database"""
        # Import here to avoid circular import
        from database import get_user_preferences
        return get_user_preferences(self.user_id)
        
    def get_processing_config(self) -> Dict[str, Any]:
        """Get content processing configuration"""
        config = ConfigManager().get_processing_config()
        return {
            "mode": self.preferences.get("mode", config.default_mode),
            "default_intensity": self.preferences.get("default_intensity", config.default_intensity),
            "cache_duration": self.preferences.get("cache_duration", config.cache_timeout)
        }