"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Feed } from "@/lib/types"

interface FeedControlsProps {
  availableFeeds: Feed[]
  feed1Source: string
  setFeed1Source: (source: string) => void
  feed2Source: string
  setFeed2Source: (source: string) => void
}

export function FeedControls({
  availableFeeds,
  feed1Source,
  setFeed1Source,
  feed2Source,
  setFeed2Source,
}: FeedControlsProps) {
  return (
    <div className="bg-reddit-card border border-reddit-border rounded p-2 mb-2 flex flex-col sm:flex-row items-center gap-4 sticky top-12 z-10">
      <div className="flex-1 w-full">
        <p className="text-xs text-reddit-text-secondary mb-1 font-semibold">LEFT FEED</p>
        <Select value={feed1Source} onValueChange={setFeed1Source}>
          <SelectTrigger className="w-full h-9">
            <SelectValue placeholder="Select a feed" />
          </SelectTrigger>
          <SelectContent>
            {availableFeeds.map((feed) => (
              <SelectItem key={feed.id} value={feed.id}>
                {feed.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 w-full">
        <p className="text-xs text-reddit-text-secondary mb-1 font-semibold">RIGHT FEED</p>
        <Select value={feed2Source} onValueChange={setFeed2Source}>
          <SelectTrigger className="w-full h-9">
            <SelectValue placeholder="Select a feed" />
          </SelectTrigger>
          <SelectContent>
            {availableFeeds.map((feed) => (
              <SelectItem key={feed.id} value={feed.id}>
                {feed.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
