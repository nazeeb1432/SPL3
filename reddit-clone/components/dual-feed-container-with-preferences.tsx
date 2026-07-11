"use client"

import { useRef, useEffect, useState } from "react"
import { ScrollArea, ScrollBar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { PostCard } from "./post-card"
import { PostPreferenceSelector } from "./post-preference-selector"
import { PreferencesSubmitPanel, type PostPreference } from "./preferences-submit-panel"
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

interface DualFeedContainerWithPreferencesProps {
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
  userId: string
  comparisonSetId: string
}

export function DualFeedContainerWithPreferences({ 
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
  currentSetFeeds,
  userId,
  comparisonSetId
}: DualFeedContainerWithPreferencesProps) {
  const feed1Ref = useRef<HTMLDivElement>(null)
  const feed2Ref = useRef<HTMLDivElement>(null)
  const lockRef = useRef<boolean>(false)
  
  // Preference collection state
  const [preferenceMode, setPreferenceMode] = useState(false)
  const [preferences, setPreferences] = useState<Record<string, PostPreference>>({})

  // Helper to format date for dropdown display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Extract text content from post (title + content)
  const extractTextContent = (post: Post): string => {
    const title = post.title || ''
    const content = post.content || ''
    return `${title}\n\n${content}`.trim()
  }

  // Handle preference changes
  const handlePreferenceChange = (postId: string, newPreferences: {
    textPreference?: 0 | 1
    imagePreference?: 0 | 1
  }) => {
    const leftPost = feed1Posts.find(p => p.id.replace('-original', '').replace('-processed', '') === postId)
    const rightPost = feed2Posts.find(p => p.id.replace('-original', '').replace('-processed', '') === postId)
    
    if (!leftPost || !rightPost) return

    setPreferences(prev => ({
      ...prev,
      [postId]: {
        post_id: postId,
        post0_text_content: extractTextContent(leftPost),
        post1_text_content: extractTextContent(rightPost),
        text_preference: newPreferences.textPreference,
        post0_image_url: leftPost.imageUrl || leftPost.images?.[0]?.url || '',
        post1_image_url: rightPost.imageUrl || rightPost.images?.[0]?.url || '',
        image_preference: newPreferences.imagePreference
      }
    }))
  }

  // Submit preferences to backend
  const handleSubmitPreferences = async (preferencesToSubmit: PostPreference[]) => {
    const response = await fetch('/api/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        comparison_set_id: comparisonSetId,
        preferences: preferencesToSubmit
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to submit preferences: ${response.statusText}`)
    }

    return response.json()
  }

  // Reset all preferences
  const handleResetPreferences = () => {
    setPreferences({})
  }

  const handleScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
    if (lockRef.current) return
    lockRef.current = true

    const sourceScrollHeight = source.scrollHeight - source.clientHeight
    const targetScrollHeight = target.scrollHeight - target.clientHeight
    
    if (sourceScrollHeight > 0 && targetScrollHeight > 0) {
      const ratio = source.scrollTop / sourceScrollHeight
      const newTargetScrollTop = ratio * targetScrollHeight
      
      if (Math.abs(target.scrollTop - newTargetScrollTop) > 1) {
        target.scrollTop = newTargetScrollTop
      }
    }
    
    lockRef.current = false
  }

  useEffect(() => {
    const el1 = feed1Ref.current
    const el2 = feed2Ref.current

    if (!el1 || !el2) return

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

    el1.addEventListener("scroll", onScroll1, { passive: true })
    el2.addEventListener("scroll", onScroll2, { passive: true })

    return () => {
      el1.removeEventListener("scroll", onScroll1)
      el2.removeEventListener("scroll", onScroll2)
    }
  }, [])

  // Simple height synchronization
  useEffect(() => {
    if (!feed1Posts || !feed2Posts || feed1Posts.length === 0) return;

    const syncHeights = () => {

      postHeightRefs.current.forEach(([leftRef, rightRef], index) => {
        if (!leftRef || !rightRef) {
          console.log(`Post ${index}: Missing refs - left: ${leftRef ? 'OK' : 'NULL'}, right: ${rightRef ? 'OK' : 'NULL'}`);
          return;
        }

        // Reset heights
        leftRef.style.minHeight = '';
        rightRef.style.minHeight = '';

        // Get natural heights
        const leftHeight = leftRef.offsetHeight;
        const rightHeight = rightRef.offsetHeight;
        const maxHeight = Math.max(leftHeight, rightHeight);


        // Apply sync if there's a difference
        if (Math.abs(leftHeight - rightHeight) > 5) {
          leftRef.style.minHeight = `${maxHeight}px`;
          rightRef.style.minHeight = `${maxHeight}px`;
        }
      });
    };

    // Run sync with delays to catch async content
    const timeouts = [
      setTimeout(() => {
        syncHeights();
      }, 500),
      setTimeout(() => {
        syncHeights();
      }, 1000),
      setTimeout(() => {
        syncHeights();
      }, 2000),
      setTimeout(() => {
        syncHeights();
      }, 3000)
    ];

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [feed1Posts, feed2Posts, leftFeedId, rightFeedId]);

  // Generate unique post pairs for preference collection
  const getPostPairs = () => {
    const pairs: Array<{
      postId: string
      leftPost: Post
      rightPost: Post
    }> = []

    // Match posts by their base ID (removing -original/-processed suffix)
    const leftPostMap = new Map<string, Post>()
    const rightPostMap = new Map<string, Post>()

    feed1Posts.forEach(post => {
      const baseId = post.id.replace('-original', '').replace('-processed', '')
      leftPostMap.set(baseId, post)
    })

    feed2Posts.forEach(post => {
      const baseId = post.id.replace('-original', '').replace('-processed', '')
      rightPostMap.set(baseId, post)
    })

    // Create pairs where both sides exist
    leftPostMap.forEach((leftPost, baseId) => {
      const rightPost = rightPostMap.get(baseId)
      if (rightPost) {
        pairs.push({
          postId: baseId,
          leftPost,
          rightPost
        })
      }
    })

    return pairs
  }

  const postHeightRefs = useRef<Array<[HTMLDivElement | null, HTMLDivElement | null]>>([]);

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
      <div className="space-y-2">
        {posts.map((post, index) => (
          <div
            key={post.id}
            className="post-wrapper transition-all duration-200"
            style={{ 
              minHeight: 'fit-content',
              marginBottom: '8px'
            }}
            ref={el => {
              if (!postHeightRefs.current[index]) {
                postHeightRefs.current[index] = [null, null];
              }
              postHeightRefs.current[index][isLeft ? 0 : 1] = el;
            }}
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

  const renderPreferencesView = () => {
    const postPairs = getPostPairs()
    
    return (
      <div className="space-y-4">
        <div className="text-center mb-6">
          <h2 className="text-xl font-semibold mb-2">Compare Feed Versions</h2>
          <p className="text-gray-600">
            Compare each post between the two feed versions and select your preferences.
          </p>
        </div>

        {postPairs.map(({ postId, leftPost, rightPost }) => (
          <div key={postId} className="space-y-4">
            {/* Post Comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-center bg-blue-100 p-2 rounded">
                  Left: {processedVersions[leftFeedId]?.metadata?.title || 'Unknown Version'}
                </h4>
                <PostCard
                  post={leftPost}
                  isProcessed={leftFeedId !== 'original'}
                  sessionId={sessionId1}
                />
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-center bg-purple-100 p-2 rounded">
                  Right: {processedVersions[rightFeedId]?.metadata?.title || 'Unknown Version'}
                </h4>
                <PostCard
                  post={rightPost}
                  isProcessed={rightFeedId !== 'original'}
                  sessionId={sessionId2}
                />
              </div>
            </div>

            {/* Preference Selector */}
            <PostPreferenceSelector
              postId={postId}
              leftPost={{
                title: leftPost.title,
                content: leftPost.content,
                imageUrl: leftPost.imageUrl || leftPost.images?.[0]?.url
              }}
              rightPost={{
                title: rightPost.title,
                content: rightPost.content,
                imageUrl: rightPost.imageUrl || rightPost.images?.[0]?.url
              }}
              onPreferenceChange={handlePreferenceChange}
              currentPreferences={preferences[postId]}
            />
          </div>
        ))}

        {/* Submit Panel */}
        <PreferencesSubmitPanel
          preferences={preferences}
          totalPosts={postPairs.length}
          onSubmit={handleSubmitPreferences}
          onReset={handleResetPreferences}
          userId={userId}
          comparisonSetId={comparisonSetId}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode Toggle */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Viewing Mode</h3>
            <p className="text-sm text-gray-600">
              {preferenceMode ? 'Compare posts and collect preferences' : 'View feeds side by side'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm">View Mode</span>
            <Switch
              checked={preferenceMode}
              onCheckedChange={setPreferenceMode}
            />
            <span className="text-sm">Preference Mode</span>
          </div>
        </div>
      </div>

      {preferenceMode ? (
        <ScrollArea className="flex-1">
          <div className="p-4">
            {renderPreferencesView()}
          </div>
        </ScrollArea>
      ) : (
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
      )}
    </div>
  )
}