"""Twitter-specific content processor"""
from bs4 import BeautifulSoup
from processors.base_processor import ContentProcessor, Post
import logging
import asyncio
import json
from typing import List, Dict, Any
from datetime import datetime
from utils.errors import ProcessorError, handle_processing_errors
from utils.json_utils import safe_json_loads
from utils import ConfigManager


logger = logging.getLogger(__name__)

class TwitterPost(Post):
    """Twitter-specific post structure"""
    def __init__(
        self,
        tweet_data: Dict[str, Any],
        entry_id: str,
        entry_index: int,
        config=None
    ):
        self.tweet_data = tweet_data
        self.entry_id = entry_id
        self.entry_index = entry_index
        self.config = config or {}
        
        # Check if this is a promoted/ad tweet
        self.is_ad = self._is_ad_tweet()
        
        # Extract tweet components
        tweet_id = self._extract_tweet_id()
        body = self._extract_body()
        created_at = self._extract_timestamp()
        media_urls = self._extract_media_urls()
        
        super().__init__(
            id=tweet_id,
            body=body,
            title=None,  # Twitter doesn't have titles
            platform='twitter',
            created_at=created_at,
            media_urls=media_urls,
            metadata={
                "entry_id": entry_id,
                "entry_index": entry_index,
                "is_ad": self.is_ad
            }
        )
        
    def _is_ad_tweet(self) -> bool:
        """Check if the tweet is promoted/ad content"""
        # Look for promotion indicators in tweet data
        if "legacy" in self.tweet_data:
            # Check for promoted content marker
            return (
                self.tweet_data.get("promotedMetadata") is not None or
                "promotedMetadata" in self.tweet_data or
                self.tweet_data.get("legacy", {}).get("is_promoted", False) or
                "promotedContent" in self.tweet_data
            )
        return False
        
    def _extract_tweet_id(self) -> str:
        """Extract the unique identifier for the tweet"""
        if "legacy" in self.tweet_data and "id_str" in self.tweet_data["legacy"]:
            return self.tweet_data["legacy"]["id_str"]
        else:
            return f"unknown_{self.entry_id}_{self.entry_index}"
            
    def _extract_body(self) -> str:
        """Extract the text content of the tweet"""
        if "legacy" in self.tweet_data and "full_text" in self.tweet_data["legacy"]:
            return self.tweet_data["legacy"]["full_text"]
        return None
        
    def _extract_timestamp(self) -> datetime:
        """Extract the creation timestamp of the tweet"""
        if "legacy" in self.tweet_data and "created_at" in self.tweet_data["legacy"]:
            try:
                return datetime.strptime(
                    self.tweet_data["legacy"]["created_at"],
                    "%a %b %d %H:%M:%S %z %Y"
                )
            except ValueError:
                logger.warning(f"Failed to parse tweet timestamp for {self._extract_tweet_id()}")
                return datetime.now()
        return datetime.now()
        
    def _extract_media_urls(self) -> List[str]:
        """Extract media URLs from the tweet based on media type"""
        if self.is_ad:
            # Skip media processing for ads unless explicitly enabled
            return []
            
        # First check if there's any media at all
        if not self._has_media():
            return []
            
        # Prioritize extended_entities as they usually have better quality
        if self._has_extended_entities():
            return self._extract_extended_media()
            
        # Fall back to basic entities if no extended media
        return self._extract_basic_media()
        
    def _has_media(self) -> bool:
        """Check if the tweet has any media"""
        if "legacy" not in self.tweet_data:
            return False
            
        # Check extended entities first (better quality)
        if "extended_entities" in self.tweet_data["legacy"]:
            if "media" in self.tweet_data["legacy"]["extended_entities"]:
                return len(self.tweet_data["legacy"]["extended_entities"]["media"]) > 0
                
        # Fall back to basic entities
        if "entities" in self.tweet_data["legacy"]:
            if "media" in self.tweet_data["legacy"]["entities"]:
                return len(self.tweet_data["legacy"]["entities"]["media"]) > 0
                
        return False
        
    def _has_extended_entities(self) -> bool:
        """Check if the tweet has extended entities with media"""
        return (
            "legacy" in self.tweet_data and
            "extended_entities" in self.tweet_data["legacy"] and
            "media" in self.tweet_data["legacy"]["extended_entities"] and
            len(self.tweet_data["legacy"]["extended_entities"]["media"]) > 0
        )
        
    def _extract_extended_media(self) -> List[str]:
        """Extract media from extended_entities (better quality)"""
        media_urls = []
        if not self._has_extended_entities():
            return media_urls
            
        extended_entities = self.tweet_data["legacy"]["extended_entities"]
        media_items = extended_entities["media"]
        
        # Limit to configured max carousel images if applicable
        max_images = self.config.twitter_max_carousel_images
        
        for i, media in enumerate(media_items):
            # Stop if we've reached the max images limit
            if i >= max_images:
                break
                
            # Handle different media types
            if media.get("type") == "photo" and "media_url_https" in media:
                media_urls.append(media["media_url_https"])
            elif media.get("type") == "video" and self.config.process_video_thumbnails:
                # Extract video thumbnail if enabled
                if "media_url_https" in media:
                    media_urls.append(media["media_url_https"])
                
        return media_urls
        
    def _extract_basic_media(self) -> List[str]:
        """Extract media from basic entities as fallback"""
        media_urls = []
        
        if "legacy" in self.tweet_data and "entities" in self.tweet_data["legacy"]:
            entities = self.tweet_data["legacy"]["entities"]
            if "media" in entities:
                # Limit to configured max carousel images
                max_images = self.config.twitter_max_carousel_images
                
                for i, media in enumerate(entities["media"]):
                    if i >= max_images:
                        break
                        
                    if media.get("type") == "photo" and "media_url_https" in media:
                        media_urls.append(media["media_url_https"])
                        
        return media_urls
        
    def update_tweet_data(self):
        logger.debug(f"Tweet {self.id}: Has processed_body: {bool(self.processed_body)}")
        # Add more detailed debugging for better troubleshooting
        if self.processed_body:
            logger.debug(f"Tweet {self.id} processed_body: {self.processed_body[:50]}...")
        
        if self.processed_body and "legacy" in self.tweet_data:
            self._update_tweet_body()
        elif "legacy" in self.tweet_data:
            # If we don't have processed body but had filtering matches, we might have markers
            # that didn't get properly assigned - check if there are any blur or overlay markers
            logger.debug(f"Tweet {self.id}: No processed_body but tweet has legacy data")
            
        # Update processed image URLs if available
        if self.processed_media_urls and "legacy" in self.tweet_data:
            self._update_media_urls()
        
        return self.tweet_data
        
    def _update_tweet_body(self):
        """Update the tweet body text with processed content"""
        if not self.processed_body:
            logger.debug(f"Tweet {self.id}: No processed_body available to update")
            return
            
        if "legacy" in self.tweet_data:
            logger.debug(f"Updating tweet text for {self.id}: {self.processed_body[:50]}...")
            self.tweet_data["legacy"]["full_text"] = self.processed_body
            
    def _update_media_urls(self):
        """Update media URLs with processed versions"""
        if not self.processed_media_urls or "legacy" not in self.tweet_data:
            return
            
        # First priority: update extended_entities (shown in UI)
        if self._has_extended_entities():
            self._update_extended_media()
            
        # Also update in basic entities for consistency
        self._update_basic_media()
            
    def _update_extended_media(self):
        """Update media in extended_entities"""
        if not self._has_extended_entities():
            return
            
        extended_media = self.tweet_data["legacy"]["extended_entities"]["media"]
        for i, media in enumerate(extended_media):
            if i < len(self.processed_media_urls) and media["type"] == "photo":
                # Get the URL and config from the processed_media_urls object
                img_data = self.processed_media_urls[i]
                media["media_url_https"] = img_data["url"]
                
                # Add configuration as custom field if available
                if img_data.get("config"):
                    media["diy_mod_config"] = json.dumps(img_data["config"])
                    
                # Also update any variants or other URLs
                if "media_url" in media:
                    media["media_url"] = img_data["url"]
                    
                # Update any URL in sizes dictionary if present
                if "sizes" in media:
                    for size_key in media["sizes"]:
                        if "url" in media["sizes"][size_key]:
                            media["sizes"][size_key]["url"] = img_data["url"]
                            
                logger.debug(f"Updated extended media {i} for tweet {self.id}")
    
    def _update_basic_media(self):
        """Update media in basic entities"""
        if "entities" not in self.tweet_data["legacy"] or "media" not in self.tweet_data["legacy"]["entities"]:
            return
            
        media_entities = self.tweet_data["legacy"]["entities"]["media"]
        for i, media in enumerate(media_entities):
            if i < len(self.processed_media_urls) and media["type"] == "photo":
                # Get the URL and config from the processed_media_urls object
                img_data = self.processed_media_urls[i]
                media["media_url_https"] = img_data["url"]
                
                # Add configuration as custom field if available
                if img_data.get("config"):
                    media["diy_mod_config"] = json.dumps(img_data["config"])
                    
                # Also update any variants or other URLs
                if "media_url" in media:
                    media["media_url"] = img_data["url"]
                    
                logger.debug(f"Updated basic media {i} for tweet {self.id}")

