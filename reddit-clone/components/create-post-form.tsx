"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileText, ImageIcon as Image, Link, VoteIcon as Poll } from "lucide-react"
import { useState } from "react"

export function CreatePostForm() {
  const [selectedCommunity, setSelectedCommunity] = useState("")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")

  const communities = ["r/nextjs", "r/programming", "r/webdev", "r/javascript", "r/css", "r/react"]

  return (
    <Card className="bg-white border border-gray-300">
      <CardHeader>
        <CardTitle className="text-lg">Create a post</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Choose a community</label>
          <Select value={selectedCommunity} onValueChange={setSelectedCommunity}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a community" />
            </SelectTrigger>
            <SelectContent>
              {communities.map((community) => (
                <SelectItem key={community} value={community}>
                  {community}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="post" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="post" className="flex items-center space-x-2">
              <FileText className="w-4 h-4" />
              <span>Post</span>
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center space-x-2">
              <Image className="w-4 h-4" />
              <span>Images & Video</span>
            </TabsTrigger>
            <TabsTrigger value="link" className="flex items-center space-x-2">
              <Link className="w-4 h-4" />
              <span>Link</span>
            </TabsTrigger>
            <TabsTrigger value="poll" className="flex items-center space-x-2">
              <Poll className="w-4 h-4" />
              <span>Poll</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-4" />

            <TabsContent value="post" className="mt-0">
              <Textarea
                placeholder="Text (optional)"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[200px]"
              />
            </TabsContent>

            <TabsContent value="image" className="mt-0">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Image className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 mb-2">Drag and drop images or videos here</p>
                <Button variant="outline">Upload</Button>
              </div>
            </TabsContent>

            <TabsContent value="link" className="mt-0">
              <Input placeholder="Url" className="mb-4" />
              <Textarea placeholder="Text (optional)" className="min-h-[100px]" />
            </TabsContent>

            <TabsContent value="poll" className="mt-0">
              <div className="space-y-3">
                <Input placeholder="Option 1" />
                <Input placeholder="Option 2" />
                <Button variant="outline" size="sm">
                  Add option
                </Button>
                <div className="flex items-center space-x-4 text-sm">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" />
                    <span>Voting length</span>
                  </label>
                  <Select defaultValue="3">
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button variant="outline">Save Draft</Button>
          <Button
            className="bg-[#0079D3] hover:bg-[#0079D3]/90 text-white"
            disabled={!selectedCommunity || !title.trim()}
          >
            Post
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
