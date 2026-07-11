"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { ComparisonSet } from "@/lib/api/customFeedApi"
import { formatDistanceToNow } from "date-fns"

interface FeedSelectorProps {
  comparisonSets: ComparisonSet[]
  selectedComparisonSetId: string | null
  onComparisonSetSelect: (comparisonSetId: string) => void
  loading: boolean
}

export function FeedSelector({ comparisonSets, selectedComparisonSetId, onComparisonSetSelect, loading }: FeedSelectorProps) {
  if (loading && comparisonSets.length === 0) {
    return (
      <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (comparisonSets.length === 0) {
    return (
      <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
        <p className="text-gray-500 text-center">No comparison sets available. Please generate some feeds with interventions.</p>
      </div>
    )
  }

  return (
    <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900">Select a Comparison Set</h2>
        <span className="text-sm text-gray-500">{comparisonSets.length} set{comparisonSets.length !== 1 ? 's' : ''} available</span>
      </div>
      
      <Select 
        value={selectedComparisonSetId || ""} 
        onValueChange={onComparisonSetSelect}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a comparison set to display" />
        </SelectTrigger>
        <SelectContent>
          {comparisonSets.map((set) => (
            <SelectItem key={set.comparison_set_id} value={set.comparison_set_id}>
              <div className="flex flex-col">
                <span className="font-medium">{set.original_title}</span>
                <span className="text-xs text-gray-500">
                  Created {formatDistanceToNow(new Date(set.original_created_at), { addSuffix: true })}
                  {set.filtered_count > 0 && ` • ${set.filtered_count} filtered version${set.filtered_count !== 1 ? 's' : ''}`}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedComparisonSetId && (
        <div className="mt-3 text-sm text-gray-600">
          <div className="flex gap-4">
            {(() => {
              const selectedSet = comparisonSets.find(s => s.comparison_set_id === selectedComparisonSetId)
              if (selectedSet) {
                return (
                  <div>
                    <span className="font-medium">Available versions: </span>
                    <span className="inline-block ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      Original
                    </span>
                    {selectedSet.filtered_count > 0 && (
                      <span className="inline-block ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                        {selectedSet.filtered_count} Filtered
                      </span>
                    )}
                  </div>
                )
              }
              return null
            })()}
          </div>
        </div>
      )}
    </div>
  )
}