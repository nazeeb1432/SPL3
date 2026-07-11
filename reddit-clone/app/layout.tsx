import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Header } from "@/components/header"
import { Toaster } from "@/components/ui/toaster"
import { WebSocketProvider } from "@/contexts/websocket-context"
import { UserProvider } from "@/contexts/UserContext"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "DIY MOD - Feed Comparison Tool",
  description: "Compare original and filtered Reddit feeds for user studies",
  generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <UserProvider>
            <WebSocketProvider>
              <Header />
              <main className="w-full max-w-[1400px] mx-auto pt-4 px-4">{children}</main>
              <Toaster />
            </WebSocketProvider>
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
