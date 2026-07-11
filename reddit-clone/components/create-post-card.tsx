"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ImageIcon, LinkIcon } from "lucide-react"

export function CreatePostCard() {
  return (
    <Card className="w-full bg-white border border-gray-300 shadow-sm">
      <CardContent className="flex items-center space-x-4 p-4">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder-user.jpg" />
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
        <Input
          placeholder="Create Post"
          className="flex-1 rounded-full bg-gray-100 border-gray-200 focus:ring-blue-500 focus:border-blue-500"
          readOnly
        />
        <Button variant="ghost" size="icon" className="rounded-full">
          <ImageIcon className="h-5 w-5 text-gray-500" />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-full">
          <LinkIcon className="h-5 w-5 text-gray-500" />
        </Button>
      </CardContent>
    </Card>
  )
}
