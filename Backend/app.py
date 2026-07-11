
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, File, UploadFile, Form, Query, Path, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from typing import Dict, List, Set, Any
from contextlib import asynccontextmanager

import os
from dotenv import load_dotenv 
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(env_path, override=True)

import json
from datetime import datetime
from pathlib import Path as PathLib
from processors import RedditProcessor, TwitterProcessor
from database import (
    get_user_filters, add_filter, remove_filter, update_filter, update_user_info,
)
from ServerCache import image_cache
from ServerCache.CacheManager import ImageCacheManager
from llm import ContentFilter
from models import ProcessFeedRequest, CreateFilterRequest, UpdateFilterRequest, ChatRequest  # Import request models
from llm.chat import FilterCreationChat  # Add this import
from llm.vision import VisionFilterCreator  # Import the new vision module
from utils import setup_logging, handle_api_errors, ConfigManager
import logging
import asyncio
import redis.asyncio as redis
# from asgiref.wsgi import WsgiToAsgi  # No longer needed for FastAPI
from hypercorn.config import Config as HyperConfig
from hypercorn.asyncio import serve
import uuid
import base64

# Initialize configuration and shared resources
config = ConfigManager()
chat_processor = None  # Will be initialized in create_app()
vision_processor = None  # Will be initialized in create_app()

# Load environment variables


# Setup logging using config
setup_logging()
logger = logging.getLogger(__name__)

# Global variables for Redis subscription
redis_client = None
redis_subscription_task = None

class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

# Lifespan context manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    global chat_processor, vision_processor, redis_client, redis_subscription_task
    
    # Startup
    chat_processor = FilterCreationChat()
    vision_processor = VisionFilterCreator()
    
    # Set up WebSocket callback for image cache
    websockets_enabled = os.getenv("WEBSOCKETS_ENABLED", "true").lower() == "true"
    if websockets_enabled and hasattr(image_cache, 'websocket_callback'):
        image_cache.websocket_callback = notify_image_complete
    else:
        logger.info("WebSocket notifications disabled by configuration")
    
    # Set up Redis subscription for image processing notifications
    try:
        if websockets_enabled:
            redis_client = await redis.from_url('redis://localhost:6379')
            redis_subscription_task = asyncio.create_task(subscribe_to_image_notifications())
            logger.info("Redis subscription started for image processing notifications")
        else:
            logger.info("WebSocket notifications disabled, skipping Redis subscription")
    except Exception as e:
        logger.error(f"Failed to connect to Redis for pub/sub: {e}")
        # Continue without Redis pub/sub - fallback to existing mechanism
    
    logger.info("DIY-MOD server initialized successfully")
    
    yield
    
    # Shutdown
    if redis_subscription_task:
        redis_subscription_task.cancel()
    if redis_client:
        await redis_client.close()
    logger.info("DIY-MOD server shutting down")

# Initialize FastAPI app
app = FastAPI(
    title="DIY-MOD Server",
    description="Browser extension to customize your social media feed. ",
    version="1.0.0",
    lifespan=lifespan
)


