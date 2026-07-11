import type { Post, Feed } from "./types"

export const mockPostsFeed1: Post[] = [
  {
    id: "1a",
    title: "5 weeks post 270° TT",
    subreddit: "tummytucksurgery",
    author: "user123",
    score: 53,
    comments: 10,
    timeAgo: "6 hr. ago",
    url: "#",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Screenshot%202025-07-16%20at%202.42.21%E2%80%AFPM-plkglB9cJeAV7B2BInKJcFOr6AKaMH.png",
    content:
      "Let me eng-explain how I use ClaudeAI as an old hat egineer, but before I do that I'd like to give you a little insight into my credentials so you know I'm not a vibe coder gone rouge. I have a CS degree and I've been doing dotnet development since dotnet was invented 20 years ago (you can check my post history on reddit to verify this).",
  },
  {
    id: "2a",
    title: "The beautiful scenery of the Swiss Alps",
    subreddit: "travel",
    author: "globetrotter",
    score: 1200,
    comments: 256,
    timeAgo: "1 day ago",
    url: "#",
    imageUrl: "/placeholder.svg?width=600&height=400",
    flair: "Photography",
  },
  {
    id: "3a",
    title: "What's the best way to learn a new programming language in 2025?",
    subreddit: "learnprogramming",
    author: "code_newbie",
    score: 450,
    comments: 150,
    timeAgo: "12 hr. ago",
    url: "#",
    content:
      "I've been a developer for a few years, mainly working with JavaScript. I want to pick up a new language, maybe something like Rust or Go. What are the most effective learning strategies you've found? Any recommended resources, courses, or books would be greatly appreciated!",
  },
]

export const mockPostsFeed2: Post[] = [
  {
    id: "1b",
    title: "5 weeks post 270° TT (Edited Version)",
    subreddit: "tummytucksurgery",
    author: "user123",
    score: 53,
    comments: 10,
    timeAgo: "6 hr. ago",
    url: "#",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Screenshot%202025-07-16%20at%202.42.21%E2%80%AFPM-plkglB9cJeAV7B2BInKJcFOr6AKaMH.png",
    content:
      "As a software engineer with 20+ years of experience, let me explain how I use ClaudeAI. I have a CS degree and have been a .NET developer for two decades. This isn't just a trend for me; it's a tool I've integrated into a long-standing professional workflow.",
  },
  {
    id: "2b",
    title: "The stunning Swiss Alps landscape",
    subreddit: "travel",
    author: "globetrotter",
    score: 1200,
    comments: 256,
    timeAgo: "1 day ago",
    url: "#",
    imageUrl: "/placeholder.svg?width=600&height=400",
    flair: "Photography",
  },
  {
    id: "3b",
    title: "Best method for learning a new language as a dev?",
    subreddit: "learnprogramming",
    author: "code_newbie",
    score: 450,
    comments: 150,
    timeAgo: "12 hr. ago",
    url: "#",
    content:
      "I'm a JS dev looking to learn Rust or Go. What's the best way to do it in 2025? Looking for strategies and resources. Thanks!",
  },
]

export const mockFeeds: Feed[] = [
  {
    id: "feed1",
    name: "Original Feed (r/all)",
    posts: mockPostsFeed1,
  },
  {
    id: "feed2",
    name: "Edited Feed (Comparison)",
    posts: mockPostsFeed2,
  },
  {
    id: "feed3",
    name: "Custom Feed: Tech",
    posts: [mockPostsFeed1[2], mockPostsFeed2[2]],
  },
]
