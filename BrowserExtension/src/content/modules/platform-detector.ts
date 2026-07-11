/**
 * Platform Detection Module
 * 
 * Provides utility functions for detecting the current platform based on URL.
 */

import { Platform } from '@/shared/types';
import { logger } from '@/utils/logger';

/**
 * Determine the current platform based on URL
 * @returns The detected platform or null if not recognized
 */
export function getCurrentPlatform(): Platform | null {
  const url = window.location.href;
  
  logger.content.debug(`Detecting platform for URL: ${url}`);
  
  if (url.includes('twitter.com') || url.includes('x.com')) {
    return 'twitter';
  } else if (url.includes('reddit.com')) {
    return 'reddit';
  }
  
  logger.content.debug('No recognized platform detected');
  return null;
} 