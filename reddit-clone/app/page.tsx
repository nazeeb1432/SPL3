"use client"

import { useState, useEffect } from "react"
import { DualFeedContainerWithPreferences } from "@/components/dual-feed-container-with-preferences"
import { RightSidebar } from "@/components/right-sidebar"
import { FeedSelector } from "@/components/feed-selector"
import { UserLogin } from "@/components/user-login"
import { useUser } from "@/contexts/UserContext"
import { customFeedApi, type SavedFeed, type ComparisonSet, type ComparisonSetFeed, type UserInfo } from "@/lib/api/customFeedApi"
import type { Post } from "@/lib/types"

interface ProcessedFeedVersion {
  posts: Post[]
  metadata: {
    title: string
    created_at: string
    session_id?: string
    filters?: string[]
  }
}

export default function HomePage() {
  const { currentUser, loading: userLoading } = useUser()
  const [comparisonSets, setComparisonSets] = useState<ComparisonSet[]>([])
  const [selectedComparisonSetId, setSelectedComparisonSetId] = useState<string | null>(null)
  const [currentSetFeeds, setCurrentSetFeeds] = useState<{
    original: ComparisonSetFeed | null;
    filtered: ComparisonSetFeed[];
    all_feeds: ComparisonSetFeed[];
  }>({ original: null, filtered: [], all_feeds: [] })
  const [originalPosts, setOriginalPosts] = useState<Post[]>([])
  const [processedVersions, setProcessedVersions] = useState<Record<string, ProcessedFeedVersion>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Track which feed version is selected for each column
  const [leftFeedId, setLeftFeedId] = useState<string>('original')
  const [rightFeedId, setRightFeedId] = useState<string>('latest')

  // Load saved feed selections from localStorage
  useEffect(() => {
    const savedSelections = localStorage.getItem('feedSelections')
    if (savedSelections) {
      try {
        const { left, right } = JSON.parse(savedSelections)
        if (left) setLeftFeedId(left)
        if (right) setRightFeedId(right)
      } catch (error) {
        console.error('Error loading saved selections:', error)
      }
    }
  }, [])

  // Save feed selections to localStorage when they change
  useEffect(() => {
    localStorage.setItem('feedSelections', JSON.stringify({
      left: leftFeedId,
      right: rightFeedId
    }))
  }, [leftFeedId, rightFeedId])

  // Load available comparison sets when user is available
  useEffect(() => {
    if (currentUser) {
      loadComparisonSets()
    }
  }, [currentUser])

  // Load comparison set data when selection changes
  useEffect(() => {
    if (selectedComparisonSetId) {
      loadComparisonSetData(selectedComparisonSetId)
    }
  }, [selectedComparisonSetId])

  const loadComparisonSets = async () => {
    if (!currentUser) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const sets = await customFeedApi.listComparisonSets(currentUser.id)
      setComparisonSets(sets)
      
      // Auto-select the latest comparison set if available
      if (sets.length > 0) {
        setSelectedComparisonSetId(sets[0].comparison_set_id)
      }
    } catch (err) {
      setError('Failed to load comparison sets')
      console.error('Error loading comparison sets:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadComparisonSetData = async (comparisonSetId: string) => {
    if (!currentUser) return

    try {
      setLoading(true)
      const setFeeds = await customFeedApi.getComparisonSetFeeds(currentUser.id, comparisonSetId)
      setCurrentSetFeeds(setFeeds)
      
      // Parse original feed if available
      if (setFeeds.original) {
        const originalParsed = customFeedApi.parseComparisonSetFeed(setFeeds.original)
        setOriginalPosts(originalParsed.original || [])
      }
      
      // Parse all filtered feeds and store them
      const newProcessedVersions: Record<string, ProcessedFeedVersion> = {}
      
      setFeeds.filtered.forEach(filteredFeed => {
        const filteredParsed = customFeedApi.parseComparisonSetFeed(filteredFeed)
        newProcessedVersions[filteredFeed.id.toString()] = {
          posts: filteredParsed.processed || [],
          metadata: {
            title: filteredFeed.title,
            created_at: filteredFeed.created_at,
            session_id: filteredFeed.comparison_set_id,
            filters: filteredFeed.filter_config ? Object.keys(filteredFeed.filter_config) : []
          }
        }
      })
      
      setProcessedVersions(newProcessedVersions)
      
      // Auto-select latest filtered as right feed if available
      if (setFeeds.filtered.length > 0) {
        const latestFiltered = setFeeds.filtered.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
        setRightFeedId(latestFiltered.id.toString())
      }
    } catch (err) {
      setError('Failed to load comparison set data')
      console.error('Error loading comparison set data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Helper function to get posts based on feed selection
  const getPostsForFeed = (feedId: string): Post[] => {
    if (feedId === 'original') {
      return originalPosts
    }
    
    if (feedId === 'latest') {
      // Get the most recent processed feed
      const entries = Object.entries(processedVersions)
      if (entries.length === 0) return []
      
      const latest = entries.sort(([,a], [,b]) => 
        new Date(b.metadata.created_at).getTime() - new Date(a.metadata.created_at).getTime()
      )[0]
      
      return latest ? latest[1].posts : []
    }
    
    return processedVersions[feedId]?.posts || []
  }

  // Helper function to get session ID for a feed
  const getSessionIdForFeed = (feedId: string): string | undefined => {
    if (feedId === 'original') {
      return undefined
    }
    
    if (feedId === 'latest') {
      const entries = Object.entries(processedVersions)
      if (entries.length === 0) return undefined
      
      const latest = entries.sort(([,a], [,b]) => 
        new Date(b.metadata.created_at).getTime() - new Date(a.metadata.created_at).getTime()
      )[0]
      
      return latest ? latest[1].metadata.session_id : undefined
    }
    
    return processedVersions[feedId]?.metadata?.session_id
  }

  // Show login screen if no user
  if (!currentUser && !userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <UserLogin onUserLogin={(user) => {
          // UserContext will handle the state update
        }} />
      </div>
    )
  }

  // Show loading screen while checking user
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      <div className="flex-grow min-w-0">
        {/* User info bar */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md flex justify-between items-center">
          <UserLogin 
            onUserLogin={(user) => {
              // UserContext will handle the state update
            }}
            currentUser={currentUser}
          />
        </div>

        <FeedSelector
          comparisonSets={comparisonSets}
          selectedComparisonSetId={selectedComparisonSetId}
          onComparisonSetSelect={setSelectedComparisonSetId}
          loading={loading}
        />
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
            {error}
          </div>
        )}
        {!error && selectedComparisonSetId && (
          <DualFeedContainerWithPreferences 
            feed1Posts={getPostsForFeed(leftFeedId)} 
            feed2Posts={getPostsForFeed(rightFeedId)}
            loading={loading}
            sessionId1={getSessionIdForFeed(leftFeedId)}
            sessionId2={getSessionIdForFeed(rightFeedId)}
            leftFeedId={leftFeedId}
            rightFeedId={rightFeedId}
            onLeftFeedChange={setLeftFeedId}
            onRightFeedChange={setRightFeedId}
            processedVersions={processedVersions}
            currentSetFeeds={currentSetFeeds}
            userId={currentUser?.id || ''}
            comparisonSetId={selectedComparisonSetId}
          />
        )}
      </div>
      <RightSidebar />
    </div>
  )
}
