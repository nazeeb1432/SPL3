#!/usr/bin/env python3
"""
Process a JSON template file to create a custom Reddit feed with specified interventions.
Users can provide a JSON file with Reddit post URLs and desired filter types.
"""

import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime
import argparse
import sys
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse
from pathlib import Path
from reddit_post_fetcher import fetch_reddit_post_html
import hashlib


# Configuration
URL_BASE = "http://localhost:8001"
# URL_BASE = "https://api.xxxxxx.io"
API_URL = f"{URL_BASE}/custom-feed/process"
SAVE_API_URL = f"{URL_BASE}/custom-feed/save"
IMAGE_POLLING_URL = f"{URL_BASE}/get_img_result"  # For polling image results
AUTH_URL = f"{URL_BASE}/auth/login-email"  # For user authentication


# Polling configuration (matching api-service.ts)
POLLING_CONFIG = {
    'max_attempts': 10,
    'base_interval_ms': 3000,
    'max_interval_ms': 60000
}

# Reddit URL patterns
REDDIT_POST_PATTERNS = [
    r'reddit\.com/r/[^/]+/comments/[^/]+',
    r'reddit\.com/[^/]+/comments/[^/]+',
    r'redd\.it/[^/]+',
    r'reddit\.com/gallery/[^/]+',
]

def validate_reddit_url(url: str) -> bool:
    """Validate if a URL is a valid Reddit post URL"""
    if not url:
        return False
    
    for pattern in REDDIT_POST_PATTERNS:
        if re.search(pattern, url):
            return True
    return False

def poll_for_image_result(image_url: str, filters: List[str], max_attempts: int = 20) -> Optional[Dict]:
    """
    Poll for image processing result, mimicking the browser extension's behavior
    """
    base_interval = POLLING_CONFIG['base_interval_ms'] / 1000  # Convert to seconds
    max_interval = POLLING_CONFIG['max_interval_ms'] / 1000
    max_attempts = POLLING_CONFIG['max_attempts']
    for attempt in range(max_attempts):
        try:
            # Construct the polling request (matching api-service.ts)
            params = {
                'img_url': image_url,
                'filters': json.dumps(filters)
            }
            
            response = requests.get(IMAGE_POLLING_URL, params=params, timeout=10)
            
            if response.status_code == 200:
                result = response.json()
                
                if result.get('status') == 'COMPLETED' and result.get('processed_value'):
                    print(f"    ✓ Image processed successfully after {attempt + 1} attempts. Result: {result.get('processed_value')}")
                    return result.get('processed_value')
                elif result.get('status') == 'NOT FOUND':
                    # Continue polling
                    pass
                else:
                    print(f"    - Attempt {attempt + 1}/{max_attempts}: {result.get('status', 'Unknown status')}")
            
            # Calculate exponential backoff with jitter (matching api-service.ts pattern)
            if attempt < max_attempts - 1:
                exponential_delay = base_interval * (attempt)
                jitter = 0.15 * exponential_delay * (2 * (attempt % 2) - 1)  # Simple jitter
                next_delay = min(exponential_delay + jitter, max_interval)
                
                print(f"    - Waiting {next_delay:.1f}s before next attempt...")
                time.sleep(next_delay)
        
        except requests.exceptions.RequestException as e:
            print(f"    ⚠️  Network error during polling attempt {attempt + 1}: {e}")
            if attempt < max_attempts - 1:
                time.sleep(base_interval)
            
    print(f"    ❌ Image processing timeout after {max_attempts} attempts")
    return None

def extract_deferred_images_from_posts(processed_posts: List[Dict]) -> List[Tuple[str, List[str], str]]:
    """
    Extract image URLs that need deferred processing from processed posts
    Returns list of (image_url, filters, post_id) tuples
    """
    deferred_images = []
    
    for post in processed_posts:
        post_id = post.get('post_id', 'unknown')
        
        # Check if there are deferred images in the image_processing_status
        image_status = post.get('image_processing_status', {})
        
        # Look for deferred images in the status dict
        if image_status:
            # The image_processing_status contains info about deferred processing
            deferred_list = image_status.get('deferred_images', [])
            
            for deferred_item in deferred_list:
                image_url = deferred_item.get('url')
                filters = deferred_item.get('filters', [])
                
                if image_url and filters:
                    deferred_images.append((image_url, filters, post_id))
        
        # Also check in the processed HTML for images with DEFERRED status
        # Look for images with diy-mod-custom attribute that has status: "DEFERRED"
        processed_html = post.get('processed_html', '')
        if 'status":"DEFERRED"' in processed_html or 'status": "DEFERRED"' in processed_html:
            # Parse HTML to extract deferred image URLs and their configs
            from bs4 import BeautifulSoup
            import json
            
            try:
                soup = BeautifulSoup(processed_html, 'html.parser')
                deferred_imgs = soup.find_all('img', attrs={'diy-mod-custom': True})
                
                for img in deferred_imgs:
                    config_str = img.get('diy-mod-custom', '{}')
                    try:
                        config = json.loads(config_str)
                        if config.get('status') == 'DEFERRED':
                            image_url = img.get('src')
                            filters = config.get('filters', [])
                            if image_url and filters:
                                deferred_images.append((image_url, filters, post_id))
                    except json.JSONDecodeError:
                        continue
                        
            except Exception as e:
                print(f"    Warning: Could not parse HTML for deferred images in post {post_id}: {e}")
    
    return deferred_images

