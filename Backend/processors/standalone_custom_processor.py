"""
Standalone Custom Feed Processor
Processes custom Reddit feeds with explicit intervention types
Follows the same pattern as RedditProcessor for consistency
"""

import asyncio
import logging
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from bs4 import BeautifulSoup
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from processors.base_processor import ContentProcessor, Post
from custom_feed_models_pkg.custom_feed_models import (
    CustomFeedPost as CustomFeedPostModel, 
    ProcessedPost, 
    CustomFeedRequest, 
    CustomFeedResponse, 
    CustomFeedAutoFilterRequest
)
# from custom_interventions.intervention_engine import InterventionEngine
from CartoonImager import make_image_cartoonish, make_image_replacement_gemini
from ServerCache import image_cache
from database import get_user_filters
from llm import ContentFilter
from utils.errors import ProcessorError, handle_processing_errors

logger = logging.getLogger(__name__)


class CustomPost(Post):
    """Custom post structure extending base Post class"""
    
    def __init__(self, 
                 post_html: str, 
                 text_intervention: Optional[str] = None,
                 image_intervention: Optional[str] = None,
                 post_id: Optional[str] = None,
                 session_id: Optional[str] = None):
        
        self.soup = BeautifulSoup(post_html, 'html.parser')
        self.post_element = self.soup.find('shreddit-post')
        self.is_valid = self.post_element is not None
        
        if not self.is_valid:
            logger.warning(f"No shreddit-post element found in HTML for post {post_id}")
        
        # Store intervention types
        self.text_intervention = text_intervention
        self.image_intervention = image_intervention
        self.session_id = session_id
        
        # Extract basic info
        if self.is_valid:
            title = self._extract_title()
            body = self._extract_body()
            media_urls = self._extract_media_urls()
            post_id = post_id or self.post_element.get('id', 'unknown')
        else:
            title = None
            body = None
            media_urls = []
            post_id = post_id or 'invalid'
        
        # Initialize base Post
        super().__init__(
            id=post_id,
            title=title,
            body=body,
            platform='reddit_custom',
            created_at=datetime.now(),
            media_urls=media_urls,
            metadata={
                'text_intervention': text_intervention,
                'image_intervention': image_intervention,
                'session_id': session_id,
                'original_html': post_html
            }
        )
        
        # Track deferred image processing
        self.deferred_images = []
        self.image_processing_status = {}
    
    def _extract_title(self) -> Optional[str]:
        """Extract post title"""
        title_elem = self.post_element.select_one('a[slot="title"]')
        return title_elem.get_text().strip() if title_elem else None
    
    def _extract_body(self) -> Optional[str]:
        """Extract post body"""
        body_elem = self.post_element.select_one('a[slot="text-body"]')
        return body_elem.get_text().strip() if body_elem else None
    
    def _extract_media_urls(self) -> List[str]:
        """Extract all image URLs from the post"""
        image_urls = []
        media_container = self.post_element.find('div', attrs={'slot': 'post-media-container'})
        
        if not media_container:
            return image_urls
        
        # Check for gallery
        gallery = media_container.find('gallery-carousel')
        if gallery:
            figures = gallery.find_all('figure')
            for figure in figures[:3]:  # Limit to 3 images
                img = figure.find('img')
                if img and 'src' in img.attrs:
                    image_urls.append(img['src'])
        else:
            # Single image or video thumbnail
            imgs = media_container.find_all('img')
            for img in imgs:
                if 'src' in img.attrs and 'post-background-image-filter' not in img.get('class', []):
                    image_urls.append(img['src'])
                    break
        
        return image_urls
    
    def update_element(self):
        """Update BeautifulSoup element with processed content"""
        if not self.is_valid:
            return
            
        # Update text content
        if self.processed_title:
            title_elem = self.post_element.select_one('a[slot="title"]')
            if title_elem:
                title_elem.string = self.processed_title
        
        if self.processed_body:
            body_elem = self.post_element.select_one('a[slot="text-body"]')
            if body_elem:
                body_elem.string = self.processed_body
        
        # Update images with intervention configs
        if self.processed_media_urls:
            self._update_images_with_configs()
    
    def _update_images_with_configs(self):
        """Update image elements with intervention configurations"""
        media_container = self.post_element.find('div', attrs={'slot': 'post-media-container'})
        if not media_container:
            return
        
        # Find all images
        all_imgs = []
        gallery = media_container.find('gallery-carousel')
        if gallery:
            figures = gallery.find_all('figure')
            for figure in figures:
                img = figure.find('img')
                if img:
                    all_imgs.append(img)
        else:
            imgs = media_container.find_all('img')
            all_imgs = [img for img in imgs if 'post-background-image-filter' not in img.get('class', [])]
        
        # Apply configurations
        for i, img in enumerate(all_imgs):
            if i >= len(self.processed_media_urls):
                break
                
            img_data = self.processed_media_urls[i]
            if img_data.get('url'):
                img['src'] = img_data['url']
                img['srcset'] = ''  # Clear srcset
            
            # Add custom intervention data
            if img_data.get('config'):
                img['diy-mod-custom'] = json.dumps(img_data['config'])
            
            # Add class for styling
            current_class = img.get('class', [])
            if isinstance(current_class, str):
                current_class = current_class.split()
            img['class'] = current_class + ['diy-mod-custom-processed']
    
    def get_processed_html(self) -> str:
        """Get the processed HTML"""
        return str(self.soup)


