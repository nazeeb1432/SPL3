import { MARKERS, CSS_CLASSES } from '../shared/constants';
import { DIY_IMG_ATTR } from '../shared/constants';
import { config } from '../shared/config';
import { safeUrlLog, debugLog, logError } from './logging';
import { safeUrlLog as safeUrl } from './logging-utils';
// Removed apiService import - will use message passing instead
// Destructure for cleaner code
const { BLUR_START, BLUR_END, OVERLAY_START, OVERLAY_END, REWRITE_START, REWRITE_END } = MARKERS;


/**
 * Type definitions for marker processor functions
 */
export type MarkerProcessor = (content: string) => string;
export type MarkerDetector = (content: string) => boolean;
export type ImageMarkerProcessor = (url: string) => string;
export type ImageMarkerDetector = (url: string) => boolean;

/**
 * Interface for registering text marker handlers
 */
export interface MarkerHandler {
  name: string;
  startMarker: string;
  endMarker: string;
  detect: MarkerDetector;
  process: MarkerProcessor;
}

/**
 * Interface for registering image marker handlers
 */
export interface ImageMarkerHandler {
  name: string;
  marker: string;
  detect: ImageMarkerDetector;
  process: ImageMarkerProcessor;
}

/**
 * Interface for tracking deferred image processing
 */
interface DeferredImageProcessing {
  imageElement: HTMLImageElement;
  originalUrl: string;
  filters: string[];
  config: any;
  pollCount: number;
  maxPolls: number;
}

/**
 * Registry of all marker handlers
 */
const markerHandlers: MarkerHandler[] = [];

/**
 * Registry of all image marker handlers
 */
const imageMarkerHandlers: ImageMarkerHandler[] = [];

/**
 * Tracking for deferred image processing
 */
const deferredImages: Map<string, DeferredImageProcessing> = new Map();

/**
 * Register a new marker handler
 * @param handler The marker handler to register
 */
export function registerMarkerHandler(handler: MarkerHandler): void {
  markerHandlers.push(handler);
  // console.log(`DIY-MOD: Registered marker handler for ${handler.name}`);
}

/**
 * Register a new image marker handler
 * @param handler The image marker handler to register
 */
export function registerImageMarkerHandler(handler: ImageMarkerHandler): void {
  imageMarkerHandlers.push(handler);
  debugLog(`DIY-MOD: Registered image marker handler for ${handler.name}`);
}

/**
 * Process text with special markers to apply visual effects
 * @param text Text containing special markers
 * @returns HTML with appropriate styling applied
 */
export function processMarkedText(text: string): string {
  if (!text) return '';
  
  // Check if there are any markers in the text before processing
  if (!hasAnyMarkers(text)) return text;
  
  let result = text;
  
  // Apply all registered handlers
  for (const handler of markerHandlers) {
    if (handler.detect(result)) {
      result = handler.process(result);
    }
  }
  
  return result;
}

/**
 * Check if text contains any known markers
 */
export function hasAnyMarkers(text: string): boolean {
  if (!text) return false;
  
  // Check if any registered handler detects markers
  return markerHandlers.some(handler => handler.detect(text));
}

/**
 * Check if URL contains any known image markers
 */
export function hasAnyImageMarkers(url: string): boolean {
  if (!url) return false;
  
  // Check if any registered handler detects markers
  return imageMarkerHandlers.some(handler => handler.detect(url));
}

/**
 * Process blur effect markers
 */
export function processBlurMarkers(text: string): string {
  if (!text.includes(BLUR_START)) return text;
  
  // Pattern: __BLUR_START__content__BLUR_END__
  // Using [\s\S]*? for non-greedy multiline matching
  const blurRegex = new RegExp(`${BLUR_START}([\\s\\S]*?)${BLUR_END}`, 'g');
  
  return text.replace(blurRegex, (_match, content) => {
    console.log("DIY-MOD: Processing blur marker in utility");
    return `<span class="${CSS_CLASSES.BLUR}">${content}</span>`;
  });
}

/**
 * Process overlay effect markers
 */
export function processOverlayMarkers(text: string): string {
  if (!text.includes(OVERLAY_START)) return text;
  
  // Pattern: __OVERLAY_START__warning|content__OVERLAY_END__
  const overlayRegex = new RegExp(`${OVERLAY_START}(.*?)\\|([\\s\\S]*?)${OVERLAY_END}`, 'g');
  
  return text.replace(overlayRegex, (_match, warning, content) => {
    const warningText = warning.trim() || 'Content filtered';
    console.log(`DIY-MOD: Processing overlay marker with warning: ${warningText}`);
    
    // Create overlay with improved containment
    const overlayElement = `<div class="${CSS_CLASSES.CONTENT_OVERLAY} ${CSS_CLASSES.OVERLAY} ${CSS_CLASSES.HIDDEN} diymod-scroll-aware" data-warning="${warningText}" onclick="this.classList.toggle('${CSS_CLASSES.HIDDEN}')">
      <div class="content">${content}</div>
      <div class="warning">${warningText}</div>
    </div>`;
    
    return overlayElement;
  });
}

/**
 * Process rewrite effect markers
 */
