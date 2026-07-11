/**
 * Utility functions for safe and concise logging
 */

/**
 * Safely log a URL by truncating long URLs and base64 data
 * @param url The URL to log
 * @param maxLength Maximum length before truncation (default: 80)
 * @returns A safe, truncated version of the URL for logging
 */
export function safeUrlLog(url: any, maxLength: number = 80): string {
  if (!url) return 'null';
  
  const urlStr = typeof url === 'string' ? url : String(url);
  
  // Handle base64 data URLs specially
  if (urlStr.startsWith('data:')) {
    const semicolonIndex = urlStr.indexOf(';');
    const commaIndex = urlStr.indexOf(',');
    if (semicolonIndex > -1 && commaIndex > -1) {
      const mimeType = urlStr.substring(5, semicolonIndex);
      const encoding = urlStr.substring(semicolonIndex + 1, commaIndex);
      const dataLength = urlStr.length - commaIndex - 1;
      return `data:${mimeType};${encoding},[${Math.round(dataLength / 1024)}KB data]`;
    }
  }
  
  // Handle localhost URLs with base64 parameters
  if (urlStr.includes('localhost:8001') && urlStr.length > maxLength) {
    const baseUrl = urlStr.split('?')[0];
    return `${baseUrl}?[params truncated]`;
  }
  
  // For regular URLs, truncate if too long
  if (urlStr.length > maxLength) {
    return urlStr.substring(0, maxLength) + '...';
  }
  
  return urlStr;
}

/**
 * Safely log an object that might contain URLs or base64 data
 * @param obj The object to log
 * @returns A safe version of the object for logging
 */
export function safeObjectLog(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const safe: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'base64' && typeof value === 'string' && value.startsWith('data:')) {
      safe[key] = safeUrlLog(value);
    } else if (key === 'url' || key === 'image_url' || key === 'result') {
      safe[key] = safeUrlLog(value);
    } else if (typeof value === 'object' && value !== null) {
      safe[key] = safeObjectLog(value);
    } else {
      safe[key] = value;
    }
  }
  
  return safe;
}

/**
 * Check if debug logging is enabled
 * @returns true if debug logging should be shown
 */
export function isDebugLoggingEnabled(): boolean {
  // Check localStorage for debug flag
  try {
    return localStorage.getItem('diy_mod_debug') === 'true';
  } catch {
    return false;
  }
}

/**
 * Log only if debug mode is enabled
 * @param message The message to log
 * @param data Optional data to log
 */
export function debugLog(message: string, ...data: any[]): void {
  if (isDebugLoggingEnabled()) {
    console.log(message, ...data.map(d => safeObjectLog(d)));
  }
}