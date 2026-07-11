"""Configuration management"""
import os
import yaml
from typing import Dict, Any, Optional, List
from pathlib import Path
import logging
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class LLMConfig(BaseModel):
    """LLM-related configuration"""
    content_model: str = "gpt-4o-mini"
    filter_model: str = "gpt-4o"
    chat_model: str = "gpt-4o"
    temperature: float = 0.1
    max_tokens: int = 1000

class ImageProcessingConfig(BaseModel):
    """Image processing configuration"""
    enabled: bool = True
    max_posts_with_images: int = 5
    max_images_per_post: int = 1

class RedditSpecificConfig(BaseModel):
    """Reddit-specific configuration"""
    enabled: bool = True
    reddit_max_carousel_images: int = 1  # Max images to process from a gallery carousel
    process_video_thumbnails: bool = True  # Whether to process video thumbnails

class TwitterSpecificConfig(BaseModel):
    """Twitter-specific configuration"""
    enabled: bool = True
    twitter_max_carousel_images: int = 1  # Max images to process from a gallery carousel
    process_video_thumbnails: bool = True  # Whether to process video thumbnailst"""


class ProcessingConfig(BaseModel):
    """Content processing configuration"""
    parallel_workers: int = 4
    cache_timeout: int = 60
    default_mode: str = "balanced"
    default_intensity: int = 3
    image_processing: ImageProcessingConfig = ImageProcessingConfig()
    reddit_specific: RedditSpecificConfig = RedditSpecificConfig()
    twitter_specific: TwitterSpecificConfig = TwitterSpecificConfig()

class DatabaseConfig(BaseModel):
    """Database configuration"""
    url: str = "sqlite:///filters.db"
    pool_size: int = 5
    max_overflow: int = 10

class LoggingConfig(BaseModel):
    """Logging configuration"""
    level: str = "INFO"
    file: str = "debug.log"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

class TestingConfig(BaseModel):
    """Testing configuration"""
    create_default_filters: bool = False
    default_filters: List[Dict[str, Any]] = []

class ExternalServicesConfig(BaseModel):
    """External services configuration"""
    image_processing_api: Dict[str, Any] = {"url": "", "api_key": "", "timeout": 30}

class Config(BaseModel):
    """Application configuration"""
    llm: LLMConfig = LLMConfig()
    processing: ProcessingConfig = ProcessingConfig()
    database: DatabaseConfig = DatabaseConfig()
    logging: LoggingConfig = LoggingConfig()
    testing: TestingConfig = TestingConfig()  # Make sure testing config is properly initialized
    external_services: ExternalServicesConfig = ExternalServicesConfig()
    env: Dict[str, str] = {}

class ConfigManager:
    """Manages application configuration"""
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if not hasattr(self, 'config'):
            self.config_path = Path(__file__).parent.parent / 'config.yaml'
            self.config = self._load_config()
            self._apply_env_vars()
            logger.info("Configuration loaded successfully")
    
    def _load_config(self) -> Config:
        """Load configuration from YAML file"""
        try:
            if self.config_path.exists():
                with open(self.config_path) as f:
                    yaml_config = yaml.safe_load(f)
            else:
                yaml_config = {}
                logger.warning(f"Config file not found at {self.config_path}, using defaults")
            
            return Config(**yaml_config)
            
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            return Config()
    
    def _apply_env_vars(self):
        """Apply environment variables, overriding config values"""
        env_mapping = {
            'OPENAI_API_KEY': ('env', 'OPENAI_API_KEY'),
            'CONTENT_PROCESS_MODEL': ('llm', 'content_model'),
            'FILTER_CREATION_MODEL': ('llm', 'filter_model'),
            'CHAT_MODEL': ('llm', 'chat_model'),
            'DEBUG_MODE': ('logging', 'level'),
            'PROCESSING_MODE': ('processing', 'default_mode'),
            'PARALLEL_WORKERS': ('processing', 'parallel_workers')
        }
        
        for env_var, (section, key) in env_mapping.items():
            value = os.getenv(env_var)
            if value:
                if section == 'env':
                    self.config.env[key] = value
                else:
                    setattr(getattr(self.config, section), key, value)
    
    def get_llm_config(self) -> LLMConfig:
        """Get LLM configuration"""
        return self.config.llm
    
    def get_processing_config(self) -> ProcessingConfig:
        """Get processing configuration"""
        return self.config.processing
    
    def get_database_config(self) -> DatabaseConfig:
        """Get database configuration"""
        return self.config.database
    
    def get_testing_config(self) -> TestingConfig:
        """Get testing configuration"""
        return self.config.testing
    
    def get_logging_config(self) -> LoggingConfig:
        """Get logging configuration"""
        return self.config.logging
    
    def get_external_services_config(self) -> Dict[str, Any]:
        """Get external services configuration"""
        return self.config.external_services.dict()
    
    def get_env(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get environment variable"""
        return self.config.env.get(key, default)
    
    def reload(self):
        """Reload configuration"""
        self.config = self._load_config()
        self._apply_env_vars()