export function processRewriteMarkers(text: string): string {
  if (!text.includes(REWRITE_START)) return text;
  
  // Pattern: __REWRITE_START__content__REWRITE_END__
  const rewriteRegex = new RegExp(`${REWRITE_START}([\\s\\S]*?)${REWRITE_END}`, 'g');
  
  return text.replace(rewriteRegex, (_match, content) => {
    console.log("DIY-MOD: Processing rewrite marker in utility");
    return `<div class="${CSS_CLASSES.REWRITTEN}">
      ${content}
      <div class="modification-indicator">Modified by DIY-MOD</div>
    </div>`;
  });
}




/**
 * Process image element with intervention configuration
 * @param imgElement The HTML image element to process
 * @param config The intervention configuration from DIY_IMG_ATTR
 */
// Global set to track processed images by their src URL to prevent reprocessing
const processedImageSrcs = new Set<string>();

export function processMarkedImage(imgElement: HTMLImageElement): void {
  if (!imgElement) return;

  const config=imgElement.getAttribute(DIY_IMG_ATTR);
  if (!config) return;
  
  // More robust deduplication using image src
  const imageSrc = imgElement.src;
  const imageKey = `${imageSrc}-${imgElement.className}`;
  
  // Skip if already processed to prevent infinite loops
  if (imgElement.hasAttribute('data-diy-mod-processed') || processedImageSrcs.has(imageKey)) {
    console.log(`DIY-MOD: Image already processed (${imageSrc.substring(0, 50)}...), skipping to prevent infinite loop`);
    return;
  }
  
  // Mark as processing immediately
  processedImageSrcs.add(imageKey);
  console.log(`DIY-MOD: Processing new image: ${imageSrc.substring(0, 50)}...`);
  // console.log("DIY-MOD: Processing image with config:", config);
  
  // Parse the configuration and determine which intervention to apply
  try {
    const configData = JSON.parse(config);
    // console.log("DIY-MOD: Parsed image intervention config:", configData);
    // Apply the appropriate handler based on the intervention type
    if (configData.type === 'overlay') {
      processOverlayImageMarker(imgElement, configData);
    } else if (configData.type === 'blur') {
      processBlurImageMarkers(imgElement, configData);
    } else if (configData.type === 'processed') {
      processStandardImageMarker(imgElement, configData);
    } else if (configData.type === 'cartoonish' || configData.type === 'edit_to_replace') {
      // Handle cartoonish image processing
      processCartoonishImageMarker(imgElement, configData);
    } else {
      console.warn("DIY-MOD: Unknown image intervention type:", configData.type);
    }
    
    // Only remove the attribute for non-deferred processing
    // For deferred processing we'll remove it when complete
    if (configData.type !== 'cartoonish' || 
        (configData.type === 'cartoonish' && configData.status !== 'DEFERRED')) {
      // Remove the attribute after successfully processing to prevent reprocessing in future scans
      imgElement.removeAttribute(DIY_IMG_ATTR);
      
      // Add a data attribute to indicate this image has been processed
      imgElement.setAttribute('data-diy-mod-processed', 'true');
    }
    
  } catch (error) {
    console.error("DIY-MOD: Failed to parse image intervention config:", error);
  }
}




/**
 * Process standard image marker
 * @param imgElement The HTML image element to process
 * @param config The configuration containing processed image data
 */
export function processStandardImageMarker(imgElement: HTMLImageElement, config: any): void {
  if (!imgElement || !config) return;
  
  // Check if we have a URL to replace the image source with
  if (config.processed_image_url) {
    debugLog("DIY-MOD: Processing standard image marker with URL:", safeUrl(config.processed_image_url));
    imgElement.src = config.processed_image_url;
    
    // Add a class to indicate this image has been processed
    imgElement.classList.add("diymod-processed-image");
    
    // Add visual indicator for modification
    addImageModificationIndicator(imgElement);
    
    // Add any additional attributes if needed
    if (config.alt) {
      imgElement.alt = config.alt;
    }
  }
}

export function processBlurImageMarkers(imgElement: HTMLImageElement, config: any): void {
  if (!imgElement || !config || !config.coordinates || !Array.isArray(config.coordinates)) return;
  
  // Skip if already processed to prevent infinite loops
  if (imgElement.classList.contains('diymod-blur-processed')) {
    console.log('DIY-MOD: Blur already processed for this image, skipping');
    return;
  }
  
  try {
    // Process each set of coordinates in the configuration
    console.log(`DIY-MOD: Processing blur image marker with ${config.coordinates.length} boxes`);
    
    // Loop through each box coordinate and apply overlays
    config.coordinates.forEach((box: { x1: number, y1: number, x2: number, y2: number }, index: number) => {
      // Extract coordinates from this box
      const { x1, y1, x2, y2 } = box;
      
      // Calculate dimensions
      let left = x1;
      let top = y1; // Use y1 for top position
      let width = (Number(x2) - Number(x1)).toString();
      let height = (Number(y2) - Number(y1)).toString();
      
      console.log(`DIY-MOD: Processing box ${index}: left=${left}, top=${top}, width=${width}, height=${height}`);
      
      // Use the existing applyOverlayToImage function to apply the overlay
      // We convert the coordinates to a string format that the function expects
      const blurInfo = [left, top, width, height].join('_');
      applyBlurToImage(imgElement, blurInfo);
    });
    
    // Add a class to indicate this image has been processed with an overlay
    imgElement.classList.add("diymod-blur-processed");
    
    // Add visual indicator for modification
    addImageModificationIndicator(imgElement);
  }
 catch (error) {
    console.error("DIY-MOD: Error processing blur image marker:", error);
  }
}

