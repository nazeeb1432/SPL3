"use client"

import { ArrowUp, ArrowDown, MessageSquare, Share, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useState } from "react"
import Link from "next/link"

interface Comment {
  id: number
  user: string
  timeAgo: string
  content: string
  upvotes: number
  replies: Comment[]
}

interface CommentProps {
  comment: Comment
  depth?: number
}

interface CommentSectionProps {
  comments: Comment[]
}

function CommentComponent({ comment, depth = 0 }: CommentProps) {
  const [vote, setVote] = useState<"up" | "down" | null>(null)
  const [currentUpvotes, setCurrentUpvotes] = useState(comment.upvotes)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const handleVote = (voteType: "up" | "down") => {
    if (vote === voteType) {
      setVote(null)
      setCurrentUpvotes(comment.upvotes)
    } else {
      const previousVote = vote
      setVote(voteType)

      let newUpvotes = comment.upvotes
      if (previousVote === "up") newUpvotes -= 1
      if (previousVote === "down") newUpvotes += 1

      if (voteType === "up") newUpvotes += 1
      if (voteType === "down") newUpvotes -= 1

      setCurrentUpvotes(newUpvotes)
    }
  }

  const marginLeft = Math.min(depth * 20, 100)

  return (
    <div className={`${depth > 0 ? "border-l-2 border-gray-200" : ""}`} style={{ marginLeft: `${marginLeft}px` }}>
      <div className="py-2">
        <div className="flex items-start space-x-2">
          <Avatar className="w-6 h-6 mt-1">
            <AvatarImage src="/placeholder-user.jpg" />
            <AvatarFallback className="text-xs bg-gray-200 text-gray-700">
              {comment.user[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 text-xs text-gray-500 mb-1">
              <Link href={`/user/${comment.user}`} className="font-medium text-[#0079D3] hover:underline">
                u/{comment.user}
              </Link>
              <span>{comment.timeAgo}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-4 px-1 text-gray-400 hover:text-gray-600"
                onClick={() => setCollapsed(!collapsed)}
              >
                [{collapsed ? "+" : "−"}]
              </Button>
            </div>

            {!collapsed && (
              <>
                <div className="text-sm text-gray-900 mb-2 whitespace-pre-wrap leading-relaxed">{comment.content}</div>

                <div className="flex items-center space-x-2">
                  <div className="flex items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`w-5 h-5 p-0 hover:bg-orange-100 ${
                        vote === "up" ? "text-[#FF4500]" : "text-gray-400 hover:text-[#FF4500]"
                      }`}
                      onClick={() => handleVote("up")}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </Button>
                    <span
                      className={`text-xs font-bold mx-1 ${
                        vote === "up" ? "text-[#FF4500]" : vote === "down" ? "text-[#7193FF]" : "text-gray-700"
                      }`}
                    >
                      {currentUpvotes}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`w-5 h-5 p-0 hover:bg-blue-100 ${
                        vote === "down" ? "text-[#7193FF]" : "text-gray-400 hover:text-[#7193FF]"
                      }`}
                      onClick={() => handleVote("down")}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6 px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    onClick={() => setShowReplyForm(!showReplyForm)}
                  >
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Reply
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6 px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Share className="w-3 h-3 mr-1" />
                    Share
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-6 h-6 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      >
                        <MoreHorizontal className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem>Save</DropdownMenuItem>
                      <DropdownMenuItem>Report</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {showReplyForm && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      placeholder="What are your thoughts?"
                      className="min-h-[80px] text-sm border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]"
                    />
                    <div className="flex space-x-2">
                      <Button size="sm" className="bg-[#0079D3] hover:bg-[#0079D3]/90 text-white">
                        Comment
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowReplyForm(false)}
                        className="border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {comment.replies.length > 0 && (
                  <div className="mt-3">
                    {comment.replies.map((reply) => (
                      <CommentComponent key={reply.id} comment={reply} depth={depth + 1} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function CommentSection({ comments }: CommentSectionProps) {
  const [sortBy, setSortBy] = useState("best")

  return (
    <Card className="bg-white border border-gray-300">
      <div className="p-4">
        {/* Comment form */}
        <div className="mb-6">
          <div className="text-sm text-gray-600 mb-2">Comment as u/username</div>
          <Textarea
            placeholder="What are your thoughts?"
            className="min-h-[100px] mb-3 border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]"
          />
          <Button className="bg-[#0079D3] hover:bg-[#0079D3]/90 text-white">Comment</Button>
        </div>

        {/* Sort options */}
        <div className="flex items-center space-x-4 mb-4 text-sm">
          <span className="text-gray-600 font-medium">Sort by:</span>
          {["Best", "Top", "New", "Controversial", "Old", "Q&A"].map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              className={`text-xs h-6 px-2 ${
                sortBy === option.toLowerCase()
                  ? "text-[#0079D3] font-medium bg-blue-50"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setSortBy(option.toLowerCase())}
            >
              {option}
            </Button>
          ))}
        </div>

        {/* Comments */}
        <div className="space-y-1">
          {comments.map((comment) => (
            <CommentComponent key={comment.id} comment={comment} />
          ))}
        </div>
      </div>
    </Card>
  )
}
