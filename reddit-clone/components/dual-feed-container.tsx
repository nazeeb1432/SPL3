"use client"

import { useRef, useEffect } from "react"
import { ScrollArea, ScrollBar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PostCard } from "./post-card"
import type { Post } from "@/lib/types"
import type { ComparisonSetFeed } from "@/lib/api/customFeedApi"



interface ProcessedFeedVersion {
  posts: Post[]
  metadata: {
    title: string
    created_at: string
    session_id?: string
    filters?: string[]
  }
}

interface DualFeedContainerProps {
  feed1Posts: Post[]
  feed2Posts: Post[]
  loading?: boolean
  sessionId1?: string
  sessionId2?: string
  leftFeedId: string
  rightFeedId: string
  onLeftFeedChange: (feedId: string) => void
  onRightFeedChange: (feedId: string) => void
  processedVersions: Record<string, ProcessedFeedVersion>
  currentSetFeeds: {
    original: ComparisonSetFeed | null;
    filtered: ComparisonSetFeed[];
    all_feeds: ComparisonSetFeed[];
  }
}

export function DualFeedContainer({ 
  feed1Posts, 
  feed2Posts, 
  loading = false, 
  sessionId1,
  sessionId2,
  leftFeedId,
  rightFeedId,
  onLeftFeedChange,
  onRightFeedChange,
  processedVersions,
  currentSetFeeds
}: DualFeedContainerProps) {
  const feed1Ref = useRef<HTMLDivElement>(null)
  const feed2Ref = useRef<HTMLDivElement>(null)
  const lockRef = useRef<boolean>(false)

  // Helper to format date for dropdown display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const handleScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
    if (lockRef.current) return
    lockRef.current = true

    const sourceScrollHeight = source.scrollHeight - source.clientHeight
    const targetScrollHeight = target.scrollHeight - target.clientHeight
    
    if (sourceScrollHeight > 0 && targetScrollHeight > 0) {
      const ratio = source.scrollTop / sourceScrollHeight
      const newTargetScrollTop = ratio * targetScrollHeight
      
      // Only update if there's a meaningful difference (reduces jitter)
      if (Math.abs(target.scrollTop - newTargetScrollTop) > 1) {
        target.scrollTop = newTargetScrollTop
      }
    }
    
    // Release lock immediately for better responsiveness
    lockRef.current = false
  }

  useEffect(() => {
    const el1 = feed1Ref.current
    const el2 = feed2Ref.current

    if (!el1 || !el2) return

    // Use throttling for smoother scroll performance
    let ticking = false
    
    const onScroll1 = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll(el1, el2)
          ticking = false
        })
        ticking = true
      }
    }
    
    const onScroll2 = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll(el2, el1)
          ticking = false
        })
        ticking = true
      }
    }

    // Use passive listeners for better performance
    el1.addEventListener("scroll", onScroll1, { passive: true })
    el2.addEventListener("scroll", onScroll2, { passive: true })

    return () => {
      el1.removeEventListener("scroll", onScroll1)
      el2.removeEventListener("scroll", onScroll2)
    }
  }, [])

  const renderFeed = (posts: Post[], isLeft: boolean, isProcessed: boolean = false, sessionId?: string) => {
    if (loading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-reddit-card border border-reddit-border rounded-md p-4">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div className="h-20 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2" data-side={isLeft ? 'left' : 'right'}>
        {posts.map((post, index) => (
          <div
            key={post.id}
            className="post-item mb-2"
            data-post-index={index}
          >
            <PostCard
              post={post}
              isProcessed={isProcessed}
              sessionId={sessionId}
            />
          </div>
        ))}
      </div>
    );
  };

  // Simple height synchronization
  useEffect(() => {
    if (!feed1Posts || !feed2Posts || feed1Posts.length === 0) return;

    const syncHeights = () => {
      const leftPosts = document.querySelectorAll('[data-side="left"] .post-item');
      const rightPosts = document.querySelectorAll('[data-side="right"] .post-item');

      console.log(`Found ${leftPosts.length} left posts and ${rightPosts.length} right posts`);

      for (let i = 0; i < Math.min(leftPosts.length, rightPosts.length); i++) {
        const leftPost = leftPosts[i] as HTMLElement;
        const rightPost = rightPosts[i] as HTMLElement;

        if (!leftPost || !rightPost) continue;

        // Reset heights
        leftPost.style.minHeight = '';
        rightPost.style.minHeight = '';

        // Get natural heights
        const leftHeight = leftPost.offsetHeight;
        const rightHeight = rightPost.offsetHeight;
        const maxHeight = Math.max(leftHeight, rightHeight);
        console.log(`Post ${i}: Left height = ${leftHeight}px, Right height = ${rightHeight}px, Max height = ${maxHeight}px`);
        // Apply sync
        if (Math.abs(leftHeight - rightHeight) > 5) {
          leftPost.style.minHeight = `${maxHeight}px`;
          rightPost.style.minHeight = `${maxHeight}px`;
          console.log(`Synced post ${i}: ${leftHeight}px & ${rightHeight}px → ${maxHeight}px`);
        }
      }
    };

    // Run sync with delays to catch async content
    const timeouts = [
      setTimeout(syncHeights, 500),
      setTimeout(syncHeights, 1000),
      setTimeout(syncHeights, 2000),
      setTimeout(syncHeights, 3000)
    ];

    // Also sync on window load for images
    const handleLoad = () => syncHeights();
    window.addEventListener('load', handleLoad);

    return () => {
      timeouts.forEach(clearTimeout);
      window.removeEventListener('load', handleLoad);
    };
  }, [feed1Posts, feed2Posts, leftFeedId, rightFeedId]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow min-h-0">
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <Select value={leftFeedId} onValueChange={onLeftFeedChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select feed version" />
            </SelectTrigger>
            <SelectContent>
              {currentSetFeeds.original && (
                <SelectItem value="original">
                  Original (No Filters) - {formatDate(currentSetFeeds.original.created_at)}
                </SelectItem>
              )}
              {currentSetFeeds.filtered.map((filteredFeed) => (
                <SelectItem key={filteredFeed.id} value={filteredFeed.id.toString()}>
                  {filteredFeed.title} - {formatDate(filteredFeed.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="flex-1 w-full rounded-md border-transparent bg-transparent">
          <ScrollAreaViewport ref={feed1Ref} className="scroll-smooth">
            <div className="space-y-2">{renderFeed(feed1Posts, true, leftFeedId !== 'original', sessionId1)}</div>
          </ScrollAreaViewport>
          <ScrollBar />
        </ScrollArea>
      </div>
      
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <Select value={rightFeedId} onValueChange={onRightFeedChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select feed version" />
            </SelectTrigger>
            <SelectContent>
              {currentSetFeeds.original && (
                <SelectItem value="original">
                  Original (No Filters) - {formatDate(currentSetFeeds.original.created_at)}
                </SelectItem>
              )}
              {currentSetFeeds.filtered.length > 0 && (
                <SelectItem value="latest">Latest Filtered</SelectItem>
              )}
              {currentSetFeeds.filtered.map((filteredFeed) => (
                <SelectItem key={filteredFeed.id} value={filteredFeed.id.toString()}>
                  {filteredFeed.title} - {formatDate(filteredFeed.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="flex-1 w-full rounded-md border-transparent bg-transparent">
          <ScrollAreaViewport ref={feed2Ref} className="scroll-smooth">
            <div className="space-y-2">{renderFeed(feed2Posts, false, rightFeedId !== 'original', sessionId2)}</div>
          </ScrollAreaViewport>
          <ScrollBar />
        </ScrollArea>
      </div>
    </div>
  )
}