/**
 * Process overlay image marker using the configuration
 * @param imgElement The HTML image element to process
 * @param config The configuration containing overlay coordinates
 */
export function processOverlayImageMarker(imgElement: HTMLImageElement, config: any): void {
  if (!imgElement || !config || !config.coordinates || !Array.isArray(config.coordinates)) return;
  
  // Skip if already processed to prevent infinite loops
  if (imgElement.classList.contains('diymod-overlay-processed')) {
    console.log('DIY-MOD: Overlay already processed for this image, skipping');
    return;
  }
  
  try {
    // Process each set of coordinates in the configuration
    console.log(`DIY-MOD: Processing overlay image marker with ${config.coordinates.length} boxes`);
    
    // Loop through each box coordinate and apply overlays
    config.coordinates.forEach((box: { x1: number, y1: number, x2: number, y2: number }, index: number) => {
      // Extract coordinates from this box
      const { x1, y1, x2, y2 } = box;
      
      // Calculate dimensions
      let left = x1;
      let top = y1; // Use y1 for top position
      let width = (Number(x2) - Number(x1)).toString();
      let height = (Number(y2) - Number(y1)).toString();
      
      console.log(`DIY-MOD: Processing box ${index}: left=${left}, top=${top}, width=${width}, height=${height}`);
      
      // Use the existing applyOverlayToImage function to apply the overlay
      // We convert the coordinates to a string format that the function expects
      const overlayInfo = [left, top, width, height].join('_');
      applyOverlayToImage(imgElement, overlayInfo);
    });
    
    // Add a class to indicate this image has been processed with an overlay
    imgElement.classList.add("diymod-overlay-processed");
    
    // Add visual indicator for modification
    addImageModificationIndicator(imgElement);
  }
 catch (error) {
    console.error("DIY-MOD: Error processing overlay image marker:", error);
  }
}

/**
 * Apply overlay to an image element directly in the DOM
 * This is called by the DOM processor after the image is in the DOM
 */
export function applyOverlayToImage(img: HTMLImageElement, overlayInfo: string): void {
  try {
    // Parse overlay information
    const [left, top, width, height] = overlayInfo.split('_').map(Number);
    const overlayUrl = "https://tinypng.com/images/social/website.jpg"; // Static overlay image
    
    // Wrap the image in a container if it's not already wrapped in one with the expected class
    let container;
    if (img.parentElement && img.parentElement.classList.contains("diymod-image-container")) {
      container = img.parentElement;
    } else {
      container = document.createElement("div");
      container.className = "diymod-image-container";
      container.style.display = "inline-block";
      container.style.position = "relative";
      
      // Insert the container before the image and move the image inside of it
      if (img.parentNode) {
        img.parentNode.insertBefore(container, img);
        container.appendChild(img);
      }
    }
    
    // Check if we already have an overlay with the same parameters
    const existingOverlay = Array.from(container.querySelectorAll('img')).find(overlay => 
      overlay !== img && 
      overlay.style.left === `${left}px` && 
      overlay.style.top === `${top}px` && 
      overlay.style.width === `${width}px` && 
      overlay.style.height === `${height}px`
    );
    
    // Only create a new overlay if we don't have one with the same parameters
    if (!existingOverlay) {
      // Create an overlay element
      const overlay = document.createElement("img");
      overlay.src = overlayUrl;
      overlay.style.position = "absolute";
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.pointerEvents = "none";  // Allow clicks to pass through if needed
      overlay.classList.add("diymod-overlay-image");
      
      // Append the overlay element to the container
      container.appendChild(overlay);
      
      console.log(`DIY-MOD: Overlay applied on image`);
    }
  } catch (error) {
    console.error('DIY-MOD: Error applying overlay to image:', error);
  }
}

/**
 * Process cartoonish image marker with deferred processing
 * @param imgElement The HTML image element to process
 * @param config The configuration containing processing status and filters
 */
export function processCartoonishImageMarker(imgElement: HTMLImageElement, config: any): void {
  if (!imgElement || !config) return;
  
  try {
    console.log("DIY-MOD: Processing cartoonish image marker:", config.type);
    
    // Check the status of the cartoonish image processing
    if (config.status === "DEFERRED") {
      // Show a loading state for the image
      showImageLoadingState(imgElement);
      
      // Start polling for the completed image
      const originalUrl = imgElement.src;
      // Use filters from config which contains the actual filter array from backend
      const filters = config.filters || [];
      
      // console.log("DIY-MOD: Starting image polling with filters:", filters);

      startImagePolling(imgElement, originalUrl, filters, config);
    } else if (config.status === "COMPLETED" && config.processedUrl) {
      // If the process is already completed, just set the image
      imgElement.src = config.processedUrl;
      imgElement.classList.add("diymod-cartoonish-processed");
      
      // Add visual indicator for modification
      addImageModificationIndicator(imgElement);
      
      // Remove any loading indicators
      removeImageLoadingState(imgElement);
    }
  } catch (error) {
    console.error("DIY-MOD: Error processing cartoonish image marker:", error);
    removeImageLoadingState(imgElement);
  }
}

