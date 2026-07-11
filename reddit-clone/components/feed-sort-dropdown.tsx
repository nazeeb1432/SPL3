"use client"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { useState } from "react"

interface FeedSortDropdownProps {
  side: "left" | "right"
}

export function FeedSortDropdown({ side }: FeedSortDropdownProps) {
  const [sortOption, setSortOption] = useState("hot") // Default sort option

  const handleSortChange = (option: string) => {
    setSortOption(option)
    // In a real application, you would trigger a data re-fetch or re-sort here
    console.log(`Sorting ${side} feed by: ${option}`)
  }

  const getDisplayName = (option: string) => {
    switch (option) {
      case "hot":
        return "Hot"
      case "new":
        return "New"
      case "top":
        return "Top"
      case "rising":
        return "Rising"
      default:
        return "Sort"
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-1 bg-transparent">
          {getDisplayName(sortOption)}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={side === "left" ? "start" : "end"}>
        <DropdownMenuItem onClick={() => handleSortChange("hot")}>Hot</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSortChange("new")}>New</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSortChange("top")}>Top</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSortChange("rising")}>Rising</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
