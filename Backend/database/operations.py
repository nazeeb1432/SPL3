"""Database operations for filter management"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
from contextlib import contextmanager
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime
import asyncio
from .models import Base, User, Filter, ProcessingLog, ContentType, CustomFeed, HumanPreference
from utils.config import ConfigManager

logger = logging.getLogger(__name__)

# Initialize database connection using config
config = ConfigManager().get_database_config()
engine = create_engine(
    config.url,
    pool_size=config.pool_size,
    max_overflow=config.max_overflow
)
SessionLocal = sessionmaker(bind=engine)

@contextmanager
def get_db():
    """Provide a transactional scope around a series of operations"""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception as e:
        logger.error(f"Database error: {e}", exc_info=True)
        session.rollback()
        raise
    finally:
        session.close()


def update_user_info(user_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    """Update or create a user with the given email address"""
    with get_db() as db:
        user = db.query(User).filter(User.id == user_id).first()
        is_new_user = user is None
        
        if is_new_user:
            user = User(id=user_id, email=email)
            db.add(user)
            logger.info(f"Created new user {user_id} with email {email}")
        else:
            if email and email != user.email:
                user.email = email
                logger.info(f"Updated email for user {user_id} to {email}")
        
        db.flush()
        
        return {
            "id": user.id,
            "email": user.email,
        }

def get_user_filters(user_id: str) -> List[Dict[str, Any]]:
    """Get active, non-expired filters for a user"""
    with get_db() as db:
        # Check if user exists
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            user = User(id=user_id)
            db.add(user)
            db.flush()
            logger.info(f"Created new user {user_id} in database")
        else:
            user.last_active = func.now()
            logger.info(f"Found existing user {user_id} (created: {user.created_at}, last active: {user.last_active})")
            
        # If configured, add default filters for new user
        if not user.filters:  # Only add default filters if user has no filters
            config = ConfigManager()
            testing_config = config.get_testing_config()
            if testing_config.create_default_filters:  # Access attribute directly instead of using .get()
                logger.info(f"Creating default test filters for user {user_id}")
                # Import here to avoid circular import
                from utils.default_filters import get_default_filters
                for default_filter in get_default_filters():
                    new_filter = Filter(
                        user_id=user_id,
                        **default_filter
                    )
                    db.add(new_filter)
                db.flush()
        
        # Get active filters
        filters = (
            db.query(Filter)
            .filter(
                Filter.user_id == user_id,
                Filter.is_active == True,
                (Filter.expires_at.is_(None) | (Filter.expires_at > datetime.now()))
            )
            .all()
        )
        
        logger.info(f"Found {len(filters)} active filters for user {user_id}")
        
        return [
            {
                "id": f.id,
                "filter_text": f.filter_text,
                "filter_type": f.filter_type,
                "content_type": f.content_type.name if isinstance(f.content_type, ContentType) else f.content_type,  # Handle both enum and string cases
                "intensity": f.intensity,
                "filter_metadata": f.filter_metadata or {},
                "is_temporary": f.is_temporary,
                "expires_at": f.expires_at.isoformat() if f.expires_at else None
            }
            for f in filters
        ]

def add_filter(user_id: str, filter_data: Dict[str, Any]) -> int:
    """Add a new filter for a user"""
    with get_db() as db:
        # Check if user exists by explicitly querying
        user = db.query(User).filter(User.id == user_id).first()
        is_new_user = user is None or user.created_at is None
        
        if is_new_user:
            user = User(id=user_id)
            db.add(user)
            db.flush()
            
        # Convert content_type string to enum
        content_type_str = filter_data.get('content_type', 'all').lower()
        try:
            content_type = ContentType[content_type_str]
        except KeyError:
            logger.warning(f"Invalid content_type '{content_type_str}', defaulting to 'all'")
            content_type = ContentType.all
        
        # Create filter with renamed metadata field
        new_filter = Filter(
            user_id=user_id,
            filter_text=filter_data['filter_text'],
            filter_type=filter_data.get('filter_type'),
            content_type=content_type,
            intensity=filter_data['intensity'],
            filter_metadata=filter_data.get('metadata', {}),
            is_temporary=filter_data.get('is_temporary', False),
            expires_at=filter_data.get('expires_at')
        )
        db.add(new_filter)
        db.flush()
        return new_filter.id

def update_filter(user_id: str, filter_id: int, filter_data: Dict[str, Any]) -> bool:
    """Update an existing filter"""
    with get_db() as db:
        filter_obj = db.query(Filter).filter(
            Filter.id == filter_id,
            Filter.user_id == user_id,
            Filter.is_active == True
        ).first()
        
        if not filter_obj:
            return False
            
        # Update fields if provided
        if 'filter_text' in filter_data:
            filter_obj.filter_text = filter_data['filter_text']
        if 'filter_type' in filter_data:
            filter_obj.filter_type = filter_data['filter_type']
        if 'content_type' in filter_data:
            try:
                filter_obj.content_type = ContentType[filter_data['content_type'].lower()]
            except KeyError:
                logger.warning(f"Invalid content_type '{filter_data['content_type']}', ignoring update")
        if 'intensity' in filter_data:
            filter_obj.intensity = filter_data['intensity']
        if 'metadata' in filter_data:
            filter_obj.metadata = filter_data['metadata']
        if 'expires_at' in filter_data:
            filter_obj.expires_at = filter_data['expires_at']
        if 'is_temporary' in filter_data:
            filter_obj.is_temporary = filter_data['is_temporary']
        
        return True

def remove_filter(user_id: str, filter_id: int) -> bool:
    """Soft delete a filter by marking it inactive"""
    with get_db() as db:
        filter_obj = db.query(Filter).filter(
            Filter.id == filter_id,
            Filter.user_id == user_id,
            Filter.is_active == True
        ).first()
        
        if not filter_obj:
            return False
            
        filter_obj.is_active = False
        return True

async def log_processing_async(
    user_id: str,
    platform: str,
    content_hash: str,
    matched_filters: List[int],
    processing_time: float,
    processing_metadata: Optional[Dict] = None
) -> None:
    """Async version of log_processing"""
    def _do_log():
        with get_db() as db:
            log = ProcessingLog(
                user_id=user_id,
                platform=platform,
                content_hash=content_hash,
                matched_filters=matched_filters,
                processing_time=processing_time,
                processing_metadata=processing_metadata
            )
            db.add(log)
    
    # Run database operation in a thread pool
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _do_log)

def log_processing(
    user_id: str,
    platform: str,
    content_hash: str,
    matched_filters: List[int],
    processing_time: float,
    processing_metadata: Optional[Dict] = None
) -> None:
    """Log content processing details - handles both sync and async contexts"""
    try:
        loop = asyncio.get_running_loop()
        # We're in an async context
        coroutine = log_processing_async(
            user_id=user_id,
            platform=platform,
            content_hash=content_hash,
            matched_filters=matched_filters,
            processing_time=processing_time,
            processing_metadata=processing_metadata
        )
        asyncio.create_task(coroutine)
    except RuntimeError:
        # We're in a sync context
        with get_db() as db:
            log = ProcessingLog(
                user_id=user_id,
                platform=platform,
                content_hash=content_hash,
                matched_filters=matched_filters,
                processing_time=processing_time,
                processing_metadata=processing_metadata
            )
            db.add(log)

def get_user_preferences(user_id: str) -> Dict[str, Any]:
    """Get user preferences"""
    with get_db() as db:
        user = db.query(User).filter(User.id == user_id).first()
        is_new_user = user is None or user.created_at is None
        
        if is_new_user:
            user = User(id=user_id)
            db.add(user)
            db.flush()
        return user.preferences or {}

# Custom Feed Operations
def save_custom_feed(
    user_id: str, 
    title: str, 
    feed_html: str, 
    metadata: Optional[Dict[str, Any]] = None,
    comparison_set_id: Optional[str] = None,
    feed_type: Optional[str] = None,
    filter_config: Optional[Dict[str, Any]] = None
) -> int:
    """Save a custom feed for a user and return the feed ID"""
    with get_db() as db:
        # Ensure user exists
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            user = User(id=user_id)
            db.add(user)
            db.flush()
            logger.info(f"Created new user {user_id} while saving custom feed")
        
        # Create custom feed
        custom_feed = CustomFeed(
            user_id=user_id,
            title=title,
            feed_html=feed_html,
            feed_metadata=metadata,
            comparison_set_id=comparison_set_id,
            feed_type=feed_type,
            filter_config=filter_config
        )
        db.add(custom_feed)
        db.flush()
        
        logger.info(f"Saved custom feed '{title}' for user {user_id}, ID: {custom_feed.id}")
        return custom_feed.id

def get_user_custom_feeds(user_id: str) -> List[Dict[str, Any]]:
    """Get list of custom feeds for a user (without full HTML)"""
    with get_db() as db:
        feeds = db.query(CustomFeed).filter(
            CustomFeed.user_id == user_id
        ).order_by(CustomFeed.created_at.desc()).all()
        
        return [{
            "id": feed.id,
            "title": feed.title,
            "created_at": feed.created_at.isoformat() if feed.created_at else None,
            "metadata": feed.feed_metadata
        } for feed in feeds]

def get_custom_feed_by_id(feed_id: int) -> Optional[Dict[str, Any]]:
    """Get a specific custom feed by ID (includes full HTML)"""
    with get_db() as db:
        feed = db.query(CustomFeed).filter(CustomFeed.id == feed_id).first()
        
        if not feed:
            return None
            
        return {
            "id": feed.id,
            "user_id": feed.user_id,
            "title": feed.title,
            "feed_html": feed.feed_html,
            "metadata": feed.feed_metadata,
            "created_at": feed.created_at.isoformat() if feed.created_at else None
        }

def delete_custom_feed(feed_id: int, user_id: str) -> bool:
    """Delete a custom feed (only if owned by the user)"""
    with get_db() as db:
        feed = db.query(CustomFeed).filter(
            CustomFeed.id == feed_id,
            CustomFeed.user_id == user_id
        ).first()
        
        if not feed:
            return False
            
        db.delete(feed)
        logger.info(f"Deleted custom feed {feed_id} for user {user_id}")
        return True

def get_feeds_by_comparison_set(user_id: str, comparison_set_id: str) -> List[Dict[str, Any]]:
    """Get all feeds in a comparison set (original + filtered versions)"""
    with get_db() as db:
        feeds = db.query(CustomFeed).filter(
            CustomFeed.user_id == user_id,
            CustomFeed.comparison_set_id == comparison_set_id
        ).order_by(CustomFeed.created_at.asc()).all()
        
        return [{
            "id": feed.id,
            "user_id": feed.user_id,
            "title": feed.title,  
            "feed_html": feed.feed_html,
            "metadata": feed.feed_metadata,
            "comparison_set_id": feed.comparison_set_id,
            "feed_type": feed.feed_type,
            "filter_config": feed.filter_config,
            "created_at": feed.created_at.isoformat() if feed.created_at else None
        } for feed in feeds]

def get_comparison_sets_for_user(user_id: str) -> List[Dict[str, Any]]:
    """Get all comparison sets for a user with summary info"""
    with get_db() as db:
        # Get unique comparison_set_ids for this user
        comparison_sets = db.query(CustomFeed.comparison_set_id).filter(
            CustomFeed.user_id == user_id,
            CustomFeed.comparison_set_id.is_not(None)
        ).distinct().all()
        
        result = []
        for (comparison_set_id,) in comparison_sets:
            feeds = db.query(CustomFeed).filter(
                CustomFeed.user_id == user_id,
                CustomFeed.comparison_set_id == comparison_set_id
            ).all()
            
            # Find original and count filtered versions
            original_feed = None
            filtered_feeds = []
            
            for feed in feeds:
                if feed.feed_type == "original":
                    original_feed = feed
                elif feed.feed_type == "filtered":
                    filtered_feeds.append(feed)
            
            if original_feed:  # Only include sets that have an original
                result.append({
                    "comparison_set_id": comparison_set_id,
                    "original_title": original_feed.title,
                    "original_created_at": original_feed.created_at.isoformat() if original_feed.created_at else None,
                    "filtered_count": len(filtered_feeds),
                    "latest_filtered_at": max([f.created_at for f in filtered_feeds]).isoformat() if filtered_feeds else None
                })
        
        # Sort by original creation date, newest first
        result.sort(key=lambda x: x["original_created_at"], reverse=True)
        return result

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get user information by email address"""
    with get_db() as db:
        user = db.query(User).filter(User.email == email).first()
        
        if not user:
            return None
            
        return {
            "id": user.id,
            "email": user.email,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_active": user.last_active.isoformat() if user.last_active else None
        }

