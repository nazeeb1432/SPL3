"use client"

import { ArrowUp, ArrowDown, MessageSquare, Share, Bookmark, MoreHorizontal, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Image from "next/image"
import { useState } from "react"
import Link from "next/link"

interface Post {
  id: number
  subreddit: string
  user: string
  timeAgo: string
  title: string
  content?: string
  imageUrl?: string
  linkUrl?: string
  linkDomain?: string
  upvotes: number
  comments: number
  awards: string[]
  type: "text" | "image" | "link"
}

interface PostDetailProps {
  post: Post
}

export function PostDetail({ post }: PostDetailProps) {
  const [vote, setVote] = useState<"up" | "down" | null>(null)
  const [currentUpvotes, setCurrentUpvotes] = useState(post.upvotes)

  const handleVote = (voteType: "up" | "down") => {
    if (vote === voteType) {
      setVote(null)
      setCurrentUpvotes(post.upvotes)
    } else {
      const previousVote = vote
      setVote(voteType)

      let newUpvotes = post.upvotes
      if (previousVote === "up") newUpvotes -= 1
      if (previousVote === "down") newUpvotes += 1

      if (voteType === "up") newUpvotes += 1
      if (voteType === "down") newUpvotes -= 1

      setCurrentUpvotes(newUpvotes)
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k"
    }
    return num.toString()
  }

  return (
    <Card className="bg-white border border-gray-300">
      <div className="flex">
        {/* Vote buttons */}
        <div className="flex flex-col items-center p-2 bg-gray-50 w-12 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={`w-6 h-6 p-0 ${vote === "up" ? "text-[#FF4500]" : "text-gray-400 hover:text-[#FF4500]"}`}
            onClick={() => handleVote("up")}
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
          <span
            className={`text-xs font-bold ${vote === "up" ? "text-[#FF4500]" : vote === "down" ? "text-[#7193FF]" : "text-gray-700"}`}
          >
            {formatNumber(currentUpvotes)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={`w-6 h-6 p-0 ${vote === "down" ? "text-[#7193FF]" : "text-gray-400 hover:text-[#7193FF]"}`}
            onClick={() => handleVote("down")}
          >
            <ArrowDown className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 min-w-0">
          {/* Header */}
          <div className="flex items-center text-xs text-gray-500 mb-3 flex-wrap">
            <Link href={`/r/${post.subreddit}`} className="font-bold text-black hover:underline flex-shrink-0">
              r/{post.subreddit}
            </Link>
            <span className="mx-1 flex-shrink-0">•</span>
            <span className="flex-shrink-0">Posted by</span>
            <Link href={`/user/${post.user}`} className="ml-1 hover:underline flex-shrink-0">
              u/{post.user}
            </Link>
            <span className="ml-1 flex-shrink-0">{post.timeAgo}</span>
            {post.awards.length > 0 && (
              <div className="flex items-center ml-2 space-x-1 flex-shrink-0">
                {post.awards.map((award, index) => (
                  <div
                    key={index}
                    className="w-4 h-4 bg-yellow-400 rounded-full text-xs flex items-center justify-center"
                  >
                    🏆
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-xl font-medium text-gray-900 mb-4 break-words leading-tight">{post.title}</h1>

          {/* Content based on type */}
          {post.type === "text" && post.content && (
            <div className="text-gray-700 text-sm mb-4 whitespace-pre-wrap break-words leading-relaxed">
              {post.content}
            </div>
          )}

          {post.type === "image" && post.imageUrl && (
            <div className="mb-4">
              <Image
                src={post.imageUrl || "/placeholder.svg"}
                alt={post.title}
                width={600}
                height={400}
                className="rounded border max-w-full h-auto"
              />
            </div>
          )}

          {post.type === "link" && post.linkUrl && (
            <div className="mb-4 p-3 border border-gray-300 rounded bg-gray-50">
              <div className="flex items-center space-x-2">
                <ExternalLink className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <a
                  href={post.linkUrl}
                  className="text-blue-600 hover:underline text-sm break-all"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {post.linkDomain}
                </a>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center space-x-4 text-gray-500 flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="text-xs h-8 px-2 flex-shrink-0">
              <MessageSquare className="w-4 h-4 mr-1" />
              {post.comments} Comments
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-8 px-2 flex-shrink-0">
              <Share className="w-4 h-4 mr-1" />
              Share
            </Button>
            <Button variant="ghost" size="sm" className="text-xs h-8 px-2 flex-shrink-0">
              <Bookmark className="w-4 h-4 mr-1" />
              Save
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-8 h-8 flex-shrink-0">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Hide</DropdownMenuItem>
                <DropdownMenuItem>Report</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </Card>
  )
}
