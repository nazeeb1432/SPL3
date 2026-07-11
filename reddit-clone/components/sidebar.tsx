"use client"

import type React from "react"

import Link from "next/link"
import {
  Home,
  ArrowUpRight,
  MessageSquareIcon as MessageSquareQuestion,
  Compass,
  BarChart3,
  Plus,
  Star,
  Settings,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { cn } from "@/lib/utils"

const mainLinks = [
  { icon: Home, label: "Home", href: "/", active: true },
  { icon: ArrowUpRight, label: "Popular", href: "#" },
  { icon: MessageSquareQuestion, label: "Answers", href: "#", beta: true },
  { icon: Compass, label: "Explore", href: "#" },
  { icon: BarChart3, label: "All", href: "#" },
]

const customFeeds = [
  { icon: "🧪", label: "Test Feed" },
  { icon: "🚀", label: "Test 2 Feed" },
]

const recentItems = [
  { icon: "💍", label: "r/Weddingsunder10k" },
  { icon: "💪", label: "r/gastricsleeve" },
  { icon: "🌳", label: "r/AnnArbor" },
  { icon: "🏦", label: "r/JPMorganChase" },
]

const communities = [
  { icon: "🎨", label: "r/100daysml" },
  // Add more communities here
]

export function Sidebar() {
  const [isCustomFeedsOpen, setCustomFeedsOpen] = useState(true)
  const [isRecentOpen, setRecentOpen] = useState(true)
  const [isCommunitiesOpen, setCommunitiesOpen] = useState(true)

  return (
    <aside className="w-60 hidden lg:block sticky top-12 h-[calc(100vh-3rem)] overflow-y-auto bg-white border-r border-reddit-border pr-4">
      <nav className="p-2">
        <ul>
          {mainLinks.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-reddit-hover",
                  link.active && "bg-reddit-active",
                )}
              >
                <link.icon className="h-5 w-5" />
                <span>{link.label}</span>
                {link.beta && <span className="text-xs text-reddit-orange font-bold">BETA</span>}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <CollapsibleSection title="Custom Feeds" isOpen={isCustomFeedsOpen} setIsOpen={setCustomFeedsOpen}>
            <ul className="space-y-1">
              <li>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2 text-sm font-medium">
                  <Plus className="h-5 w-5" /> Create a custom feed
                </Button>
              </li>
              {customFeeds.map((feed) => (
                <li key={feed.label} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <span className="text-lg">{feed.icon}</span>
                    <span>{feed.label}</span>
                  </div>
                  <Star className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>

        <div className="mt-2 pt-2 border-t border-gray-200">
          <CollapsibleSection title="Recent" isOpen={isRecentOpen} setIsOpen={setRecentOpen}>
            <ul className="space-y-1">
              {recentItems.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-3 px-3 py-2 text-sm font-medium hover:bg-reddit-hover rounded-md"
                >
                  <span className="text-lg">{item.icon}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>

        <div className="mt-2 pt-2 border-t border-gray-200">
          <CollapsibleSection title="Communities" isOpen={isCommunitiesOpen} setIsOpen={setCommunitiesOpen}>
            <ul className="space-y-1">
              <li>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2 text-sm font-medium">
                  <Plus className="h-5 w-5" /> Create a community
                </Button>
              </li>
              <li>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2 text-sm font-medium">
                  <Settings className="h-5 w-5" /> Manage communities
                </Button>
              </li>
              {communities.map((comm) => (
                <li key={comm.label} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <span className="text-lg">{comm.icon}</span>
                    <span>{comm.label}</span>
                  </div>
                  <Star className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      </nav>
    </aside>
  )
}

function CollapsibleSection({
  title,
  isOpen,
  setIsOpen,
  children,
}: { title: string; isOpen: boolean; setIsOpen: (isOpen: boolean) => void; children: React.ReactNode }) {
  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-reddit-text-secondary uppercase tracking-wider"
      >
        <span>{title}</span>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {isOpen && <div className="mt-1">{children}</div>}
    </div>
  )
}