def create_user_with_email(email: str) -> Dict[str, Any]:
    """Create a new user with email (generates user_id from email)"""
    import hashlib
    import uuid
    
    with get_db() as db:
        # Check if user already exists
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user:
            return {
                "id": existing_user.id,
                "email": existing_user.email,
                "created_at": existing_user.created_at.isoformat() if existing_user.created_at else None,
                "is_new": False
            }
        
        # Generate user_id from email (deterministic but unique)
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()[:8]
        user_id = f"user_{email_hash}"
        
        # Ensure uniqueness (in case of hash collision)
        while db.query(User).filter(User.id == user_id).first():
            user_id = f"user_{uuid.uuid4().hex[:8]}"
        
        # Create new user
        new_user = User(id=user_id, email=email)
        db.add(new_user)
        db.flush()
        
        logger.info(f"Created new user {user_id} with email {email}")
        
        return {
            "id": new_user.id,
            "email": new_user.email,
            "created_at": new_user.created_at.isoformat() if new_user.created_at else None,
            "is_new": True
        }

# Human Preference Operations
def save_human_preferences(
    user_id: str,
    comparison_set_id: str,
    preferences: List[Dict[str, Any]]
) -> int:
    """Save human preferences for post comparisons and return the count of saved preferences"""
    with get_db() as db:
        # Ensure user exists
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logger.warning(f"User {user_id} not found when saving preferences")
            return 0
        
        saved_count = 0
        for pref_data in preferences:
            # Validate that at least one preference is set
            if pref_data.get('text_preference') is None and pref_data.get('image_preference') is None:
                continue
            
            # Check if preference already exists for this post
            # existing = db.query(HumanPreference).filter_by(
            #     user_id=user_id,
            #     comparison_set_id=comparison_set_id,
            #     post_id=pref_data['post_id']
            # ).first()
            
            # if existing:
            #     # Update existing preference
            #     existing.post0_text_content = pref_data['post0_text_content']
            #     existing.post1_text_content = pref_data['post1_text_content']
            #     existing.text_preference = pref_data.get('text_preference')
            #     existing.post0_image_url = pref_data.get('post0_image_url', '')
            #     existing.post1_image_url = pref_data.get('post1_image_url', '')
            #     existing.image_preference = pref_data.get('image_preference')
            #     logger.info(f"Updated preference for user {user_id}, post {pref_data['post_id']}")
            # else:
                # Create new preference
            human_pref = HumanPreference(
                user_id=user_id,
                comparison_set_id=comparison_set_id,
                post_id=pref_data['post_id'],
                post0_text_content=pref_data['post0_text_content'],
                post1_text_content=pref_data['post1_text_content'],
                text_preference=pref_data.get('text_preference'),
                post0_image_url=pref_data.get('post0_image_url', ''),
                post1_image_url=pref_data.get('post1_image_url', ''),
                image_preference=pref_data.get('image_preference')
            )
            db.add(human_pref)
            logger.info(f"Created new preference for user {user_id}, post {pref_data['post_id']}")
            
            saved_count += 1
        
        logger.info(f"Saved {saved_count} preferences for user {user_id} in comparison set {comparison_set_id}")
        return saved_count

