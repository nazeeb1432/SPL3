/**
 * DOM Processor
 * 
 * Handles finding and processing content with markers in the DOM.
 * This module is responsible for:
 * - Observing DOM changes
 * - Finding nodes with markers
 * - Processing and replacing content with styled HTML
 */

import { processMarkedText, hasAnyMarkers, processMarkedImage } from '@/utils/markers';
import { DIY_IMG_ATTR } from '@/shared/constants';
import { config } from '@/shared/config';
/**
 * DOM Processor class for handling content marker processing in the DOM
 */
export class DomProcessor {
  private config = {
    debug: true,
    periodicCheckInterval: 10000, // milliseconds (increased interval)
  };
  
  private mutationObserver: MutationObserver | null = null;
  private isProcessing = false;

  /**
   * Hide the first three post articles on initial load by setting display to 'none' (collapsed)
   */
  private hideInitialPosts(): void {
    const posts = Array.from(document.querySelectorAll<HTMLElement>('article.w-full.m-0'));
    posts.slice(0, 3).forEach(post => {
      post.style.display = 'none';
      post.dataset.diyModHidden = 'true';
      // Also hide the following <hr> separator, if present

      // Hide the separator <hr> immediately after the post, if present
      const next = post.nextElementSibling as HTMLElement | null;
      if (next && next.tagName.toLowerCase() === 'hr') {
        next.style.display = 'none';
      }
    });
  }
  
  /**
   * Initialize the DOM processor and start observing
   */
  public initialize(): void {
    this.log('Initializing DOM processor','debug');
    
    // Check if we should hide initial posts based on configuration
    if (config.features.hideInitialPosts) {
      this.log('Hiding initial posts based on configuration','info');
      // Hide initial posts immediately and on DOM ready
      this.hideInitialPosts();
      
      // Set up early hiding for posts that might load quickly
      const earlyHideInterval = setInterval(() => {
        this.hideInitialPosts();
      }, 100);
      
      // Stop early hiding after 3 seconds
      setTimeout(() => {
        clearInterval(earlyHideInterval);
      }, 3000);
    }
    else {
      this.log('Skipping initial post hiding based on configuration','info');
    }
    
    // Process existing content
    this.processExistingContent();
    
    // Set up observer for DOM mutations
    this.setupDomObserver();
    
    // Set up scroll-aware overlay management
    this.setupScrollAwareOverlays();
    
    // Fallback periodic checks removed—relying on MutationObserver only
    
    this.log('DOM processor initialized','debug');
  }
  
  /**
   * Process all existing content in the DOM
   */
  private processExistingContent(): void {
    this.log('Processing existing content in the DOM','debug');
    this.processNode(document.body);
  }
  