class TwitterProcessor(ContentProcessor):
    """Twitter-specific content processor"""
    
    def __init__(self, user_id: str, feed_info: Dict[str, Any], url: str):
        super().__init__(user_id, feed_info, url)
        try:
            self.json_data = json.loads(feed_info.get('response', '{}'))
        except json.JSONDecodeError as e:
            raise ProcessorError(f"Error parsing Twitter JSON: {e}")
            
    @handle_processing_errors
    async def work_on_feed(self) -> str:
        """Process Twitter feed JSON asynchronously"""
        try:
            if not self.json_data:
                logger.warning("No JSON data to process")
                return "{}"
                
            # Process tweets
            await self._process_tweets()
            
            # Return updated JSON data
            return json.dumps(self.json_data)
            
        except Exception as e:
            raise ProcessorError(f"Error processing Twitter feed: {e}")
            
    async def _process_tweets(self):
        """Extract and process tweets from the Twitter JSON structure"""
        start_time = datetime.now().timestamp()
        total_tweets = 0
        processed_count = 0
        errors = []
        
        # Get image processing and Twitter-specific configurations
        config = ConfigManager()
        img_config = config.get_processing_config().image_processing
        twitter_config = config.get_processing_config().twitter_specific
        
        logger.info(f"Processing Twitter feed in {self.mode} mode")
        logger.debug(f"Twitter config: max_carousel_images={twitter_config.twitter_max_carousel_images}, process_video_thumbnails={twitter_config.process_video_thumbnails}")
            
        try:
            # Extract tweets from JSON data
            tweets = self._extract_tweets_from_json()
                
            if not tweets:
                logger.info("No tweets found in feed")
                return
                
            total_tweets = len(tweets)
            logger.info(f"Found {total_tweets} tweets to process")
            
            # Skip ad tweets unless configured to process them
            
            # Apply image processing limits if enabled
            if img_config.enabled and img_config.max_posts_with_images > 0:
                # Separate tweets with and without images
                tweets_with_images = [t for t in tweets if t.media_urls]
                tweets_without_images = [t for t in tweets if not t.media_urls]
                
                # Limit the number of tweets with images to process
                limited_tweets_with_images = tweets_with_images[:img_config.max_posts_with_images]
                
                logger.info(f"Processing {len(limited_tweets_with_images)} out of {len(tweets_with_images)} tweets with images")
                
                # Combine limited tweets with images and all tweets without images
                final_tweets = limited_tweets_with_images + tweets_without_images
            else:
                final_tweets = tweets
                
            # Process tweets in parallel
            tasks = []
            for tweet in final_tweets:
                task = asyncio.create_task(self.process_post(tweet))
                tasks.append(task)
                
            # Wait for all tasks to complete
            processed_tweets = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Update the original JSON data with processed content
            for tweet in processed_tweets:
                if isinstance(tweet, Exception):
                    errors.append(str(tweet))
                    continue
                    
                if tweet:
                    try:
                        # Update the original tweet data in the JSON structure
                        tweet.update_tweet_data()
                        processed_count += 1
                        if processed_count % 5 == 0:  # Log progress every 5 tweets
                            logger.info(f"Processed {processed_count}/{len(final_tweets)} tweets")
                    except Exception as e:
                        errors.append(f"Error updating tweet: {e}")
                        
        except Exception as e:
            logger.error(f"Error processing tweets: {e}")
            raise ProcessorError(f"Failed to process tweets: {e}", {
                "processed": processed_count,
                "total": total_tweets,
                "errors": errors
            })
                
        # Log processing summary
        end_time = datetime.now().timestamp()
        total_time = end_time - start_time
        
        if total_tweets > 0:
            avg_time = total_time / total_tweets
            logger.info(f"Twitter processing completed in {total_time:.2f}s (avg {avg_time:.2f}s per tweet)")
            
        if errors:
            logger.warning(f"Completed with {len(errors)} errors: {errors[:3]}...")
            
        logger.info(f"Successfully processed {processed_count}/{len(final_tweets)} tweets")
        
    def _extract_tweets_from_json(self) -> List[TwitterPost]:
        """Extract tweets from the Twitter JSON structure"""
        tweets = []
        
        # Get Twitter-specific configuration
        config = ConfigManager()
        twitter_config = config.get_processing_config().twitter_specific
        
        try:
            # Navigate through the JSON structure to find tweets
            if "data" in self.json_data and "home" in self.json_data["data"] and "home_timeline_urt" in self.json_data["data"]["home"]:
                timeline = self.json_data["data"]["home"]["home_timeline_urt"]
                if "instructions" in timeline:
                    for instruction in timeline["instructions"]:
                        if instruction.get("type") == "TimelineAddEntries":
                            if "entries" in instruction:
                                entry_index = 0
                                for entry in instruction["entries"]:
                                    entry_id = entry.get("entryId", f"unknown_{entry_index}")
                                    if "content" in entry and "itemContent" in entry["content"]:
                                        item_content = entry["content"]["itemContent"]
                                        if "tweet_results" in item_content and "result" in item_content["tweet_results"]:
                                            tweet_data = item_content["tweet_results"]["result"]
                                            # Create TwitterPost object with configuration
                                            tweet = TwitterPost(tweet_data, entry_id, entry_index, twitter_config)
                                            tweets.append(tweet)
                                    entry_index += 1
        except Exception as e:
            logger.error(f"Error extracting tweets from JSON: {e}")
            raise ProcessorError(f"Failed to extract tweets from Twitter data: {e}")
            
        return tweets