#!/usr/bin/env python3
"""
Process custom feeds with automatic original + filtered version generation
"""

import json
import uuid
from datetime import datetime
from typing import Dict, List, Any, Tuple
import asyncio
import requests
from pathlib import Path

# Import your existing modules
from database import save_custom_feed, get_custom_feed_by_id
from process_json_custom_feed import create_custom_post_html
from reddit_post_fetcher import fetch_reddit_post_html

API_URL = "http://localhost:8001/custom-feed/process"

async def process_json_with_comparison(
    json_data: Dict[str, Any], 
    user_id: str,
    base_title: str = None
) -> Dict[str, Any]:
    """
    Process a JSON feed template and generate both original and filtered versions
    """
    # Generate unique comparison set ID
    comparison_set_id = str(uuid.uuid4())
    
    # Use provided title or generate one
    if not base_title:
        base_title = f"Custom Feed - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    
    # Extract posts from JSON
    posts = json_data.get('posts', [])
    
    # Step 1: Prepare post HTML (fetch Reddit posts or create custom ones)
    posts_html = []
    posts_data = []
    
    print(f"\nProcessing {len(posts)} posts for comparison...")
    
    for post in posts:
        if 'post_url' in post and post['post_url']:
            # Fetch from Reddit
            print(f"Fetching Reddit post: {post['post_url']}")
            html = fetch_reddit_post_html(post['post_url'])
            if html:
                posts_html.append(html)
                posts_data.append(post)
        elif 'post_type' in post:
            # Create custom post
            print(f"Creating custom post: {post.get('title', 'Untitled')}")
            html = create_custom_post_html(post)
            posts_html.append(html)
            posts_data.append(post)
    
    # Step 2: Generate ORIGINAL version (no filters)
    print("\nGenerating ORIGINAL version (no filters)...")
    original_request = {
        "session_id": f"original_{comparison_set_id}",
        "posts": [],
        "return_original": True
    }
    
    for html, post in zip(posts_html, posts_data):
        original_request["posts"].append({
            "post_html": html,
            "text_intervention": None,  # No filters
            "image_intervention": None,  # No filters
            "post_id": post.get('id', 'unknown')
        })
    
    # Process original
    original_html = await process_feed_to_html(original_request)
    
    # Save original to database
    # Store comparison info in metadata since DB might not have new columns yet
    original_metadata = {
        "comparison_set_id": comparison_set_id,
        "feed_type": "original",
        "post_count": len(posts_html),
        "filters_applied": "none",
        "comparison_info": {
            "set_id": comparison_set_id,
            "type": "original"
        }
    }
    
    original_feed_id = save_custom_feed(
        user_id=user_id,
        title=f"{base_title} - Original",
        feed_html=original_html,
        metadata=original_metadata
    )
    print(f"✓ Saved original feed with ID: {original_feed_id}")
    
    # Step 3: Generate FILTERED version (with user filters)
    print("\nGenerating FILTERED version...")
    filtered_request = {
        "session_id": f"filtered_{comparison_set_id}",
        "posts": [],
        "return_original": True
    }
    
    filter_summary = {}
    
    for html, post in zip(posts_html, posts_data):
        text_filter = post.get('text_filter', 'none')
        image_filter = post.get('image_filter', 'none')
        
        # Track filters used
        if text_filter != 'none':
            filter_summary[f"text_{text_filter}"] = filter_summary.get(f"text_{text_filter}", 0) + 1
        if image_filter != 'none':
            filter_summary[f"image_{image_filter}"] = filter_summary.get(f"image_{image_filter}", 0) + 1
        
        filtered_request["posts"].append({
            "post_html": html,
            "text_intervention": text_filter if text_filter != 'none' else None,
            "image_intervention": image_filter if image_filter != 'none' else None,
            "post_id": post.get('id', 'unknown')
        })
    
    print(f"Applying filters: {filter_summary}")
    
    # Process filtered
    filtered_html = await process_feed_to_html(filtered_request)
    
    # Save filtered to database
    # Store comparison info in metadata since DB might not have new columns yet
    filtered_metadata = {
        "comparison_set_id": comparison_set_id,
        "feed_type": "filtered",
        "post_count": len(posts_html),
        "filters_applied": filter_summary,
        "filter_config": {
            post.get('id'): {
                'text_filter': post.get('text_filter', 'none'),
                'image_filter': post.get('image_filter', 'none')
            } for post in posts_data
        },
        "comparison_info": {
            "set_id": comparison_set_id,
            "type": "filtered"
        }
    }
    
    filtered_feed_id = save_custom_feed(
        user_id=user_id,
        title=f"{base_title} - Filtered",
        feed_html=filtered_html,
        metadata=filtered_metadata
    )
    print(f"✓ Saved filtered feed with ID: {filtered_feed_id}")
    
    return {
        "comparison_set_id": comparison_set_id,
        "original": {
            "feed_id": original_feed_id,
            "title": f"{base_title} - Original"
        },
        "filtered": {
            "feed_id": filtered_feed_id,
            "title": f"{base_title} - Filtered",
            "filters_applied": filter_summary
        }
    }