/**
 * Show a loading state on an image while it's being processed
 * @param imgElement The image element to show loading state for
 */
function showImageLoadingState(imgElement: HTMLImageElement): void {
  // Create a container for the image if it doesn't exist
  let container = imgElement.parentElement;
  if (!container || !container.classList.contains("diymod-image-container")) {
    container = document.createElement("div");
    container.className = "diymod-image-container";
    container.style.display = "inline-block";
    container.style.position = "relative";
    
    // Insert the container before the image and move the image inside of it
    if (imgElement.parentNode) {
      imgElement.parentNode.insertBefore(container, imgElement);
      container.appendChild(imgElement);
    }
  }
  
  // Add processing class to the image
  imgElement.classList.add(CSS_CLASSES.PROCESSING);
  
  // Add a loading indicator
  const loadingIndicator = document.createElement("div");
  loadingIndicator.className = "diymod-loading-indicator";
  loadingIndicator.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">Transforming image...</div>
  `;
  loadingIndicator.style.position = "absolute";
  loadingIndicator.style.top = "0";
  loadingIndicator.style.left = "0";
  loadingIndicator.style.width = "100%";
  loadingIndicator.style.height = "100%";
  loadingIndicator.style.display = "flex";
  loadingIndicator.style.flexDirection = "column";
  loadingIndicator.style.alignItems = "center";
  loadingIndicator.style.justifyContent = "center";
  loadingIndicator.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
  loadingIndicator.style.color = "white";
  loadingIndicator.style.zIndex = "1000";
  
  container.appendChild(loadingIndicator);
}

/**
 * Remove the loading state from an image
 * @param imgElement The image element to remove loading state from
 */
function removeImageLoadingState(imgElement: HTMLImageElement): void {
  // Remove the processing class
  imgElement.classList.remove(CSS_CLASSES.PROCESSING);
  
  // Remove the loading indicator if it exists
  const container = imgElement.parentElement;
  if (container) {
    const loadingIndicator = container.querySelector(".diymod-loading-indicator");
    if (loadingIndicator) {
      container.removeChild(loadingIndicator);
    }
  }
}

/**
 * Update a Reddit image element with the processed URL
 * Handles Reddit's complex image structure including srcset, lazy loading, etc.
 * @param imgElement The image element to update
 * @param processedUrl The new processed image URL
 */
async function updateRedditImage(imgElement: HTMLImageElement, processedUrl: string): Promise<void> {
  debugLog(`[DIY-MOD Markers] Updating Reddit image`);
  
  // Type guard to ensure processedUrl is a string
  if (typeof processedUrl !== 'string') {
    console.error(`[DIY-MOD Markers] Invalid processedUrl type:`, typeof processedUrl);
    return;
  }
  
  // Store original attributes for debugging
  const originalSrc = imgElement.src;
  
  // Use the URL directly - if it's a base64 data URL, it will work without CSP issues
  let finalUrl = processedUrl;
  
  // Check if this is already a base64 data URL
  if (processedUrl.startsWith('data:image/')) {
    debugLog(`[DIY-MOD Markers] Using base64 data URL`);
  } else if (processedUrl.includes('localhost:8001') || processedUrl.includes('127.0.0.1:8001')) {
    debugLog(`[DIY-MOD Markers] Localhost URL detected - may fail due to CSP`);
  }
  
  // Test if the new URL is accessible
  const testImg = new Image();
  testImg.onerror = () => {
    logError('DIY-MOD Markers', `Failed to load new image URL: ${safeUrlLog(finalUrl)}`);
  };
  testImg.onload = () => {
    debugLog(`[DIY-MOD Markers] New image URL is accessible`);
  };
  testImg.src = finalUrl;
  
  // Update the main src
  imgElement.src = finalUrl;
  
  // Clear srcset to prevent browser from using original sources
  imgElement.srcset = '';
  
  // Remove lazy loading attributes that might interfere
  imgElement.removeAttribute('data-src');
  imgElement.removeAttribute('data-srcset');
  imgElement.removeAttribute('loading');
  
  // Add processed class
  imgElement.classList.add("diymod-cartoonish-processed");
  
  // Add visual indicator for modification
  addImageModificationIndicator(imgElement);
  
  // Check if this is part of a Reddit gallery
  const galleryItem = imgElement.closest('gallery-carousel-item, li[class*="gallery"]');
  if (galleryItem) {
    console.log('DIY-MOD: Detected gallery image, updating gallery structure');
    
    // Update any source elements in picture tags
    const picture = imgElement.closest('picture');
    if (picture) {
      const sources = picture.querySelectorAll('source');
      sources.forEach(source => {
        source.srcset = finalUrl;
        source.removeAttribute('data-srcset');
      });
    }
    
    // Update any preview/thumbnail images in the same gallery item
    const thumbnails = galleryItem.querySelectorAll('img');
    thumbnails.forEach(thumb => {
      if (thumb !== imgElement && thumb.src && thumb.src.includes(originalSrc.split('?')[0])) {
        thumb.src = finalUrl;
        thumb.srcset = '';
        thumb.classList.add("diymod-cartoonish-processed");
      }
    });
  }
  
  // Handle Reddit's image preview system
  const postContainer = imgElement.closest('shreddit-post, article');
  if (postContainer) {
    // Find all images in the post that might be the same image (previews, expanded views, etc.)
    const allImages = postContainer.querySelectorAll('img');
    allImages.forEach(img => {
      // Check if this is the same image by comparing URL parts
      if (img !== imgElement && img instanceof HTMLImageElement) {
        const imgSrcBase = img.src.split('?')[0].split('/').pop();
        const originalSrcBase = originalSrc.split('?')[0].split('/').pop();
        
        if (imgSrcBase && originalSrcBase && imgSrcBase === originalSrcBase) {
          console.log('DIY-MOD: Updating related image:', img.src);
          img.src = finalUrl;
          img.srcset = '';
          img.removeAttribute('data-src');
          img.removeAttribute('data-srcset');
          img.classList.add("diymod-cartoonish-processed");
        }
      }
    });
  }
  
  // Force a reflow to ensure the image updates
  imgElement.style.opacity = '0.99';
  setTimeout(() => {
    imgElement.style.opacity = '';
    // Verify the update after reflow
    debugLog(`[DIY-MOD Markers] Image updated: ${safeUrlLog(imgElement.src, 50)}`);
    console.log(`[DIY-MOD Markers] Has processed class:`, imgElement.classList.contains('diymod-cartoonish-processed'));
  }, 10);
  
  // Image update complete
}

/**
 * Start polling for a processed image
 * @param imgElement The image element to update when processing is complete
 * @param originalUrl The original URL of the image
 * @param filters The filters applied to the image
 * @param config The original configuration
 */
function startImagePolling(
  imgElement: HTMLImageElement, 
  originalUrl: string, 
  filters: string[], 
  imgConfig: any
): void {
  // Create a unique key for this image
  const key = `${originalUrl}-${JSON.stringify(filters)}`;
  
  debugLog(`DIY-MOD: Starting image polling for: ${safeUrlLog(originalUrl)}`, {
    filters,
    key
  });
  
  // Default polling parameters - don't rely directly on config which might not be fully loaded
  const DEFAULT_MAX_ATTEMPTS = 20;
  
  // Get max attempts from config if available, otherwise use default
  const maxPollAttempts = config?.api?.polling?.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  
  // Track this deferred image processing
  const deferredImage: DeferredImageProcessing = {
    imageElement: imgElement,
    originalUrl: originalUrl,
    filters: filters,
    config: imgConfig,
    pollCount: 0,
    maxPolls: maxPollAttempts
  };
  
  // Store in the tracking map
  deferredImages.set(key, deferredImage);
  
  console.log(`DIY-MOD: Total deferred images being tracked: ${deferredImages.size}`);
  
  // Start waiting for WebSocket notification
  waitForImageResult(key);
}

/**
 * Poll the server for an image processing result
 * @param key The unique key for the deferred image
 */
async function waitForImageResult(key: string): Promise<void> {
  const deferredImage = deferredImages.get(key);
  if (!deferredImage) return;
  
  try {
    debugLog(`DIY-MOD: Registering for image processing updates`);
    
    // Create a unique request ID for this image processing request
    const requestId = `img-process-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Send request to content script to register for WebSocket updates
    // Use the actual filters from the image configuration
    window.postMessage({
      type: 'diymod_wait_for_image',
      requestId: requestId,
      imageUrl: deferredImage.originalUrl,
      filters: deferredImage.filters  // Use the actual filters from the image
    }, '*');
    
    // Wait for WebSocket notification via message event
    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        reject(new Error('Image processing timeout'));
      }, 160000); // 160 second timeout
      
      const messageHandler = (event: MessageEvent) => {
        if (event.data.type === 'diymod_image_processed' && 
            event.data.requestId === requestId) {
          clearTimeout(timeout);
          window.removeEventListener('message', messageHandler);
          
          if (event.data.result) {
            resolve(event.data.result);
          } else {
            reject(new Error(event.data.error || 'Image processing failed'));
          }
        }
      };
      
      window.addEventListener('message', messageHandler);
    });
    
    debugLog(`DIY-MOD: Image processing completed`);
    
    // Extract the URL from the result object
    let processedUrl: string;
    if (typeof result === 'object' && result !== null) {
      // Prefer base64 data URL if available to avoid CSP issues
      const resultObj = result as { base64?: string; url?: string };
      processedUrl = resultObj.base64 || resultObj.url || String(result);
      // Ensure it's always a string
      if (typeof processedUrl !== 'string') {
        processedUrl = String(processedUrl);
      }
    } else if (typeof result === 'string') {
      processedUrl = result;
    } else {
      logError('DIY-MOD', `Invalid result type: ${typeof result}`);
      throw new Error('Invalid image processing result');
    }
    
    // Update the image with the processed URL
    await updateRedditImage(deferredImage.imageElement, processedUrl);
    
    // Remove loading state
    removeImageLoadingState(deferredImage.imageElement);
    
    // Remove the DIY_IMG_ATTR now that processing is complete
    deferredImage.imageElement.removeAttribute(DIY_IMG_ATTR);
    deferredImage.imageElement.setAttribute('data-diy-mod-processed', 'true');
    
    // Remove from tracking
    deferredImages.delete(key);
    
  } catch (error) {
    logError('DIY-MOD', 'Error waiting for image processing:', error);
    
    // Remove loading state on error
    removeImageLoadingState(deferredImage.imageElement);
    
    // Remove from tracking
    deferredImages.delete(key);
  }
}

