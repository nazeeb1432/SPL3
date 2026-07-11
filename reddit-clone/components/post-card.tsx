"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowUp, ArrowDown, MessageCircle, Share, Bookmark, MoreHorizontal, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Post, PostImage } from "@/lib/types"
import { renderInterventions } from "@/lib/intervention-parser"
import Image from "next/image"
import { useWebSocket } from "@/contexts/websocket-context"
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";

interface PostCardProps {
  post: Post
  isProcessed?: boolean
  sessionId?: string
}

interface RenderImageProps {
  image: PostImage
  title: string
  isProcessed: boolean
  sessionId?: string
}

function RenderImage({ image, title, isProcessed, sessionId }: RenderImageProps) {
  const intervention = isProcessed ? image.intervention : undefined
  const { subscribeToImageUpdates, sessionId: contextSessionId } = useWebSocket()
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  
  useEffect(() => {
    // Subscribe to updates for images that are being processed
    if (intervention?.type === 'cartoonish' || intervention?.type === 'edit_to_replace') {
      if (intervention.status === 'processing' && image.url) {
        const effectiveSessionId = sessionId || contextSessionId
        const unsubscribe = subscribeToImageUpdates(
          image.url, 
          (newUrl) => {
            console.log(`Image processed: ${image.url} -> ${newUrl}`)
            setProcessedUrl(newUrl)
          },
          intervention.type,
          effectiveSessionId
        )
        
        return unsubscribe
      }
    }
  }, [image.url, intervention, subscribeToImageUpdates, sessionId, contextSessionId])
  
  // Use processed URL if available
  const displayUrl = processedUrl || image.url || "/placeholder.svg"
  
  if (intervention?.type === 'cartoonish' || intervention?.type === 'edit_to_replace') {
    // Handle deferred processing
    if (intervention.status === 'processing' && !processedUrl) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center p-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
            <p className="text-sm">Processing image...</p>
            <p className="text-xs text-gray-400 mt-1">{intervention.type}</p>
          </div>
        </div>
      )
    } else if (intervention.status === 'failed') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
          <div className="text-center p-4">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm">Failed to process image</p>
          </div>
        </div>
      )
    }
  }
  
  // Apply CSS-based interventions
  const imageClasses = cn(
    "w-full h-full object-contain",
    intervention?.type === 'blur' && "filter blur-lg hover:blur-none transition-all duration-300",
    intervention?.type === 'overlay' && "opacity-10"
  )

  // Determine if image has been modified
  const isImageModified = intervention && (
    intervention.type === 'cartoonish' || 
    intervention.type === 'edit_to_replace' ||
    intervention.type === 'blur' ||
    intervention.type === 'overlay'
  )
  
  return (
    <div className={cn(
      "relative w-full h-full",
      isImageModified && "diymod-image-modified"
    )}>
      <Image
        src={displayUrl}
        alt={title}
        width={600}
        height={400}
        className={imageClasses}
      />
      {intervention?.type === 'overlay' && (
        <div className="absolute inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center">
          <div className="text-center text-white p-4">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm font-medium">Content Hidden</p>
            <p className="text-xs text-gray-300 mt-1">Image filtered</p>
          </div>
        </div>
      )}
    </div>
  )
}

