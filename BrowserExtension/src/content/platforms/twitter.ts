/**
 * Twitter/X platform adapter for content extraction and modification
 */
import { logger } from '@/utils/logger';
import { Post, ProcessedPost, PlatformAdapter } from '@/shared/types';
import { processMarkedText } from '@/utils/markers';

class TwitterAdapter implements PlatformAdapter {
  name = 'Twitter';
  
  /**
   * Check if this adapter can handle the given URL
   */
  canHandle(url: string): boolean {
    return url.includes('twitter.com') || url.includes('x.com') || url.includes('api.twitter.com');
  }
  
  /**
   * Extract posts from Twitter API response
   */
  extractPosts(responseData: string): Post[] {
    try {
      // Attempt to parse response as JSON
      const data = JSON.parse(responseData);
      const posts: Post[] = [];
      
      // Handle timeline response
      if (data.globalObjects && data.globalObjects.tweets) {
        const tweets = data.globalObjects.tweets;
        const users = data.globalObjects.users || {};
        
        Object.values(tweets).forEach((tweet: any) => {
          const mediaUrls = this.extractMediaUrls(tweet);
          
          const post: Post = {
            id: tweet.id_str || tweet.id,
            body: tweet.full_text || tweet.text,
            mediaUrls,
            platform: 'twitter',
            metadata: {
              user_id: tweet.user_id_str,
              username: users[tweet.user_id_str]?.screen_name || '',
              created_at: tweet.created_at
            }
          };
          
          posts.push(post);
        });
      }
      
      // Handle tweet detail response
      if (data.data?.threaded_conversation_with_injections) {
        const extractTweets = (entries: any[]) => {
          entries.forEach(entry => {
            if (entry.content?.itemContent?.tweet_results?.result) {
              const tweetResult = entry.content.itemContent.tweet_results.result;
              const tweet = tweetResult.legacy || tweetResult;
              const user = tweetResult.core?.user_results?.result?.legacy || {};
              
              if (tweet) {
                const mediaUrls = this.extractMediaUrls(tweet);
                
                const post: Post = {
                  id: tweet.id_str || tweet.id,
                  body: tweet.full_text || tweet.text,
                  mediaUrls,
                  platform: 'twitter',
                  metadata: {
                    user_id: tweet.user_id_str || user.id_str,
                    username: user.screen_name || '',
                    created_at: tweet.created_at
                  }
                };
                
                posts.push(post);
              }
            }
            
            // Process any nested entries recursively
            if (entry.content?.items) {
              extractTweets(entry.content.items);
            }
          });
        };
        
        extractTweets(data.data.threaded_conversation_with_injections.entries || []);
      }
      
      // Handle search response
      if (Array.isArray(data.statuses)) {
        data.statuses.forEach((tweet: any) => {
          const mediaUrls = this.extractMediaUrls(tweet);
          
          const post: Post = {
            id: tweet.id_str || tweet.id,
            body: tweet.full_text || tweet.text,
            mediaUrls,
            platform: 'twitter',
            metadata: {
              user_id: tweet.user.id_str,
              username: tweet.user.screen_name,
              created_at: tweet.created_at
            }
          };
          
          posts.push(post);
        });
      }
      
      return posts;
    } catch (error) {
      logger.content.error('Error extracting Twitter posts:', error);
      return [];
    }
  }
  