def extract_intervention_name_from_url(processed_url: str) -> Optional[str]:
    """
    Extract intervention name from processed URL pattern: jobs/{job_id}/{intervention_name}.png
    """
    import re
    match = re.search(r'/jobs/[^/]+/([^/]+)\.png', processed_url)
    return match.group(1) if match else None

def categorize_interventions_for_post(post: Dict, processed_posts: List[Dict]) -> Dict:
    """
    Categorize interventions into winners and losers for comparison study purposes
    """
    post_id = post.get('post_id', 'unknown')
    print(f"  🔍 Analyzing interventions for post {post_id}...")
    
    # Check if the post has any image intervention applied
    image_intervention_applied = post.get('image_intervention_applied')
    print(f"    📋 Image intervention applied: {image_intervention_applied}")
    
    # Get the intervention metadata from the post
    image_status = post.get('image_processing_status') or {}
    deferred_list = image_status.get('deferred_images', [])
    print(f"    🔍 Found {len(deferred_list)} deferred images")
    
    # If no deferred images but there's an intervention, try extracting from HTML
    if not deferred_list and image_intervention_applied:
        print(f"    🔄 No deferred images but intervention applied - extracting from HTML")
    
    # Find completed images with their intervention names
    completed_interventions = []
    winner_intervention = None
    
    for item in deferred_list:
        if item.get('status') == 'completed' and item.get('processed_url'):
            intervention_name = extract_intervention_name_from_url(item['processed_url'])
            if intervention_name:
                completed_interventions.append(intervention_name)
                # The winner is determined by which intervention's URL was used in the final result
                # Check if this intervention's URL appears in the processed HTML
                processed_url = item['processed_url']
                if processed_url in post.get('processed_html', ''):
                    winner_intervention = intervention_name
                    print(f"    ✅ Winner: {winner_intervention} (URL found in final HTML)")
    
    print(f"    📝 Completed interventions: {completed_interventions}")
    
    # Get the original intervention recommendations from ImageProcessor
    top3_interventions = []
    next2_interventions = []
    
    # First try to get from deferred images metadata
    if deferred_list:
        for item in deferred_list:
            if item.get('top3_interventions'):
                top3_interventions = item['top3_interventions']
                print(f"    🥇 Top3 from deferred: {top3_interventions}")
            if item.get('next2_interventions'):
                next2_interventions = item['next2_interventions']
                print(f"    🥈 Next2 from deferred: {next2_interventions}")
            if top3_interventions or next2_interventions:
                break
    
    # Fallback: Extract from HTML custom attributes
    if not top3_interventions and not next2_interventions:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(post.get('processed_html', ''), 'html.parser')
            imgs_with_custom = soup.find_all('img', attrs={'diy-mod-custom': True})
            
            print(f"    🔎 Found {len(imgs_with_custom)} images with custom attributes")
            
            for img in imgs_with_custom:
                config_str = img.get('diy-mod-custom', '{}')
                try:
                    config = json.loads(config_str)
                    print(f"    📋 Config keys: {list(config.keys())}")
                    
                    if 'top3_interventions' in config:
                        top3_interventions = config['top3_interventions']
                        print(f"    🥇 Top3 from HTML: {top3_interventions}")
                    if 'next2_interventions' in config:
                        next2_interventions = config['next2_interventions']
                        print(f"    🥈 Next2 from HTML: {next2_interventions}")
                    if top3_interventions or next2_interventions:
                        break  # Use the first one found with intervention data
                except json.JSONDecodeError as e:
                    print(f"    ❌ JSON decode error: {e}")
                    continue
        except Exception as e:
            print(f"    ❌ Error extracting metadata: {e}")
    
    # Categorize losers
    all_recommended = top3_interventions + next2_interventions
    top3_losers = [i for i in top3_interventions if i != winner_intervention and i in completed_interventions]
    beyond_top3_losers = [i for i in next2_interventions if i != winner_intervention and i in completed_interventions]
    
    print(f"    🏆 Final categorization:")
    print(f"      Winner: {winner_intervention}")
    print(f"      Top3 losers: {top3_losers}")
    print(f"      Beyond top3 losers: {beyond_top3_losers}")
    
    return {
        'winner_intervention': winner_intervention,
        'top3_interventions': top3_interventions,
        'next2_interventions': next2_interventions,
        'top3_losers': top3_losers,
        'beyond_top3_losers': beyond_top3_losers,
        'all_completed': completed_interventions
    }