async def process_feed_to_html(request_data: Dict) -> str:
    """Send request to API and build HTML timeline"""
    try:
        response = requests.post(API_URL, json=request_data, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            processed_posts = result['data']['processed_posts']
            
            # Build timeline HTML
            timeline_html = build_timeline_html(processed_posts, request_data.get('session_id', ''))
            return timeline_html
        else:
            raise Exception(f"API Error: {response.status_code}")
            
    except Exception as e:
        print(f"Error processing feed: {e}")
        # Return error HTML
        return f"<div class='error'>Error processing feed: {str(e)}</div>"

def build_timeline_html(posts: List[Dict], session_id: str) -> str:
    """Build the complete timeline HTML"""
    feed_type = "Original" if "original" in session_id else "Filtered"
    
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>Custom Reddit Feed - {feed_type}</title>
    <meta charset="UTF-8">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #dae0e6;
            margin: 0;
            padding: 0;
        }}
        .feed-header {{
            background: #1a1a1b;
            color: white;
            padding: 20px;
            text-align: center;
        }}
        .feed-container {{
            max-width: 800px;
            margin: 20px auto;
            padding: 0 20px;
        }}
        .post {{
            background: white;
            border-radius: 8px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        .post-content {{
            padding: 16px;
        }}
        .processing-info {{
            background: #f6f7f8;
            padding: 8px 16px;
            font-size: 12px;
            color: #7c7c7c;
            border-top: 1px solid #edeff1;
        }}
    </style>
</head>
<body>
    <div class="feed-header">
        <h1>{feed_type} Feed</h1>
        <p>Generated on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>
    </div>
    <div class="feed-container">
"""
    
    for post in posts:
        interventions = []
        if post.get('text_intervention_applied'):
            interventions.append(f"Text: {post['text_intervention_applied']}")
        if post.get('image_intervention_applied'):
            interventions.append(f"Image: {post['image_intervention_applied']}")
        
        intervention_text = " | ".join(interventions) if interventions else "No interventions"
        
        html += f"""
        <div class="post">
            <div class="post-content">
                {post['processed_html']}
            </div>
            <div class="processing-info">
                Post ID: {post['post_id']} | {intervention_text} | Processing: {post['processing_time_ms']:.1f}ms
            </div>
        </div>
"""
    
    html += """
    </div>
</body>
</html>"""
    
    return html

# Test function
async def test_comparison():
    """Test the comparison processing"""
    test_json = {
        "posts": [
            {
                "id": "test_1",
                "post_type": "text",
                "title": "Test Post for Comparison",
                "body": "This is a test post. It contains some text that might be filtered.",
                "author": "TestUser",
                "subreddit": "testing",
                "text_filter": "blur",
                "image_filter": "none"
            },
            {
                "id": "test_2",
                "post_type": "image",
                "title": "Test Image Post",
                "body": "This post has an image",
                "media": ["https://via.placeholder.com/600x400"],
                "author": "TestUser",
                "subreddit": "testing",
                "text_filter": "none",
                "image_filter": "cartoonish"
            }
        ]
    }
    
    print("=" * 70)
    print("TESTING COMPARISON PROCESSING")
    print("=" * 70)
    
    result = await process_json_with_comparison(
        test_json,
        "test_user",
        "Test Comparison Feed"
    )
    
    print("\n" + "=" * 70)
    print("TEST RESULTS:")
    print("=" * 70)
    print(f"Comparison Set ID: {result['comparison_set_id']}")
    print(f"Original Feed ID: {result['original']['feed_id']}")
    print(f"Filtered Feed ID: {result['filtered']['feed_id']}")
    print(f"Filters Applied: {result['filtered']['filters_applied']}")
    
    # Also save the result to a JSON file for inspection
    with open('test_comparison_result.json', 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\nResults saved to: test_comparison_result.json")

if __name__ == "__main__":
    asyncio.run(test_comparison())