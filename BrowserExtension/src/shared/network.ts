/**
 * Network communication module for DIY-MOD extension
 * 
 * Handles all server communications with proper formatting for each endpoint
 */

import { logger } from '../utils/logger';
import { config } from './config';

/**
 * Send a request to the server with proper formatting
 * This is a critical function that ensures data is formatted exactly as expected
 */
export async function sendServerRequest(endpoint: string, data: any): Promise<any> {
  try {
    const url = `${config.api.baseUrl}${endpoint}`;
    
    // Log request details at debug level
    logger.content.debug(`Sending request to ${url}`, data);
    
    // Add detailed console logs for debugging
    console.log(`DIY-MOD: Sending request to ${url}`, {
      endpoint,
      dataType: typeof data,
      dataKeys: data ? Object.keys(data) : 'null'
    });
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Version': config.version
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
      credentials: 'omit'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DIY-MOD: Server error (${response.status}):`, errorText);
      throw new Error(`Server returned status ${response.status}: ${response.statusText}`);
    }
    
    const jsonData = await response.json();
    return jsonData;
  } catch (error) {
    console.error('DIY-MOD: Network error:', error);
    throw error;
  }
}

/**
 * Makes a standardized request body following the original implementation format
 */
export function makeRequestBody(params: any, userId: string): any {
  return {
    tab_id: chrome.runtime.id, // Using runtime ID as tab ID
    user_id: userId,
    url: window.location ? window.location.href : '',
    extension_version: config.version,
    data: JSON.stringify(params)
  };
}

/**
 * Sends a feed to the server for processing
 * Formats the request correctly per server requirements
 */
export async function processFeed(url: string, userId: string, platform: string, responseData: string): Promise<any> {
  try {
    // Format response data properly based on platform
    let formattedResponse = responseData;
    
    // For Twitter feeds, ensure response is valid JSON as a string
    if (platform === 'twitter') {
      try {
        if (typeof responseData === 'string') {
          // Validate it's actually JSON by parsing and re-stringifying
          // This ensures proper JSON format for Twitter data
          const parsed = JSON.parse(responseData);
          formattedResponse = JSON.stringify(parsed);
        } else {
          // If it's already an object, stringify it
          formattedResponse = JSON.stringify(responseData);
        }
      } catch (e) {
        // If it's not valid JSON, wrap it in an object
        console.warn('DIY-MOD: Twitter data is not valid JSON, wrapping it');
        formattedResponse = JSON.stringify({ html: responseData });
      }
    }
    
    // Build the payload using the standardized format
    const params = {
      feed_info: {
        response: formattedResponse
      }
    };
    
    // Create standardized request body
    const payload = makeRequestBody(params, userId);
    payload.url = url; // Override with specific URL
    
    // Log the critical parts of the request
    console.log('DIY-MOD: Sending feed for processing', {
      platform,
      url,
      payloadStructure: Object.keys(payload),
      responseType: typeof formattedResponse,
      responseLength: formattedResponse.length
    });
    
    // Send the request to the server
    const result = await sendServerRequest('/get_feed', payload);
    return result;
  } catch (error) {
    console.error('DIY-MOD: Error processing feed:', error);
    throw error;
  }
}

/**
 * Log events to the server
 * Directly matches the original implementation's logEvent function
 */
export async function logEvent(eventType: string, params: any = {}, userId: string): Promise<void> {
  try {
    params['event_type'] = eventType;
    
    // Log at debug level
    logger.api.debug(`Logging event: ${eventType}`, params);
    
    // Create standardized request body
    const payload = makeRequestBody(params, userId);
    
    // Send the request to the server
    await sendServerRequest('/event', payload);
  } catch (error) {
    console.error('DIY-MOD: Error logging event:', error);
    // Don't propagate error for logging - just log it
  }
}

/**
 * Test the server connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${config.api.baseUrl}/ping`);
    return response.ok;
  } catch (error) {
    console.error('DIY-MOD: Server connection test failed:', error);
    return false;
  }
}

/**
 * Get user filters from the server
 */
export async function getUserFilters(userId: string): Promise<any> {
  try {
    const url = `${config.api.baseUrl}/filters?user_id=${userId}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch filters: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to fetch filters');
    }
    
    return data.filters;
  } catch (error) {
    console.error('DIY-MOD: Error fetching user filters:', error);
    throw error;
  }
}

/**
 * Update user filter on the server
 */
export async function updateFilter(filter: any, userId: string): Promise<any> {
  try {
    const url = `${config.api.baseUrl}/filters`;
    const payload = {
      user_id: userId,
      filter: filter
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update filter: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('DIY-MOD: Error updating filter:', error);
    throw error;
  }
}

/**
 * Delete user filter from the server
 */
export async function deleteFilter(filterId: string, userId: string): Promise<any> {
  try {
    const url = `${config.api.baseUrl}/filters/${filterId}?user_id=${userId}`;
    const response = await fetch(url, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete filter: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('DIY-MOD: Error deleting filter:', error);
    throw error;
  }
}