// /**
//  * Determine the best position for the indicator based on image visibility and dimensions
//  * @param imgElement The image element to analyze
//  * @returns Position object with top/bottom/left/right values
//  */
// function determineIndicatorPosition(_imgElement: HTMLImageElement): {
//   top: number | null,
//   bottom: number | null,
//   left: number | null,
//   right: number | null,
//   middle?: boolean
// } {
//   // Since we're using the parent container, we can always use top-right
//   // The container shows the full visible area, so no cropping issues
//   // console.log('DIY-MOD: Using top-right on parent container');
//   return { top: 8, bottom: null, left: null, right: 8 };
// }

/**
 * Add a visual indicator to show that an image has been modified by DIY-MOD
 * @param imgElement The image element to add the indicator to
 */
function addImageModificationIndicator(imgElement: HTMLImageElement): void {
  try {
    // Skip if already has indicator
    if (imgElement.classList.contains('diymod-image-modified')) {
      return;
    }
    
    // Add the modification class for tracking
    imgElement.classList.add('diymod-image-modified');
    
    // Create the indicator element using modification-indicator class
    const indicator = document.createElement('div');
    indicator.className = 'modification-indicator diymod-img-indicator';
    indicator.textContent = 'Modified by DIY-MOD';
    
    // Calculate position based on actual image display
    const computePosition = () => {
      const imgRect = imgElement.getBoundingClientRect();
      const containerRect = imgElement.parentElement?.getBoundingClientRect();
      
      if (!containerRect) return;
      
      // Wait for natural dimensions to be available
      if (!imgElement.naturalWidth || !imgElement.naturalHeight) {
        // Try again after a short delay
        setTimeout(computePosition, 100);
        return;
      }
      
      // For object-contain images, calculate the actual rendered image size
      const naturalRatio = imgElement.naturalWidth / imgElement.naturalHeight;
      const containerRatio = imgRect.width / imgRect.height;
      
      let actualWidth = imgRect.width;
      let actualHeight = imgRect.height;
      let offsetLeft = 0;
      let offsetTop = 0;
      
      if (imgElement.style.objectFit === 'contain' || 
          imgElement.classList.contains('object-contain')) {
        // Image is contained, so it might not fill the entire element
        if (naturalRatio > containerRatio) {
          // Image is wider relative to container, constrained by width
          // Height will be less than container height (letterboxed top/bottom)
          actualHeight = imgRect.width / naturalRatio;
          offsetTop = (imgRect.height - actualHeight) / 2;
        } else {
          // Image is taller relative to container, constrained by height
          // Width will be less than container width (letterboxed left/right)
          actualWidth = imgRect.height * naturalRatio;
          offsetLeft = (imgRect.width - actualWidth) / 2;
        }
      }
      
      // Position indicator inside the actual visible image area
      // Use offsetLeft and offsetTop to account for letterboxing
      const topPosition = offsetTop + 8;
      const rightPosition = (imgRect.width - offsetLeft - actualWidth) + 8;
      
      indicator.style.top = `${topPosition}px`;
      indicator.style.right = `${rightPosition}px`;
      
      console.log('DIY-MOD: Indicator position calculated:', {
        naturalDimensions: `${imgElement.naturalWidth}x${imgElement.naturalHeight}`,
        containerDimensions: `${imgRect.width}x${imgRect.height}`,
        actualImageSize: `${actualWidth}x${actualHeight}`,
        offsets: `left: ${offsetLeft}, top: ${offsetTop}`,
        indicatorPosition: `top: ${topPosition}, right: ${rightPosition}`
      });
    };
    
    // Apply base styles
    indicator.style.cssText = `
      position: absolute !important;
      background: rgba(9, 116, 246, 0.94) !important;
      padding: 2px 6px !important;
      border-radius: 3px !important;
      font-size: 10px !important;
      font-weight: bold !important;
      color: #ffffff !important;
      border: 1px solid rgba(255,255,255,0.3) !important;
      z-index: 9999 !important;
      pointer-events: none !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
    `;
    
    // Compute position after image loads
    if (imgElement.complete) {
      computePosition();
    } else {
      imgElement.addEventListener('load', computePosition);
    }
    
    // Find the best container to attach the indicator
    // For carousel images, we need to be careful about overflow:hidden on <li>
    const figure = imgElement.closest('figure');
    const li = imgElement.closest('li');
    let container = imgElement.parentElement;
    
    // Special handling for carousel images with overflow:hidden
    if (li && window.getComputedStyle(li).overflow === 'hidden' && figure) {
      // Place indicator directly on the image with a fixed position strategy
      // that accounts for the actual visible area within the overflow:hidden container
      
      // Apply indicator as an overlay directly on the image position
      const applyDirectIndicator = () => {
        const imgRect = imgElement.getBoundingClientRect();
        const liRect = li.getBoundingClientRect();
        
        // Calculate the visible portion of the image within the li
        const visibleTop = Math.max(0, imgRect.top - liRect.top);
        const visibleLeft = Math.max(0, imgRect.left - liRect.left);
        const visibleRight = Math.min(liRect.width, imgRect.right - liRect.left);
        const visibleBottom = Math.min(liRect.height, imgRect.bottom - liRect.top);
        
        const visibleWidth = visibleRight - visibleLeft;
        const visibleHeight = visibleBottom - visibleTop;
        
        // Only proceed if we have a reasonable visible area
        if (visibleWidth > 50 && visibleHeight > 50) {
          // Position indicator within the visible bounds
          indicator.style.top = `${visibleTop + 8}px`;
          indicator.style.right = `${liRect.width - visibleRight + 8}px`;
        } else {
          // Fallback to center if visible area is too small
          // Fallback: pin to the top-right of the <li> container cleanly
          indicator.style.top = '8px';
          indicator.style.right = '8px';
          indicator.style.left = 'auto';        // cancel any left positioning
          indicator.style.bottom = 'auto';      // be explicit
          indicator.style.transform = 'none';   // cancel translate(-50%, -50%)
          indicator.style.maxWidth = 'max-content';
          indicator.style.width = 'auto';
          indicator.style.whiteSpace = 'nowrap'; // keep one-word badge tight 
        }
      };
      
      // Attach to figure instead of image container to avoid clipping
      container = figure as HTMLElement;
      
      // Ensure we're not duplicating
      const existingIndicator = container.querySelector('.modification-indicator');
      if (!existingIndicator) {
        container.style.position = 'relative';
        container.appendChild(indicator);
        
        // Apply positioning after attachment
        setTimeout(applyDirectIndicator, 0);
        
        console.log('DIY-MOD: Added indicator to figure to avoid overflow:hidden clipping');
      }
      return;
    }
    
    // Standard handling for non-carousel or non-clipped images
    if (container && container.classList.contains('diymod-image-container')) {
      console.log('DIY-MOD: Using existing diymod-image-container');
    } else if (figure) {
      // Check if figure already has a diymod-image-container child with our image
      const existingContainer = figure.querySelector('.diymod-image-container');
      if (existingContainer && existingContainer.contains(imgElement)) {
        container = existingContainer as HTMLElement;
        console.log('DIY-MOD: Found existing container in figure');
      } else {
        // Wrap the image in our container
        container = document.createElement('div');
        container.className = 'diymod-image-container';
        container.style.cssText = 'position: relative; display: inline-block; width: 100%; height: 100%;';
        
        if (imgElement.parentNode) {
          imgElement.parentNode.insertBefore(container, imgElement);
          container.appendChild(imgElement);
        }
        console.log('DIY-MOD: Created new container in figure');
      }
    } else if (container && !container.classList.contains('diymod-image-container')) {
      const newContainer = document.createElement('div');
      newContainer.className = 'diymod-image-container';
      newContainer.style.cssText = 'position: relative; display: inline-block;';
      
      if (imgElement.parentNode) {
        imgElement.parentNode.insertBefore(newContainer, imgElement);
        newContainer.appendChild(imgElement);
        container = newContainer;
      }
      console.log('DIY-MOD: Created new container for single image');
    }
    
    // Ensure container has relative positioning
    if (container && container instanceof HTMLElement) {
      const containerStyle = window.getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }
      
      // Check if indicator already exists in this container
      const existingIndicator = container.querySelector('.modification-indicator');
      if (!existingIndicator) {
        container.appendChild(indicator);
        console.log('DIY-MOD: Added modification indicator to container');
      }
    }
    
  } catch (error) {
    console.error('DIY-MOD: Error adding image modification indicator:', error);
  }
}

