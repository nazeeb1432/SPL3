"""Database package for filter management"""
from .operations import (
    get_user_filters, 
    add_filter, 
    update_filter, 
    remove_filter,
    get_user_preferences,
    log_processing,
    log_processing_async,
    save_custom_feed,
    get_user_custom_feeds,
    get_custom_feed_by_id,
    delete_custom_feed,
    update_user_info,
    get_feeds_by_comparison_set,
    get_comparison_sets_for_user,
    get_user_by_email,
    create_user_with_email
)
from .models import User, Filter, CustomFeed

__all__ = [
    'get_user_filters',
    'add_filter',
    'update_filter',
    'remove_filter',
    'get_user_preferences',
    'log_processing',
    'log_processing_async',
    'save_custom_feed',
    'get_user_custom_feeds',
    'get_custom_feed_by_id',
    'delete_custom_feed',
    'User',
    'Filter',
    'CustomFeed',
    'update_user_info',
    'get_feeds_by_comparison_set',
    'get_comparison_sets_for_user',
    'get_user_by_email',
    'create_user_with_email'
]