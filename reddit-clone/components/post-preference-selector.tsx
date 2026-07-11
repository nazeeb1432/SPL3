"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface PostPreferenceSelectorProps {
  postId: string
  leftPost: {
    title: string
    content?: string
    imageUrl?: string
  }
  rightPost: {
    title: string
    content?: string
    imageUrl?: string
  }
  onPreferenceChange: (postId: string, preferences: {
    textPreference?: 0 | 1
    imagePreference?: 0 | 1
  }) => void
  currentPreferences?: {
    textPreference?: 0 | 1
    imagePreference?: 0 | 1
  }
}

export function PostPreferenceSelector({
  postId,
  leftPost,
  rightPost,
  onPreferenceChange,
  currentPreferences
}: PostPreferenceSelectorProps) {
  const [textPreference, setTextPreference] = useState<0 | 1 | undefined>(
    currentPreferences?.textPreference
  )
  const [imagePreference, setImagePreference] = useState<0 | 1 | undefined>(
    currentPreferences?.imagePreference
  )

  const handleTextPreference = (preference: 0 | 1) => {
    const newPref = textPreference === preference ? undefined : preference
    setTextPreference(newPref)
    onPreferenceChange(postId, {
      textPreference: newPref,
      imagePreference
    })
  }

  const handleImagePreference = (preference: 0 | 1) => {
    const newPref = imagePreference === preference ? undefined : preference
    setImagePreference(newPref)
    onPreferenceChange(postId, {
      textPreference,
      imagePreference: newPref
    })
  }

  const hasText = (leftPost.title || leftPost.content) && (rightPost.title || rightPost.content)
  const hasImages = leftPost.imageUrl && rightPost.imageUrl

  return (
    <Card className="p-4 mb-4 bg-blue-50 border-2 border-blue-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-blue-100">
            Post {postId}
          </Badge>
          <span className="text-sm text-gray-600">Select your preferences</span>
        </div>
        <div className="flex gap-2">
          {textPreference !== undefined && (
            <Badge variant="default" className="bg-blue-500">
              Text: {textPreference === 0 ? 'Left' : 'Right'}
            </Badge>
          )}
          {imagePreference !== undefined && (
            <Badge variant="default" className="bg-purple-500">
              Image: {imagePreference === 0 ? 'Left' : 'Right'}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Text Preference */}
        {hasText && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Text Content Preference:</h4>
            <div className="flex gap-2 justify-center">
              <Button
                variant={textPreference === 0 ? "default" : "outline"}
                size="sm"
                onClick={() => handleTextPreference(0)}
                className={cn(
                  "transition-all",
                  textPreference === 0 && "bg-blue-600 hover:bg-blue-700"
                )}
              >
                Prefer Left
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTextPreference(undefined)
                  onPreferenceChange(postId, { textPreference: undefined, imagePreference })
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                Skip
              </Button>
              <Button
                variant={textPreference === 1 ? "default" : "outline"}
                size="sm"
                onClick={() => handleTextPreference(1)}
                className={cn(
                  "transition-all",
                  textPreference === 1 && "bg-blue-600 hover:bg-blue-700"
                )}
              >
                Prefer Right
              </Button>
            </div>
          </div>
        )}

        {/* Image Preference */}
        {hasImages && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Image Content Preference:</h4>
            <div className="flex gap-2 justify-center">
              <Button
                variant={imagePreference === 0 ? "default" : "outline"}
                size="sm"
                onClick={() => handleImagePreference(0)}
                className={cn(
                  "transition-all",
                  imagePreference === 0 && "bg-purple-600 hover:bg-purple-700"
                )}
              >
                Prefer Left
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setImagePreference(undefined)
                  onPreferenceChange(postId, { textPreference, imagePreference: undefined })
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                Skip
              </Button>
              <Button
                variant={imagePreference === 1 ? "default" : "outline"}
                size="sm"
                onClick={() => handleImagePreference(1)}
                className={cn(
                  "transition-all",
                  imagePreference === 1 && "bg-purple-600 hover:bg-purple-700"
                )}
              >
                Prefer Right
              </Button>
            </div>
          </div>
        )}

        {!hasText && !hasImages && (
          <div className="text-center text-gray-500 text-sm">
            No comparable content found for this post
          </div>
        )}
      </div>
    </Card>
  )
}