  /**
   * Extract media URLs from a tweet
   */
  private extractMediaUrls(tweet: any): string[] {
    const mediaUrls: string[] = [];
    
    // Extract from media entities
    if (tweet.entities?.media) {
      tweet.entities.media.forEach((media: any) => {
        if (media.media_url_https) {
          mediaUrls.push(media.media_url_https);
        }
      });
    }
    
    // Extract from extended entities
    if (tweet.extended_entities?.media) {
      tweet.extended_entities.media.forEach((media: any) => {
        if (media.media_url_https) {
          mediaUrls.push(media.media_url_https);
        }
        
        // Extract video thumbnails
        if (media.video_info?.variants) {
          const highestBitrateVariant = media.video_info.variants
            .filter((v: any) => v.bitrate)
            .sort((a: any, b: any) => b.bitrate - a.bitrate)[0];
          
          if (highestBitrateVariant?.url) {
            mediaUrls.push(highestBitrateVariant.url);
          }
        }
      });
    }
    
    return mediaUrls;
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
      
      // Update timeline response
      if (data.globalObjects && data.globalObjects.tweets) {
        const tweets = data.globalObjects.tweets;
        
        Object.keys(tweets).forEach(tweetId => {
          const tweet = tweets[tweetId];
          const processedPost = processedPostMap.get(tweetId);
          
          if (processedPost) {
            // Update tweet text if processed
            if (processedPost.processedBody) {
              tweet.full_text = processMarkedText(processedPost.processedBody);
              tweet.text = processMarkedText(processedPost.processedBody);
            }
            
            // Update media URLs if processed
            if (processedPost.processedMediaUrls && processedPost.processedMediaUrls.length > 0) {
              this.updateMediaUrls(tweet, processedPost.processedMediaUrls);
            }
          }
        });
      }
      
      // Update tweet detail response
      if (data.data?.threaded_conversation_with_injections) {
        const updateTweets = (entries: any[]) => {
          entries.forEach(entry => {
            if (entry.content?.itemContent?.tweet_results?.result) {
              const tweetResult = entry.content.itemContent.tweet_results.result;
              const tweet = tweetResult.legacy || tweetResult;
              
              if (tweet) {
                const tweetId = tweet.id_str || tweet.id;
                const processedPost = processedPostMap.get(tweetId);
                
                if (processedPost) {
                  // Update tweet text if processed
                  if (processedPost.processedBody) {
                    tweet.full_text = processMarkedText(processedPost.processedBody);
                    tweet.text = processMarkedText(processedPost.processedBody);
                  }
                  
                  // Update media URLs if processed
                  if (processedPost.processedMediaUrls && processedPost.processedMediaUrls.length > 0) {
                    this.updateMediaUrls(tweet, processedPost.processedMediaUrls);
                  }
                }
              }
            }
            
            // Process any nested entries recursively
            if (entry.content?.items) {
              updateTweets(entry.content.items);
            }
          });
        };
        
        updateTweets(data.data.threaded_conversation_with_injections.entries || []);
      }
      
      // Update search response
      if (Array.isArray(data.statuses)) {
        data.statuses.forEach((tweet: any) => {
          const tweetId = tweet.id_str || tweet.id;
          const processedPost = processedPostMap.get(tweetId);
          
          if (processedPost) {
            // Update tweet text if processed
            if (processedPost.processedBody) {
              tweet.full_text = processMarkedText(processedPost.processedBody);
              tweet.text = processMarkedText(processedPost.processedBody);
            }
            
            // Update media URLs if processed
            if (processedPost.processedMediaUrls && processedPost.processedMediaUrls.length > 0) {
              this.updateMediaUrls(tweet, processedPost.processedMediaUrls);
            }
          }
        });
      }
      
      return JSON.stringify(data);
    } catch (error) {
      logger.content.error('Error updating Twitter response:', error);
      return originalResponse;
    }
  }
  
  /**
   * Update media URLs in a tweet object
   */
  private updateMediaUrls(tweet: any, processedUrls: string[]): void {
    let urlIndex = 0;
    
    // Update media entities
    if (tweet.entities?.media && processedUrls.length > 0) {
      tweet.entities.media.forEach((media: any) => {
        if (media.media_url_https && urlIndex < processedUrls.length) {
          media.media_url_https = processedUrls[urlIndex++];
          media.media_url = processedUrls[urlIndex - 1];
        }
      });
    }
    
    // Update extended entities
    if (tweet.extended_entities?.media && processedUrls.length > 0) {
      tweet.extended_entities.media.forEach((media: any) => {
        if (media.media_url_https && urlIndex < processedUrls.length) {
          media.media_url_https = processedUrls[urlIndex++];
          media.media_url = processedUrls[urlIndex - 1];
        }
        
        // Update video variants
        if (media.video_info?.variants && urlIndex < processedUrls.length) {
          media.video_info.variants.forEach((variant: any) => {
            if (variant.url) {
              variant.url = processedUrls[urlIndex - 1];
            }
          });
        }
      });
    }
  }
}

// Export singleton instance
export const twitterAdapter = new TwitterAdapter();