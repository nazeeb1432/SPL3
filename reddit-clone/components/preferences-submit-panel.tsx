"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, Circle, Send, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PostPreference {
  post_id: string
  post0_text_content: string
  post1_text_content: string
  text_preference?: 0 | 1
  post0_image_url?: string
  post1_image_url?: string
  image_preference?: 0 | 1
}

interface PreferencesSubmitPanelProps {
  preferences: Record<string, PostPreference>
  totalPosts: number
  onSubmit: (preferences: PostPreference[]) => Promise<void>
  onReset: () => void
  userId: string
  comparisonSetId: string
}

export function PreferencesSubmitPanel({
  preferences,
  totalPosts,
  onSubmit,
  onReset,
  userId,
  comparisonSetId
}: PreferencesSubmitPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)

  // Calculate statistics
  const preferencesArray = Object.values(preferences)
  const postsWithTextPrefs = preferencesArray.filter(p => p.text_preference !== undefined).length
  const postsWithImagePrefs = preferencesArray.filter(p => p.image_preference !== undefined).length
  const postsWithAnyPrefs = preferencesArray.filter(p => 
    p.text_preference !== undefined || p.image_preference !== undefined
  ).length

  const completionPercentage = Math.round((postsWithAnyPrefs / totalPosts) * 100)

  const handleSubmit = async () => {
    const preferencesToSubmit = preferencesArray.filter(p => 
      p.text_preference !== undefined || p.image_preference !== undefined
    )

    if (preferencesToSubmit.length === 0) {
      setSubmitMessage("Please select preferences for at least one post before submitting.")
      return
    }

    setIsSubmitting(true)
    setSubmitMessage(null)

    try {
      await onSubmit(preferencesToSubmit)
      setSubmitMessage(`Successfully submitted preferences for ${preferencesToSubmit.length} posts!`)
      
      // Clear submitted preferences from the preferences object
      preferencesToSubmit.forEach(pref => {
        if (preferences[pref.post_id]) {
          delete preferences[pref.post_id]
        }
      })
    } catch (error) {
      setSubmitMessage(`Error submitting preferences: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 sticky bottom-4 z-10">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Preference Summary</h3>
          <Badge variant="outline" className="bg-white">
            {postsWithAnyPrefs}/{totalPosts} posts rated
          </Badge>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Completion Progress</span>
            <span>{completionPercentage}%</span>
          </div>
          <Progress value={completionPercentage} className="h-2" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>Text preferences: {postsWithTextPrefs}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-purple-500" />
            <span>Image preferences: {postsWithImagePrefs}</span>
          </div>
        </div>

        {/* Message */}
        {submitMessage && (
          <div className={cn(
            "p-3 rounded-lg text-sm",
            submitMessage.includes("Error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          )}>
            {submitMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || postsWithAnyPrefs === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? (
              <>
                <Circle className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Preferences ({postsWithAnyPrefs})
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={onReset}
            disabled={isSubmitting}
            className="border-gray-300"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All
          </Button>
        </div>

        {/* Submission Info */}
        <div className="text-xs text-gray-500 space-y-1">
          <p>• You can submit multiple times - only posts with selections will be sent</p>
          <p>• Submitted preferences will be cleared from this form</p>
          <p>• User: {userId} | Set: {comparisonSetId}</p>
        </div>
      </div>
    </Card>
  )
}