export function PostCard({ post, isProcessed = false, sessionId }: PostCardProps) {
  const [userVote, setUserVote] = useState<"up" | "down" | null>(null)

  const getVoteCount = () => {
    let count = post.score
    if (userVote === "up") {
      count = post.score + 1
    } else if (userVote === "down") {
      count = post.score - 1
    }
    return count
  }

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return num.toString()
  }

  return (
    <Card className="bg-reddit-card border border-reddit-border hover:border-reddit-blue transition-colors w-full rounded-md flex">
      <div className="flex flex-col items-center p-1 bg-reddit-hover w-10 flex-shrink-0 rounded-l-md">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 p-0 text-reddit-text-secondary hover:bg-gray-200 hover:text-reddit-orange",
            userVote === "up" && "text-reddit-orange bg-orange-100",
          )}
          onClick={() => setUserVote(userVote === "up" ? null : "up")}
        >
          <ArrowUp className="h-5 w-5" />
        </Button>
        <span
          className={cn(
            "text-xs font-bold py-1 min-w-[2rem] text-center text-reddit-text-primary",
            userVote === "up" && "text-reddit-orange",
            userVote === "down" && "text-reddit-periwinkle",
          )}
        >
          {formatNumber(getVoteCount())}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 p-0 text-reddit-text-secondary hover:bg-gray-200 hover:text-reddit-periwinkle",
            userVote === "down" && "text-reddit-periwinkle bg-blue-100",
          )}
          onClick={() => setUserVote(userVote === "down" ? null : "down")}
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-2 min-w-0 w-full flex-grow">
        <div className="flex items-center flex-wrap gap-x-2 text-xs text-reddit-text-secondary mb-2">
          <span className="font-bold text-reddit-text-primary hover:underline">r/{post.subreddit}</span>
          <span>•</span>
          <span>Posted by u/{post.author}</span>
          <span>{post.timeAgo}</span>
        </div>

        <h3 className="text-lg font-medium text-reddit-text-primary mb-2 break-words">
          {isProcessed ? (
            <div 
              className="intervention-content"
              dangerouslySetInnerHTML={{ __html: renderInterventions(post.title) }}
            />
          ) : (
            post.title
          )}
        </h3>

        {/* Render images with interventions if available, otherwise fallback to imageUrl */}
        {(post.images && post.images.length > 0) ? (
          <div className="w-full mb-2">
            {post.images.length === 1 ? (
              // Single image
              <div className="relative bg-black rounded-md overflow-hidden">
                <RenderImage image={post.images[0]} title={post.title} isProcessed={isProcessed} sessionId={sessionId} />
              </div>
            ) : (
              // Multiple images in a gallery
                <Carousel className="w-full">
                  <CarouselContent>
                    {post.images.map((image, index) => (
                      <CarouselItem key={index}>
                        <RenderImage
                          image={image}
                          title={`${post.title} - Image ${index + 1}`}
                          isProcessed={isProcessed}
                          sessionId={sessionId}
                        />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="left-2 bg-black/50 hover:bg-black/70 text-white" />
                  <CarouselNext className="right-2 bg-black/50 hover:bg-black/70 text-white" />
                </Carousel>
            )}
          </div>
        ) : post.imageUrl && (
          // Fallback to single imageUrl for backward compatibility
          <div className="w-full mb-2 bg-black rounded-md overflow-hidden">
            <Image
              src={post.imageUrl || "/placeholder.svg"}
              alt={post.title}
              width={600}
              height={400}
              className="w-full h-auto object-contain max-h-[500px]"
            />
          </div>
        )}

        {post.content && post.content.trim() !== '' && (
          <div className="text-sm text-reddit-text-primary mb-2 break-words max-h-40 overflow-hidden relative mask-fade">
            {isProcessed ? (
              <div 
                className="intervention-content"
                dangerouslySetInnerHTML={{ __html: renderInterventions(post.content) }}
              />
            ) : (
              <div>{post.content}</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm font-bold text-reddit-text-secondary">
          <Button variant="ghost" size="sm" className="hover:bg-reddit-hover px-3 py-1.5 h-auto rounded-full">
            <MessageCircle className="h-5 w-5 mr-1.5" />
            <span>{formatNumber(post.comments)}</span>
          </Button>
          <Button variant="ghost" size="sm" className="hover:bg-reddit-hover px-3 py-1.5 h-auto rounded-full">
            <Share className="h-5 w-5 mr-1.5" />
            <span>Share</span>
          </Button>
          <Button variant="ghost" size="sm" className="hover:bg-reddit-hover px-3 py-1.5 h-auto rounded-full">
            <Bookmark className="h-5 w-5 mr-1.5" />
            <span>Save</span>
          </Button>
          <Button variant="ghost" size="icon" className="hover:bg-reddit-hover rounded-full h-8 w-8">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
