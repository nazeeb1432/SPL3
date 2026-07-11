"""Database models for content filtering"""
from sqlalchemy import (
    create_engine, Column, Integer, String, JSON, 
    DateTime, ForeignKey, Boolean, Float, Enum
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
from typing import List, Dict, Any, Optional
from datetime import datetime
import enum

Base = declarative_base()

class ContentType(enum.Enum):
    text = "text"
    image = "image"
    all = "all"

class User(Base):
    __tablename__ = 'users'
    
    id = Column(String, primary_key=True)
    email = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_active = Column(DateTime, onupdate=func.now())
    preferences = Column(JSON, nullable=True)  # User preferences like default mode
    filters = relationship("Filter", back_populates="user", cascade="all, delete-orphan")

class Filter(Base):
    __tablename__ = 'filters'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey('users.id'))
    filter_text = Column(String, nullable=False)
    filter_type = Column(String, nullable=True)  # Optional filter type
    intensity = Column(Integer, nullable=False)
    filter_metadata = Column(JSON, nullable=True)  # Includes filter_type, content_type, etc.
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    expires_at = Column(DateTime, nullable=True)  # For temporary filters
    content_type = Column(Enum(ContentType), default=ContentType.all)
    is_temporary = Column(Boolean, default=False)
    user = relationship("User", back_populates="filters")
    
    @property
    def is_expired(self) -> bool:
        """Check if filter has expired"""
        if self.expires_at is None:
            return False
        return datetime.now() > self.expires_at

class ProcessingLog(Base):
    __tablename__ = 'processing_logs'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey('users.id'))
    platform = Column(String, nullable=False)  # reddit, twitter, etc.
    content_hash = Column(String, nullable=False)  # Hash of processed content
    matched_filters = Column(JSON, nullable=True)  # List of filter IDs that matched
    processing_time = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    processing_metadata = Column(JSON, nullable=True)  # Additional processing metadata

class CustomFeed(Base):
    __tablename__ = 'custom_feeds'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=False)
    title = Column(String, nullable=False)
    feed_html = Column(String, nullable=False)  # The complete timeline HTML
    feed_metadata = Column(JSON, nullable=True)  # Stats, interventions applied, post count, etc.
    
    # Comparison fields for grouping original + filtered versions
    comparison_set_id = Column(String, nullable=True)  # Groups original + filtered versions
    feed_type = Column(String, nullable=True)  # "original" or "filtered"
    filter_config = Column(JSON, nullable=True)  # What filters were applied
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Relationship
    user = relationship("User", backref="custom_feeds")

class HumanPreference(Base):
    __tablename__ = 'human_preferences'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=False)
    comparison_set_id = Column(String, nullable=False)  # Links to CustomFeed comparison_set_id
    post_id = Column(String, nullable=False)  # From JSON ("1", "2", "3", etc.)
    
    # Text content and preference
    post0_text_content = Column(String, nullable=False)  # Left side text content
    post1_text_content = Column(String, nullable=False)  # Right side text content
    text_preference = Column(Integer, nullable=True)     # 0=left, 1=right, NULL=skip
    
    # Image content and preference  
    post0_image_url = Column(String, nullable=True)      # Left side image URL
    post1_image_url = Column(String, nullable=True)      # Right side image URL
    image_preference = Column(Integer, nullable=True)    # 0=left, 1=right, NULL=skip
    
    created_at = Column(DateTime, server_default=func.now())
    
    # Relationship
    user = relationship("User", backref="human_preferences")

# Initialize database
engine = create_engine('sqlite:///filters.db')
Base.metadata.create_all(engine)