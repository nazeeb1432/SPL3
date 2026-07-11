import { config } from "../config";
import { FeedResponse, Filter, LLMResponse, ServerResponse } from "../types";
import { logger } from "../../utils/logger";
import { debugLog, logError, logInfo, safeUrlLog } from "../../utils/logging";
import { client } from "../client";
import { getWebSocketClient } from "../websocket/websocket-client";

/**
 * API Service for DIY-MOD extension
 * Handles all communication with the backend API
 */
class ApiService {
  private imageProcessingCallbacks: Map<string, (result: any) => void> =
    new Map();
  private pendingImageRequests: Map<
    string,
    { filters: string[]; timestamp: number }
  > = new Map();
  private wsClient: any = null;

  constructor() {
    // Initialize WebSocket handlers
    this.initializeWebSocket();
  }

  /**
   * Initialize WebSocket connection and handlers
   */
  private async initializeWebSocket(): Promise<void> {
    // Skip WebSocket initialization if disabled
    if (!config.api.websockets.useWebSockets) {
      logger.websocket.info(
        "WebSockets disabled in configuration, using polling only",
      );
      return;
    }
    try {
      // Get user ID first
      const userId = await this.getUserId();
      config.userId = userId; // Update config with current userId
      this.wsClient = getWebSocketClient(userId);

      // Set up WebSocket message handlers
      this.wsClient.on("image_processed", (data: any) => {
        // The data is already unwrapped by the WebSocket client
        const { image_url, result, filters, base64_url } = data;
        logInfo("DIY-MOD API", `Image processed for: ${safeUrlLog(image_url)}`);
        debugLog(`[DIY-MOD API] Filters:`, filters);
        if (base64_url) {
          debugLog(
            `[DIY-MOD API] Base64 data included (${
              Math.round(base64_url.length / 1024)
            }KB)`,
          );
        }
        debugLog(
          `[DIY-MOD API] Registered callbacks:`,
          Array.from(this.imageProcessingCallbacks.keys()).map((url) =>
            safeUrlLog(url, 50)
          ),
        );
        logger.websocket.info(
          `Received image_processed event for ${image_url} with filters ${filters}`,
          data,
        );

        // Try exact match first
        let callback = this.imageProcessingCallbacks.get(image_url);

        // If no exact match, try to find a callback with normalized URL
        if (!callback) {
          // Check all registered callbacks for URL variations
          for (
            const [registeredUrl, registeredCallback] of this
              .imageProcessingCallbacks.entries()
          ) {
            // Simple URL normalization - remove trailing slashes, query params for comparison
            const normalizedRegistered = registeredUrl.split("?")[0].replace(
              /\/$/,
              "",
            );
            const normalizedReceived = image_url.split("?")[0].replace(
              /\/$/,
              "",
            );

            if (normalizedRegistered === normalizedReceived) {
              logger.websocket.info(
                `Found callback for normalized URL: ${registeredUrl} matches ${image_url}`,
              );
              callback = registeredCallback;
              this.imageProcessingCallbacks.delete(registeredUrl);
              break;
            }
          }
        }

        if (callback) {
          // Prefer base64_url over regular URL to bypass CSP restrictions
          const finalResult = base64_url || result;
          logger.websocket.info(
            `Found callback for ${image_url}, calling it with result:`,
            finalResult,
          );
          if (config.logging?.level === "debug") {
            console.log(
              `[DIY-MOD API] Using ${
                base64_url ? "base64 data" : "regular URL"
              }`,
            );
          }
          callback(finalResult);
          if (this.imageProcessingCallbacks.has(image_url)) {
            this.imageProcessingCallbacks.delete(image_url);
          }
        } else {
          logger.websocket.warn(
            `No callback found for processed image ${image_url}. Registered URLs:`,
            Array.from(this.imageProcessingCallbacks.keys()),
          );
        }
      });

      this.wsClient.on("filters_updated", (message: any) => {
        // Broadcast filter update to all tabs
        chrome.runtime.sendMessage({
          type: "filters_updated",
          filters: message.data,
        }).catch(() => {
          // Ignore errors if no listeners
        });
      });

      this.wsClient.on("chat_response", (message: any) => {
        // Handle streaming chat responses
        chrome.runtime.sendMessage({
          type: "chat_stream",
          data: message.data,
        }).catch(() => {
          // Ignore errors if no listeners
        });
      });

      // Connect WebSocket
      this.wsClient.connect();

      // Log connection status
      this.wsClient.onConnect(() => {
        logger.websocket.info("WebSocket connected successfully");
      });

      this.wsClient.onDisconnect(() => {
        logger.websocket.warn("WebSocket disconnected");
      });

      // Handle reconnection to update userId
      this.wsClient.on("reconnected", async () => {
        logger.websocket.info("WebSocket reconnected, updating userId...");
        try {
          const newUserId = await this.getUserId();
          config.userId = newUserId; // Update the global config
          logger.websocket.info(`Updated userId to: ${newUserId}`);

          // Re-register any pending image processing
          this.reRegisterPendingImages();
        } catch (error) {
          logger.websocket.error(
            "Failed to update userId on reconnection:",
            error,
          );
        }
      });
    } catch (error) {
      logger.websocket.error("Failed to initialize WebSocket:", error);
      // Continue working without WebSocket - fallback to polling
    }
  }
  /**
   * Process a feed with the backend API
   */
  async processFeed(
    url: string,
    userId: string,
    platform: string,
    responseData: string,
    options: { useBatching?: boolean } = {},
  ): Promise<FeedResponse> {
    try {
      logger.api.info(`Processing ${platform} feed from ${url}`);
      debugLog("[DIY-MOD] Processing feed:", {
        url: safeUrlLog(url),
        userId,
        platform,
      });

      // Get authenticated user info for token
      const userInfo = await this.getUserInfo();
      const authToken = userInfo?.token;

      // const endpoint = options.useBatching && config.api.batchingEnabled ? '/batch' : '/process';
      const requestBody = {
        user_id: userId,
        url: url,
        data: {
          feed_info: {
            response: responseData,
          },
        },
      };

      debugLog(
        "[DIY-MOD] API endpoint:",
        `${config.api.baseUrl}${config.api.endpoints.process}`,
      );

      // Use the batch client if batching is enabled
      if (options.useBatching && config.api.batchingEnabled) {
        logger.api.debug("Using batch client for feed processing");

        // Wrap the request in a Promise
        return new Promise((resolve, reject) => {
          client.postRequest(
            config.api.endpoints.process,
            requestBody,
            (data) => resolve(data),
            (error) => reject(new Error(error)),
          );
        });
      } else {
        // Standard request using fetch
        const response = await fetch(
          `${config.api.baseUrl}${config.api.endpoints.process}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authToken ? `Bearer ${authToken}` : "",
            },
            body: JSON.stringify(requestBody),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${response.statusText}`,
          );
        }

        const result = await response.json();
        debugLog("[DIY-MOD] API Response received");
        return result;
      }
    } catch (error) {
      logError("DIY-MOD", "Error processing feed:", error);
      logger.api.error("Error processing feed:", error);
      throw error;
    }
  }

  /**
   * Process content through the backend API
   * @param posts Array of posts to process
   */
  async processContent(posts: any[]): Promise<any[]> {
    try {
      logger.api.info(`Processing ${posts.length} posts`);

      const userId = await this.getUserId();

      // Format the request body
      const requestBody = {
        tab_id: chrome.runtime.id,
        user_id: userId,
        extension_version: config.version,
        data: {
          posts: posts,
        },
      };

      const response = await fetch(`${config.api.baseUrl}/process_content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result.processed_posts || [];
    } catch (error) {
      logger.api.error("Error processing content:", error);
      throw error;
    }
  }

  /**
   * Process multiple content items in parallel
   * @param items Array of content items to process
   * @param userId User ID
   * @param url URL being accessed
   */
  async processContentItems(
    items: { id: string; content: string }[],
    userId: string,
    url: string,
  ): Promise<any[]> {
    try {
      // Check if parallel processing is enabled
      if (!config.api.parallelRequestsEnabled) {
        throw new Error("Parallel requests are disabled in configuration");
      }

      logger.api.info(`Processing ${items.length} content items in parallel`);

      // Prepare parallel requests
      const requests = items.map((item) => {
        return {
          path: config.api.endpoints.process,
          params: {
            tab_id: chrome.runtime.id,
            user_id: userId,
            url: url,
            extension_version: config.version,
            item_id: item.id,
            data: {
              feed_info: {
                response: item.content,
              },
            },
          },
        };
      });

      // Use the parallel execution feature of the client
      const results = await client.executeParallel(requests);

      // Return results with their IDs
      return results.map((result, index) => ({
        id: items[index].id,
        result,
      }));
    } catch (error) {
      logger.api.error("Error in parallel content processing:", error);
      throw error;
    }
  }

  /**
   * Send a chat message to the LLM
   * @param message Message content
   * @param history Previous conversation history
   * @param options Additional options including batching
   */
  async sendChatMessage(
    message: string,
    history: any[] = [],
    options: { useBatching?: boolean; batchId?: string } = {},
  ): Promise<LLMResponse> {
    try {
      logger.api.info("Sending chat message to LLM");

      const userId = await this.getUserId();

      const requestParams = {
        message,
        history,
        user_id: userId,
      };

      // Use batching if enabled and requested
      if (
        options.useBatching && config.api.batchingEnabled && options.batchId
      ) {
        logger.api.debug(`Adding message to batch: ${options.batchId}`);

        // Add to specified batch and return a Promise
        return new Promise<LLMResponse>((resolve) => {
          // Add to batch but ignore the returned ID for now
          client.addToBatch(
            options.batchId || "default",
            "/chat",
            requestParams,
          );

          // Note: This doesn't wait for the batch to complete
          // The caller should use client.executeBatch() when ready

          // For now, resolve with a placeholder to maintain interface compatibility
          resolve({
            status: "pending",
            message: "Added to batch, waiting for execution",
            response: "",
            pending: true,
            batch_id: options.batchId,
          } as any);
        });
      } else {
        // Standard request using fetch
        const response = await fetch(`${config.api.baseUrl}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestParams),
        });

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${response.statusText}`,
          );
        }

        const result = await response.json();
        return result;
      }
    } catch (error) {
      logger.api.error("Error in chat processing:", error);
      throw error;
    }
  }

  /**
   * Send multiple chat messages to LLMs in parallel
   * @param messages Array of messages with associated metadata
   * @param userId User ID
   */
  async sendParallelChatMessages(
    messages: Array<{
      message: string;
      history?: any[];
      metadata?: any;
    }>,
  ): Promise<any[]> {
    try {
      // Check if parallel processing is enabled
      if (!config.api.parallelRequestsEnabled) {
        throw new Error("Parallel requests are disabled in configuration");
      }

      logger.api.info(`Sending ${messages.length} chat messages in parallel`);

      const userId = await this.getUserId();

      // Prepare parallel requests
      const requests = messages.map((item) => {
        return {
          path: "/chat",
          params: {
            message: item.message,
            history: item.history || [],
            user_id: userId,
            metadata: item.metadata,
          },
        };
      });

      // Use the parallel execution feature of the client
      return await client.executeParallel(requests);
    } catch (error) {
      logger.api.error("Error in parallel chat processing:", error);
      throw error;
    }
  }

  /**
   * Send an image for processing
   */
  async processImage(
    image: File,
    message?: string,
    history: any[] = [],
  ): Promise<LLMResponse> {
    try {
      logger.api.info("Processing image with LLM");

      const userId = await this.getUserId();

      const formData = new FormData();
      formData.append("image", image);

      if (message) {
        formData.append("message", message);
      }

      formData.append("history", JSON.stringify(history));
      formData.append("user_id", userId);

      const response = await fetch(`${config.api.baseUrl}/chat/image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      logger.api.error("Error processing image:", error);
      throw error;
    }
  }

  /**
   * Get user filters from the server
   */
  async getUserFilters(): Promise<Filter[]> {
    try {
      const userId = await this.getUserId();

      const response = await fetch(
        `${config.api.baseUrl}/filters?user_id=${userId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const data = await response.json();

      if (data.status !== "success") {
        throw new Error(data.message || "Unknown error getting user filters");
      }

      return data.filters || [];
    } catch (error) {
      logger.api.error("Error getting user filters:", error);
      throw error;
    }
  }

  /**
   * Create a new filter
   */
  async createFilter(filterData: {
    filter_text: string;
    content_type: "text" | "image" | "all";
    intensity: number;
    duration: string;
  }): Promise<ServerResponse<any>> {
    try {
      const userId = await this.getUserId();

      const response = await fetch(`${config.api.baseUrl}/filters`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          ...filterData,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      logger.api.error("Error creating filter:", error);
      throw error;
    }
  }

  /**
   * Delete a filter
   */
  async deleteFilter(filterId: string): Promise<ServerResponse<any>> {
    try {
      const userId = await this.getUserId();

      const response = await fetch(
        `${config.api.baseUrl}/filters/${filterId}?user_id=${userId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      logger.api.error("Error deleting filter:", error);
      throw error;
    }
  }

  /**
   * Update an existing filter
   */
  async updateFilter(filterId: string, filterData: {
    filter_text: string;
    content_type: "text" | "image" | "all";
    intensity: number;
    duration: string;
  }): Promise<ServerResponse<any>> {
    try {
      const userId = await this.getUserId();

      const response = await fetch(
        `${config.api.baseUrl}/filters/${filterId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            user_id: userId,
            ...filterData,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      logger.api.error("Error updating filter:", error);
      throw error;
    }
  }

  /**
   * Test connection to the server
   */
  async testConnection(): Promise<ServerResponse<boolean>> {
    try {
      const response = await fetch(`${config.api.baseUrl}/ping`, {
        method: "GET",
      });

      if (!response.ok) {
        return {
          status: "error",
          message: `Server returned ${response.status}`,
        };
      }

      return { status: "success", data: true };
    } catch (error) {
      logger.api.error("Error testing connection:", error);
      return { status: "error", message: (error as Error).message };
    }
  }

  /**
   * Wait for image processing result via WebSocket or polling
   */
  async waitForImageProcessing(
    imageUrl: string,
    filters: string[],
    timeout: number = 160000, // 160 seconds default timeout
  ): Promise<any> {
    // debugLog(`[DIY-MOD API] Registering image wait for: ${safeUrlLog(imageUrl)}`);
    // debugLog(`[DIY-MOD API] Filters:`, filters);
    if (config.api.websockets.useWebSockets) {
      debugLog(
        `[DIY-MOD API] WebSocket connected:`,
        this.wsClient && this.wsClient.isConnected(),
      );

      // If WebSocket is connected, use it for real-time updates
      if (this.wsClient && this.wsClient.isConnected()) {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            this.imageProcessingCallbacks.delete(imageUrl);
            logError(
              "DIY-MOD API",
              `Timeout for image: ${safeUrlLog(imageUrl)}`,
            );
            reject(new Error("Image processing timeout"));
          }, timeout);

          // Register callback for this image
          this.imageProcessingCallbacks.set(imageUrl, (result) => {
            clearTimeout(timeoutId);
            this.pendingImageRequests.delete(imageUrl); // Remove from pending
            debugLog(
              `[DIY-MOD API] ✅ Callback executed for ${safeUrlLog(imageUrl)}`,
            );
            logger.websocket.info(
              `Received processed image result for ${imageUrl}`,
            );
            resolve(result);
          });

          // Track this as a pending request
          this.pendingImageRequests.set(imageUrl, {
            filters,
            timestamp: Date.now(),
          });

          debugLog(
            `[DIY-MOD API] Callback registered. Total callbacks:`,
            this.imageProcessingCallbacks.size,
          );

          logger.websocket.info(
            `Sending wait_for_image request for ${imageUrl} with filters:`,
            filters,
          );
          if (config.logging?.level === "debug") {
            console.log(`[DIY-MOD] Waiting for image processing: ${imageUrl}`);
          }

          // Notify server we're waiting for this image
          this.wsClient.send("wait_for_image", {
            image_url: imageUrl,
            filters: filters,
          });
        });
      }
    } else {
      // Fallback to polling if WebSocket is not available
      // logger.websocket.info("WebSocket not connected, falling back to polling");
      return this.pollForImageResult(imageUrl, filters);
    }
  }

  /**
   * Poll for image processing result (fallback when WebSocket is not available)
   */
  private async pollForImageResult(
    imageUrl: string,
    filters: string[],
  ): Promise<any> {
    const maxAttempts = config.api.polling.maxAttempts;
    const baseIntervalMs = config.api.polling.baseIntervalMs;
    const maxIntervalMs = config.api.polling.maxIntervalMs || 60000; // Default to 60 seconds if not set

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(
          `${config.api.pollingBaseUrl}${config.api.endpoints.imageResult}?` +
            `img_url=${encodeURIComponent(imageUrl)}&` +
            `filters=${encodeURIComponent(JSON.stringify(filters))}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${response.statusText}`,
          );
        }

        const result = await response.json();

        if (result.status === "COMPLETED" && result.processed_value) {
          return result.processed_value;
        }

        // Calculate delay for next attempt based on configuration
        if (attempt < maxAttempts - 1) {
          let nextDelay: number;
          
          if (config.api.polling.useCustomTiming) {
            // Custom timing: 5s for first 2 attempts, 2.5s for the rest
            if (attempt < 2) {
              nextDelay = config.api.polling.customTiming.firstTwoAttemptsMs;
            } else {
              nextDelay = config.api.polling.customTiming.remainingAttemptsMs;
              
              // Add small random variance (±20%) to remaining attempts to prevent thundering herd
              const variance = 0.2;
              const jitterAmount = nextDelay * variance * (Math.random() * 2 - 1);
              nextDelay = Math.max(2000, nextDelay + jitterAmount); // Min 2 seconds
            }
          } else {
            // Original exponential backoff algorithm
            const exponentialDelay = baseIntervalMs * Math.pow(2, attempt);
            
            // Add jitter (±15%) to prevent synchronized retries
            const jitter = 0.15;
            const jitterAmount = exponentialDelay * jitter * (Math.random() * 2 - 1);
            
            // Apply delay with jitter, capped at maximum interval
            nextDelay = Math.min(exponentialDelay + jitterAmount, maxIntervalMs);
          }
          
          logger.api.info(
            `Polling attempt ${attempt + 1}/${maxAttempts} for image: ${safeUrlLog(imageUrl)}. Next attempt in ${Math.round(nextDelay/1000)}s`,
          );
          
          await new Promise((resolve) => setTimeout(resolve, nextDelay));
        }
      } catch (error) {
        logger.api.error("Error polling for image result:", error);
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw new Error("Image processing timeout - max polling attempts reached");
  }

  /**
   * Get user ID from storage
   */
  async getUserId(): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(["user_id"], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!result.user_id) {
          reject(new Error("User ID not found in storage"));
          return;
        }

        resolve(result.user_id);
      });
    });
  }

  /**
   * Get the authenticated user info
   */
  async getUserInfo(): Promise<{ id: string; token?: string } | null> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getUserInfo" }, (response) => {
        resolve(response.user || null);
      });
    });
  }

  /**
   * Re-register pending image requests after WebSocket reconnection
   */
  private reRegisterPendingImages(): void {
    if (!this.wsClient || !this.wsClient.isConnected()) {
      return;
    }

    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    // Re-register all pending images that aren't too old
    for (
      const [imageUrl, { filters, timestamp }] of this.pendingImageRequests
        .entries()
    ) {
      if (now - timestamp < maxAge) {
        logger.websocket.info(
          `Re-registering pending image: ${imageUrl} with filters:`,
          filters,
        );
        this.wsClient.send("wait_for_image", {
          image_url: imageUrl,
          filters: filters,
        });
      } else {
        // Remove old requests
        this.pendingImageRequests.delete(imageUrl);
        this.imageProcessingCallbacks.delete(imageUrl);
      }
    }
  }
}

// Export as singleton
export const apiService = new ApiService();
