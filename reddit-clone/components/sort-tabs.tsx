"use client"

import { Button } from "@/components/ui/button"
import { Flame, TrendingUp, Clock, Star } from "lucide-react"

export function SortTabs() {
  return (
    <div className="flex items-center gap-1 p-2 bg-white border-b border-gray-200">
      <Button variant="ghost" size="sm" className="flex items-center gap-2 text-blue-600 bg-blue-50">
        <Flame className="h-4 w-4" />
        Hot
      </Button>
      <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600">
        <TrendingUp className="h-4 w-4" />
        Rising
      </Button>
      <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600">
        <Clock className="h-4 w-4" />
        New
      </Button>
      <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600">
        <Star className="h-4 w-4" />
        Top
      </Button>
    </div>
  )
}