def process_deferred_images(processed_posts: List[Dict], session_id: str) -> List[Dict]:
    """
    Poll for and update deferred image processing results
    """
    deferred_images = extract_deferred_images_from_posts(processed_posts)
    
    if not deferred_images:
        print("    No deferred images to process")
        return processed_posts
    
        # --- initialize metadata on each post ---
    for image_url, filters, post_id in deferred_images:
        for post in processed_posts:
            if post.get('post_id') == post_id:
                status = post.get('image_processing_status')
                if not isinstance(status, dict):
                    status = {}
                    post['image_processing_status'] = status
                deferred_list = status.setdefault('deferred_images', [])
                # only add new entries
                if not any(item.get('url') == image_url for item in deferred_list):
                    deferred_list.append({
                        'url': image_url,
                        'filters': filters,
                        'status': 'pending'
                    })
    # ------------------------------------------
    

    print(f"\n6b. Processing {len(deferred_images)} deferred images...")
    
    # Track results
    image_results = {}
    
    for image_url, filters, post_id in deferred_images:
        print(f"    Polling for image in post {post_id}...")
        print(f"    URL: {image_url[:60]}{'...' if len(image_url) > 60 else ''}")
        print(f"    Filters: {filters}")
        
        # Poll for the image result
        result = poll_for_image_result(image_url, filters)
        print(f"    Result: {result}, type: {type(result)}")
        if result:
            image_results[image_url] = result
        else:
            print(f"    ❌ Failed to get result for image in post {post_id}")
    
    # Update processed posts with image results
    if image_results:
        print(f"\n    Updating {len(image_results)} processed images in posts...")
        print(f"{image_results}")
        for post in processed_posts:
            # print(f"type(post): {type(post)}, {post.keys()}")
            processed_html = post.get('processed_html', '')
            if not processed_html:
                continue
            # print(f"{processed_html}")
            soup = BeautifulSoup(processed_html, 'html.parser')
            images_updated = False

            for original_url, result_data in image_results.items():
                # Find all images - need to handle URL encoding differences
                # First try exact match
                imgs_to_update = soup.find_all('img', src=original_url)
                
                # If no exact match, try to find by partial match (handles &amp; encoding)
                if not imgs_to_update:
                    # Find all images and check if the URL matches when decoded
                    all_imgs = soup.find_all('img')
                    imgs_to_update = []
                    for img in all_imgs:
                        img_src = img.get('src', '')
                        # Check if the URLs match after decoding HTML entities
                        if img_src and (original_url in img_src or img_src in original_url):
                            imgs_to_update.append(img)
                            print(f"    Found image with src: {img_src}...")
                
                if imgs_to_update:
                    new_url = result_data
                    if new_url:
                        for img in imgs_to_update:
                            print(f"    - Updating image src for post {post.get('post_id')}:")
                            print(f"        From: {img['src']}")
                            print(f"        To:   {new_url}")
                            img['src'] = new_url
                            images_updated = True
                            
                            # Also update the custom attribute
                            if img.has_attr('diy-mod-custom'):
                                try:
                                    config = json.loads(img['diy-mod-custom'])
                                    config['status'] = 'COMPLETED'
                                    config['processed_url'] = new_url
                                    img['diy-mod-custom'] = json.dumps(config)
                                except (json.JSONDecodeError, TypeError):
                                    pass # Ignore if config is not valid JSON
                else:
                    # print(f"    WARNING: Could not find image with URL: {original_url}")
                    pass

            if images_updated:
                post['processed_html'] = str(soup)

            # Update the status tracking object
            status = post['image_processing_status']
            if isinstance(status, dict):
                deferred_list = status.get('deferred_images', [])
                for item in deferred_list:
                    original_url = item.get('url')
                    if original_url in image_results:
                        item['status'] = 'completed'
                        processed_url = image_results[original_url]
                        item['processed_url'] = processed_url
                    elif item.get('status') == 'pending':
                        item['status'] = 'failed'

    # After processing all images, categorize interventions for comparison study
    for post in processed_posts:
        intervention_analysis = categorize_interventions_for_post(post, processed_posts)
        post['intervention_analysis'] = intervention_analysis
    
    return processed_posts


# The fetch_reddit_post_html function is now imported from reddit_post_fetcher module

def create_custom_post_html(post_data: Dict) -> str:
    """Create shreddit-post HTML from custom post data"""
    post_id = post_data.get('id', 'custom_post')
    post_type = post_data.get('post_type', 'text')
    title = post_data.get('title', 'Custom Post')
    body = post_data.get('body', '')
    media = post_data.get('media', [])
    author = post_data.get('author', 'CustomUser')
    subreddit = post_data.get('subreddit', 'customfeed')
    
    # Create timestamp
    timestamp = "2025-01-01T00:00:00Z"
    
    # Build HTML structure
    html = f"""<shreddit-post 
    id="{post_id}"
    contenttype="{post_type}"
    subredditname="{subreddit}"
    author="{author}"
    created-timestamp="{timestamp}"
>
    <div class="post-container">"""
    
    # Add title
    html += f"""
        <a slot="title" href="#">
            {title}
        </a>"""
    
    # Add text content if available
    if body:
        html += f"""
        <div slot="text-body">
            <p>{body}</p>
        </div>"""
    
    # Add media content based on type
    if post_type == 'image' and media:
        html += f"""
        <div slot="post-media-container">
            <img src="{media[0] if media else 'https://via.placeholder.com/600x400'}" alt="{title}">
        </div>"""
    
    elif post_type == 'gallery' and media:
        html += """
        <div slot="post-media-container">
            <div class="gallery-container">"""
        
        for img_url in media:
            html += f"""
                <img src="{img_url}" alt="Gallery image">"""
        
        html += """
            </div>
        </div>"""
    
    html += """
    </div>
</shreddit-post>"""
    
    return html

