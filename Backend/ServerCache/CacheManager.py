'''This file contains a method to try and reuse previously computed values from the cache.'''
import os
import json
import asyncio
from dotenv import load_dotenv
from openai import OpenAI
from .Cache import Cache
from .RedisCache import RedisCache
import logging

logger = logging.getLogger(__name__)


class ImageCacheManager():
    def __init__(self):
        load_dotenv()
        self.cache_sub_key_limit = 10
        self.cache: Cache = RedisCache()
        # self.llm = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        # self.model = "gpt-4o-mini"
        self.llm = OpenAI(api_key=os.getenv("GOOGLE_API_KEY"), base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
        self.model = "gemini-2.5-flash"
        self.websocket_callback = None  # Will be set by app.py

    def _get_filter_string(self, filters):
        # Handle empty filters or None
        if not filters:
            return ""
        
        formatted_filters = []
        for filter in filters:
            # Skip empty strings
            if not filter:
                continue
                
            # Handle custom filters differently - don't normalize them
            if filter.startswith('custom_'):
                formatted_filters.append(filter)
            else:
                # Standard filter normalization
                if filter[-1] != ".":
                    filter += "."
                filter = filter.lower()
                formatted_filters.append(filter)
        
        # Sort filters for consistent cache keys
        formatted_filters.sort()
        return " ".join(formatted_filters)

    def _construct_llm_prompt(self, current_filters, new_filter):
        return [
            {
                "role": "user",
                "content": f'Here is a list of strings: {current_filters}. From this list return one string that matches the most with the string: {new_filter}. Only return the string from the list and nothing else. Also, if none of the items match, then return an empty string'
            }
        ]

    def _get_similar_filter_from_llm(self, llm_message_prompt):
        completion = self.llm.chat.completions.create(
            model=self.model,
            messages=llm_message_prompt
        )
        return completion.choices[0].message.content

    def _get_value_of_similar_filter(self, current_value_dict, new_filter):
        current_filters = list(current_value_dict.keys())
        prompt = self._construct_llm_prompt(current_filters, new_filter)
        similar_filter = self._get_similar_filter_from_llm(prompt)
        return current_value_dict.get(similar_filter)

    def _get_key(self, image_url, filters):
        return image_url + " " + self._get_filter_string(filters)

    def _add_sub_key_and_value(self, value_dict, sub_key, value):
        if len(value_dict) < self.cache_sub_key_limit:
            value_dict[sub_key] = value
        return value_dict
    
    def _get_existing_value_for_key(self, cache_key):
        value_json = self.cache.get(cache_key)
        if value_json is None:
            return None
        return json.loads(value_json)

    def _get_cache_transaction_details(self, cache_key, filters):
        filter_string = self._get_filter_string(filters)
        value_dict = self._get_existing_value_for_key(cache_key=cache_key)
        return filter_string, value_dict

    def get_processed_value_from_cache(self, image_url, filters):
        filter_string, value_dict = self._get_cache_transaction_details(cache_key=image_url, filters=filters)
        # print(f"[Cache GET] URL: {image_url}, Filters: {filters}, Filter String: '{filter_string}'")
        
        # Case where nothing has been stored for a key
        if value_dict is None:
            logger.debug(f"[Cache GET] No cache entry found for URL: {image_url}")
            return None

        # logger.info(f"[Cache GET] Cache dict keys: {list(value_dict.keys())}")

        # Case for getting a similar filter key
        if not filter_string in value_dict:
            # For empty filter string, check if there's any custom processing result
            if filter_string == "" and any(k.startswith('custom_') for k in value_dict.keys()):
                # Return the first custom processing result
                for k, v in value_dict.items():
                    if k.startswith('custom_'):
                        logger.info(f"[Cache GET] Found custom processing result: {k} -> {v}")
                        return v
            
            similar_filter_value = self._get_value_of_similar_filter(value_dict, filter_string)
            logger.debug(f"[Cache GET] Using similar filter value: {similar_filter_value}")
            return similar_filter_value
        
        # Case where the filter string exists in the sub key dictionary
        result = value_dict.get(filter_string)
        logger.debug(f"[Cache GET] Found exact match: {result}")
        
        # If result is a dict with 'url' key, return the full dict to include base64
        if isinstance(result, dict):
            if 'base64' in result and result['base64']:
                logger.debug(f"[Cache GET] Found base64 URL in cache (length: {len(result['base64'])} chars)")
            
            # Return the full dict so caller can access both URL and base64
            return result
            
        return result

    def set_processed_value_to_cache(self, image_url, filters, processed_url, base64_url=None):
        filter_string, value_dict = self._get_cache_transaction_details(cache_key=image_url, filters=filters)
        logger.info(f"[Cache SET] URL: {image_url}, Filters: {filters}, Filter String: '{filter_string}', Processed URL: {processed_url}")
        if base64_url:
            logger.debug(f"[Cache SET] Base64 URL provided (length: {len(base64_url)} chars)")

        if value_dict is None:
            value_dict = {}
        
        # Store both URL and base64 data
        cache_value = {
            "url": processed_url,
            "base64": base64_url
        } if base64_url else processed_url
        
        value_dict = self._add_sub_key_and_value(value_dict, filter_string, cache_value)
        
        # print(f"[Cache SET] Updated cache dict: {value_dict}")

        result = self.cache.set(image_url, json.dumps(value_dict))
        
        # Publish notification to Redis channel for WebSocket updates
        if processed_url:
            try:
                notification_data = {
                    "image_url": image_url,
                    "processed_url": processed_url,
                    "filters": filters
                }
                # Include base64 data if available
                if base64_url:
                    notification_data["base64_url"] = base64_url
                    logger.debug(f"[Cache SET] Including base64 URL in Redis notification (length: {len(base64_url)} chars)")
                    
                # Publish to Redis channel that the app is listening to
                publish_result = self.cache.publish('image_processing_complete', json.dumps(notification_data))
                logger.debug(f"[Cache SET] Published notification to Redis channel for {image_url}, subscribers: {publish_result}")
            except Exception as e:
                logger.error(f"Error publishing to Redis channel: {e}")

        # Keep the old callback mechanism for backward compatibility
        if self.websocket_callback and processed_url:
            logger.debug(f"[Cache SET] Triggering WebSocket notification for {image_url}")
            # Run the async callback in a new task
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # Schedule the coroutine to run
                    # Pass base64_url as an additional parameter if the callback supports it
                    asyncio.create_task(self.websocket_callback(image_url, processed_url, filters, base64_url))
                else:
                    # If no loop is running, create a new one
                    asyncio.run(self.websocket_callback(image_url, processed_url, filters, base64_url))
            except Exception as e:
                logger.error(f"Error notifying WebSocket clients: {e}")
        
        return result