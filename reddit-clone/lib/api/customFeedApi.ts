/**
 * API client for interacting with the DIY-MOD custom feed backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export interface SavedFeed {
  id: number;
  title: string;
  created_at: string;
  metadata?: {
    post_count?: number;
    interventions?: Record<string, number>;
    processing_time_ms?: number;
  };
}

export interface ComparisonSet {
  comparison_set_id: string;
  original_title: string;
  original_created_at: string;
  filtered_count: number;
  latest_filtered_at?: string;
}

export interface ComparisonSetFeed {
  id: number;
  user_id: string;
  title: string;
  feed_html: string;
  metadata?: Record<string, any>;
  comparison_set_id: string;
  feed_type: "original" | "filtered";
  filter_config?: Record<string, any>;
  created_at: string;
}

export interface FeedData {
  id: number;
  user_id: string;
  title: string;
  feed_html: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface ParsedFeedData {
  originalHtml: string;
  processedHtml: string;
  original?: any[];
  processed?: any[];
  metadata: Record<string, any>;
}

export interface UserInfo {
  id: string;
  email: string;
  created_at: string;
  is_new?: boolean;
}

class CustomFeedAPI {
  /**
   * Login with email address
   */
  async loginWithEmail(email: string): Promise<{ user: UserInfo; is_new: boolean } | null> {
    try {
      const response = await fetch(`${API_BASE}/auth/login-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      
      if (!response.ok) {
        throw new Error(`Login failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success') {
        return {
          user: result.user,
          is_new: result.is_new
        };
      }
      
      throw new Error(result.message || 'Login failed');
    } catch (error) {
      console.error('Error during login:', error);
      return null;
    }
  }

  /**
   * Get user info by user ID
   */
  async getUserInfo(userId: string): Promise<UserInfo | null> {
    try {
      const response = await fetch(`${API_BASE}/auth/user/${userId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get user info: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result.user;
    } catch (error) {
      console.error('Error getting user info:', error);
      return null;
    }
  }

  /**
   * List all available feeds for a user
   */
  async listFeeds(userId: string): Promise<SavedFeed[]> {
    try {
      const response = await fetch(`${API_BASE}/custom-feed/list/${userId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to list feeds: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result.data.feeds || [];
    } catch (error) {
      console.error('Error listing feeds:', error);
      return [];
    }
  }

  /**
   * Retrieve a specific feed by ID
   */
  async retrieveFeed(feedId: number): Promise<FeedData | null> {
    try {
      const response = await fetch(`${API_BASE}/custom-feed/retrieve/${feedId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to retrieve feed: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error retrieving feed:', error);
      return null;
    }
  }

  /**
   * Parse stored feed HTML to extract original and processed versions
   */
  parseStoredFeed(feedData: FeedData): ParsedFeedData {
    // Import the parser function from intervention-parser
    // This import is dynamic to avoid circular dependencies
    const { parseStoredFeed } = require('@/lib/intervention-parser');
    
    const parsed = parseStoredFeed(feedData.feed_html);
    console.log('Parsed feed data:', {
      originalCount: parsed.original.length,
      processedCount: parsed.processed.length,
      firstPost: parsed.original[0]
    });
    
    return {
      ...parsed,
      metadata: feedData.metadata || {}
    };
  }

  /**
   * Get the latest feed for a user
   */
  async getLatestFeed(userId: string): Promise<FeedData | null> {
    const feeds = await this.listFeeds(userId);
    
    if (feeds.length === 0) {
      return null;
    }
    
    // Sort by created_at descending and get the first one
    const sortedFeeds = feeds.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    return this.retrieveFeed(sortedFeeds[0].id);
  }

  /**
   * List all comparison sets for a user
   */
  async listComparisonSets(userId: string): Promise<ComparisonSet[]> {
    try {
      const response = await fetch(`${API_BASE}/custom-feed/comparison-sets/${userId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to list comparison sets: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result.data.comparison_sets || [];
    } catch (error) {
      console.error('Error listing comparison sets:', error);
      return [];
    }
  }

  /**
   * Get all feeds in a specific comparison set
   */
  async getComparisonSetFeeds(userId: string, comparisonSetId: string): Promise<{
    original: ComparisonSetFeed | null;
    filtered: ComparisonSetFeed[];
    all_feeds: ComparisonSetFeed[];
  }> {
    try {
      const response = await fetch(`${API_BASE}/custom-feed/comparison-set/${userId}/${comparisonSetId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get comparison set feeds: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error getting comparison set feeds:', error);
      return { original: null, filtered: [], all_feeds: [] };
    }
  }

  /**
   * Parse comparison set feed to extract posts (updated to handle both original and filtered)
   */
  parseComparisonSetFeed(feedData: ComparisonSetFeed): ParsedFeedData {
    // Import the parser function from intervention-parser
    const { parseStoredFeed } = require('@/lib/intervention-parser');
    
    const parsed = parseStoredFeed(feedData.feed_html);
    
    // For original feeds, we only want the original posts
    // For filtered feeds, we want the processed posts
    if (feedData.feed_type === 'original') {
      return {
        originalHtml: feedData.feed_html,
        processedHtml: feedData.feed_html, // Same as original
        original: parsed.original,
        processed: parsed.original, // Use original for both
        metadata: feedData.metadata || {}
      };
    } else {
      return {
        originalHtml: '', // We don't have original HTML in filtered feeds 
        processedHtml: feedData.feed_html,
        original: parsed.original, // Reconstructed original
        processed: parsed.processed,
        metadata: feedData.metadata || {}
      };
    }
  }
}

export const customFeedApi = new CustomFeedAPI();