class StandaloneCustomProcessor(ContentProcessor):
    """Process custom Reddit posts with explicit interventions"""
    
    def __init__(self, user_id: str, session_id: str, posts_data: List[Any]):
        # Initialize with a dummy feed_info and url since we're processing custom posts
        # Create a dummy HTML response that contains our posts
        dummy_html = "<div>Custom feed placeholder</div>"
        feed_info = {
            "type": "custom", 
            "session_id": session_id,
            "response": dummy_html  # ContentProcessor might expect this
        }
        url = f"custom://session/{session_id}"
        
        # Initialize base ContentProcessor
        super().__init__(user_id, feed_info, url)
        
        # Store custom processing data AFTER super().__init__
        self.session_id = session_id
        self.posts_data = posts_data  # This is the critical part that was being lost
        # self.intervention_engine = InterventionEngine()
        self.deferred_images_tracker = {}  # Track deferred images by URL
        
        logger.info(f"Initialized StandaloneCustomProcessor for session {session_id} with {len(posts_data)} posts")
        
    @handle_processing_errors
    async def work_on_feed(self) -> List[ProcessedPost]:
        """Process the custom feed posts and wait for deferred images"""
        try:
            logger.info(f"Starting work_on_feed with {len(self.posts_data)} posts")
            
            # Create CustomPost instances from input data
            custom_posts = []
            for i, post_data in enumerate(self.posts_data):
                logger.debug(f"Processing post_data {i}: type={type(post_data)}")
                
                if isinstance(post_data, CustomFeedPostModel):
                    # From CustomFeedRequest - post_data is a Pydantic model
                    logger.debug(f"Post {i} is CustomFeedPostModel with interventions: text={post_data.text_intervention}, image={post_data.image_intervention}")
                    custom_post = CustomPost(
                        post_html=post_data.post_html,
                        text_intervention=post_data.text_intervention,
                        image_intervention=post_data.image_intervention,
                        post_id=post_data.post_id,
                        session_id=self.session_id
                    )
                elif isinstance(post_data, dict):
                    # From dict (auto-filter mode or other sources)
                    custom_post = CustomPost(
                        post_html=post_data.get('post_html', ''),
                        text_intervention=post_data.get('text_intervention'),
                        image_intervention=post_data.get('image_intervention'),
                        post_id=post_data.get('post_id'),
                        session_id=self.session_id
                    )
                else:
                    logger.error(f"Unexpected post_data type: {type(post_data)}")
                    continue
                    
                custom_posts.append(custom_post)
            
            logger.info(f"Created {len(custom_posts)} CustomPost objects")
            
            # Process posts in parallel
            processed_posts = await self._process_posts_parallel(custom_posts)
            logger.info(f"Processed {len(processed_posts)} posts")
            
            # Check if we have any deferred images
            if self.deferred_images_tracker:
                logger.info(f"Waiting for {len(self.deferred_images_tracker)} deferred images...")
                await self._wait_for_deferred_images()
            
            # Convert to ProcessedPost format for API response
            results = []
            for post in processed_posts:
                if isinstance(post, CustomPost):
                    # Update element with final processed content
                    post.update_element()
                    
                    # Structure image processing status for compatibility with process_json_custom_feed.py
                    # Extract deferred images directly from processed HTML (like Reddit processor does)
                    image_processing_status = None
                    
                    try:
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(post.get_processed_html(), 'html.parser')
                        deferred_imgs = soup.find_all('img', attrs={'diy-mod-custom': True})
                        
                        deferred_items = []
                        for img in deferred_imgs:
                            config_str = img.get('diy-mod-custom', '{}')
                            try:
                                config = json.loads(config_str)
                                if config.get('status') == 'DEFERRED':
                                    deferred_items.append({
                                        'url': img.get('src', ''),
                                        'filters': config.get('filters', []),
                                        'status': 'deferred',
                                        'type': config.get('type'),
                                        'top3_interventions': config.get('top3_interventions', []),
                                        'next2_interventions': config.get('next2_interventions', []),
                                        'all_recommended_interventions': config.get('all_recommended_interventions', [])
                                    })
                            except json.JSONDecodeError:
                                continue
                        
                        if deferred_items:
                            image_processing_status = {
                                'deferred_images': deferred_items
                            }
                            logger.info(f"Found {len(deferred_items)} deferred images with intervention metadata")
                        
                    except Exception as e:
                        logger.error(f"Error extracting deferred image metadata: {e}")
                    
                    results.append(ProcessedPost(
                        post_id=post.id,
                        original_html=post.metadata.get('original_html', ''),
                        processed_html=post.get_processed_html(),
                        text_intervention_applied=post.text_intervention,
                        image_intervention_applied=post.image_intervention,
                        image_processing_status=image_processing_status,
                        processing_time_ms=post.metadata.get('processing_time_ms', 0),
                        errors=None
                    ))
            
            logger.info(f"Returning {len(results)} ProcessedPost objects")
            return results
            
        except Exception as e:
            logger.error(f"Error in work_on_feed: {e}", exc_info=True)
            raise ProcessorError(f"Error processing custom feed: {e}")
    
    async def _process_posts_parallel(self, posts: List[CustomPost]) -> List[CustomPost]:
        """Process multiple posts in parallel"""
        if not posts:
            logger.warning("No posts to process in _process_posts_parallel")
            return []
        
        logger.info(f"Starting parallel processing of {len(posts)} posts")
        
        # Create tasks for all posts
        tasks = []
        for i, post in enumerate(posts):
            logger.debug(f"Creating task for post {i}: {post.id}")
            task = asyncio.create_task(self.process_post(post))
            tasks.append(task)
        
        logger.info(f"Created {len(tasks)} tasks, waiting for completion...")
        
        # Wait for all tasks to complete
        completed_posts = await asyncio.gather(*tasks, return_exceptions=True)
        
        logger.info(f"All tasks completed, processing results...")
        
        # Handle results
        processed = []
        for i, result in enumerate(completed_posts):
            if isinstance(result, Exception):
                logger.error(f"Error processing post {i}: {result}", exc_info=True)
                # Return original post on error
                processed.append(posts[i])
            else:
                logger.debug(f"Successfully processed post {i}")
                processed.append(result)
        
        logger.info(f"Returning {len(processed)} processed posts")
        return processed
    
    async def _wait_for_deferred_images(self, max_wait_seconds: int = 60, poll_interval: int = 2):
        """Wait for deferred image processing to complete"""
        start_time = datetime.now()
        
        while self.deferred_images_tracker:
            # Check each deferred image
            completed_urls = []
            
            for img_url, info in self.deferred_images_tracker.items():
                # Check cache for completion
                possible_filters = [
                    [f"custom_{info['intervention']}_{self.session_id}"],
                    [f"custom_cartoonish_{self.session_id}"],
                    [f"custom_edit_{self.session_id}"]
                ]
                
                for filters in possible_filters:
                    cached_result = image_cache.get_processed_value_from_cache(
                        image_url=img_url,
                        filters=filters
                    )
                    if cached_result:
                        logger.info(f"Deferred image completed: {img_url}")
                        completed_urls.append(img_url)
                        
                        # Update the corresponding post's processed_media_urls
                        # This would require tracking which post each image belongs to
                        # For now, we'll just mark it as completed
                        break
            
            # Remove completed images from tracker
            for url in completed_urls:
                del self.deferred_images_tracker[url]
            
            # Check if we've waited too long
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > max_wait_seconds:
                logger.warning(f"Timeout waiting for deferred images. {len(self.deferred_images_tracker)} still pending.")
                break
            
            # If still waiting, sleep before next poll
            if self.deferred_images_tracker:
                await asyncio.sleep(poll_interval)
        
        logger.info("Finished waiting for deferred images")
    
    def check_deferred_images_status(self) -> Dict[str, Any]:
        """Check current status of deferred images"""
        results = {}
        completed_count = 0
        
        for img_url in list(self.deferred_images_tracker.keys()):
            info = self.deferred_images_tracker[img_url]
            
            # Check cache
            possible_filters = [
                [f"custom_{self.session_id}"],
                [f"custom_cartoonish_{self.session_id}"],
                [f"custom_edit_{self.session_id}"]
            ]
            
            cached_result = None
            for filters in possible_filters:
                cached_result = image_cache.get_processed_value_from_cache(
                    image_url=img_url,
                    filters=filters
                )
                if cached_result:
                    break
            
            if cached_result:
                results[img_url] = {
                    "status": "COMPLETED",
                    "processed_value": cached_result,
                    "url": cached_result if isinstance(cached_result, str) else img_url
                }
                completed_count += 1
            else:
                results[img_url] = {
                    "status": "PROCESSING",
                    "processed_value": None
                }
        
        total_count = len(self.deferred_images_tracker)
        
        if completed_count == total_count:
            overall_status = "ALL_COMPLETED"
        elif completed_count > 0:
            overall_status = "PARTIALLY_COMPLETED"
        else:
            overall_status = "PROCESSING"
        
        return {
            "session_id": self.session_id,
            "status": overall_status,
            "completed_count": completed_count,
            "total_count": total_count,
            "results": results
        }


