from bs4 import BeautifulSoup
from processors.base_processor import ContentProcessor, Post
import re
from urllib.parse import unquote_plus
import logging
import asyncio
from typing import List, Dict, Any
from datetime import datetime
from utils.errors import ProcessorError, handle_processing_errors
from utils import ConfigManager
import re
import json
from utils.config import ConfigManager

logger = logging.getLogger(__name__)

class RedditPost(Post):
    """Reddit-specific post structure"""
    def __init__(self, element: BeautifulSoup, config=None):
        self.element = element
        self.config = config or {}
        
        # Check if this is an ad post
        self.is_ad = (element.name == 'shreddit-ad-post')
        
        if self.is_ad:
            # Skip further processing for ads
            self.id = "ad-" + element.get('id', 'unknown')
            super().__init__(
                id=self.id,
                title=None,
                body=None,
                platform='reddit',
                created_at=datetime.now(),
                media_urls=[]
            )
            return
        
        # Extract post identifier
        self.id = element.get('id', 'unknown')
        
        # Extract post components
        title = self._extract_title()
        body = self._extract_body()
        media_urls = self._extract_media_urls()
        
        # Initialize the base Post object
        super().__init__(
            id=self.id,
            title=title,
            body=body,
            platform='reddit',
            created_at=datetime.now(),
            media_urls=media_urls
        )
    
    def _extract_title(self) -> str:
        """Extract the title from the Reddit post"""
        title_element = self.element.select_one('a[slot="title"]')
        return title_element.get_text().strip() if title_element else None
    
    def _extract_body(self) -> str:
        """Extract the body text from the Reddit post"""
        body_element = self.element.select_one('a[slot="text-body"]')
        return body_element.get_text().strip() if body_element else None
    
    def _extract_media_urls(self) -> List[str]:
        """Extract media URLs from the post based on its type"""
        if self.is_ad:
            return []
            
        media_urls = []
        media_container = self.element.find('div', attrs={'slot': 'post-media-container'})
        
        if not media_container:
            return media_urls
            
        # Determine the post media type and extract accordingly
        if self._is_gallery_post(media_container):
            media_urls = self._extract_gallery_images(media_container)
        elif self._is_video_post(media_container):
            media_urls = self._extract_video_thumbnail(media_container)
        else:
            # Default to single image extraction --> Because post w/ media cannot have empty media_url.
            media_urls = self._extract_single_image(media_container)
            
        return media_urls
    
    def _is_gallery_post(self, container) -> bool:
        """Check if the post contains a gallery carousel"""
        return bool(container.find('gallery-carousel') or 
                    container.find('shreddit-async-loader', attrs={'bundleName': 'gallery_carousel'}))
    
    def _is_video_post(self, container) -> bool:
        """Check if the post contains a video player"""
        return bool(container.find('shreddit-player-2') or 
                    container.find('shreddit-async-loader', attrs={'bundleName': 'shreddit_player_2_loader'}))
    
    def _extract_gallery_images(self, container) -> List[str]:
        """Extract images from a gallery carousel post"""
        media_urls = []
        logger.debug("Found gallery carousel post")
        
        # Find the gallery element
        gallery = container.find('gallery-carousel') or container.find('shreddit-async-loader', attrs={'bundleName': 'gallery_carousel'})
        if not gallery:
            return media_urls
            
        # Extract images from figures within the gallery
        figures = gallery.find_all('figure') if gallery.find_all('figure') else []
        
        # Limit to configured max number of carousel images
        max_carousel = self.config.reddit_max_carousel_images
        for i, figure in enumerate(figures):
            if i >= max_carousel:
                break
            img = figure.find('img')
            if img and 'src' in img.attrs:
                media_urls.append(img['src'])
                
        return media_urls
    
    def _extract_video_thumbnail(self, container) -> List[str]:
        """Extract thumbnail from a video post"""
        media_urls = []
        logger.debug("Found video post")
        
        # Only process video thumbnails if enabled in config
        if not self.config.process_video_thumbnails:
            return media_urls
            
        # Try to find the video thumbnail with preview-image class
        img = container.find('img', class_='preview-image')
        if img and 'src' in img.attrs:
            media_urls.append(img['src'])
            return media_urls
            
        # Try alternative selector for video thumbnails
        img = container.find('img', attrs={'slot': 'poster'})
        if img and 'src' in img.attrs:
            media_urls.append(img['src'])
            
        return media_urls
    
    def _extract_single_image(self, container) -> List[str]:
        """Extract image from a single image post"""
        media_urls = []
        logger.debug("Found single image post")
        
        # For single image posts, look for the media-lightbox-img class
        media_lightbox = container.find('div', class_='media-lightbox-img')
        if media_lightbox:
            # Find the actual image (not the background filter image)
            img = media_lightbox.find('img', class_='i18n-post-media-img')
            if img and 'src' in img.attrs:
                media_urls.append(img['src'])
                return media_urls
        
        # Fallback: look for any suitable image in the container
        images = container.find_all('img')
        for img in images:
            if 'src' in img.attrs and (not img.get('class') or 'post-background-image-filter' not in img.get('class', [])):
                media_urls.append(img['src'])
                break
                
        return media_urls

    def update_element(self):
        """Update BeautifulSoup element with processed content"""
        if self.processed_title:
            title_element = self.element.select_one('a[slot="title"]')
            if title_element:
                title_element.string = self.processed_title
                
        if self.processed_body:
            body_element = self.element.select_one('a[slot="text-body"]')
            if body_element:
                body_element.string = self.processed_body
        
        # Update processed images if available
        if self.processed_media_urls:
            media_container = self.element.find('div', attrs={'slot': 'post-media-container'})
            if media_container:
                # Use the same type detection as in extraction to apply the updates
                if self._is_gallery_post(media_container):
                    self._update_gallery_images(media_container)
                elif self._is_video_post(media_container):
                    self._update_video_thumbnail(media_container)
                else:
                    self._update_single_image(media_container)
    
    def _update_gallery_images(self, container):
        """Update images in a gallery carousel"""
        gallery = container.find('gallery-carousel') or container.find('shreddit-async-loader', attrs={'bundleName': 'gallery_carousel'})
        if not gallery:
            return
            
        figures = gallery.find_all('figure')
        for i, figure in enumerate(figures):
            if i >= len(self.processed_media_urls):
                break
                
            img = figure.find('img')
            if img and 'src' in img.attrs:
                # Update this image with processed content
                self._apply_image_processing(img, self.processed_media_urls[i])
    
    def _update_video_thumbnail(self, container):
        """Update thumbnail in a video post"""
        # Only update if we have processed media and video thumbnails are enabled
        if not self.processed_media_urls or not self.config.process_video_thumbnails:
            return
            
        # Try preview image first
        img = container.find('img', class_='preview-image')
        if not img:
            # Try alternative poster slot
            img = container.find('img', attrs={'slot': 'poster'})
            
        if img and 'src' in img.attrs and self.processed_media_urls:
            self._apply_image_processing(img, self.processed_media_urls[0])
    
    def _update_single_image(self, container):
        """Update single image post"""
        if not self.processed_media_urls:
            return
            
        # For single image posts, try to find the main image
        media_lightbox = container.find('div', class_='media-lightbox-img')
        if media_lightbox:
            img = media_lightbox.find('img', class_='i18n-post-media-img')
            if img and 'src' in img.attrs:
                self._apply_image_processing(img, self.processed_media_urls[0])
                return
                
        # Fallback: find any suitable image
        images = container.find_all('img')
        for img in images:
            if 'src' in img.attrs and (not img.get('class') or 'post-background-image-filter' not in img.get('class', [])):
                self._apply_image_processing(img, self.processed_media_urls[0])
                break
    
    def _apply_image_processing(self, img, img_data):
        """Apply processed image data to an image element"""
        # Set the src attribute to the processed URL
        img['src'] = img_data['url']
        img['srcset'] = ''  # Clear srcset to prevent browser from using other sources
        
        # If we have configuration, set it as the diy-mod-image attribute
        if img_data.get('config'):
            img['diy-mod-image'] = json.dumps(img_data['config'])
            
            # Add a class to identify processed images
            # BeautifulSoup handles 'class' as either a string or list depending on the parser
            current_class = img.get('class')
            if current_class is None:
                img['class'] = 'diy-mod-processed'
            elif isinstance(current_class, list):
                img['class'] = current_class + ['diy-mod-processed']
            else:
                img['class'] = str(current_class) + ' diy-mod-processed'

