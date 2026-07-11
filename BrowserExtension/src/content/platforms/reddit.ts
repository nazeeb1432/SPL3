/**
 * Reddit platform adapter for content extraction and modification
 */
import { logger } from '@/utils/logger';
import { Post, ProcessedPost, PlatformAdapter } from '@/shared/types';
import { processMarkedText } from '@/utils/markers';

class RedditAdapter implements PlatformAdapter {
  name = 'Reddit';
  
  /**
   * Check if this adapter can handle the given URL
   */
  canHandle(url: string): boolean {
    return url.includes('reddit.com');
  }
  
  /**
   * Extract posts from Reddit API response
   */
  extractPosts(responseData: string): Post[] {
    try {
      // Attempt to parse response as JSON
      const data = JSON.parse(responseData);
      const posts: Post[] = [];
      
      // Handle listing response (common Reddit API format)
      if (data.kind === 'Listing' && Array.isArray(data.data?.children)) {
        data.data.children.forEach((child: any) => {
          if (child.kind === 't3') { // t3 is a post
            const post = child.data;
            
            // Create post object
            const postObject: Post = {
              id: post.name || post.id,
              title: post.title,
              body: post.selftext,
              mediaUrls: this.extractMediaUrls(post),
              platform: 'reddit',
              metadata: {
                subreddit: post.subreddit,
                author: post.author,
                created: post.created_utc
              }
            };
            
            posts.push(postObject);
          }
        });
      }
      
      // Handle post detail response
      if (data[0]?.data?.children?.[0]?.data && data[1]?.data?.children) {
        // Main post
        const post = data[0].data.children[0].data;
        
        const postObject: Post = {
          id: post.name || post.id,
          title: post.title,
          body: post.selftext,
          mediaUrls: this.extractMediaUrls(post),
          platform: 'reddit',
          metadata: {
            subreddit: post.subreddit,
            author: post.author,
            created: post.created_utc
          }
        };
        
        posts.push(postObject);
        
        // Comments
        data[1].data.children.forEach((comment: any) => {
          if (comment.kind === 't1' && comment.data) {
            const commentObj: Post = {
              id: comment.data.name || comment.data.id,
              body: comment.data.body,
              mediaUrls: [],
              platform: 'reddit',
              metadata: {
                type: 'comment',
                author: comment.data.author,
                parent: comment.data.parent_id
              }
            };
            
            posts.push(commentObj);
          }
        });
      }
      
      return posts;
    } catch (error) {
      logger.content.error('Error extracting Reddit posts:', error);
      return [];
    }
  }
  
  /**
   * Extract media URLs from a Reddit post
   */
  private extractMediaUrls(post: any): string[] {
    const mediaUrls: string[] = [];
    
    // Check for preview images
    if (post.preview?.images) {
      post.preview.images.forEach((image: any) => {
        if (image.source?.url) {
          mediaUrls.push(image.source.url);
        }
      });
    }
    
    // Check for media metadata (gallery posts)
    if (post.media_metadata) {
      Object.values(post.media_metadata).forEach((media: any) => {
        if (media.s?.u) {
          mediaUrls.push(media.s.u);
        }
      });
    }
    
    // Check for direct media URL
    if (post.url && this.isImageUrl(post.url)) {
      mediaUrls.push(post.url);
    }
    
    return mediaUrls;
  }
  
  /**
   * Check if a URL is an image
   */
  private isImageUrl(url: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);
  }
  
  /**
   * Update response with processed posts
   */
  updateResponseWithProcessedPosts(
    originalResponse: string, 
    processedPosts: ProcessedPost[]
  ): string {
    try {
      // Create a map of processed posts by ID for quick lookup
      const processedPostMap = new Map<string, ProcessedPost>();
      processedPosts.forEach(post => {
        processedPostMap.set(post.id, post);
      });
      
      // Parse the original response
      const data = JSON.parse(originalResponse);
      
      // Process listing response
      if (data.kind === 'Listing' && Array.isArray(data.data?.children)) {
        data.data.children.forEach((child: any) => {
          if (child.kind === 't3') {
            const post = child.data;
            const processedPost = processedPostMap.get(post.name || post.id);
            
            if (processedPost) {
              // Update title if processed
              if (processedPost.processedTitle) {
                post.title = processMarkedText(processedPost.processedTitle);
              }
              
              // Update body if processed
              if (processedPost.processedBody) {
                post.selftext = processMarkedText(processedPost.processedBody);
                post.selftext_html = processMarkedText(processedPost.processedBody);
              }
              
              // Update media URLs if processed
              if (processedPost.processedMediaUrls && processedPost.processedMediaUrls.length > 0) {
                this.updateMediaUrls(post, processedPost.processedMediaUrls);
              }
            }
          }
        });
      }
      
      // Process post detail response
      if (data[0]?.data?.children?.[0]?.data && data[1]?.data?.children) {
        // Main post
        const post = data[0].data.children[0].data;
        const processedPost = processedPostMap.get(post.name || post.id);
        
        if (processedPost) {
          // Update title if processed
          if (processedPost.processedTitle) {
            post.title = processMarkedText(processedPost.processedTitle);
          }
          
          // Update body if processed
          if (processedPost.processedBody) {
            post.selftext = processMarkedText(processedPost.processedBody);
            post.selftext_html = processMarkedText(processedPost.processedBody);
          }
          
          // Update media URLs if processed
          if (processedPost.processedMediaUrls && processedPost.processedMediaUrls.length > 0) {
            this.updateMediaUrls(post, processedPost.processedMediaUrls);
          }
        }
        
        // Comments
        data[1].data.children.forEach((comment: any) => {
          if (comment.kind === 't1' && comment.data) {
            const processedComment = processedPostMap.get(comment.data.name || comment.data.id);
            
            if (processedComment && processedComment.processedBody) {
              comment.data.body = processMarkedText(processedComment.processedBody);
              comment.data.body_html = processMarkedText(processedComment.processedBody);
            }
          }
        });
      }
      
      return JSON.stringify(data);
    } catch (error) {
      logger.content.error('Error updating Reddit response:', error);
      return originalResponse;
    }
  }
  
  /**
   * Update media URLs in a post object
   */
  private updateMediaUrls(post: any, processedUrls: string[]): void {
    // Simple case: single image post with direct URL
    if (processedUrls.length === 1 && post.url && this.isImageUrl(post.url)) {
      post.url = processedUrls[0];
    }
    
    // Update preview images
    if (post.preview?.images && processedUrls.length > 0) {
      let urlIndex = 0;
      
      post.preview.images.forEach((image: any) => {
        if (image.source && urlIndex < processedUrls.length) {
          image.source.url = processedUrls[urlIndex++];
          
          // Also update resolutions
          if (Array.isArray(image.resolutions)) {
            image.resolutions.forEach((resolution: any) => {
              resolution.url = processedUrls[urlIndex - 1];
            });
          }
        }
      });
    }
    
    // Update gallery posts
    if (post.media_metadata && processedUrls.length > 0) {
      let urlIndex = 0;
      
      Object.keys(post.media_metadata).forEach(key => {
        const media = post.media_metadata[key];
        if (media.s && urlIndex < processedUrls.length) {
          media.s.u = processedUrls[urlIndex++];
        }
      });
    }
  }
}

// Export singleton instance
export const redditAdapter = new RedditAdapter();