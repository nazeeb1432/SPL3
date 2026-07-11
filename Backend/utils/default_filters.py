"""Helper module for creating default test filters for new users"""
from typing import List, Dict, Any
from utils.config import ConfigManager
from database.models import ContentType

def get_default_filters() -> List[Dict[str, Any]]:
    """Return list of default test filters from config"""
    config = ConfigManager()
    testing_config = config.get_testing_config()
    
    # Get default filters from config, or return empty list if none configured
    default_filters = testing_config.default_filters  # Access attribute directly
    
    # Transform config format to database format
    processed_filters = []
    for filter_data in default_filters:
        # Convert content_type to proper enum value
        content_type_str = filter_data.get('content_type', 'all').lower()
        try:
            # Validate content type matches enum
            content_type = ContentType[content_type_str].value
        except KeyError:
            content_type = ContentType.all.value
            
        processed_filter = {
            'filter_text': filter_data['filter_text'],  # These fields are required in config
            'intensity': filter_data['intensity'],
            'content_type': content_type,  # Now properly validated
            'filter_type': filter_data.get('filter_type',''),
            'is_temporary': filter_data.get('is_temporary', False),
            'filter_metadata': {  # Transform filter_metadata to metadata for database
                'source': 'test',
                **(filter_data.get('filter_metadata', {}))
            },
            'expires_at': None  # Ensure non-temporary filters don't expire
        }
        processed_filters.append(processed_filter)
            
    return processed_filters