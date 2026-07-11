"use client"

import { useState, useRef } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PostCard } from "@/components/post-card"
import { CreatePostCard } from "@/components/create-post-card"
import { FeedSortDropdown } from "@/components/feed-sort-dropdown"
import { useWebSocket } from "@/components/websocket-provider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Eye,
  EyeOff,
  ArrowUpDown,
  FileText,
  ArrowLeftRight,
  Shuffle,
  Upload,
  Trash2,
  Files,
  CheckCircle,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/hooks/use-toast"
import { TagVisibilityControls } from "@/components/tag-visibility-controls"

export function MobileDualFeed() {
  const {
    leftFeedPosts,
    rightFeedPosts,
    leftFeedSource,
    rightFeedSource,
    setLeftFeedSource,
    setRightFeedSource,
    availableSources,
    dataSources,
    uploadHTMLFile,
    uploadHTMLFiles,
    removeCustomSource,
    tagVisibility,
    setTagVisibility,
  } = useWebSocket()

  const [activeTab, setActiveTab] = useState("left")
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [uploadName, setUploadName] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResults, setUploadResults] = useState<{
    successful: Array<{ fileName: string; sourceName: string; postCount: number }>
    failed: Array<{ fileName: string; error: string }>
  } | null>(null)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getSourceDisplayName = (source: string) => {
    return (
      dataSources[source]?.displayName ||
      source
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
  }

  const getSourceIcon = (source: string) => {
    if (source.includes("original")) return <Eye className="h-4 w-4" />
    if (source.includes("censored")) return <EyeOff className="h-4 w-4" />
    if (source.includes("ai-filtered")) return <ArrowUpDown className="h-4 w-4" />
    return <FileText className="h-4 w-4" />
  }

  const getSourceType = (source: string) => {
    return dataSources[source]?.type || "built-in"
  }

  const swapFeeds = () => {
    const tempSource = leftFeedSource
    setLeftFeedSource(rightFeedSource)
    setRightFeedSource(tempSource)
  }

  const randomizeFeeds = () => {
    const shuffled = [...availableSources].sort(() => Math.random() - 0.5)
    setLeftFeedSource(shuffled[0])
    setRightFeedSource(shuffled[1])
  }

  const resetUploadDialog = () => {
    setUploadName("")
    setUploadProgress(0)
    setUploadResults(null)
    setIsBatchMode(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleSingleFileUpload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file || !uploadName.trim()) {
      toast({
        title: "Error",
        description: "Please select a file and enter a source name",
        variant: "destructive",
      })
      return
    }

    if (!file.name.toLowerCase().endsWith(".html")) {
      toast({
        title: "Error",
        description: "Please upload an HTML file",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 20, 90))
      }, 100)

      await uploadHTMLFile(file, uploadName.trim())

      clearInterval(progressInterval)
      setUploadProgress(100)

      toast({
        title: "Success",
        description: `Successfully uploaded ${uploadName} with 3 variants (Original, Censored, AI Filtered)`,
      })

      setTimeout(() => {
        setIsUploadOpen(false)
        resetUploadDialog()
      }, 1000)
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleBatchFileUpload = async () => {
    const files = fileInputRef.current?.files
    if (!files || files.length === 0 || !uploadName.trim()) {
      toast({
        title: "Error",
        description: "Please select files and enter a base source name",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90))
      }, 200)

      const results = await uploadHTMLFiles(files, uploadName.trim())

      clearInterval(progressInterval)
      setUploadProgress(100)
      setUploadResults(results)

      if (results.successful.length > 0) {
        toast({
          title: "Batch Upload Complete",
          description: `Successfully uploaded ${results.successful.length} files. ${results.failed.length > 0 ? `${results.failed.length} files failed.` : ""}`,
        })
      } else {
        toast({
          title: "Upload Failed",
          description: "No files were successfully uploaded",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveSource = (sourceName: string) => {
    const baseSourceName = sourceName.replace(/^custom-(original|censored|ai-filtered)-/, "")
    removeCustomSource(baseSourceName)
    toast({
      title: "Removed",
      description: `Removed custom source: ${baseSourceName}`,
    })
  }

  const groupedSources = availableSources.reduce(
    (groups, source) => {
      const type = getSourceType(source)
      if (!groups[type]) groups[type] = []
      groups[type].push(source)
      return groups
    },
    {} as Record<string, string[]>,
  )

  // Filter posts based on tag visibility
  const filterPostsByTags = (posts: typeof leftFeedPosts) => {
    return posts.filter((post) => {
      if (!post.tags || post.tags.length === 0) return true
      return post.tags.some((tag) => tagVisibility[tag] !== false)
    })
  }

  const filteredLeftPosts = filterPostsByTags(leftFeedPosts)
  const filteredRightPosts = filterPostsByTags(rightFeedPosts)

  return (
    <div className="lg:hidden p-4 space-y-4 bg-gray-50 min-h-screen">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Left Feed Control */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              Left Feed
            </Badge>
          </div>
          <Select value={leftFeedSource} onValueChange={setLeftFeedSource}>
            <SelectTrigger className="w-full bg-white border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]">
              <div className="flex items-center gap-2">
                {getSourceIcon(leftFeedSource)}
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(groupedSources).map(([type, sources]) => (
                <div key={type}>
                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase">
                    {type === "built-in" ? "Built-in Sources" : "Custom Sources"}
                  </div>
                  {sources.map((source) => (
                    <SelectItem key={source} value={source}>
                      <div className="flex items-center gap-2 w-full">
                        {getSourceIcon(source)}
                        <span className="flex-1">{getSourceDisplayName(source)}</span>
                        {type === "uploaded" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 ml-2 text-gray-400 hover:text-red-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveSource(source)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right Feed Control */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center gap-2 sm:justify-end">
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Right Feed
            </Badge>
          </div>
          <Select value={rightFeedSource} onValueChange={setRightFeedSource}>
            <SelectTrigger className="w-full bg-white border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]">
              <div className="flex items-center gap-2">
                {getSourceIcon(rightFeedSource)}
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(groupedSources).map(([type, sources]) => (
                <div key={type}>
                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase">
                    {type === "built-in" ? "Built-in Sources" : "Custom Sources"}
                  </div>
                  {sources.map((source) => (
                    <SelectItem key={source} value={source}>
                      <div className="flex items-center gap-2 w-full">
                        {getSourceIcon(source)}
                        <span className="flex-1">{getSourceDisplayName(source)}</span>
                        {type === "uploaded" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 ml-2 text-gray-400 hover:text-red-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveSource(source)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button
          onClick={swapFeeds}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeftRight className="h-4 w-4" />
          Swap
        </Button>
        <Button
          onClick={randomizeFeeds}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          <Shuffle className="h-4 w-4" />
          Random
        </Button>

        {/* Upload Button */}
        <Dialog
          open={isUploadOpen}
          onOpenChange={(open) => {
            setIsUploadOpen(open)
            if (!open) resetUploadDialog()
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <Upload className="h-4 w-4" />
              Upload
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Upload Reddit HTML Files</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Upload Mode Toggle */}
              <div className="flex items-center gap-4">
                <Button
                  variant={!isBatchMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsBatchMode(false)}
                  className="flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Single File
                </Button>
                <Button
                  variant={isBatchMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsBatchMode(true)}
                  className="flex items-center gap-2"
                >
                  <Files className="h-4 w-4" />
                  Batch Upload
                </Button>
              </div>

              <div>
                <Label htmlFor="source-name" className="text-sm font-medium text-gray-700">
                  {isBatchMode ? "Base Source Name" : "Source Name"}
                </Label>
                <Input
                  id="source-name"
                  placeholder={isBatchMode ? "e.g., My Feed Collection" : "e.g., My Custom Feed"}
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  className="border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]"
                />
                {isBatchMode && (
                  <p className="text-xs text-gray-500 mt-1">
                    Files will be named: "{uploadName} 1", "{uploadName} 2", etc.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="html-file" className="text-sm font-medium text-gray-700">
                  HTML Files
                </Label>
                <Input
                  id="html-file"
                  type="file"
                  accept=".html"
                  multiple={isBatchMode}
                  ref={fileInputRef}
                  className="border-gray-300 focus:border-[#0079D3] focus:ring-[#0079D3]"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {isBatchMode
                    ? "Select multiple HTML files containing shreddit-post elements"
                    : "Upload an HTML file containing shreddit-post elements"}
                </p>
              </div>

              {/* Progress Bar */}
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {isBatchMode ? "Processing files..." : "Uploading file..."}
                    </span>
                    <span className="text-sm text-gray-600">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="w-full" />
                </div>
              )}

              {/* Upload Results */}
              {uploadResults && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Upload Results</h4>
                  <ScrollArea className="h-32 w-full border rounded p-3 border-gray-300">
                    <div className="space-y-2">
                      {uploadResults.successful.map((result, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <span className="font-medium text-gray-900">{result.fileName}</span>
                          <span className="text-gray-600">
                            → {result.sourceName} ({result.postCount} posts)
                          </span>
                        </div>
                      ))}
                      {uploadResults.failed.map((result, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                          <XCircle className="h-4 w-4 text-red-600" />
                          <span className="font-medium text-gray-900">{result.fileName}</span>
                          <span className="text-red-600">→ {result.error}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsUploadOpen(false)}
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  {uploadResults ? "Close" : "Cancel"}
                </Button>
                {!uploadResults && (
                  <Button
                    onClick={isBatchMode ? handleBatchFileUpload : handleSingleFileUpload}
                    disabled={isUploading}
                    className="bg-[#0079D3] hover:bg-[#0079D3]/90 text-white"
                  >
                    {isUploading ? "Uploading..." : isBatchMode ? "Upload Files" : "Upload File"}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tag Visibility Controls */}
      <TagVisibilityControls tagVisibility={tagVisibility} setTagVisibility={setTagVisibility} />

      <Tabs defaultValue="left" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 bg-white border border-gray-300">
          <TabsTrigger value="left" className="data-[state=active]:bg-[#0079D3] data-[state=active]:text-white">
            Left Feed ({filteredLeftPosts.length})
          </TabsTrigger>
          <TabsTrigger value="right" className="data-[state=active]:bg-[#0079D3] data-[state=active]:text-white">
            Right Feed ({filteredRightPosts.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="left" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{getSourceDisplayName(leftFeedSource)}</h2>
            <FeedSortDropdown side="left" />
          </div>
          <CreatePostCard />
          {filteredLeftPosts.map((post) => (
            <PostCard key={`left-${post.id}`} post={post} />
          ))}
          <div className="h-20" />
        </TabsContent>
        <TabsContent value="right" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{getSourceDisplayName(rightFeedSource)}</h2>
            <FeedSortDropdown side="right" />
          </div>
          <CreatePostCard />
          {filteredRightPosts.map((post) => (
            <PostCard key={`right-${post.id}`} post={post} />
          ))}
          <div className="h-20" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