class AutoFilterCustomProcessor(StandaloneCustomProcessor):
    """Custom processor that automatically determines interventions based on user filters"""
    
    def __init__(self, user_id: str, session_id: str, posts_html: List[Dict[str, Any]]):
        # Initialize parent with posts_html as posts_data
        super().__init__(user_id, session_id, posts_html)
        
        # Load user filters
        self.user_filters = [ContentFilter(**f) for f in get_user_filters(user_id)]
        logger.info(f"Loaded {len(self.user_filters)} filters for auto-processing")
    
    def _map_intensity_to_intervention(self, intensity: int) -> Dict[str, Optional[str]]:
        """Map filter intensity to intervention types"""
        if intensity <= 2:
            return {"text": "blur", "image": "blur"}
        elif intensity == 3:
            return {"text": "overlay", "image": "overlay"}
        else:  # intensity >= 4
            return {"text": "rewrite", "image": "cartoonish"}
    
    async def work_on_feed(self) -> List[ProcessedPost]:
        """Process posts with automatic filter detection"""
        try:
            # First, analyze each post to determine interventions
            analyzed_posts = []
            
            for post_data in self.posts_data:
                post_html = post_data.get('post_html', '')
                post_id = post_data.get('post_id')
                
                # Create a temporary CustomPost to extract content
                temp_post = CustomPost(
                    post_html=post_html,
                    post_id=post_id,
                    session_id=self.session_id
                )
                
                # Determine interventions based on content
                text_intervention = None
                image_intervention = None
                
                if temp_post.is_valid and self.user_filters:
                    combined_text = temp_post.get_combined_text()
                    
                    if combined_text:
                        # Evaluate against filters
                        matching_filters = await self.llm_processor.evaluate_content(
                            combined_text, self.user_filters
                        )
                        
                        if matching_filters:
                            max_intensity = max(f.intensity for f in matching_filters)
                            interventions = self._map_intensity_to_intervention(max_intensity)
                            text_intervention = interventions["text"]
                            image_intervention = interventions["image"] if temp_post.media_urls else None
                            
                            logger.info(f"Post {post_id} matched filters with intensity {max_intensity}")
                
                # Add analyzed post data
                analyzed_posts.append({
                    'post_html': post_html,
                    'post_id': post_id,
                    'text_intervention': text_intervention,
                    'image_intervention': image_intervention
                })
            
            # Update posts_data with interventions
            self.posts_data = analyzed_posts
            
            # Now process with determined interventions
            return await super().work_on_feed()
            
        except Exception as e:
            raise ProcessorError(f"Error in auto-filter processing: {e}")


