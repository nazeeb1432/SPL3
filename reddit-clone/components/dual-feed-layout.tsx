"use client"

import { Header } from "@/components/header"
import { DualFeedContainerWithPreferences } from "@/components/dual-feed-container-with-preferences"
import { Sidebar } from "@/components/sidebar"

export function DualFeedLayout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <div className="flex">
        <div className="flex-1">
          <DualFeedContainerWithPreferences />
        </div>
        <Sidebar />
      </div>
    </div>
  )
}