class RedditProcessor(ContentProcessor):
    """Reddit-specific content processor"""
    
    def __init__(self, user_id: str, feed_info: Dict[str, Any], url: str):
        super().__init__(user_id, feed_info, url)
        try:
            self.soup = BeautifulSoup(feed_info.get('response', ''), 'html.parser')
        except Exception as e:
            raise ProcessorError(f"Error parsing Reddit HTML: {e}")
    
    @handle_processing_errors
    async def work_on_feed(self) -> str:
        """Process Reddit feed HTML asynchronously"""
        try:
            if not self.soup:
                logger.warning("No HTML content to process")
                return ""

            # Shift more-posts-cursor to earlier posts
            if any(ft in self.url for ft in ("popular-feed", "home-feed", "all-feed")):
                self.shift_more_posts_cursor_home()
            else:
                self.shift_more_posts_cursor()
                
            posts = self.soup.find_all('shreddit-post')
            total_posts = len(posts)
            
            if not posts:
                logger.info("No posts found in feed")
                return str(self.soup)
                
            logger.info(f"Processing {total_posts} posts in {self.mode} mode")
            await self._process_posts_parallel(posts)
            return str(self.soup)
            
        except Exception as e:
            raise ProcessorError(f"Error processing Reddit feed: {e}")

    async def _process_posts_parallel(self, elements: List[BeautifulSoup]):
        """Process multiple posts in parallel using asyncio"""
        if not elements:
            logger.info("No elements to process")
            return
            
        total_posts = len(elements)
        logger.info(f"Starting parallel processing of {total_posts} posts")
        start_time = datetime.now().timestamp()
        
        processed_count = 0
        errors = []
        
        # Get image processing configuration
        config = ConfigManager()
        img_config = config.get_processing_config().image_processing
        
        try:
            # If image processing is enabled, we need to track how many posts with images we process
            posts_with_images_processed = 0
            
            # Create tasks for all posts
            tasks = []
            posts = []
            
            # Get reddit-specific config
            reddit_specific_config = config.get_processing_config().reddit_specific
            
            # First, create all post objects to check which ones have images
            for element in elements:
                # Skip ads by checking element name
                if element.name == 'shreddit-ad-post':
                    logger.debug(f"Skipping ad post: {element.get('id', 'unknown')}")
                    continue
                    
                post = RedditPost(element, reddit_specific_config)
                posts.append(post)
            
            # Filter posts with images if needed
            if img_config.enabled and img_config.max_posts_with_images > 0:
                # Separate posts with and without images
                posts_with_images = [p for p in posts if p.media_urls]
                posts_without_images = [p for p in posts if not p.media_urls]
                
                # Limit the number of posts with images to process
                limited_posts_with_images = posts_with_images[:img_config.max_posts_with_images]
                
                logger.info(f"Processing {len(limited_posts_with_images)} out of {len(posts_with_images)} posts with images")
                
                # Combine limited posts with images and all posts without images
                final_posts = limited_posts_with_images + posts_without_images
            else:
                final_posts = posts
            
            # Create tasks for all posts in the final list
            for post in final_posts:
                task = asyncio.create_task(self.process_post(post))
                tasks.append(task)
            
            # Wait for all tasks to complete
            completed_posts = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Update elements and handle results
            for post in completed_posts:
                if isinstance(post, Exception):
                    errors.append(str(post))
                    continue
                    
                if post:
                    post.update_element()
                    processed_count += 1
                    if processed_count % 5 == 0:  # Log progress every 5 posts
                        logger.info(f"Processed {processed_count}/{len(final_posts)} posts")
        
        except Exception as e:
            raise ProcessorError(f"Error in parallel processing: {e}", {
                "processed": processed_count,
                "total": total_posts,
                "errors": errors
            })
        
        end_time = datetime.now().timestamp()
        total_time = end_time - start_time
        
        # Log processing summary
        if total_posts > 0:
            avg_time = total_time / total_posts
            logger.info(f"Parallel processing completed in {total_time:.2f}s (avg {avg_time:.2f}s per post)")
        
        if errors:
            logger.warning(f"Completed with {len(errors)} errors: {errors[:3]}...")
        
        logger.info(f"Successfully processed {processed_count}/{total_posts} posts\n{len(limited_posts_with_images)} posts with images.")
    
    def _update_post_content(self, post_element: BeautifulSoup, processed_text: str):
        """Update post content while preserving HTML structure and handling markers"""
        title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', processed_text, re.DOTALL)
        body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', processed_text, re.DOTALL)
        
        if title_match:
            title_content = title_match.group(1)
            title_element = post_element.select_one('a[slot="title"]')
            if title_element:
                # Don't strip markers - they need to be handled by frontend
                title_element.string = title_content
                post_element['post-title'] = title_content  # Update post attribute too
                logger.debug(f"Updated post title with processed content: {title_content[:100]}")
                
        if body_match:
            body_content = body_match.group(1)
            body_element = post_element.select_one('a[slot="text-body"]')
            if body_element:
                # Don't strip markers - they need to be handled by frontend
                body_element.string = body_content
                logger.debug(f"Updated post body with processed content: {body_content[:100]}")

    def shift_more_posts_cursor_home(self):
        """
        For the homepage (popular-feed/home-feed/all-feed), hijack the pagination cursor
        so that the next batch is loaded when the user scrolls past the 11th or 12th post.
        """
        

        # 1) Locate the home-feed partial
        partial = self.soup.find(
            'faceplate-partial',
            attrs={'src': re.compile(r'(popular-feed|home-feed|all-feed)')}
        )
        if not partial:
            # not a home feed — nothing to do here
            return

        # 2) Extract the `after=` token from its src URL
        src = partial['src']
        m = re.search(r'after=([^&]+)', src)
        if not m:
            # unexpected format
            return
        raw_cursor = m.group(1)              # e.g. "dDNfMWsydTR1ZQ%3D%3D"
        decoded = unquote_plus(raw_cursor)   # e.g. "dDNfMWsydTR1ZQ=="
        trimmed = decoded.rstrip('=')        # e.g. "dDNfMWsydTR1ZQ"

        # 3) Rewrite the partial’s ID to match the non‑home convention
        partial['id'] = f'partial-more-posts-{trimmed}'

        # # 4) Also patch the `src` params to use the raw (still‑encoded) cursor
        # #    so that subsequent requests will carry the right `after=…` and `cursor=…`.
        # #    (Optional if you know they already match.)
        # url_parts = src.split('?', 1)
        # base, qs = url_parts if len(url_parts) == 2 else (src, '')
        # params = {}
        # for kv in qs.split('&'):
        #     if '=' in kv:
        #         k, v = kv.split('=', 1)
        #         params[k] = v
        # params['after'] = raw_cursor
        # params['cursor'] = raw_cursor
        # # rebuild src
        # new_qs = '&'.join(f'{k}={v}' for k, v in params.items())
        # partial['src'] = f'{base}?{new_qs}'

        # 5) Find all the posts and stamp the cursor onto post #11 and #12
        posts = self.soup.find_all('shreddit-post')
        for idx in (6, 7):  # zero‑based indices for 11th & 12th items
            if idx < len(posts):
                posts[idx]['more-posts-cursor'] = trimmed


    def shift_more_posts_cursor(self):
        """
        Shift the more-posts-cursor attribute from posts at the end of the feed to posts that appear
        earlier in the feed. This causes Reddit to load the next batch of posts when the user reaches
        an earlier point in the feed.
        """
        try:
            # Find all posts that have the more-posts-cursor attribute
            posts_with_cursor = self.soup.find_all('shreddit-post', attrs={'more-posts-cursor': True})
            if not posts_with_cursor:
                logger.info("No posts with more-posts-cursor found")
                return

            # Get the cursor value from the first post that has it
            cursor_value = posts_with_cursor[0]['more-posts-cursor']
            
            # Find all posts in the feed
            all_posts = self.soup.find_all('shreddit-post')
            if not all_posts:
                logger.info("No posts found in feed")
                return
                
            # Find the index of the first post that has the cursor
            cursor_post_index = None
            for i, post in enumerate(all_posts):
                if post.get('more-posts-cursor'):
                    cursor_post_index = i
                    break
                    
            if cursor_post_index is None:
                logger.info("Could not determine cursor post index")
                return
                
            # Calculate the target post index (5 posts earlier)
            shift_amount = 13  # The target is to fetch next batch after first 7/6 posts. 
                              # Here, reddit already brings when 5 left.
                              # Each batch contains ~25 posts. So, 25-5 (already) - 13 (our shift_amount)=7
            
            # Ensure the target index is within bounds
            target_index = max(0, cursor_post_index - shift_amount)
            
            # Remove the cursor from all posts
            # for post in posts_with_cursor:
            #     del post['more-posts-cursor']
                
            # Add the cursor to the target post
            for i in range(target_index, cursor_post_index):
                all_posts[i]['more-posts-cursor'] = cursor_value
            
            logger.info(f"Shifted more-posts-cursor from post index {cursor_post_index} to {target_index}")
            
        except Exception as e:
            logger.warning(f"Error shifting more-posts-cursor: {e}")
            # Don't raise - this is an enhancement, not critical functionality
            pass