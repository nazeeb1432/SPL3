/**
 * API Connector Module
 * 
 * Provides functionality for communicating with the backend API.
 */

import { logger } from '@/utils/logger';
import { apiService } from '@/shared/api/api-service';
import { config } from '@/shared/config';
import { InterceptedRequest, Platform } from '@/shared/types';

/**
 * Test the API connection to verify server communication
 */
export async function testApiConnection(): Promise<void> {
  try {
    const response = await apiService.testConnection();
    
    if (response.status === 'success') {
      logger.content.info('Backend API connection successful');
    } else {
      logger.content.warn(`Backend API connection failed: ${response.message}`);
    }
  } catch (error) {
    logger.content.error('Backend API connection error:', error);
    console.error('DIY-MOD: Error connecting to backend server:', error);
    console.error(`DIY-MOD: Please verify that the server is running at ${config.api.baseUrl}`);
  }
}

/**
 * Process an intercepted request through the API
 */
export async function processInterceptedRequest(data: InterceptedRequest, platform: Platform): Promise<any> {
  try {
    // Using the API service for consistent request formatting
    logger.content.debug(`Processing feed for ${platform}`);
    
    // Add timing information for debugging
    const startTime = performance.now();
    
    const result = await apiService.processFeed(
      data.url,
      config.userId || 'unknown',
      platform,
      data.response
    );
    
    // Calculate processing time
    const processingTime = (performance.now() - startTime).toFixed(1);
    logger.content.info(`Server processed response in ${processingTime}ms`);
    
    return result;
  } catch (error) {
    logger.content.error('Error processing content through server:', error);
    throw error;
  }
}

/**
 * Process multiple feed items in parallel using the batching client
 */
export async function batchProcessFeed(data: InterceptedRequest, platform: Platform): Promise<any> {
  try {
    // Use API service's process endpoint but in batch mode
    return await apiService.processFeed(
      data.url,
      config.userId || 'unknown',
      platform,
      data.response,
      { useBatching: true }
    );
  } catch (error) {
    logger.content.error('Error in batch processing:', error);
    // Fall back to regular processing
    return await processInterceptedRequest(data, platform);
  }
} 