def extract_post_content(html: str, post_id: str) -> Optional[Dict]:
    """Extract post content from Reddit HTML"""
    try:
        soup = BeautifulSoup(html, 'html.parser')
        
        # Look for shreddit-post element
        post = soup.find('shreddit-post', {'id': post_id})
        if not post:
            # Try finding by any shreddit-post
            post = soup.find('shreddit-post')
        
        if post:
            return {
                'html': str(post),
                'title': post.select_one('a[slot="title"]').get_text() if post.select_one('a[slot="title"]') else "Untitled"
            }
        
        return None
    except Exception as e:
        print(f"  ❌ Error parsing HTML: {e}")
        return None

def process_json_template(json_file: str, user_email: Optional[str] = None, 
                         title: Optional[str] = None, save_to_db: bool = False, 
                         override_session_id: Optional[str] = None):
    """Process a JSON template file with Reddit URLs and interventions"""
    
    print("=" * 70)
    print("JSON CUSTOM FEED PROCESSOR")
    print("=" * 70)
    print(f"Polling config: max {POLLING_CONFIG['max_attempts']} attempts, "
          f"{POLLING_CONFIG['base_interval_ms']}ms base interval")
    
    # Step 0: Resolve email to user_id if needed
    user_id = None
    if user_email and save_to_db:
        print(f"\n0. Resolving email to user_id...")
        print(f"   Email: {user_email}")
        
        # Basic email validation
        if '@' not in user_email or '.' not in user_email.split('@')[-1]:
            print(f"   ❌ Invalid email format: {user_email}")
            return
        
        try:
            login_response = requests.post(
                AUTH_URL,
                json={"email": user_email},
                timeout=10
            )
            
            if login_response.status_code == 200:
                result = login_response.json()
                if result['status'] == 'success':
                    user_id = result['user']['id']
                    is_new_user = result.get('is_new', False)
                    print(f"   ✓ {'Created new user' if is_new_user else 'Found existing user'}: {user_id}")
                else:
                    print(f"   ❌ Failed to resolve email: {result.get('message', 'Unknown error')}")
                    return
            else:
                print(f"   ❌ Server error: {login_response.status_code}")
                return
                
        except Exception as e:
            print(f"   ❌ Error connecting to server: {e}")
            print("   Make sure the backend is running: python app.py")
            return
    
    # Step 1: Read JSON file
    print(f"\n1. Reading JSON template: {json_file}")
    try:
        with open(json_file, 'r') as f:
            template_data = json.load(f)
    except Exception as e:
        print(f"❌ Error reading JSON file: {e}")
        return
    
    if 'posts' not in template_data:
        print("❌ JSON file must contain a 'posts' array")
        return
    
    posts = template_data['posts']
    print(f"   Found {len(posts)} post entries")
    
    # Step 2: Validate and prepare posts
    print("\n2. Validating posts...")
    valid_posts = []
    
    for i, post in enumerate(posts):
        post_id = post.get('id', f'post_{i+1}')
        text_filter = post.get('text_filter', 'none')
        image_filter = post.get('image_filter', 'none')
        image_intervention = post.get('image_intervention')  # Check for hardcoded intervention
        
        print(f"\n   Post {post_id}:")
        
        # Check if it's a URL-based post or custom post
        if 'post_url' in post and post.get('post_url', '').strip():
            # URL-based post
            post_url = post.get('post_url', '').strip()
            print(f"   Type: URL-based")
            print(f"   URL: {post_url[:50]}..." if len(post_url) > 50 else f"   URL: {post_url}")
            
            if not validate_reddit_url(post_url):
                print("   ⚠️  Invalid Reddit URL format, skipping")
                continue
            
            print(f"   ✓ Valid Reddit URL")
            print(f"   Filters: text={text_filter}, image={image_filter}")
            if image_intervention:
                print(f"   Hardcoded intervention: {image_intervention}")
            
            valid_posts.append({
                'type': 'url',
                'id': post_id,
                'url': post_url,
                'text_filter': text_filter if text_filter != 'none' else None,
                'image_filter': image_filter if image_filter != 'none' else None,
                'image_intervention': image_intervention
            })
            
        elif 'post_type' in post or 'title' in post:
            # Custom post
            post_type = post.get('post_type', 'text')
            title = post.get('title', '')
            body = post.get('body', '')
            media = post.get('media', [])
            
            print(f"   Type: Custom {post_type} post")
            print(f"   Title: {title[:50]}..." if len(title) > 50 else f"   Title: {title}")
            
            if not title:
                print("   ⚠️  No title provided for custom post, skipping")
                continue
            
            print(f"   ✓ Valid custom post")
            print(f"   Filters: text={text_filter}, image={image_filter}")
            if image_intervention:
                print(f"   Hardcoded intervention: {image_intervention}")
            
            valid_posts.append({
                'type': 'custom',
                'id': post_id,
                'post_type': post_type,
                'title': title,
                'body': body,
                'media': media,
                'author': post.get('author', 'CustomUser'),
                'subreddit': post.get('subreddit', 'customfeed'),
                'text_filter': text_filter if text_filter != 'none' else None,
                'image_filter': image_filter if image_filter != 'none' else None,
                'image_intervention': image_intervention
            })
        else:
            print("   ⚠️  Invalid post format (needs either post_url or title), skipping")
            continue
    
    if not valid_posts:
        print("\n❌ No valid posts to process")
        return
    
    print(f"\n   Total valid posts: {len(valid_posts)}")
    
    # Step 3: Process posts (fetch URLs or build custom)
    print("\n3. Processing posts...")
    
    posts_html = []
    posts_to_process = []
    
    for post in valid_posts:
        if post['type'] == 'url':
            # URL-based post - fetch from Reddit
            print(f"\n   Fetching {post['id']} from Reddit...")
            
            post_html = fetch_reddit_post_html(post['url'])
            
            if post_html:
                print(f"   ✓ Successfully fetched")
                posts_html.append(post_html)
                posts_to_process.append(post)
            else:
                print(f"   ✗ Failed to fetch - creating placeholder")
                # Create a placeholder if fetch fails
                placeholder_html = f"""
                <shreddit-post id="{post['id']}" 
                               contenttype="text" 
                               subredditname="customfeed"
                               created-timestamp="{datetime.now().isoformat()}Z">
                    <div class="post-container">
                        <a slot="title" href="{post['url']}">
                            [Failed to fetch] {post['url']}
                        </a>
                        <div slot="text-body">
                            <p>Unable to fetch this Reddit post. The URL may be invalid or the post may have been deleted.</p>
                            <p>Requested filters - Text: {post['text_filter'] or 'none'}, Image: {post['image_filter'] or 'none'}</p>
                        </div>
                    </div>
                </shreddit-post>
                """
                posts_html.append(placeholder_html)
                posts_to_process.append(post)
                
        else:
            # Custom post - build from provided data
            print(f"\n   Building custom post {post['id']}...")
            
            custom_html = create_custom_post_html(post)
            posts_html.append(custom_html)
            posts_to_process.append(post)
            
            print(f"   ✓ Created custom {post['post_type']} post")
    
    # Step 4: Build API request
    print("\n4. Building API request...")
    request_data = {
        # "session_id": f"json_feed_{datetime.now().timestamp()}",
        "user_id": user_id,
        "session_id": "",
        "posts": [],
        "return_original": True
    }
    
    for post, html in zip(posts_to_process, posts_html):
        request_data["posts"].append({
            "post_html": html,
            "text_intervention": post['text_filter'],
            "image_intervention": post.get('image_intervention') or post['image_filter'],
            "post_id": post['id']
        })
    # Check for session_id override (priority order: manual > comparison template > generated)
    if override_session_id:
        request_data["session_id"] = override_session_id
        print(f"   🎯 Using manually specified session_id: {override_session_id}")
    else:
        original_session_id = template_data.get('metadata', {}).get('session_id')
        if original_session_id:
            # Use the original session_id for consistency in comparison studies
            request_data["session_id"] = original_session_id
            print(f"   📎 Using original session_id for comparison: {original_session_id}")
        else:
            # Generate new session_id based on HTML content
            all_post_html = ''.join([post['post_html'] for post in request_data['posts']])
            request_data["session_id"] = hashlib.md5(all_post_html.encode('utf-8')).hexdigest()
            print(f"   🆔 Generated new session_id: {request_data['session_id']}")

    # Step 5: Send to API
    print("\n5. Sending to custom feed processor API...")
    try:
        response = requests.post(API_URL, json=request_data, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            processed_posts = result['data']['processed_posts']
            session_id = result['data']['session_id']
            
            print(f"\n6. Successfully processed {len(processed_posts)} posts!")
            
            # Check for deferred images and poll for results
            processed_posts = process_deferred_images(processed_posts, session_id)
            
            # Display results
            print("\n" + "=" * 70)
            print("RESULTS:")
            print("=" * 70)
            
            intervention_counts = {}
            
            for post in processed_posts:
                print(f"\nPost ID: {post['post_id']}")
                
                # Show interventions
                text_int = post.get('text_intervention_applied')
                img_int = post.get('image_intervention_applied')
                
                if text_int:
                    print(f"  ✓ Text intervention: {text_int}")
                    intervention_counts[f"text_{text_int}"] = intervention_counts.get(f"text_{text_int}", 0) + 1
                else:
                    print(f"  - No text intervention")
                    
                if img_int:
                    print(f"  ✓ Image intervention: {img_int}")
                    intervention_counts[f"image_{img_int}"] = intervention_counts.get(f"image_{img_int}", 0) + 1
                else:
                    print(f"  - No image intervention")
                
                # Show deferred image processing results
                image_status = post.get('image_processing_status', {})
                if image_status and 'deferred_images' in image_status:
                    deferred_count = len(image_status['deferred_images'])
                    completed_count = sum(1 for img in image_status['deferred_images'] 
                                        if img.get('status') == 'completed')
                    print(f"  📷 Deferred images: {completed_count}/{deferred_count} completed")
                    
                    for img_item in image_status['deferred_images']:
                        if img_item.get('status') == 'completed':
                            print(f"    ✓ Image processed: {img_item.get('filters', [])}")
                        else:
                            print(f"    ❌ Image failed: {img_item.get('filters', [])}")
                
                print(f"  Processing time: {post['processing_time_ms']:.2f}ms")
            
            # Create timeline HTML
            print("\n7. Creating timeline HTML...")
            
            timeline_html = """<!DOCTYPE html>
<html>
<head>
    <title>Custom Reddit Feed - JSON Generated</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #dae0e6;
            margin: 0;
            padding: 0;
        }
        .feed-header {
            background: #1a1a1b;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .feed-container {
            max-width: 800px;
            margin: 20px auto;
        }
        .post {
            background: white;
            border-radius: 8px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .post-header {
            padding: 16px;
            border-bottom: 1px solid #edeff1;
        }
        .post-content {
            padding: 16px;
        }
        .intervention-info {
            background: #f6f7f8;
            padding: 8px 16px;
            font-size: 12px;
            color: #7c7c7c;
            border-top: 1px solid #edeff1;
        }
        /* DIY-MOD Styles */
        .diymod-blur { filter: blur(8px); }
        .diymod-overlay-content { position: relative; }
        .diymod-overlay-content.diymod-overlay-hidden .content { display: none; }
        .diymod-overlay-content.diymod-overlay-hidden .warning { display: block; }
        .diymod-overlay-content .warning { 
            display: none; 
            background: #ff4500; 
            color: white; 
            padding: 20px; 
            text-align: center;
            cursor: pointer;
        }
        .diymod-rewritten { 
            border-left: 4px solid #ffd700; 
            padding-left: 12px; 
        }
        .diymod-processing { opacity: 0.6; }
    </style>
</head>
<body>
    <div class="feed-header">
        <h1>""" + (title or "Custom Reddit Feed (JSON Generated)") + """</h1>
        <p>Generated on """ + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + """</p>
    </div>
    <div class="feed-container">
"""
            
            # Add posts to timeline
            for post in processed_posts:
                timeline_html += f"""
        <div class="post">
            <div class="post-content">
                {post['processed_html']}
            </div>
            <div class="intervention-info">
                Post ID: {post['post_id']} | 
                Processing: {post['processing_time_ms']:.1f}ms
                {' | Text: ' + post.get('text_intervention_applied', 'none') if post.get('text_intervention_applied') else ''}
                {' | Image: ' + post.get('image_intervention_applied', 'none') if post.get('image_intervention_applied') else ''}
            </div>
        </div>
"""
            
            timeline_html += """
    </div>
</body>
</html>"""
            
            # Save timeline to file
            output_file = f"json_feed_timeline_{session_id}.html"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(timeline_html)
            
            print(f"  ✅ Saved timeline to: {output_file}")
            print(f"  📊 Total posts: {len(processed_posts)}")
            print(f"  ⏱️  Total processing time: {sum(p['processing_time_ms'] for p in processed_posts):.2f}ms")
            
            # Generate comparison JSON for study purposes (only if not using hardcoded interventions)
            has_hardcoded_interventions = any(
                post.get('image_intervention') for post in template_data.get('posts', [])
            )
            
            if not has_hardcoded_interventions and user_email:
                print("\n8a. Generating comparison template for study...")
                comparison_json = generate_comparison_json(processed_posts, template_data, session_id)
                # Add the original session_id to metadata so comparison runs use the same ID
                comparison_json["metadata"]["original_session_id"] = session_id
                
                # Create user-specific directory
                user_dir = Path("phase-two-feed-data") / user_email
                user_dir.mkdir(parents=True, exist_ok=True)
                
                comparison_file = user_dir / f"comparison_template_{session_id}.json"
                
                with open(comparison_file, 'w', encoding='utf-8') as f:
                    json.dump(comparison_json, f, indent=2, ensure_ascii=False)
                
                print(f"  ✅ Generated comparison template: {comparison_file}")
                print(f"  📋 Instructions:")
                print(f"      1. Edit the 'image_intervention' field in posts to change interventions")
                print(f"      2. Run this script again with the edited JSON to create comparison feeds")
                print(f"      3. Available options are listed in each post's 'intervention_options'")
            elif not has_hardcoded_interventions:
                print("  📝 No user email provided - comparison template not saved")
            else:
                print("  📝 Using hardcoded interventions - no comparison template generated")
            
            # Save to database if requested
            if save_to_db and user_id:
                # Check if session_id exists in template (comparison run)
                has_existing_session = template_data.get('metadata', {}).get('session_id')
                version_suffix = "v_beta" if has_existing_session else "v_alpha"
                
                print(f"\n8. Saving to database ({version_suffix})...")
                
                session_id = request_data['session_id']
                base_title = f"User Study Feed"
                
                # Create original feed HTML (without any processing)
                original_timeline_html = """<!DOCTYPE html>
<html>
<head>
    <title>Custom Reddit Feed - Original</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #dae0e6;
            margin: 0;
            padding: 0;
        }
        .feed-header {
            background: #1a1a1b;
            color: white;
            padding: 20px;
            text-align: center;
        }
        .feed-container {
            max-width: 800px;
            margin: 20px auto;
        }
        .post {
            background: white;
            border-radius: 8px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .post-header {
            padding: 16px;
            border-bottom: 1px solid #edeff1;
        }
        .post-content {
            padding: 16px;
        }
        .intervention-info {
            background: #f6f7f8;
            padding: 8px 16px;
            font-size: 12px;
            color: #7c7c7c;
            border-top: 1px solid #edeff1;
        }
    </style>
</head>
<body>
    <div class="feed-header">
        <h1>""" + base_title + """</h1>
        <p>Generated on """ + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + """</p>
    </div>
    <div class="feed-container">
"""
                
                # Add original posts (from posts_html before processing)
                for i, html in enumerate(posts_html):
                    original_timeline_html += f"""
        <div class="post">
            <div class="post-content">
                {html}
            </div>
            <div class="intervention-info">
                Post ID: {posts_to_process[i]['id']} | Original (No Processing)
            </div>
        </div>
"""
                
                original_timeline_html += """
    </div>
</body>
</html>"""
                
                # Metadata for both feeds
                common_metadata = {
                    "source": "json_template",
                    "template_file": json_file,
                    "post_count": len(processed_posts),
                    "session_id": session_id
                }
                
                original_metadata = {
                    **common_metadata,
                    "feed_type": "original",
                    "interventions": {},
                    "processing_time_ms": 0
                }
                
                filtered_metadata = {
                    **common_metadata,
                    "feed_type": "filtered", 
                    "interventions": dict(intervention_counts),
                    "processing_time_ms": sum(p['processing_time_ms'] for p in processed_posts)
                }
                
                try:
                    # Save original feed only if no existing session
                    if not has_existing_session:
                        original_save_request = {
                            "user_id": user_id,
                            "title": f"{base_title} (Original)",
                            "feed_html": original_timeline_html,
                            "metadata": original_metadata,
                            "comparison_set_id": session_id,
                            "feed_type": "original",
                            "filter_config": {}
                        }
                        
                        original_response = requests.post(SAVE_API_URL, json=original_save_request)
                        if original_response.status_code == 200:
                            original_result = original_response.json()
                            print(f"  ✅ Saved original feed with ID: {original_result['data']['feed_id']}")
                        else:
                            print(f"  ❌ Failed to save original: {original_response.text}")
                    
                    # Save filtered feed 
                    filter_config = {}
                    for post in posts_to_process:
                        if post.get('text_filter') or post.get('image_filter'):
                            filter_config[post['id']] = {
                                'text_filter': post.get('text_filter'),
                                'image_filter': post.get('image_filter')
                            }
                    
                    # Change title based on session existence
                    filtered_title = f"{base_title} ({version_suffix})"
                    
                    filtered_save_request = {
                        "user_id": user_id,
                        "title": filtered_title,
                        "feed_html": timeline_html,
                        "metadata": filtered_metadata,
                        "comparison_set_id": session_id,
                        "feed_type": "filtered",
                        "filter_config": filter_config
                    }
                    
                    filtered_response = requests.post(SAVE_API_URL, json=filtered_save_request)
                    if filtered_response.status_code == 200:
                        filtered_result = filtered_response.json()
                        print(f"  ✅ Saved filtered feed with ID: {filtered_result['data']['feed_id']}")
                        print(f"  📝 Comparison Set ID: {session_id}")
                        print(f"  📊 Original + Filtered feeds saved for session")
                    else:
                        print(f"  ❌ Failed to save filtered: {filtered_response.text}")
                        
                except Exception as e:
                    print(f"  ❌ Error saving feeds: {e}")
                    
        else:
            print(f"\n❌ API Error {response.status_code}: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("\n❌ Could not connect to server")
        print("Make sure the backend is running: python app.py")
    except Exception as e:
        print(f"\n❌ Error: {e}")
    
    print("\n" + "=" * 70)
    print("JSON FEED PROCESSING COMPLETE")
    print("=" * 70)

def generate_comparison_json(processed_posts: List[Dict], original_template: Dict, session_id: str) -> Dict:
    """
    Generate a JSON template with intervention options for creating comparison feeds
    """
    comparison_template = {
        "posts": [],
        "metadata": {
            "session_id": session_id,
            "generated_from": "winner_feed",
            "purpose": "comparison_study",
            "instructions": {
                "usage": "Manually edit 'image_intervention' field to create different feeds",
                "options": {
                    "winner": "Use the system's chosen intervention (current state)",
                    "top3_loser": "Pick from top3_losers list",
                    "beyond_top3_loser": "Pick from beyond_top3_losers list",
                    "mixed": "Mix different categories for hybrid comparison"
                }
            }
        }
    }
    
    for post in processed_posts:
        analysis = post.get('intervention_analysis', {})
        
        # Build post entry
        post_entry = {
            "id": post['post_id'],
            "post_type": "text",  # Default, will be updated if we have original info
            "title": f"Post {post['post_id']}",
            "text_filter": post.get('text_intervention_applied', 'none'),
            "image_filter": "none",  # Will be overridden by image_intervention
        }
        
        # Add intervention options if this post has image interventions
        if analysis and analysis.get('winner_intervention'):
            post_entry["image_intervention"] = analysis['winner_intervention']  # Current winner
            post_entry["intervention_options"] = {
                "current_winner": analysis['winner_intervention'],
                "top3_losers": analysis.get('top3_losers', []),
                "beyond_top3_losers": analysis.get('beyond_top3_losers', []),
                "all_top3": analysis.get('top3_interventions', []),
                "all_next2": analysis.get('next2_interventions', [])
            }
            post_entry["instructions"] = "Change 'image_intervention' to any option from 'intervention_options'"
        
        # Try to get original post data from the template
        original_posts = original_template.get('posts', [])
        for orig_post in original_posts:
            if orig_post.get('id') == post['post_id']:
                # Copy relevant original data
                if 'post_url' in orig_post:
                    post_entry['post_url'] = orig_post['post_url']
                    post_entry['type'] = 'url'
                if 'title' in orig_post:
                    post_entry['title'] = orig_post['title']
                if 'body' in orig_post:
                    post_entry['body'] = orig_post['body']
                if 'post_type' in orig_post:
                    post_entry['post_type'] = orig_post['post_type']
                if 'media' in orig_post:
                    post_entry['media'] = orig_post['media']
                break
        
        comparison_template["posts"].append(post_entry)
    
    return comparison_template

def create_example_json(output_file: str = "example_mixed_feed.json"):
    """Create an example JSON template file with both URL and custom posts"""
    example = {
        "posts": [
            {
                "id": "reddit_post_1",
                "post_url": "https://www.reddit.com/r/gastricsleeve/comments/1lwktko/",
                "text_filter": "none",
                "image_filter": "none"
            },
            {
                "id": "custom_text_post",
                "post_type": "text",
                "title": "My Custom Text Post",
                "body": "This is a custom post created directly in the JSON file. It can contain any text content you want to include in your feed.",
                "author": "MyUsername",
                "subreddit": "mycustomfeed",
                "text_filter": "blur",
                "image_filter": "none"
            },
            {
                "id": "reddit_post_2",
                "post_url": "https://reddit.com/r/gastricsleeve/comments/1e3tkr4/",
                "text_filter": "overlay",
                "image_filter": "cartoonish"
            },
            {
                "id": "custom_image_post",
                "post_type": "image",
                "title": "Beautiful Sunset Photo",
                "body": "Check out this amazing sunset I captured yesterday!",
                "media": ["https://images.unsplash.com/photo-1495616811223-4d98c6e9c869"],
                "author": "PhotoLover",
                "subreddit": "photography",
                "text_filter": "none",
                "image_filter": "blur"
            },
            {
                "id": "custom_gallery_post",
                "post_type": "gallery",
                "title": "My Travel Photos Collection",
                "body": "Here are some photos from my recent trip",
                "media": [
                    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4",
                    "https://images.unsplash.com/photo-1454391304352-2bf4678b1a7a",
                    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4"
                ],
                "author": "TravelBlogger",
                "subreddit": "travel",
                "text_filter": "rewrite",
                "image_filter": "overlay"
            }
        ]
    }
    
    with open(output_file, 'w') as f:
        json.dump(example, f, indent=2)
    
    print(f"Created example template: {output_file}")

def main():
    parser = argparse.ArgumentParser(
        description='Process a JSON template to create a custom Reddit feed',
        epilog='''
Examples:
  # Process without saving to database
  python process_json_custom_feed.py my_feed.json
  
  # Process and save to database with user email
  python process_json_custom_feed.py my_feed.json --user-email user@example.com --save
  
  # Process with custom title and save
  python process_json_custom_feed.py my_feed.json --user-email researcher@university.edu --title "Study Feed A" --save
        ''',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        'json_file',
        nargs='?',
        default='custom_feed_example.json',
        help='JSON template file (default: custom_feed_example.json)'
    )
    parser.add_argument(
        '--user-email',
        help='User email for saving to database (will be resolved to user_id)'
    )
    parser.add_argument(
        '--title',
        help='Title for the custom feed'
    )
    parser.add_argument(
        '--save',
        action='store_true',
        help='Save to database (requires --user-email)'
    )
    parser.add_argument(
        '--create-example',
        action='store_true',
        help='Create an example JSON template file'
    )
    parser.add_argument(
        '--session-id',
        help='Override session_id for comparison studies'
    )
    
    args = parser.parse_args()
    
    if args.create_example:
        create_example_json()
        return
    
    # Check if JSON file exists
    if not Path(args.json_file).exists():
        print(f"❌ JSON file not found: {args.json_file}")
        print("\nTip: Use --create-example to generate a template")
        sys.exit(1)
    
    # Validate email if saving to database
    if args.save and not args.user_email:
        print("❌ --user-email is required when using --save")
        print("   Example: python process_json_custom_feed.py my_feed.json --user-email user@example.com --save")
        sys.exit(1)
    
    # Process the JSON template
    process_json_template(
        args.json_file,
        user_email=args.user_email,
        title=args.title,
        save_to_db=args.save and args.user_email is not None,
        override_session_id=args.session_id
    )

if __name__ == "__main__":
    main()