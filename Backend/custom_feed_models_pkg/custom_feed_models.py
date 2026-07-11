"""
Custom Feed Models - Isolated from main application models
These models are used exclusively for the custom Reddit feed processing feature
and do not interact with the browser extension functionality.
"""

from pydantic import BaseModel
from typing import List, Literal, Optional, Dict, Any
from datetime import datetime


class CustomFeedPost(BaseModel):
    """Individual post in a custom feed with explicit intervention types"""
    post_html: str
    text_intervention: Optional[Literal["blur", "overlay", "rewrite"]] = None
    image_intervention: Optional[Literal["overlay", "blur", "replacement", "cartoonish","stylization","stylize_cubism","stylize_impressionism","stylize_ghibli","stylize_pointillism","occlusion","selectivestylization","selective_stylize_cubism","selective_stylize_impressionism","selective_stylize_ghibli","selective_stylize_pointillism","inpainting","warning","shrink"]] = None
    post_id: Optional[str] = None  # Optional identifier for tracking


class CustomFeedRequest(BaseModel):
    """Request to process a custom Reddit feed"""
    user_id: str  # User ID for tracking, not used in custom feeds
    session_id: str  # Using session_id instead of user_id to maintain separation
    posts: List[CustomFeedPost]
    return_original: bool = True  # Whether to return original HTML alongside processed


class ProcessedPost(BaseModel):
    """Result of processing a single custom post"""
    post_id: Optional[str] = None
    original_html: Optional[str] = None
    processed_html: str
    text_intervention_applied: Optional[str] = None
    image_intervention_applied: Optional[str] = None
    image_processing_status: Optional[Dict[str, Any]] = None  # For deferred image processing
    processing_time_ms: Optional[float] = None
    errors: Optional[List[str]] = None


class CustomFeedResponse(BaseModel):
    """Response containing all processed posts"""
    session_id: str
    processed_posts: List[ProcessedPost]
    total_processing_time_ms: float
    timestamp: datetime = None
    
    def __init__(self, **data):
        if 'timestamp' not in data:
            data['timestamp'] = datetime.now()
        super().__init__(**data)


# Human Preference Models
class PostPreference(BaseModel):
    """Individual post preference submission"""
    post_id: str
    post0_text_content: str
    post1_text_content: str
    text_preference: Optional[Literal[0, 1]] = None
    post0_image_url: Optional[str] = None
    post1_image_url: Optional[str] = None
    image_preference: Optional[Literal[0, 1]] = None


class HumanPreferenceSubmission(BaseModel):
    """Request to submit human preferences for posts"""
    user_id: str
    comparison_set_id: str
    preferences: List[PostPreference]


class HumanPreferenceResponse(BaseModel):
    """Response after saving human preferences"""
    success: bool
    saved_count: int
    message: str
    timestamp: datetime = None
    
    def __init__(self, **data):
        if 'timestamp' not in data:
            data['timestamp'] = datetime.now()
        super().__init__(**data)


class CustomFeedAutoFilterRequest(BaseModel):
    """Request to process custom feed using user's saved filters"""
    session_id: str
    user_id: str  # Required to fetch user's filters from database
    posts: List[Dict[str, Any]]  # Just post HTML, no intervention specified
    return_original: bool = True
    use_user_filters: bool = True


class CustomFeedWebSocketMessage(BaseModel):
    """WebSocket message format for custom feed processing"""
    type: Literal["custom_feed_process", "custom_feed_result", "custom_feed_error", "custom_feed_auto_filter"]
    session_id: str
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class InterventionConfig(BaseModel):
    """Configuration for a specific intervention type"""
    type: str
    parameters: Optional[Dict[str, Any]] = None
    
    
class ImageInterventionResult(BaseModel):
    """Result of applying an image intervention"""
    intervention_type: str
    status: Literal["completed", "deferred", "failed"]
    result_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class SaveCustomFeedRequest(BaseModel):
    """Request to save a custom feed"""
    user_id: str
    title: Optional[str] = None
    feed_html: str
    metadata: Optional[Dict[str, Any]] = None


class SaveCustomFeedResponse(BaseModel):
    """Response after saving a custom feed"""
    feed_id: int
    title: str
    message: str


class CustomFeedListItem(BaseModel):
    """Item in custom feed list"""
    id: int
    title: str
    created_at: str
    metadata: Optional[Dict[str, Any]] = None


class CustomFeedListResponse(BaseModel):
    """Response for listing custom feeds"""
    feeds: List[CustomFeedListItem]
    count: int


class CustomFeedRetrieveResponse(BaseModel):
    """Response for retrieving a custom feed"""
    id: int
    user_id: str
    title: str
    feed_html: str
    metadata: Optional[Dict[str, Any]] = None
    created_at: str