def get_human_preferences(
    user_id: str, 
    comparison_set_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get human preferences for a user, optionally filtered by comparison set"""
    with get_db() as db:
        query = db.query(HumanPreference).filter_by(user_id=user_id)
        
        if comparison_set_id:
            query = query.filter_by(comparison_set_id=comparison_set_id)
        
        preferences = query.order_by(HumanPreference.created_at.desc()).all()
        
        return [{
            "id": pref.id,
            "comparison_set_id": pref.comparison_set_id,
            "post_id": pref.post_id,
            "post0_text_content": pref.post0_text_content,
            "post1_text_content": pref.post1_text_content,
            "text_preference": pref.text_preference,
            "post0_image_url": pref.post0_image_url,
            "post1_image_url": pref.post1_image_url,
            "image_preference": pref.image_preference,
            "created_at": pref.created_at.isoformat() if pref.created_at else None
        } for pref in preferences]

def delete_human_preferences(user_id: str, comparison_set_id: str) -> int:
    """Delete all human preferences for a user in a specific comparison set"""
    with get_db() as db:
        deleted_count = db.query(HumanPreference).filter_by(
            user_id=user_id,
            comparison_set_id=comparison_set_id
        ).delete()
        
        logger.info(f"Deleted {deleted_count} preferences for user {user_id} in comparison set {comparison_set_id}")
        return deleted_count

def get_human_preference_stats(comparison_set_id: str) -> Dict[str, Any]:
    """Get aggregated statistics for human preferences in a comparison set"""
    with get_db() as db:
        preferences = db.query(HumanPreference).filter_by(
            comparison_set_id=comparison_set_id
        ).all()
        
        if not preferences:
            return {
                "total_responses": 0,
                "unique_users": 0,
                "posts_evaluated": 0,
                "text_preference_stats": {},
                "image_preference_stats": {}
            }
        
        # Calculate statistics
        unique_users = len(set(pref.user_id for pref in preferences))
        unique_posts = len(set(pref.post_id for pref in preferences))
        
        text_prefs = [pref.text_preference for pref in preferences if pref.text_preference is not None]
        image_prefs = [pref.image_preference for pref in preferences if pref.image_preference is not None]
        
        text_stats = {
            "total_responses": len(text_prefs),
            "left_preferred": text_prefs.count(0),
            "right_preferred": text_prefs.count(1),
            "left_percentage": (text_prefs.count(0) / len(text_prefs) * 100) if text_prefs else 0,
            "right_percentage": (text_prefs.count(1) / len(text_prefs) * 100) if text_prefs else 0
        }
        
        image_stats = {
            "total_responses": len(image_prefs),
            "left_preferred": image_prefs.count(0),
            "right_preferred": image_prefs.count(1),
            "left_percentage": (image_prefs.count(0) / len(image_prefs) * 100) if image_prefs else 0,
            "right_percentage": (image_prefs.count(1) / len(image_prefs) * 100) if image_prefs else 0
        }
        
        return {
            "total_responses": len(preferences),
            "unique_users": unique_users,
            "posts_evaluated": unique_posts,
            "text_preference_stats": text_stats,
            "image_preference_stats": image_stats
        }