@app.options("/{path:path}")
async def handle_options(request: Request, path: str):
    """Handle CORS preflight requests with Private Network Access headers"""
    origin = request.headers.get("origin", "")
    
    # Debug logging
    logger.info(f"OPTIONS request received:")
    logger.info(f"  Path: {path}")
    logger.info(f"  Origin: {origin}")
    logger.info(f"  Headers: {dict(request.headers)}")
    
    return Response(
        headers={
            "Access-Control-Allow-Origin": origin if origin else "*",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400"
        }
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://illbkkpmokdffhcpligfomonjonpgjme",
        "chrome-extension://dbbkdokcdhadpekdclhljlafcbelnkgc",
        "chrome-extension://*",  # Allow any chrome extension for testing
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",  # Vite dev server
        "https://www.reddit.com",
        "https://reddit.com",
        "https://www.twitter.com",
        "https://twitter.com",
        "https://x.com",
        "https://www.x.com",
        "*"  # Allow all origins for development - REMOVE IN PRODUCTION
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Create temporary directory for image uploads if it doesn't exist
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "temp", "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Setup templates and static files - COMMENTED OUT (no frontend for now)
# templates = Jinja2Templates(directory="frontend/templates")
# app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

# Create temp/uploads directory if it doesn't exist
os.makedirs("temp/uploads", exist_ok=True)

# Mount temp/uploads directory to serve generated images
app.mount("/temp/uploads", StaticFiles(directory="temp/uploads"), name="uploads")

PLATFORM_PROCESSORS = {
    'reddit': RedditProcessor,
    'twitter': TwitterProcessor
}

PLATFORM_RESPONSE_FORMAT = {
    'reddit': ".html",
    'twitter': ".json"
}

def get_platform_from_url(url):
    if 'reddit.com' in url:
        return 'reddit'
    elif 'twitter.com' in url or 'x.com' in url:
        return 'twitter'
    else:
        return None

# Add ping endpoint for extension health check
@app.get('/ping')
def ping():
    """Simple ping endpoint to check if the server is alive"""
    logger.info("Received ping from extension")
    return {
        "status": "success",
        "message": "DIY-MOD server is running",
        "timestamp": datetime.now().isoformat()
    }

@app.post('/get_feed')
@handle_api_errors
async def process_feed_route(request_data: ProcessFeedRequest):
    """Process a social media feed"""
    # Create data directory for request logging
    data_dir = PathLib(__file__).parent / "data" / "requests"
    data_dir.mkdir(parents=True, exist_ok=True)
    
    user_id = request_data.user_id
    url = request_data.url
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    req_id = f"{str(user_id)[:4]}_{timestamp}"
    request_dir = data_dir / req_id
    request_dir.mkdir(exist_ok=True)
    
    # Extract feed data
    data = request_data.data
    feed_info = data.get('feed_info')
    if not feed_info:
        raise HTTPException(status_code=400, detail='No feed_info in data')

    # Get platform
    platform = get_platform_from_url(url)
    if not platform:
        raise HTTPException(status_code=400, detail="Unsupported platform in URL")
    
    # Save the body (raw data) directly
    in_file_ ="in_feed"+ PLATFORM_RESPONSE_FORMAT.get(platform, ".html")
    with open(request_dir / in_file_, 'w', encoding='utf-8') as f:
        f.write(feed_info.get('response', ''))

    # Get appropriate processor
    processor_class = PLATFORM_PROCESSORS.get(platform)
    if not processor_class:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")
        
    # Process feed
    processor = processor_class(user_id=user_id, feed_info=feed_info, url=url)
    modified_feed = await processor.work_on_feed()  # Await the async method
    
    response_data = {
        'status': 'success',
        'feed': {'response': modified_feed}
    }
    
    # Log response
    out_file_ ="out_feed"+ PLATFORM_RESPONSE_FORMAT.get(platform, ".html")
    with open(request_dir / out_file_, 'w', encoding='utf-8') as f:
        f.write(modified_feed)
        
    return response_data

@app.get('/filters')
@handle_api_errors
def get_filters_route(user_id: str = Query(..., description="User ID")):
    """Get user's content filters"""
    filters = get_user_filters(user_id)
    logger.info(f"Loaded {len(filters)} filters for user {user_id}")
    return {
        "status": "success",
        "message": f"Found {len(filters)} filters",
        "filters": filters
    }

@app.post('/filters')
@handle_api_errors
def create_filter_route(filter_request: CreateFilterRequest):
    """Create a new content filter"""
    # Set is_temporary explicitly based on duration
    is_temporary = filter_request.duration != 'permanent'
    filter_data = filter_request.model_dump()
    filter_data['is_temporary'] = is_temporary

    # Calculate expiration for temporary filters
    if is_temporary:
        from datetime import datetime, timedelta
        duration = filter_request.duration
        
        if duration == 'day':
            filter_data['expires_at'] = datetime.now() + timedelta(days=1)
        elif duration == 'week':
            filter_data['expires_at'] = datetime.now() + timedelta(weeks=1)
        elif duration == 'month':
            filter_data['expires_at'] = datetime.now() + timedelta(days=30)
        
        logger.debug(f"Creating temporary filter with duration {duration}, expires_at: {filter_data['expires_at']}")
    else:
        filter_data['expires_at'] = None
        
    content_filter = ContentFilter(**filter_data)
    filter_id = add_filter(filter_request.user_id, content_filter.model_dump())
    
    return {
        "status": "success",
        "message": "Filter created successfully",
        "filter_id": filter_id
    }

@app.put('/filters/{filter_id}')
@handle_api_errors
def update_filter_route(filter_id: int, filter_request: UpdateFilterRequest):
    """Update an existing content filter"""
    filter_data = ContentFilter(**filter_request.model_dump())
    if update_filter(filter_request.user_id, filter_id, filter_data.model_dump()):
        return {
            "status": "success",
            "message": "Filter updated successfully"
        }
    raise HTTPException(status_code=404, detail="Filter not found")

@app.delete('/filters/{filter_id}')
@handle_api_errors
def delete_filter_route(
    filter_id: int = Path(..., description="Filter ID"), 
    user_id: str = Query(..., description="User ID")
):
    """Delete a content filter"""
    if remove_filter(user_id, filter_id):
        return {
            "status": "success",
            "message": "Filter deleted successfully"
        }
    raise HTTPException(status_code=404, detail="Filter not found")

@app.post('/chat')
def chat(chat_request: ChatRequest):
    """Process chat messages and return LLM response"""
    try:
        # Add user_id to history if not present in latest message
        history = chat_request.history
        if history and isinstance(history[-1], dict) and 'user_id' not in history[-1]:
            history[-1]['user_id'] = chat_request.user_id
            
        response = chat_processor.process_chat(
            chat_request.message, 
            history, 
            chat_request.user_id
        )
        return {
            'status': 'success',
            'user_id': chat_request.user_id,
            **response
        }
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/chat/image')
@handle_api_errors
async def chat_with_image(
    image: UploadFile = File(...),
    message: str = Form(""),
    history: str = Form("[]"),
    user_id: str = Form("default_user")
):
    """Process image uploads for filter creation"""
    try:
        # Parse history JSON
        try:
            history_data = json.loads(history)
        except json.JSONDecodeError:
            history_data = []
            
        # Generate a unique filename
        file_ext = os.path.splitext(image.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        
        # Save the file temporarily
        content = await image.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        logger.info(f"Saved uploaded image to {file_path}")
        
        try:
            # Process the image with GPT-4V
            response = vision_processor.process_image(
                image_path=file_path,
                message=message,
                history=history_data,
                user_id=user_id
            )
            
            # Clean up - remove the temporary file
            os.remove(file_path)
            
            return {
                'status': 'success',
                'user_id': user_id,
                **response
            }
        finally:
            # Ensure file is removed even if processing fails
            if os.path.exists(file_path):
                os.remove(file_path)
                
    except Exception as e:
        logger.error(f"Image chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get('/get_img_result')
def get_img_result(
    img_url: str = Query(..., description="Image URL"),
    filters: str = Query(..., description="Filters to apply")
):
    logger.debug(f"Received image polling request: img_url={img_url}, filters={filters}")
    
    # Parse the filters parameter - it comes as a JSON string
    try:
        if filters:
            parsed_filters = json.loads(filters) if filters.startswith('[') else [filters]
        else:
            parsed_filters = []
    except json.JSONDecodeError:
        logger.error(f"Failed to parse filters JSON: {filters}")
        parsed_filters = [filters]  # Fallback to treating it as a single filter
    
    logger.debug(f"Parsed filters: {parsed_filters}")
    
    # Use the actual filters passed in the request
    result = image_cache.get_processed_value_from_cache(image_url=img_url, filters=parsed_filters)
    logger.debug(f"Image Polling Result: \nImage URL: {img_url}\n, Filters used: {parsed_filters}\n, Result: {result}")
    if result:
        # Handle both string results (backward compatibility) and dict results (with base64)
        if isinstance(result, dict):
            response = {
                "status": "COMPLETED",
                "processed_value": result.get('url', result)  # Use 'url' if available
            }
            # Include base64 if available
            if 'base64' in result and result['base64']:
                response['base64_url'] = result['base64']
                logger.debug(f"Including base64 URL in polling response (length: {len(result['base64'])} chars)")
            return response
        else:
            # Backward compatibility for string results
            return {
                "status": "COMPLETED",
                "processed_value": result
            }

    return {
        "status": "NOT FOUND"
    }

@app.get('/get_img_base64')
def get_img_base64(
    img_url: str = Query(..., description="Processed image URL")
):
    """Convert a localhost image URL to base64 data URL to bypass CSP restrictions"""
    try:
        logger.info(f"Converting image to base64: {img_url}")
        
        # Extract filename from URL
        if "/temp/uploads/" in img_url:
            filename = img_url.split("/temp/uploads/")[-1]
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            
            if os.path.exists(filepath):
                # Read the image file and convert to base64
                with open(filepath, "rb") as image_file:
                    image_data = image_file.read()
                    base64_encoded = base64.b64encode(image_data).decode('utf-8')
                    
                # Determine MIME type (assuming PNG for now, could be enhanced)
                mime_type = "image/png"
                if filename.lower().endswith('.jpg') or filename.lower().endswith('.jpeg'):
                    mime_type = "image/jpeg"
                elif filename.lower().endswith('.gif'):
                    mime_type = "image/gif"
                
                # Return as data URL
                data_url = f"data:{mime_type};base64,{base64_encoded}"
                logger.info(f"Successfully converted image to base64 data URL (length: {len(data_url)})")
                
                return {
                    "status": "success",
                    "data_url": data_url
                }
            else:
                logger.error(f"Image file not found: {filepath}")
                return {
                    "status": "error",
                    "message": "Image file not found"
                }
        else:
            # If not a localhost URL, return the original URL
            return {
                "status": "success",
                "data_url": img_url
            }
            
    except Exception as e:
        logger.error(f"Error converting image to base64: {e}", exc_info=True)
        return {
            "status": "error",
            "message": str(e)
        }

@app.post('/user/update')
@handle_api_errors
async def update_user_info_endpoint(request: Request):
    """Update user information including email"""
    data = await request.json()
    user_id = data.get('user_id')
    email = data.get('email')
    
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    
    user_info = update_user_info(user_id=user_id, email=email)
    
    return {
        "status": "success",
        "message": "User information updated",
        "user": user_info
    }


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.waiting_for_images: Dict[str, Set[str]] = {}  # image_url -> set of user_ids
        self.waiting_with_filters: Dict[str, Dict[str, List[str]]] = {}  # user_id -> {image_url: filters}
        self.last_activity: Dict[str, datetime] = {}  # Track last activity per user
        self.heartbeat_interval = 30  # Send heartbeat every 30 seconds
        self.heartbeat_timeout = 300  # Disconnect if no activity for 90 seconds
        self.heartbeat_task = None

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.last_activity[user_id] = datetime.now()
        logger.info(f"[WS Heartbeat] User {user_id} connected, activity tracked")
        
        # Start heartbeat monitor if not already running
        if not self.heartbeat_task or self.heartbeat_task.done():
            self.heartbeat_task = asyncio.create_task(self.monitor_heartbeats())
            logger.info("[WS Heartbeat] Started heartbeat monitor task")

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.last_activity:
            del self.last_activity[user_id]
        # Clean up any image waiting registrations
        for image_url, waiting_users in list(self.waiting_for_images.items()):
            waiting_users.discard(user_id)
            if not waiting_users:
                del self.waiting_for_images[image_url]
        # Clean up filter tracking
        if user_id in self.waiting_with_filters:
            del self.waiting_with_filters[user_id]
    
    def update_activity(self, user_id: str):
        """Update last activity timestamp for a user"""
        if user_id in self.active_connections:
            self.last_activity[user_id] = datetime.now()
            logger.debug(f"[WS Heartbeat] Updated activity for user {user_id}")
    
    async def monitor_heartbeats(self):
        """Monitor connections and disconnect inactive ones"""
        logger.info("[WS Heartbeat] Heartbeat monitor started")
        while self.active_connections:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                now = datetime.now()
                disconnected_users = []
                
                for user_id, last_activity in list(self.last_activity.items()):
                    if user_id not in self.active_connections:
                        continue
                        
                    time_since_activity = (now - last_activity).total_seconds()
                    
                    if time_since_activity > self.heartbeat_timeout:
                        logger.warning(f"[WS Heartbeat] User {user_id} inactive for {time_since_activity:.0f}s, disconnecting")
                        disconnected_users.append(user_id)
                    elif time_since_activity > self.heartbeat_interval:
                        # Send a ping to check if connection is alive
                        try:
                            await self.send_json({
                                "type": "ping",
                                "timestamp": now.isoformat()
                            }, user_id)
                            logger.debug(f"[WS Heartbeat] Sent ping to user {user_id}")
                        except Exception as e:
                            logger.error(f"[WS Heartbeat] Failed to ping user {user_id}: {e}")
                            disconnected_users.append(user_id)
                
                # Disconnect inactive users
                for user_id in disconnected_users:
                    logger.info(f"[WS Heartbeat] Disconnecting inactive user {user_id}")
                    self.disconnect(user_id)
                    
            except Exception as e:
                logger.error(f"[WS Heartbeat] Monitor error: {e}", exc_info=True)
        
        logger.info("[WS Heartbeat] Heartbeat monitor stopped (no active connections)")

    async def send_personal_message(self, message: str, user_id: str):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_text(message)

    async def send_json(self, data: dict, user_id: str):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(data)
            except Exception as e:
                logger.error(f"Error sending to user {user_id}: {e}")
                self.disconnect(user_id)
    
    def register_image_wait(self, image_url: str, user_id: str, filters: List[str] = None):
        """Register that a user is waiting for an image processing result with specific filters"""
        logger.debug(f"[WS Register] 📝 REGISTERING IMAGE WAIT")
        logger.debug(f"[WS Register] User: {user_id}")
        logger.debug(f"[WS Register] Image URL: {image_url}")
        logger.debug(f"[WS Register] Filters: {filters}")
        
        if image_url not in self.waiting_for_images:
            self.waiting_for_images[image_url] = set()
        self.waiting_for_images[image_url].add(user_id)
        
        # Also track the specific filters this user is waiting for
        if user_id not in self.waiting_with_filters:
            self.waiting_with_filters[user_id] = {}
        self.waiting_with_filters[user_id][image_url] = filters or []
        
        logger.info(f"[WS Register] Total images being tracked: {len(self.waiting_for_images)}")
        logger.info(f"[WS Register] Users waiting for this image: {len(self.waiting_for_images[image_url])}")
    
    async def notify_image_processed(self, image_url: str, result: any, filters: List[str] = None, base64_url: str = None):
        """Notify users waiting for this specific image+filter combination"""
        logger.info(f"[WS Notify] 🔔 NOTIFICATION TRIGGERED")
        logger.info(f"[WS Notify] Image URL: {image_url}")
        logger.info(f"[WS Notify] Result URL: {result}")
        logger.info(f"[WS Notify] Filters: {filters}")
        if base64_url:
            logger.info(f"[WS Notify] Base64 included: Yes (length: {len(base64_url)} chars)")
        else:
            logger.info(f"[WS Notify] Base64 included: No")
        logger.info(f"[WS Notify] Active WebSocket connections: {list(self.active_connections.keys())}")
        logger.info(f"[WS Notify] Waiting images map: {self.waiting_for_images}")
        # logger.info(f"[WS Notify] Waiting with filters map: {self.waiting_with_filters}")
        
        if image_url in self.waiting_for_images:
            waiting_users = self.waiting_for_images[image_url].copy()
            notified_users = set()
            logger.info(f"[WS Notify] Found {len(waiting_users)} users waiting for this image")
            
            for user_id in waiting_users:
                # Check if this user is waiting for this specific filter combination
                if user_id in self.waiting_with_filters:
                    user_filters = self.waiting_with_filters[user_id].get(image_url, [])
                    logger.info(f"[WS Notify] User {user_id} is waiting with filters: {user_filters}")
                    
                    # Special handling for custom filters
                    should_notify = False
                    
                    # Check if this is a custom feed processing result
                    if filters and any(f.startswith('custom_') for f in filters):
                        # For custom filters, we need more flexible matching
                        if not user_filters or user_filters == []:
                            # User sent empty filters, meaning they want any custom processing result
                            logger.info(f"[WS Notify] User {user_id} has empty filters - will notify for any custom result")
                            should_notify = True
                        else:
                            # Check if user is waiting for a custom filter with matching intervention type
                            for filter_str in filters:
                                if filter_str.startswith('custom_'):
                                    # Extract intervention type (e.g., 'cartoonish' from 'custom_cartoonish_...')
                                    parts = filter_str.split('_')
                                    if len(parts) >= 2:
                                        intervention_type = parts[1]
                                        # Check if user is waiting for this intervention type
                                        for user_filter in user_filters:
                                            if (user_filter.startswith('custom_') and intervention_type in user_filter) or \
                                               user_filter == intervention_type:
                                                should_notify = True
                                                break
                                if should_notify:
                                    break
                    else:
                        # Original exact matching logic for non-custom filters
                        normalized_filters = sorted([f.lower().rstrip('.') for f in (filters or [])])
                        normalized_user_filters = sorted([f.lower().rstrip('.') for f in user_filters])
                        should_notify = normalized_filters == normalized_user_filters
                        logger.info(f"[WS Notify] Standard filter check: user_filters={user_filters}, filters={filters}, normalized_match={should_notify}")
                    
                    # Notify if filters match
                    if should_notify:
                        logger.info(f"[WS Notify] Sending notification to user {user_id}")
                        message_data = {
                            "type": "image_processed",
                            "data": {
                                "image_url": image_url,
                                "result": result,
                                "filters": filters
                            }
                        }
                        # Include base64 data if available
                        if base64_url:
                            message_data["data"]["base64_url"] = base64_url
                            logger.info(f"[WS Notify] Including base64 URL (length: {len(base64_url)} chars) for image {image_url}")
                        else:
                            logger.warning(f"[WS Notify] No base64 URL available for image {image_url}, using regular URL (may cause CSP issues)")
                            
                        await self.send_json(message_data, user_id)
                        notified_users.add(user_id)
                        logger.info(f"[WS Notify] ✅ Notified user {user_id} for image {image_url} with filters {filters}")
                    else:
                        logger.info(f"[WS Notify] ❌ User {user_id} waiting for different filters: {user_filters} vs {filters}")
            
            # Only remove users that were notified
            for user_id in notified_users:
                self.waiting_for_images[image_url].discard(user_id)
                if user_id in self.waiting_with_filters and image_url in self.waiting_with_filters[user_id]:
                    del self.waiting_with_filters[user_id][image_url]
            
            # Clean up if no more users waiting for this image
            if not self.waiting_for_images[image_url]:
                del self.waiting_for_images[image_url]
        else:
            logger.info(f"[WS Notify] No users waiting for image: {image_url}")

manager = ConnectionManager()

# Global reference for image processing notifications
async def notify_image_complete(image_url: str, result: any, filters: List[str] = None, base64_url: str = None):
    """Called by image processing tasks when complete"""
    await manager.notify_image_processed(image_url, result, filters, base64_url)

# Redis subscription handler
async def subscribe_to_image_notifications():
    """Subscribe to Redis channel for image processing notifications"""
    global redis_client
    
    if not redis_client:
        logger.error("Redis client not initialized for subscription")
        return
    
    try:
        pubsub = redis_client.pubsub()
        await pubsub.subscribe('image_processing_complete')
        
        logger.info("Subscribed to Redis channel: image_processing_complete")
        
        async for message in pubsub.listen():
            if message['type'] == 'message':
                try:
                    # Parse the notification data
                    data = json.loads(message['data'])
                    image_url = data.get('image_url')
                    processed_url = data.get('processed_url')
                    filters = data.get('filters', [])
                    base64_url = data.get('base64_url')  # Get base64 data if available
                    
                    logger.info(f"Received Redis notification for image: {image_url}")
                    if base64_url:
                        logger.info(f"Notification includes base64 data (length: {len(base64_url)} chars)")
                    
                    # Notify WebSocket clients
                    await manager.notify_image_processed(image_url, processed_url, filters, base64_url)
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse Redis message: {e}")
                except Exception as e:
                    logger.error(f"Error processing Redis notification: {e}")
                    
    except asyncio.CancelledError:
        logger.info("Redis subscription cancelled")
        await pubsub.unsubscribe('image_processing_complete')
        await pubsub.close()
    except Exception as e:
        logger.error(f"Redis subscription error: {e}")

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    logger.info(f"[WS Connection] 🔌 New WebSocket connection attempt from user: {user_id}")
    logger.info(f"[WS Connection] Timestamp: {datetime.now().isoformat()}")
    
    await manager.connect(websocket, user_id)
    logger.info(f"[WS Connection] ✅ WebSocket connected for user: {user_id}")
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            # logger.info(f"[WS Message] 📥 Received message from {user_id}: type={data.get('type')}")
            
            # Update activity timestamp for any received message
            manager.update_activity(user_id)
            
            # Handle different message types
            if data.get("type") == "chat":
                # Process chat message
                response = chat_processor.process_chat(
                    data.get("message"),
                    data.get("history", []),
                    user_id
                )
                await manager.send_json({
                    "type": "chat_response",
                    "data": response
                }, user_id)
                
            elif data.get("type") == "filter_update":
                # Notify about filter updates
                filters = get_user_filters(user_id)
                await manager.send_json({
                    "type": "filters_updated",
                    "data": filters
                }, user_id)
                
            elif data.get("type") == "wait_for_image":
                # Client is waiting for image processing result
                logger.info(f"[WS Handler] 📨 Received wait_for_image from {user_id}")
                logger.info(f"[WS Handler] Raw message data: {json.dumps(data)}")
                
                image_url = data.get("data", {}).get("image_url")
                filters = data.get("data", {}).get("filters", [])
                
                logger.info(f"[WS Handler] Extracted - Image URL: {image_url}")
                logger.info(f"[WS Handler] Extracted - Filters: {filters}")
                logger.info(f"[WS Handler] Timestamp: {datetime.now().isoformat()}")
                
                # Check if result is already cached
                logger.info(f"[WS Handler] Checking cache for image: {image_url}")
                result = image_cache.get_processed_value_from_cache(image_url, filters)
                
                if result:
                    logger.info(f"[WS Handler] ✅ Found in cache! Sending immediate response: ")
                                # {result}")
                    await manager.send_json({
                        "type": "image_processed",
                        "data": {
                            "image_url": image_url,
                            "result": result,
                            "filters": filters
                        }
                    }, user_id)
                    logger.info(f"[WS Handler] Sent cached result to {user_id}")
                else:
                    # Register this WebSocket to receive notification when ready
                    logger.info(f"[WS Handler] ❌ Not in cache, registering wait for {user_id}")
                    manager.register_image_wait(image_url, user_id, filters)
                    logger.info(f"[WS Handler] User {user_id} registered to wait for image {image_url} with filters {filters}")
                    
                    # Log current state of waiting lists
                    logger.info(f"[WS Handler] Current waiting_for_images: {list(manager.waiting_for_images.keys())}")
                    logger.info(f"[WS Handler] Current waiting_with_filters for {user_id}: {manager.waiting_with_filters.get(user_id, {})}")
                
            elif data.get("type") == "ping":
                # Simple ping/pong for keepalive
                logger.debug(f"[WS Heartbeat] Received ping from user {user_id}")
                await manager.send_json({
                    "type": "pong",
                    "timestamp": datetime.now().isoformat()
                }, user_id)
                
            elif data.get("type") == "pong":
                # Client responding to server ping
                logger.debug(f"[WS Heartbeat] Received pong from user {user_id}")
                # Activity is already updated above, no need to do anything else
                
            elif data.get("type") == "custom_feed_process":
                # Handle custom feed processing request
                from processors.standalone_custom_processor import StandaloneCustomProcessor
                from custom_feed_models_pkg.custom_feed_models import CustomFeedRequest
                
                try:
                    feed_data = data.get("data", {})
                    custom_request = CustomFeedRequest(
                        session_id=feed_data.get("session_id", f"custom_{user_id}"),
                        posts=feed_data.get("posts", []),
                        return_original=feed_data.get("return_original", True)
                    )
                    
                    # Process the custom feed
                    processor = StandaloneCustomProcessor()
                    response = await processor.process_batch(custom_request)
                    
                    # Send results back
                    await manager.send_json({
                        "type": "custom_feed_result",
                        "data": response.model_dump()
                    }, user_id)
                    
                except Exception as e:
                    logger.error(f"Custom feed processing error: {e}", exc_info=True)
                    await manager.send_json({
                        "type": "custom_feed_error",
                        "error": str(e),
                        "session_id": feed_data.get("session_id", "unknown")
                    }, user_id)
                    
            elif data.get("type") == "custom_feed_auto_filter":
                # Handle custom feed with auto-filter mode
                from processors.standalone_custom_processor import StandaloneCustomProcessor
                from custom_feed_models_pkg.custom_feed_models import CustomFeedAutoFilterRequest
                
                try:
                    feed_data = data.get("data", {})
                    auto_request = CustomFeedAutoFilterRequest(
                        session_id=feed_data.get("session_id", f"auto_{user_id}"),
                        user_id=feed_data.get("user_id", user_id),  # Use provided user_id or fallback to WebSocket user_id
                        posts=feed_data.get("posts", []),
                        return_original=feed_data.get("return_original", True)
                    )
                    
                    # Process with user filters
                    processor = StandaloneCustomProcessor()
                    response = await processor.process_auto_filter_batch(auto_request)
                    
                    # Send results back
                    await manager.send_json({
                        "type": "custom_feed_result",
                        "data": response.model_dump()
                    }, user_id)
                    
                except Exception as e:
                    logger.error(f"Custom feed auto-filter error: {e}", exc_info=True)
                    await manager.send_json({
                        "type": "custom_feed_error",
                        "error": str(e),
                        "session_id": feed_data.get("session_id", "unknown")
                    }, user_id)
                
    except WebSocketDisconnect:
        logger.info(f"[WS Disconnect] 🔌❌ WebSocket disconnected for user {user_id}")
        logger.info(f"[WS Disconnect] Timestamp: {datetime.now().isoformat()}")
        logger.info(f"[WS Disconnect] Images user was waiting for: {manager.waiting_with_filters.get(user_id, {})}")
        manager.disconnect(user_id)
        logger.info(f"[WS Disconnect] Cleanup completed for user {user_id}")
    except Exception as e:
        logger.error(f"[WS Error] ❌ WebSocket error for user {user_id}: {e}", exc_info=True)
        logger.info(f"[WS Error] Timestamp: {datetime.now().isoformat()}")
        manager.disconnect(user_id)
        logger.info(f"[WS Error] Cleanup completed for user {user_id}")

#--------------------------------
# CUSTOM FEED ENDPOINTS
#--------------------------------
# Update these endpoints in app.py to use the refactored processor:

@app.post('/custom-feed/process')
@handle_api_errors
async def process_custom_feed(request_data: Dict[str, Any]):
    """
    Process a custom Reddit feed with explicit intervention types.
    This endpoint is completely isolated from the main feed processing.
    """
    from processors.standalone_custom_processor import process_custom_feed_request
    from custom_feed_models_pkg.custom_feed_models import CustomFeedRequest
    
    try:
        # Create request object
        print("Processing custom feed request with data:", request_data.get("session_id"))
        custom_request = CustomFeedRequest(
            user_id=request_data.get("user_id"),
            session_id=request_data.get("session_id"),
            posts=request_data.get("posts", []),
            return_original=request_data.get("return_original", True)
        )
        
        logger.info(f"Processing custom-feed with session: {custom_request.session_id}")
        
        # Process using the convenience function
        response = await process_custom_feed_request(custom_request)
        
        return {
            "status": "success",
            "data": response.model_dump()
        }
        
    except Exception as e:
        logger.error(f"Custom feed API error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/custom-feed/process-with-filters')
@handle_api_errors
async def process_custom_feed_with_filters(request_data: Dict[str, Any]):
    """
    Process a custom Reddit feed using user's saved filters.
    Automatically determines interventions based on filter matches.
    """
    from processors.standalone_custom_processor import process_auto_filter_request
    from custom_feed_models_pkg.custom_feed_models import CustomFeedAutoFilterRequest
    
    try:
        # Parse request
        auto_request = CustomFeedAutoFilterRequest(**request_data)
        
        # Process using the convenience function
        response = await process_auto_filter_request(auto_request)
        
        return {
            "status": "success",
            "data": response.model_dump()
        }
        
    except Exception as e:
        logger.error(f"Custom feed auto-filter error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/custom-feed/image-status/{session_id}')
@handle_api_errors
async def get_custom_image_status(
    session_id: str,
    image_url: str = Query(..., description="Image URL to check")
):
    """
    Check the status of deferred image processing for custom feeds.
    """
    from processors.standalone_custom_processor import StandaloneCustomProcessor
    
    # Create a dummy processor just to use its check method
    processor = StandaloneCustomProcessor(
        user_id="custom_user",
        session_id=session_id,
        posts_data=[]
    )
    
    status = processor.check_deferred_images_status()
    
    # Find the specific image status
    image_status = status.get("results", {}).get(image_url, {})
    
    if image_status.get("status") == "COMPLETED":
        return {
            "status": "completed",
            "result": image_status.get("url")
        }
    
    return {
        "status": "processing",
        "result": None
    }

# Custom Feed Save/Retrieve Endpoints
@app.post('/custom-feed/save')
@handle_api_errors
async def save_custom_feed_endpoint(request_data: Dict[str, Any]):
    """Save a processed custom feed for a user"""
    from database import save_custom_feed
    
    user_id = request_data.get('user_id')
    title = request_data.get('title', f"Custom Feed - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    feed_html = request_data.get('feed_html')
    metadata = request_data.get('metadata', {})
    comparison_set_id = request_data.get('comparison_set_id')
    feed_type = request_data.get('feed_type')
    filter_config = request_data.get('filter_config')
    
    if not user_id or not feed_html:
        return {
            "status": "error",
            "message": "user_id and feed_html are required"
        }
    
    feed_id = save_custom_feed(
        user_id=user_id, 
        title=title, 
        feed_html=feed_html, 
        metadata=metadata,
        comparison_set_id=comparison_set_id,
        feed_type=feed_type,
        filter_config=filter_config
    )
    
    return {
        "status": "success", 
        "data": {
            "feed_id": feed_id,
            "title": title,
            "comparison_set_id": comparison_set_id,
            "feed_type": feed_type,
            "message": "Custom feed saved successfully"
        }
    }

@app.get('/custom-feed/list/{user_id}')
@handle_api_errors
async def list_user_custom_feeds(user_id: str):
    """List all custom feeds for a user"""
    from database import get_user_custom_feeds
    
    feeds = get_user_custom_feeds(user_id)
    
    return {
        "status": "success",
        "data": {
            "feeds": feeds,
            "count": len(feeds)
        }
    }

@app.get('/custom-feed/retrieve/{feed_id}')
@handle_api_errors
async def retrieve_custom_feed(feed_id: int):
    """Retrieve a specific custom feed by ID"""
    from database import get_custom_feed_by_id
    
    feed = get_custom_feed_by_id(feed_id)
    
    if not feed:
        return {
            "status": "error",
            "message": "Feed not found"
        }
    
    return {
        "status": "success",
        "data": feed
    }

@app.delete('/custom-feed/{feed_id}')
@handle_api_errors
async def delete_custom_feed_endpoint(
    feed_id: int,
    user_id: str = Query(..., description="User ID for ownership verification")
):
    """Delete a custom feed"""
    from database import delete_custom_feed
    
    success = delete_custom_feed(feed_id, user_id)
    
    if not success:
        return {
            "status": "error",
            "message": "Feed not found or unauthorized"
        }
    
    return {
        "status": "success",
        "message": f"Feed {feed_id} deleted successfully"
    }

@app.post('/custom-feed/process-comparison')
@handle_api_errors
async def process_comparison_endpoint(request_data: Dict[str, Any]):
    """Process custom feed and generate both original and filtered versions"""
    from process_comparison import process_json_with_comparison
    
    user_id = request_data.get('user_id')
    title = request_data.get('title', f"Comparison Feed - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    json_data = request_data.get('json_data')
    
    if not user_id or not json_data:
        return {
            "status": "error",
            "message": "user_id and json_data are required"
        }
    
    try:
        result = await process_json_with_comparison(json_data, user_id, title)
        
        return {
            "status": "success",
            "data": result
        }
    except Exception as e:
        logger.error(f"Comparison processing error: {e}", exc_info=True)
        return {
            "status": "error",
            "message": str(e)
        }

@app.get('/custom-feed/comparison-sets/{user_id}')
@handle_api_errors
async def list_user_comparison_sets(user_id: str):
    """List all comparison sets for a user"""
    from database import get_comparison_sets_for_user
    
    comparison_sets = get_comparison_sets_for_user(user_id)
    # print(f"Retrieved {len(comparison_sets)} comparison sets for user {user_id}.\n Details: {comparison_sets}")
    return {
        "status": "success",
        "data": {
            "comparison_sets": comparison_sets,
            "count": len(comparison_sets)
        }
    }

@app.get('/custom-feed/comparison-set/{user_id}/{comparison_set_id}')
@handle_api_errors
async def get_feeds_in_comparison_set(user_id: str, comparison_set_id: str):
    """Get all feeds in a specific comparison set"""
    from database import get_feeds_by_comparison_set
    print(f"Fetching feeds for user {user_id} in comparison set {comparison_set_id}")
    feeds = get_feeds_by_comparison_set(user_id, comparison_set_id)
    
    if not feeds:
        raise HTTPException(status_code=404, detail="Comparison set not found")
    
    # Organize feeds by type
    original_feed = None
    filtered_feeds = []
    
    for feed in feeds:
        if feed['feed_type'] == 'original':
            original_feed = feed
        elif feed['feed_type'] == 'filtered':
            filtered_feeds.append(feed)
    
    return {
        "status": "success",
        "data": {
            "comparison_set_id": comparison_set_id,
            "original": original_feed,
            "filtered": filtered_feeds,
            "all_feeds": feeds
        }
    }

@app.get('/custom-feed/comparison/{comparison_set_id}')
@handle_api_errors
async def get_comparison_feeds(comparison_set_id: str):
    """Get all feeds in a comparison set (legacy endpoint for compatibility)"""
    from database.models import CustomFeed
    from database.operations import get_db
    
    try:
        with get_db() as db:
            # Use the new database fields instead of metadata
            feeds = db.query(CustomFeed).filter(
                CustomFeed.comparison_set_id == comparison_set_id
            ).all()
            
            if not feeds:
                raise HTTPException(status_code=404, detail="Comparison set not found")
            
            # Organize by feed_type 
            original_feed = None
            filtered_feeds = []
            
            for feed in feeds:
                if feed.feed_type == "original":
                    original_feed = feed
                elif feed.feed_type == "filtered":
                    filtered_feeds.append(feed)
            
            return {
                "status": "success",
                "comparison_set_id": comparison_set_id,
                "original": {
                    "id": original_feed.id,
                    "title": original_feed.title,
                    "html_content": original_feed.feed_html,
                    "created_at": original_feed.created_at.isoformat()
                } if original_feed else None,
                "filtered": [{
                    "id": feed.id, 
                    "title": feed.title,
                    "html_content": feed.feed_html,
                    "filter_config": feed.filter_config,
                    "created_at": feed.created_at.isoformat()
                } for feed in filtered_feeds]
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving comparison feeds: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }

@app.post('/auth/login-email')
@handle_api_errors
async def login_with_email(request_data: Dict[str, Any]):
    """Login or create user with email address"""
    from database import get_user_by_email, create_user_with_email
    
    email = request_data.get('email', '').strip().lower()
    
    if not email:
        return {
            "status": "error",
            "message": "Email is required"
        }
    
    # Validate email format (basic)
    import re
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        return {
            "status": "error",
            "message": "Invalid email format"
        }
    
    try:
        # Try to get existing user first
        user = get_user_by_email(email)
        
        if user:
            logger.info(f"User logged in: {user['id']} ({email})")
            return {
                "status": "success",
                "message": "User found",
                "user": user,
                "is_new": False
            }
        else:
            # Create new user
            user = create_user_with_email(email)
            logger.info(f"New user created: {user['id']} ({email})")
            return {
                "status": "success", 
                "message": "New user created",
                "user": user,
                "is_new": True
            }
            
    except Exception as e:
        logger.error(f"Error in email login: {e}", exc_info=True)
        return {
            "status": "error",
            "message": "Failed to process login"
        }

@app.get('/auth/user/{user_id}')
@handle_api_errors
async def get_user_info(user_id: str):
    """Get user information by user_id"""
    from database.models import User
    from database.operations import get_db
    
    try:
        with get_db() as db:
            user = db.query(User).filter(User.id == user_id).first()
            
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            
            return {
                "status": "success",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "last_active": user.last_active.isoformat() if user.last_active else None
                }
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user info: {e}", exc_info=True)
        return {
            "status": "error",
            "message": str(e)
        }

#--------------------------------
# FRONTEND ROUTES - REDDIT CLONE
#--------------------------------
# COMMENTED OUT - No frontend for now
# @app.get('/', response_class=HTMLResponse)
# async def reddit_home(request: Request, user_id: str = Query(default="default_user")):
#     """Reddit-style homepage showing custom feeds"""
#     from database import get_user_custom_feeds
#     
#     feeds = get_user_custom_feeds(user_id)
#     # Sort feeds by creation date (newest first)
#     feeds.sort(key=lambda x: x.get('created_at', ''), reverse=True)
#     
#     return templates.TemplateResponse("reddit_home.html", {
#         "request": request,
#         "feeds": feeds,
#         "user_id": user_id
#     })

# @app.get('/r/custom/{feed_id}', response_class=HTMLResponse)
# async def reddit_feed_view(request: Request, feed_id: int):
#     """View a custom feed in Reddit style"""
#     from database import get_custom_feed_by_id
#     
#     feed = get_custom_feed_by_id(feed_id)
#     if not feed:
#         raise HTTPException(status_code=404, detail="Feed not found")
#     
#     return templates.TemplateResponse("reddit_feed.html", {
#         "request": request,
#         "feed": feed
#     })

# @app.get('/compare', response_class=HTMLResponse)
# async def compare_feeds(request: Request, user_id: str = Query(default="default_user")):
#     """Side-by-side feed comparison view for user testing"""
#     from database import get_user_custom_feeds
#     
#     feeds = get_user_custom_feeds(user_id)
#     return templates.TemplateResponse("compare_feeds.html", {
#         "request": request,
#         "feeds": feeds,
#         "user_id": user_id
#     })

@app.get('/api/feeds/{user_id}')
async def get_feeds_list(user_id: str):
    """API endpoint to get list of feeds for dropdown"""
    from database import get_user_custom_feeds
    
    feeds = get_user_custom_feeds(user_id)
    return {
        "status": "success",
        "feeds": [{"id": f["id"], "title": f["title"]} for f in feeds]
    }

@app.get('/api/feed/{feed_id}/html')
async def get_feed_html(feed_id: int):
    """API endpoint to get feed HTML content"""
    from database import get_custom_feed_by_id
    
    feed = get_custom_feed_by_id(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    
    return {
        "status": "success",
        "html": feed["feed_html"],
        "title": feed["title"],
        "metadata": feed.get("feed_metadata", {})
    }

#--------------------------------
# ADMIN ROUTES
#--------------------------------
# COMMENTED OUT - No frontend for now
# @app.get('/admin', response_class=HTMLResponse)
# async def admin_home(request: Request):
#     """Admin interface home"""
#     return templates.TemplateResponse("index.html", {"request": request})

# @app.get('/admin/feeds', response_class=HTMLResponse)
# async def admin_list_feeds(request: Request, user_id: str = Query(default="default_user")):
#     """Admin view of all feeds"""
#     from database import get_user_custom_feeds
#     
#     feeds = get_user_custom_feeds(user_id)
#     return templates.TemplateResponse("feeds.html", {
#         "request": request,
#         "feeds": feeds,
#         "user_id": user_id
#     })

# @app.get('/admin/feed/{feed_id}', response_class=HTMLResponse)
# async def admin_view_feed(request: Request, feed_id: int):
#     """Admin view of a specific feed"""
#     from database import get_custom_feed_by_id
#     
#     feed = get_custom_feed_by_id(feed_id)
#     if not feed:
#         raise HTTPException(status_code=404, detail="Feed not found")
#     
#     return templates.TemplateResponse("feed_view.html", {
#         "request": request,
#         "feed": feed
#     })

# @app.get('/admin/create', response_class=HTMLResponse)
# async def admin_create_feed_page(request: Request):
#     """Admin page to create a new custom feed"""
#     return templates.TemplateResponse("create_feed.html", {"request": request})

@app.post('/upload-feed')
async def upload_feed(
    file: UploadFile = File(...),
    user_id: str = Form(default="default_user"),
    title: str = Form(default="")
):
    """Handle JSON feed file upload and processing"""
    try:
        content = await file.read()
        feed_data = json.loads(content)
        
        # Process the feed
        from process_json_custom_feed import process_json_feed
        output_file = await process_json_feed(feed_data, user_id)
        
        # Read the generated HTML
        with open(output_file, 'r') as f:
            feed_html = f.read()
        
        # Save to database
        from database import save_custom_feed
        feed_id = save_custom_feed(
            user_id=user_id,
            title=title or f"Upload: {file.filename}",
            feed_html=feed_html,
            metadata={"source": "upload", "filename": file.filename}
        )
        
        # Clean up
        os.remove(output_file)
        
        return JSONResponse({
            "status": "success",
            "feed_id": feed_id,
            "redirect": f"/feed/{feed_id}"
        })
        
    except Exception as e:
        logger.error(f"Feed upload error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Human Preferences Endpoints
@app.post('/human-preferences/submit')
@handle_api_errors
async def submit_human_preferences(request_data: Dict[str, Any]):
    """Submit human preferences for post comparisons"""
    try:
        from custom_feed_models_pkg.custom_feed_models import HumanPreferenceSubmission, HumanPreferenceResponse
        from database.operations import save_human_preferences
        print(f"{bcolors.OKGREEN}Request data: {request_data}{bcolors.ENDC}")
        submission = HumanPreferenceSubmission(**request_data)
        
        # Convert Pydantic models to dicts for the operations function
        preference_dicts = []
        for pref in submission.preferences:
            if pref.text_preference is not None or pref.image_preference is not None:
                preference_dicts.append({
                    'post_id': pref.post_id,
                    'post0_text_content': pref.post0_text_content,
                    'post1_text_content': pref.post1_text_content,
                    'text_preference': pref.text_preference,
                    'post0_image_url': pref.post0_image_url,
                    'post1_image_url': pref.post1_image_url,
                    'image_preference': pref.image_preference
                })
        
        if not preference_dicts:
            raise HTTPException(status_code=400, detail="No valid preferences provided")
        
        # Save to database using operations function
        saved_count = save_human_preferences(
            user_id=submission.user_id,
            comparison_set_id=submission.comparison_set_id,
            preferences=preference_dicts
        )
        
        if saved_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "status": "success",
            "data": HumanPreferenceResponse(
                success=True,
                saved_count=saved_count,
                message=f"Successfully saved {saved_count} preferences"
            ).model_dump()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting human preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/human-preferences/list/{user_id}')
@handle_api_errors
async def list_human_preferences(user_id: str, comparison_set_id: str = Query(None)):
    """List human preferences for a user, optionally filtered by comparison set"""
    try:
        from database.operations import get_human_preferences
        
        preferences = get_human_preferences(
            user_id=user_id,
            comparison_set_id=comparison_set_id
        )
        
        return {
            "status": "success",
            "data": {
                "preferences": preferences,
                "total_count": len(preferences)
            }
        }
        
    except Exception as e:
        logger.error(f"Error listing human preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/human-preferences/stats/{comparison_set_id}')
@handle_api_errors
async def get_preference_stats(comparison_set_id: str):
    """Get aggregated statistics for human preferences in a comparison set"""
    try:
        from database.operations import get_human_preference_stats
        
        stats = get_human_preference_stats(comparison_set_id)
        
        return {
            "status": "success",
            "data": stats
        }
        
    except Exception as e:
        logger.error(f"Error getting preference statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.middleware("http")
async def add_private_network_header(request: Request, call_next):
    # Handle preflight here too as backup
    if request.method == "OPTIONS":
        origin = request.headers.get("origin", "")
        response = Response()
        response.headers["Access-Control-Allow-Origin"] = origin if origin else "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        return response
    
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

#
if __name__ == '__main__':
    # Use Hypercorn (already in requirements)
    hypercorn_config = HyperConfig()
    hypercorn_config.bind = ["0.0.0.0:8001"]
    print(f"Current WebSocket max message size: {hypercorn_config.websocket_max_message_size} bytes")
    # hypercorn_config.websocket_max_message_size = 10485760
    
    # Enable reload on source edit
    hypercorn_config.use_reloader = True
    print("Auto-reload enabled - server will restart when source files change")
    
    asyncio.run(serve(app, hypercorn_config))
    
    # Alternative: Use Uvicorn (also in requirements)
    # import uvicorn
    # uvicorn.run(app, host="0.0.0.0", port=8001, reload=True)  # Added reload=True