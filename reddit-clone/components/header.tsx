"use client"

import Link from "next/link"
import { Search, Bell, MessageSquare, Plus, ChevronDown, Rss } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { RedditLogo } from "./reddit-logo"
import { ThemeToggle } from "./theme-toggle"

export function Header() {
  return (
    <header className="bg-reddit-card border-b border-reddit-border sticky top-0 z-20">
      <div className="w-full max-w-[1400px] mx-auto px-4">
        <div className="flex items-center justify-between h-12">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-reddit-text-primary">
              <div className="text-reddit-orange">
                <RedditLogo className="h-8 w-8" />
              </div>
              <span className="font-bold text-xl hidden sm:block">reddit</span>
            </Link>
          </div>

          <div className="flex-1 max-w-xl mx-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-reddit-text-secondary" />
              <Input
                placeholder="Search Reddit"
                className="bg-reddit-active border-reddit-border rounded-full pl-11 h-9 focus:bg-white focus:border-reddit-blue"
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:bg-reddit-hover rounded-full hidden sm:flex"
            >
              <Rss className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:bg-reddit-hover rounded-full hidden sm:flex"
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-gray-600 hover:bg-reddit-hover rounded-full">
              <Bell className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="text-gray-600 hover:bg-reddit-hover rounded-full h-9 px-3">
              <Plus className="h-5 w-5 md:mr-1" />
              <span className="font-bold text-sm hidden md:inline">Create</span>
            </Button>
            <Button variant="outline" className="rounded-full h-9 px-2 sm:px-3 bg-transparent">
              <Avatar className="h-6 w-6">
                <AvatarImage src="/placeholder-user.jpg" />
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
              <ChevronDown className="h-4 w-4 text-gray-500 hidden sm:block ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
