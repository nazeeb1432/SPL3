"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Filter } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useState } from "react"

interface TagVisibilityControlsProps {
  tagVisibility: Record<string, boolean>
  setTagVisibility: (visibility: Record<string, boolean>) => void
}

export function TagVisibilityControls({ tagVisibility, setTagVisibility }: TagVisibilityControlsProps) {
  const [isOpen, setIsOpen] = useState(false)

  const availableTags = Object.keys(tagVisibility)
  const visibleTagsCount = Object.values(tagVisibility).filter(Boolean).length

  const handleTagToggle = (tag: string, visible: boolean) => {
    setTagVisibility({
      ...tagVisibility,
      [tag]: visible,
    })
  }

  const handleToggleAll = (visible: boolean) => {
    const newVisibility: Record<string, boolean> = {}
    availableTags.forEach((tag) => {
      newVisibility[tag] = visible
    })
    setTagVisibility(newVisibility)
  }

  if (availableTags.length === 0) {
    return null
  }

  return (
    <div className="mt-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 border-gray-300 text-gray-700 hover:bg-gray-50 bg-transparent"
          >
            <Filter className="h-4 w-4" />
            Tag Filters
            <Badge variant="secondary" className="bg-gray-100 text-gray-700">
              {visibleTagsCount}/{availableTags.length}
            </Badge>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3">
          <Card className="border-gray-300">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-900">Tag Visibility</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleAll(true)}
                    className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Show All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleAll(false)}
                    className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <EyeOff className="h-3 w-3 mr-1" />
                    Hide All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {availableTags.map((tag) => (
                  <div key={tag} className="flex items-center space-x-2">
                    <Switch
                      id={`tag-${tag}`}
                      checked={tagVisibility[tag]}
                      onCheckedChange={(checked) => handleTagToggle(tag, checked)}
                    />
                    <Label htmlFor={`tag-${tag}`} className="text-sm text-gray-700 cursor-pointer flex-1">
                      {tag}
                    </Label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
