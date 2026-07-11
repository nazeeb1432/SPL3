"""Logging configuration for the application"""
import logging
import os
from datetime import datetime
from pathlib import Path

def setup_logging():
    """Setup application-wide logging configuration"""
    # Create logs directory if it doesn't exist
    log_dir = Path(__file__).parent.parent / 'logs'
    log_dir.mkdir(exist_ok=True)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, os.getenv('DEBUG_MODE', 'INFO').upper()))
    
    # Set third-party loggers to higher level to reduce noise
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)
    logging.getLogger('flask').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    logging.getLogger('httpx').setLevel(logging.WARNING)


    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # File handler for debug.log
    debug_handler = logging.FileHandler('debug.log')
    debug_handler.setFormatter(detailed_formatter)
    debug_handler.setLevel(logging.DEBUG)
    
    # File handler for daily logs - only for app logs
    today = datetime.now().strftime('%Y-%m-%d')
    daily_handler = logging.FileHandler(log_dir / f'{today}.log')
    daily_handler.setFormatter(detailed_formatter)
    daily_handler.setLevel(logging.INFO)
    
    # Add a filter to daily handler to only show app logs
    class AppFilter(logging.Filter):
        def filter(self, record):  # Changed to instance method with self parameter
            return record.name.startswith(('__main__', 'llm', 'processors', 'utils', 'database'))
    daily_handler.addFilter(AppFilter())
    
    # Console handler - only show warning and above for third-party logs
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(detailed_formatter)
    console_handler.setLevel(logging.INFO)
    
    # Add handlers
    root_logger.addHandler(debug_handler)
    root_logger.addHandler(daily_handler)
    root_logger.addHandler(console_handler)