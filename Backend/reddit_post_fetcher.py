#!/usr/bin/env python3
"""
Utility to fetch Reddit post HTML content for custom feed processing.
This fetches the actual post HTML that can be processed by our system.
"""

import requests
from bs4 import BeautifulSoup
import json
import time
from typing import Optional, Dict
import re

def normalize_reddit_url(url: str) -> str:
    """Normalize Reddit URL to standard format"""
    # Handle redd.it shortlinks
    if 'redd.it' in url:
        # Extract post ID and fetch redirect
        try:
            response = requests.head(url, allow_redirects=True, timeout=5)
            url = response.url
        except:
            pass

    # Ensure HTTPS
    url = url.replace('http://', 'https://')
    
    # Remove trailing slashes and query parameters for consistency
    url = url.split('?')[0].rstrip('/')
    
    return url

def fetch_reddit_post_json(url: str) -> Optional[Dict]:
    """Fetch Reddit post data in JSON format"""
    try:
        # Normalize URL
        url = normalize_reddit_url(url)
        
        # Add .json to get JSON data
        json_url = f"{url}.json"
        
        headers = {
            'User-Agent': 'DIY-MOD/1.0 (Custom Feed Processor)'
        }
        
        response = requests.get(json_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        # Reddit returns array with post and comments
        if isinstance(data, list) and len(data) > 0:
            return data[0]['data']['children'][0]['data']
        
        return None
        
    except Exception as e:
        print(f"Error fetching Reddit JSON: {e}")
        return None

def construct_reddit_post_html(post_data: Dict) -> str:
    """Construct HTML in shreddit-post format from Reddit JSON data"""
    
    # Extract post details
    post_id = f"t3_{post_data.get('id', '')}"
    subreddit = post_data.get('subreddit', 'unknown')
    title = post_data.get('title', 'Untitled')
    author = post_data.get('author', '[deleted]')
    created = post_data.get('created_utc', 0)
    
    # Format timestamp
    timestamp = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(created))
    
    # Determine content type
    is_self = post_data.get('is_self', False)
    is_video = post_data.get('is_video', False)
    is_gallery = post_data.get('is_gallery', False)
    
    if is_video:
        content_type = 'video'
    elif is_gallery:
        content_type = 'gallery'
    elif not is_self:
        content_type = 'image'
    else:
        content_type = 'text'
    
    # Build HTML structure
    html = f"""<shreddit-post 
    id="{post_id}"
    contenttype="{content_type}"
    subredditname="{subreddit}"
    author="{author}"
    created-timestamp="{timestamp}"
    permalink="{post_data.get('permalink', '')}"
>
    <div class="post-container">"""
    
    # Add title
    html += f"""
        <a slot="title" href="https://reddit.com{post_data.get('permalink', '')}">
            {title}
        </a>"""
    
    # Add text content if available
    if is_self and post_data.get('selftext'):
        # Convert markdown to basic HTML
        text = post_data.get('selftext', '')
        # Basic markdown conversion (very simplified)
        text = text.replace('\n\n', '</p><p>')
        text = f"<p>{text}</p>"
        
        html += f"""
        <div slot="text-body">
            {text}
        </div>"""
    
    # Add media content
    if content_type == 'image' and post_data.get('url'):
        # Check if it's an image URL
        image_url = post_data.get('url', '')
        preview = post_data.get('preview', {})
        
        # Try to get a reasonable image URL
        if preview and 'images' in preview and preview['images']:
            # Use preview image
            img_data = preview['images'][0]
            if 'source' in img_data:
                image_url = img_data['source']['url'].replace('&amp;', '&')
        
        html += f"""
        <div slot="post-media-container">
            <img src="{image_url}" alt="{title}">
        </div>"""
    
    elif content_type == 'gallery' and post_data.get('gallery_data'):
        # Handle gallery posts
        gallery_data = post_data.get('gallery_data', {})
        media_metadata = post_data.get('media_metadata', {})
        
        html += """
        <div slot="post-media-container">
            <div class="gallery-container">"""
        
        for item in gallery_data.get('items', []):
            media_id = item.get('media_id')
            if media_id in media_metadata:
                media = media_metadata[media_id]
                if 's' in media:  # source image
                    img_url = media['s']['u'].replace('&amp;', '&')
                    html += f"""
                <img src="{img_url}" alt="Gallery image">"""
        
        html += """
            </div>
        </div>"""
    
    elif content_type == 'video' and post_data.get('media'):
        # Handle video posts
        video_url = post_data.get('media', {}).get('reddit_video', {}).get('fallback_url', '')
        if video_url:
            html += f"""
        <div slot="post-media-container">
            <video controls>
                <source src="{video_url}" type="video/mp4">
            </video>
        </div>"""
    
    html += """
    </div>
</shreddit-post>"""
    
    return html

def fetch_reddit_post_html(url: str) -> Optional[str]:
    """Fetch Reddit post and return it as shreddit-post HTML"""
    
    # First, get the JSON data
    post_data = fetch_reddit_post_json(url)
    
    if not post_data:
        return None
    
    # Construct HTML from JSON data
    return construct_reddit_post_html(post_data)

def test_fetch():
    """Test fetching a Reddit post"""
    test_urls = [
        "https://www.reddit.com/r/gastricsleeve/comments/1e3vrby/",
        "https://redd.it/1e3tkr4",
        "https://reddit.com/r/pics/comments/test123/"  # Fake URL for testing
    ]
    
    for url in test_urls:
        print(f"\nTesting: {url}")
        html = fetch_reddit_post_html(url)
        
        if html:
            print("✓ Successfully fetched")
            print(f"  HTML length: {len(html)} characters")
            print(f"  Preview: {html[:200]}...")
        else:
            print("✗ Failed to fetch")

if __name__ == "__main__":
    test_fetch()