/**
 * Apply a blur overlay to a specific rectangular region of an image.
 * @param img The image element to blur a region of.
 * @param blurInfo A string "left_top_width_height".
 */
export function applyBlurToImage(img: HTMLImageElement, blurInfo: string): void {
  try {
    const [left, top, width, height] = blurInfo.split('_').map(Number);
    // Ensure container
    let container: HTMLElement;
    if (img.parentElement?.classList.contains('diymod-image-container')) {
      container = img.parentElement as HTMLElement;
    } else {
      container = document.createElement('div');
      container.className = 'diymod-image-container';
      container.style.display = 'inline-block';
      container.style.position = 'relative';
      if (img.parentNode) {
        img.parentNode.insertBefore(container, img);
        container.appendChild(img);
      }
    }
    // Avoid duplicate blur overlays
    const existing = Array.from(container.querySelectorAll('.diymod-blur-overlay'))
      .find(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.left === left && rect.top === top &&
               rect.width === width && rect.height === height;
      });
    if (!existing) {
      const overlay = document.createElement('div');
      overlay.className = 'diymod-blur-overlay';
      Object.assign(overlay.style, {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none'
      });
      container.appendChild(overlay);
      console.log('DIY-MOD: Blur overlay applied to image');
    }
  } catch (error) {
    console.error('DIY-MOD: Error applying blur to image:', error);
  }
}