# Convenience functions for API compatibility
async def process_custom_feed_request(request: CustomFeedRequest) -> CustomFeedResponse:
    """Process a custom feed request"""
    logger.info(f"process_custom_feed_request called with session_id: {request.session_id}, {len(request.posts)} posts")
    
    processor = StandaloneCustomProcessor(
        user_id=request.user_id,  # Custom feeds don't need a real user_id
        session_id=request.session_id,
        posts_data=request.posts  # Pass the actual posts from the request
    )
    
    start_time = datetime.now()
    processed_posts = await processor.work_on_feed()
    total_time = (datetime.now() - start_time).total_seconds() * 1000
    
    logger.info(f"process_custom_feed_request completed with {len(processed_posts)} processed posts")
    
    return CustomFeedResponse(
        session_id=request.session_id,
        processed_posts=processed_posts,
        total_processing_time_ms=total_time
    )


async def process_auto_filter_request(request: CustomFeedAutoFilterRequest) -> CustomFeedResponse:
    """Process an auto-filter feed request"""
    logger.info(f"process_auto_filter_request called for user {request.user_id}, session {request.session_id}")
    
    processor = AutoFilterCustomProcessor(
        user_id=request.user_id,
        session_id=request.session_id,
        posts_html=request.posts  # Note: this is posts_html for auto-filter
    )
    
    start_time = datetime.now()
    processed_posts = await processor.work_on_feed()
    total_time = (datetime.now() - start_time).total_seconds() * 1000
    
    logger.info(f"process_auto_filter_request completed with {len(processed_posts)} processed posts")
    
    return CustomFeedResponse(
        session_id=request.session_id,
        processed_posts=processed_posts,
        total_processing_time_ms=total_time
    )