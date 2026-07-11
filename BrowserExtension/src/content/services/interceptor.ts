/**
 * Request interceptor service
 * Intercepts network requests to process content before it's displayed
 */

import { apiService } from '@/shared/api/api-service';
import { config } from '@/shared/config';
import { logger } from '@/utils/logger';
import { Platform } from '@/shared/types';
import { redditAdapter } from '../platforms/reddit';
import { twitterAdapter } from '../platforms/twitter';

class RequestInterceptor {
  private initialized = false;
  private platformAdapters = new Map();

  constructor() {
    // Register platform adapters
    this.platformAdapters.set('reddit', redditAdapter);
    this.platformAdapters.set('twitter', twitterAdapter);
  }

  /**
   * Start the interceptor
   */
  public start(): void {
    if (this.initialized) return;
    
    logger.content.info('Starting request interceptor');
    
    // Set up the fetch interceptor
    this.setupFetchInterceptor();
    
    // Set up XHR interceptor
    this.setupXHRInterceptor();
    
    this.initialized = true;
  }

  /**
   * Determine if a URL should be intercepted
   */
  private shouldInterceptUrl(url: string): boolean {
    // Check if URL matches any of the interceptor patterns
    for (const [platform, adapter] of this.platformAdapters.entries()) {
      if (adapter.canHandle(url)) {
        const patterns = config.platforms[platform as Platform]?.interceptPatterns || [];
        
        for (const pattern of patterns) {
          // Convert glob pattern to regex
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
          
          if (new RegExp(regexPattern).test(url)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Get the appropriate adapter for a URL
   */
  private getAdapterForUrl(url: string): any {
    for (const [_, adapter] of this.platformAdapters.entries()) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Set up fetch interceptor
   */
  private setupFetchInterceptor(): void {
    // Store original fetch
    const originalFetch = window.fetch;
    
    // Override fetch
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      
      // Only intercept URLs we care about
      if (!this.shouldInterceptUrl(url)) {
        return originalFetch(input, init);
      }
      
      try {
        // Call the original fetch
        const response = await originalFetch(input, init);
        
        // Clone the response so we can read it multiple times
        const responseClone = response.clone();
        
        // Get text content
        const responseText = await responseClone.text();
        
        // Get adapter for this URL
        const adapter = this.getAdapterForUrl(url);
        if (!adapter) {
          logger.content.warn('No adapter found for URL:', url);
          return response;
        }
        
        // Extract posts from the response
        const posts = adapter.extractPosts(responseText);
        if (!posts || posts.length === 0) {
          logger.content.debug('No posts extracted from response');
          return response;
        }
        
        // Process posts through standard API
        // Note: In the future, we can use the batching client when the server
        // supports batch processing of posts
        const processedPosts = await apiService.processContent(posts);
        
        if (!processedPosts || processedPosts.length === 0) {
          logger.content.debug('No processed posts returned from API');
          return response;
        }
        
        // Update response with processed posts
        const updatedResponse = adapter.updateResponseWithProcessedPosts(
          responseText, 
          processedPosts
        );
        
        // Create a new response object with the updated content
        return new Response(updatedResponse, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (error) {
        logger.content.error('Error in fetch interceptor:', error);
        return originalFetch(input, init);
      }
    };
  }

  /**
   * Set up XMLHttpRequest interceptor
   */
  private setupXHRInterceptor(): void {
    // Store original open and send methods
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    // Store interceptor methods for XHR context
    const shouldInterceptUrl = this.shouldInterceptUrl.bind(this);
    const getAdapterForUrl = this.getAdapterForUrl.bind(this);
    
    // Override open method to store the URL
    XMLHttpRequest.prototype.open = function(
      this: XMLHttpRequest & { __url?: string },
      method: string,
      url: string,
      ...args: any[]
    ) {
      this.__url = url;
      return originalOpen.apply(this, [method, url, ...args] as any);
    };
    
    // Override send method to intercept the response
    XMLHttpRequest.prototype.send = function(
      this: XMLHttpRequest & { __url?: string, __originalOnReadyStateChange?: any }
    ) {
      if (!this.__url || !this.__url.toString || !shouldInterceptUrl(this.__url.toString())) {
        return originalSend.apply(this, arguments as any);
      }
      
      // Store original onreadystatechange
      this.__originalOnReadyStateChange = this.onreadystatechange;
      
      // Override onreadystatechange
      this.onreadystatechange = async function(this: XMLHttpRequest & { __url?: string, __originalOnReadyStateChange?: any }) {
        if (this.readyState !== 4) {
          // Not done yet, call original
          if (this.__originalOnReadyStateChange) {
            this.__originalOnReadyStateChange.apply(this);
          }
          return;
        }
        
        try {
          // Get adapter for this URL
          const adapter = getAdapterForUrl(this.__url || '');
          if (!adapter) {
            logger.content.warn('No adapter found for URL:', this.__url);
            if (this.__originalOnReadyStateChange) {
              this.__originalOnReadyStateChange.apply(this);
            }
            return;
          }
          
          // Extract posts from the response
          const posts = adapter.extractPosts(this.responseText);
          if (!posts || posts.length === 0) {
            logger.content.debug('No posts extracted from XHR response');
            if (this.__originalOnReadyStateChange) {
              this.__originalOnReadyStateChange.apply(this);
            }
            return;
          }
          
          // Process posts through our API
          const processedPosts = await apiService.processContent(posts);
          if (!processedPosts || processedPosts.length === 0) {
            logger.content.debug('No processed posts returned from API');
            if (this.__originalOnReadyStateChange) {
              this.__originalOnReadyStateChange.apply(this);
            }
            return;
          }
          
          // Update response text with processed posts
          Object.defineProperty(this, 'responseText', {
            get: () => adapter.updateResponseWithProcessedPosts(
              this.responseText, 
              processedPosts
            )
          });
          
        } catch (error) {
          logger.content.error('Error in XHR interceptor:', error);
        }
        
        // Call original onreadystatechange
        if (this.__originalOnReadyStateChange) {
          this.__originalOnReadyStateChange.apply(this);
        }
      }.bind(this);
      
      return originalSend.apply(this, arguments as any);
    };
  }
}

// Export singleton instance
export const requestInterceptor = new RequestInterceptor();