// Debug utility to check processed images
(window as any).DIY_MOD_CHECK_PROCESSED = () => {
  console.log('=== DIY-MOD Processed Images ===');
  console.log(`Total processed images: ${processedImageSrcs.size}`);
  console.log('Processed images:', Array.from(processedImageSrcs));
};

// Debug utility to clear processed images (for testing)
(window as any).DIY_MOD_CLEAR_PROCESSED = () => {
  processedImageSrcs.clear();
  console.log('DIY-MOD: Cleared processed images set');
};

// Debug utility to test image modification indicator
(window as any).DIY_MOD_TEST_INDICATOR = () => {
  console.log('=== DIY-MOD Test Image Indicator ===');
  
  // Find first image on the page
  const firstImg = document.querySelector('img') as HTMLImageElement;
  if (firstImg) {
    console.log('Testing indicator on first image:', firstImg.src.substring(0, 100) + '...');
    console.log('Image parent before:', firstImg.parentElement);
    
    addImageModificationIndicator(firstImg);
    
    // Check if the indicator element was created
    const container = firstImg.parentElement;
    const indicator = container?.querySelector('.diymod-image-indicator');
    
    console.log('Results:', {
      imageClasses: firstImg.className,
      hasModClass: firstImg.classList.contains('diymod-image-modified'),
      containerExists: !!container,
      containerClasses: container?.className,
      indicatorExists: !!indicator,
      indicatorText: indicator?.textContent,
      indicatorVisible: indicator ? window.getComputedStyle(indicator).display !== 'none' : false
    });
    
    if (indicator) {
      console.log('✅ Indicator element created successfully!');
      // Make it flash to help you see it
      if (indicator instanceof HTMLElement) {
        indicator.style.background = 'red';
        setTimeout(() => {
          indicator.style.background = 'rgba(9, 116, 246, 0.94)';
        }, 1000);
      }
    } else {
      console.log('❌ Indicator element was not created');
    }
  } else {
    console.log('No images found on page');
  }
};

