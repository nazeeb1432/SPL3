/**
 * Logging configuration for DIY-MOD extension
 * Controls what gets logged to reduce console noise
 */

export interface LoggingConfig {
  // Global debug flag
  debug: boolean;
  
  // Specific logging categories
  websocket: {
    enabled: boolean;
    logMessages: boolean;
    logPings: boolean;
    truncateUrls: boolean;
  };
  
  api: {
    enabled: boolean;
    logRequests: boolean;
    logResponses: boolean;
    logImageResults: boolean;
  };
  
  dom: {
    enabled: boolean;
    logImageUpdates: boolean;
    logMarkerProcessing: boolean;
  };
}

// Default configuration - production settings
export const defaultLoggingConfig: LoggingConfig = {
  debug: false,
  
  websocket: {
    enabled: true,
    logMessages: false,  // Don't log full messages
    logPings: false,     // Don't log ping/pong
    truncateUrls: true
  },
  
  api: {
    enabled: true,
    logRequests: false,
    logResponses: false,
    logImageResults: false  // Don't log image processing results
  },
  
  dom: {
    enabled: true,
    logImageUpdates: false,
    logMarkerProcessing: false
  }
};

// Get current logging configuration
export function getLoggingConfig(): LoggingConfig {
  try {
    const stored = localStorage.getItem('diy_mod_logging_config');
    if (stored) {
      return { ...defaultLoggingConfig, ...JSON.parse(stored) };
    }
  } catch (e) {
    // Ignore errors, use defaults
  }
  
  return defaultLoggingConfig;
}

// Update logging configuration
export function setLoggingConfig(config: Partial<LoggingConfig>): void {
  try {
    const current = getLoggingConfig();
    const updated = { ...current, ...config };
    localStorage.setItem('diy_mod_logging_config', JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save logging config:', e);
  }
}

// Helper to enable debug logging
export function enableDebugLogging(): void {
  setLoggingConfig({
    debug: true,
    websocket: { ...defaultLoggingConfig.websocket, enabled: true, logMessages: true },
    api: { ...defaultLoggingConfig.api, enabled: true, logRequests: true, logResponses: true },
    dom: { ...defaultLoggingConfig.dom, enabled: true, logImageUpdates: true }
  });
  console.log('DIY-MOD: Debug logging enabled');
}

// Helper to disable verbose logging
export function disableVerboseLogging(): void {
  setLoggingConfig(defaultLoggingConfig);
  console.log('DIY-MOD: Verbose logging disabled');
}