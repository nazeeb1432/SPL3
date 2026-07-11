/**
 * Type definitions for DIY-MOD extension
 */

// Platform types
export type Platform = 'reddit' | 'twitter';

export interface Post {
  id: string;
  title?: string;
  body?: string;
  mediaUrls: string[];
  platform: Platform;
  metadata?: any;
}

export interface ProcessedPost {
  id: string;
  processedTitle?: string;
  processedBody?: string;
  processedMediaUrls: string[];
}

export interface PlatformAdapter {
  name: string;
  canHandle(url: string): boolean;
  extractPosts(responseData: string): Post[];
  updateResponseWithProcessedPosts(
    originalResponse: string, 
    processedPosts: ProcessedPost[]
  ): string;
}

export interface ImageProcessingSettings {
  enabled: boolean;
  maxPostsWithImages: number;
  maxImagesPerPost: number;
}

export interface Settings {
  enabled: boolean;
  blurHoverEffect: boolean;
  blurIntensity: number;
  overlayStyle: 'dark' | 'light';
  showOverlayBorder: boolean;
  overlayBorderWidth: number;
  overlayBorderColor: string;
  showRewriteBorder: boolean;
  rewriteBorderWidth: number;
  rewriteBorderColor: string;
  imageProcessing: ImageProcessingSettings;
}

export interface Filter {
  id: string;
  filter_text: string;
  content_type: 'text' | 'image' | 'all';
  intensity: number;
  user_id: string;
  is_temporary: boolean;
  expires_at?: string;
  created_at: string;
  duration?: string | number;
}

export interface InterceptorOptions {
  enabled: boolean;
  platforms: Platform[];
}

export interface AnalyticsEvent {
  eventType: string;
  timestamp: number;
  data: any;
  userId: string;
}

// State management types
export enum FilterState {
  INITIAL = 'initial',
  CLARIFYING = 'clarifying',
  FILTER_CONFIG = 'filter_config',
  CONTENT_TYPE = 'content_type',
  INTENSITY = 'intensity',
  DURATION = 'duration',
  COMPLETE = 'complete'
}

export interface FilterData {
  text: string;
  contentType: 'text' | 'image' | 'all';
  intensity: number;
  duration: string;
  context?: string;
  type?: string;
}

export interface StateChange {
  previousState: FilterState | null;
  currentState: FilterState;
  filterData: FilterData;
}

// Network interception types
export interface InterceptedRequest {
  id: string;
  url: string;
  type: string; 
  startTime: string;
  response: string;
}

// Server response types
export interface ServerResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
}

export interface FeedResponse {
  feed: {
    response: string;
  };
}

export interface LLMResponse {
  status: 'success' | 'error';
  message?: string;
  type: 'clarify' | 'content_type' | 'intensity' | 'duration' | 'complete' | 'ready_for_config' | 'initial';
  text: string;
  options?: string[];
  filter_data?: {
    filter_text: string;
    content_type?: string;
    intensity?: number;
    duration?: string;
    initial_type?: string;
    context?: string;
  };
}

// Extension message types
export interface ExtensionMessage {
  type: string;
  data?: any;
}

// Custom events
declare global {
  interface WindowEventMap {
    'SaveBatch': CustomEvent<InterceptedRequest>;
    'CustomFeedReady': CustomEvent<{
      id: string;
      url?: string;
      response: string;
    }>;
  }
}