// Debug utility to check deferred images status
(window as any).DIY_MOD_CHECK_IMAGES = () => {
  console.log('=== DIY-MOD Deferred Images Status ===');
  console.log(`Total tracked: ${deferredImages.size}`);
  
  deferredImages.forEach((image, key) => {
    console.log(`\nImage: ${key}`);
    debugLog(`  Original URL: ${safeUrl(image.originalUrl)}`);
    console.log(`  Current src: ${image.imageElement.src}`);
    console.log(`  Filters: ${JSON.stringify(image.filters)}`);
    console.log(`  Poll count: ${image.pollCount}/${image.maxPolls}`);
    console.log(`  Element connected: ${image.imageElement.isConnected}`);
    console.log(`  Has loading indicator: ${!!image.imageElement.parentElement?.querySelector('.diymod-loading-indicator')}`);
  });
  
  // Also check for processed images in the DOM
  const processedImages = document.querySelectorAll('img[data-diy-mod-processed]');
  console.log(`\nProcessed images in DOM: ${processedImages.length}`);
  
  const loadingImages = document.querySelectorAll('img.diymod-processing');
  console.log(`Images with loading state: ${loadingImages.length}`);
};

// Register built-in text markers
registerMarkerHandler({
  name: 'blur',
  startMarker: BLUR_START,
  endMarker: BLUR_END,
  detect: (text) => text.includes(BLUR_START),
  process: processBlurMarkers
});

registerMarkerHandler({
  name: 'overlay',
  startMarker: OVERLAY_START,
  endMarker: OVERLAY_END,
  detect: (text) => text.includes(OVERLAY_START),
  process: processOverlayMarkers
});

registerMarkerHandler({
  name: 'rewrite',
  startMarker: REWRITE_START,
  endMarker: REWRITE_END,
  detect: (text) => text.includes(REWRITE_START),
  process: processRewriteMarkers
});

// // Register built-in image markers
// registerImageMarkerHandler({
//   name: 'processed_image',
//   marker: MARKERS.PROCESSED_IMAGE,
//   detect: (url) => url.includes(MARKERS.PROCESSED_IMAGE),
//   process: processStandardImageMarker
// });

// // Register overlay image marker
// registerImageMarkerHandler({
//   name: 'overlay_image',
//   marker: MARKERS.OVERLAY_IMAGE,
//   detect: (url) => url.includes(MARKERS.OVERLAY_IMAGE),
//   process: processOverlayImageMarker
// });