  /**
   * Set up an observer to process DOM nodes with markers
   */
  private setupDomObserver(): void {
    // Create and start the observer with more options
    this.mutationObserver = new MutationObserver(mutations => {
      // Skip processing if we're already processing (prevents infinite loops)
      if (this.isProcessing) {
        this.log('Skipping mutation processing - already in progress', 'debug');
        return;
      }
      
      const nodesWithPossibleMarkers = new Set<Node>();
      
      // Debounce rapid mutations to prevent infinite loops
      let mutationCount = 0;
      
      for (const mutation of mutations) {
        mutationCount++;
        
        // Safety check: if we're getting too many mutations, something is wrong
        if (mutationCount > 200) {
          console.warn('DIY-MOD DOM Processor: Too many mutations detected, possible infinite loop. Skipping batch.');
          return;
        }
        // For childList mutations, check added nodes
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              const tag = element.tagName.toLowerCase();
              
              // Skip script/style elements
              if (tag === 'script' || tag === 'style') {
                return;
              }
              
              // Skip elements we've already created (prevents infinite loops)
              if (element.classList.contains('diymod-image-container') ||
                  element.classList.contains('diymod-blur-overlay') ||
                  element.classList.contains('diymod-image-indicator') ||
                  element.classList.contains('diymod-loading-indicator')) {
                return;
              }
            }
            
            if (this.nodeHasMarkers(node)) {
              nodesWithPossibleMarkers.add(node);
            }
          });
        }
        // For character data mutations, check text nodes
        else if (mutation.type === 'characterData') {
          const textNode = mutation.target;
          if (this.nodeHasMarkers(textNode)) {
            nodesWithPossibleMarkers.add(textNode);
          }
        }
        // For attribute mutations, check if the element now contains markers
        else if (mutation.type === 'attributes') {
          const element = mutation.target as Element;
          if (element.nodeType === Node.ELEMENT_NODE) {
            const tag = element.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style') {
              return;
            }
            
            // Special handling for image src changes
            if (tag === 'img' && mutation.attributeName === 'src') {
              this.checkRedditImageReload(element as HTMLImageElement);
            }
          }
          if (this.nodeHasMarkers(element)) {
            nodesWithPossibleMarkers.add(element);
            
            // Also directly process elements with innerHTML containing markers
            if (element instanceof HTMLElement) {
              this.processElementWithMarkers(element);
            }
          }
        }
      }
      
      // Process collected nodes
      if (nodesWithPossibleMarkers.size > 0) {
        this.log(`Processing ${nodesWithPossibleMarkers.size} nodes after mutations`, 'debug');
        
        // Set processing flag to prevent re-entry
        this.isProcessing = true;
        
        try {
          nodesWithPossibleMarkers.forEach(node => {
            this.processNode(node);
          });
        } finally {
          // Always clear the flag, even if processing fails
          this.isProcessing = false;
        }
      }
    });
    
    // Start observing with all mutation types
    this.mutationObserver.observe(document.body, { 
      childList: true, 
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['innerHTML', 'textContent'] 
    });
  }
  
  /**
   * Set up periodic checks for content that might have been missed
   * This helps catch content loaded dynamically through scripts
   */
  // private setupPeriodicChecks(): void {
  //   // Run the periodic check after initial page load and every few seconds
  //   setTimeout(() => this.runPeriodicCheck(), 1000);
  //   setInterval(() => this.runPeriodicCheck(), this.config.periodicCheckInterval);
  // }
  
  /**
   * Run a periodic check for markers in the DOM
   */
  // private runPeriodicCheck(): void {
  //   const allElements = Array.from(document.querySelectorAll<HTMLElement>('*'));
  //   const batchSize = 50;

  //   for (let i = 0; i < allElements.length; i += batchSize) {
  //     setTimeout(() => {
  //       let batchMarkerCount = 0;
  //       const batch = allElements.slice(i, i + batchSize);

  //       batch.forEach(element => {
  //         if (element.innerHTML && hasAnyMarkers(element.innerHTML)) {
  //           this.processElementWithMarkers(element);
  //           batchMarkerCount++;
  //         }
  //         batchMarkerCount += this.processMarkedImages(element);
  //       });

  //       if (batchMarkerCount > 0) {
  //         this.log(`Periodic check batch [${i}-${i + batchSize}] found ${batchMarkerCount} markers`, 'info');
  //       }
  //     }, 0);
  //   }
  // }
  
  /**
   * Process a DOM node for markers
   */
  public processNode(node: Node): void {
    // Skip processing if node doesn't exist or isn't part of the DOM
    if (!node || !node.isConnected) {
      return;
    }
    
    // Quick check if node or its children have markers
    if (!this.nodeHasMarkers(node)) {
      return;
    }
    
    // Check if this is a text node
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (hasAnyMarkers(text)) {
        
        // Create a span to replace the text node
        const span = document.createElement('span');
        span.innerHTML = processMarkedText(text);
        if (node.parentNode) {
          node.parentNode.replaceChild(span, node);
        }
      }
    } 
    // For element nodes, walk through child text nodes
    else if (node.nodeType === Node.ELEMENT_NODE) {
      // Skip processing for script and style elements
      const tagName = (node as Element).tagName.toLowerCase();
      if (tagName === 'script' || tagName === 'style') {
        return;
      }
      
      const walker = document.createTreeWalker(
        node, 
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (textNode) => {
            const text = textNode.textContent || '';
            return hasAnyMarkers(text)
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT;
          }
        } as NodeFilter
      );
      
      const textNodesToProcess: Node[] = [];
      let textNode: Node | null;
      
      while (textNode = walker.nextNode()) {
        textNodesToProcess.push(textNode);
      }
      
      // Process collected nodes
      if (textNodesToProcess.length > 0) {
        this.log(`Found ${textNodesToProcess.length} text nodes with markers to process`, 'info');        
        textNodesToProcess.forEach(textNode => {
          // Skip if this node was already removed or replaced
          if (!textNode.isConnected) return;
          
          const text = textNode.textContent || '';
          const span = document.createElement('span');
          span.innerHTML = processMarkedText(text);
          
          if (textNode.parentNode) {
            textNode.parentNode.replaceChild(span, textNode);
          }
        });
      }

      // Also process images
      if (node instanceof HTMLElement) {
        this.processMarkedImages(node);
        
        // Check for images that might have been reset by Reddit
        this.checkForResetImages(node);
      }
    }
  }
  
  /**
   * Process an HTML element that directly contains markers in its innerHTML
   */
  private processElementWithMarkers(element: Element): void {
    if (!(element instanceof HTMLElement)) return;
    
    const html = element.innerHTML;
    if (hasAnyMarkers(html)) {
      this.log('Processing HTML element with markers in innerHTML', 'debug');
      // console.log("DIY-MOD: Found element with markers in innerHTML");
      
      // Process the HTML directly
      element.innerHTML = processMarkedText(html);
    }
  }
  
  /**
   * Process any marked images within the given element.
   * Returns the number of images processed.
   */
  private processMarkedImages(element: HTMLElement): number {
    const imgs = Array.from(element.querySelectorAll<HTMLImageElement>(`img[${DIY_IMG_ATTR}]`));
    imgs.forEach(img => processMarkedImage(img));
    return imgs.length;
  }

  /**
   * Check if a Reddit image has been reloaded/reset and needs reprocessing
   */
  private checkRedditImageReload(img: HTMLImageElement): void {
    // Check if this was a processed image that Reddit has reloaded
    if (img.hasAttribute('data-diy-mod-processed') && 
        img.classList.contains('diymod-cartoonish-processed')) {
      
      // Check if the src has been reset to the original
      if (!img.src.includes('localhost:8001/temp/uploads/')) {
        this.log(`Detected Reddit image reload, needs reprocessing: ${img.src}`, 'info');
        
        // Remove the processed markers so it can be detected again
        img.removeAttribute('data-diy-mod-processed');
        img.classList.remove('diymod-cartoonish-processed');
        
        // Check if there's a DIY_IMG_ATTR that needs to be reprocessed
        if (img.hasAttribute(DIY_IMG_ATTR)) {
          processMarkedImage(img);
        }
      }
    }
  }

  /**
   * Check for images that might have been reset within an element
   */
  private checkForResetImages(element: HTMLElement): void {
    const processedImages = element.querySelectorAll<HTMLImageElement>('img[data-diy-mod-processed]');
    processedImages.forEach(img => {
      this.checkRedditImageReload(img);
    });
  }
  
  /**
   * Check if a node or its children contain any known markers
   */
  public nodeHasMarkers(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      return hasAnyMarkers(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (element instanceof HTMLImageElement) {
        return element.hasAttribute(DIY_IMG_ATTR);
      }
      const text = element.textContent || '';
      return hasAnyMarkers(text);
    }
    return false;
  }
  
  /**
   * Set up scroll-aware overlay management
   */
  private setupScrollAwareOverlays(): void {
    // Delay setup to allow DOM mutations to settle
    setTimeout(() => {
      const overlays = document.querySelectorAll('.diymod-scroll-aware, .content-overlay');
      
      if (overlays.length === 0) {
        this.log('No overlays found for scroll-aware setup', 'debug');
        return;
      }
      
      this.log(`Setting up scroll-aware management for ${overlays.length} overlays`, 'info');
      
      // Create intersection observer
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const overlay = entry.target as HTMLElement;
          
          if (entry.isIntersecting) {
            // Visible: use normal z-index
            overlay.style.zIndex = '10';
          } else {
            // Not visible: lower z-index
            overlay.style.zIndex = '1';
          }
        });
      }, {
        root: null,
        rootMargin: '50px', // Start hiding slightly before it goes off-screen
        threshold: 0.1
      });
      
      // Set up observers and containment
      overlays.forEach(overlay => {
        observer.observe(overlay);
        
        // Ensure parent has containment
        const parent = overlay.closest('article, [class*="post"], [class*="tweet"]') as HTMLElement;
        if (parent) {
          const parentStyle = window.getComputedStyle(parent);
          if (parentStyle.contain === 'none') {
            parent.style.contain = 'layout style';
          }
          if (parentStyle.position === 'static') {
            parent.style.position = 'relative';
          }
        }
      });
    }, 1000);
  }
  
  /**
   * Log a message if debug is enabled
   */
  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = 'DIY-MOD DOM Processor:';
    
    switch(level) {
      case 'debug':
        if (this.config.debug) {
          console.debug(prefix, message);
        }
        break;
      case 'info':
        console.log(prefix, message);
        break;
      case 'warn':
        console.warn(prefix, message);
        break;
      case 'error':
        console.error(prefix, message);
        break;
    }
  }
}