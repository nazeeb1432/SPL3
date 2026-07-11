/**
 * Logging utilities for DIY-MOD extension
 * Provides safe logging functions that prevent verbose output
 */

import { config } from '@/shared/config';

/**
 * Safely log a URL by truncating long URLs and base64 data
 * @param url The URL to log
 * @param maxLength Maximum length before truncation (default: 100)
 * @returns A safe string representation of the URL
 */
export function safeUrlLog(url: string | undefined | null, maxLength: number = 100): string {
  if (!url) return 'undefined';
  
  // Handle base64 data URLs
  if (typeof url === 'string' && url.startsWith('data:')) {
    const mimeMatch = url.match(/^data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';
    const sizeKB = Math.round(url.length / 1024);
    return `base64 ${mimeType} (${sizeKB}KB)`;
  }
  
  // Handle localhost URLs
  if (typeof url === 'string' && (url.includes('localhost:') || url.includes('127.0.0.1:'))) {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  }
  
  // Truncate long URLs
  if (typeof url === 'string' && url.length > maxLength) {
    try {
      return url.substring(0, maxLength) + '...';
    } catch (e) {
      return String(url);
    }
  }
  
  return url;
}

/**
 * Check if debug logging is enabled
 * @returns true if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  try {
    return config?.logging?.level === 'debug';
  } catch (e) {
    // If config is not available, default to false
    return false;
  }
}

/**
 * Log a debug message only if debug mode is enabled
 * @param message The message to log
 * @param args Additional arguments to log
 */
export function debugLog(message: string, ...args: any[]): void {
  if (isDebugEnabled()) {
    console.log(message, ...args);
  }
}

/**
 * Log an info message with a prefix
 * @param prefix The prefix for the log message
 * @param message The message to log
 * @param args Additional arguments to log
 */
export function logInfo(prefix: string, message: string, ...args: any[]): void {
  console.log(`[${prefix}] ${message}`, ...args);
}

/**
 * Log an error message with a prefix
 * @param prefix The prefix for the log message
 * @param message The message to log
 * @param error The error object or message
 */
export function logError(prefix: string, message: string, error?: any): void {
  if (error) {
    console.error(`[${prefix}] ${message}`, error);
  } else {
    console.error(`[${prefix}] ${message}`);
  }
}