"""Error handling utilities"""
import logging
from functools import wraps
import inspect
import asyncio
from typing import Callable, Any
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

class ContentProcessingError(Exception):
    """Base exception for content processing errors"""
    def __init__(self, message: str, context: dict = None):
        super().__init__(message)
        self.context = context or {}

class FilterError(ContentProcessingError):
    """Filter-related errors"""
    pass

class LLMError(ContentProcessingError):
    """LLM processing errors"""
    pass

class ProcessorError(ContentProcessingError):
    """Content processor errors"""
    pass

def handle_processing_errors(func: Callable) -> Callable:
    """Decorator to handle processing errors"""
    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        try:
            # If the wrapped function is async, just await it
            result = await func(*args, **kwargs)
            return result
        except ContentProcessingError as e:
            logger.error(f"{type(e).__name__}: {str(e)}", extra={"context": e.context})
            raise
        except Exception as e:
            logger.error(f"Unexpected error in {func.__name__}: {e}", exc_info=True)
            if "transaction" in str(e).lower() or "database" in str(e).lower():
                logger.error("Database transaction failed, retrying filter fetch...")
                # If database error during filter refresh, just continue without filters
                return []
            raise ContentProcessingError(f"Processing error: {str(e)}")

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        try:
            # For sync functions, no need for event loop handling
            result = func(*args, **kwargs)
            return result
        except ContentProcessingError as e:
            logger.error(f"{type(e).__name__}: {str(e)}", extra={"context": e.context})
            raise
        except Exception as e:
            logger.error(f"Unexpected error in {func.__name__}: {e}", exc_info=True)
            if "transaction" in str(e).lower() or "database" in str(e).lower():
                logger.error("Database transaction failed, retrying filter fetch...")
                # If database error during filter refresh, just continue without filters
                return []
            raise ContentProcessingError(f"Processing error: {str(e)}")

    # Use async wrapper if function is async, otherwise use sync wrapper
    if inspect.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper

def handle_api_errors(func: Callable) -> Callable:
    """Decorator to handle API endpoint errors and coroutines"""
    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        try:
            # If the wrapped function is async, just await it
            result = await func(*args, **kwargs)
            return result
        except ContentProcessingError as e:
            logger.error(f"API error: {str(e)}", extra={"context": e.context})
            return JSONResponse({"status": "error", "message": str(e)}, status_code=400)
        except Exception as e:
            logger.error(f"Unexpected API error in {func.__name__}: {e}", exc_info=True)
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        try:
            # For sync functions, no need for event loop handling
            result = func(*args, **kwargs)
            return result
        except ContentProcessingError as e:
            logger.error(f"API error: {str(e)}", extra={"context": e.context})
            return JSONResponse({"status": "error", "message": str(e)}, status_code=400)
        except Exception as e:
            logger.error(f"Unexpected API error in {func.__name__}: {e}", exc_info=True)
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)

    # Use async wrapper if function is async, otherwise use sync wrapper
    if inspect.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper