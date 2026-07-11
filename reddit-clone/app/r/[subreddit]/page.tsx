import { Header } from "@/components/header"
import { PostCard } from "@/components/post-card"
import { CreatePostCard } from "@/components/create-post-card"
import { SortTabs } from "@/components/sort-tabs"
import { SubredditHeader } from "@/components/subreddit-header"
import { SubredditSidebar } from "@/components/subreddit-sidebar"

const subredditData = {
  nextjs: {
    name: "Next.js",
    description: "The React Framework for Production",
    members: 125000,
    online: 2400,
    created: "Jan 15, 2020",
    icon: "⚛️",
    banner: "/placeholder.svg?height=200&width=800",
    rules: [
      "Be respectful and constructive",
      "No spam or self-promotion without permission",
      "Use descriptive titles",
      "Search before posting",
      "Follow Reddit's content policy",
    ],
  },
  programming: {
    name: "Programming",
    description: "Computer Programming",
    members: 4200000,
    online: 15600,
    created: "Jan 25, 2006",
    icon: "👨‍💻",
    banner: "/placeholder.svg?height=200&width=800",
    rules: [
      "Keep submissions on topic and of high quality",
      "No surveys, polls, or homework help",
      "No career/education posts",
      "Avoid low-effort content",
      "Be professional and respectful",
    ],
  },
  webdev: {
    name: "Web Development",
    description: "A community for web developers",
    members: 890000,
    online: 5200,
    created: "Mar 10, 2010",
    icon: "💻",
    banner: "/placeholder.svg?height=200&width=800",
    rules: [
      "Be respectful and constructive",
      "No spam or self-promotion",
      "Use descriptive titles",
      "Search before posting",
      "Follow Reddit's content policy",
    ],
  },
  MachineLearning: {
    name: "Machine Learning",
    description: "A subreddit dedicated to learning machine learning",
    members: 2100000,
    online: 8900,
    created: "Feb 20, 2008",
    icon: "🤖",
    banner: "/placeholder.svg?height=200&width=800",
    rules: [
      "Be respectful and constructive",
      "No homework help requests",
      "Use descriptive titles",
      "Provide context for questions",
      "Follow Reddit's content policy",
    ],
  },
}

const getPostsForSubreddit = (subreddit: string) => {
  const basePosts = [
    {
      id: 1,
      subreddit: subreddit,
      user: "developer123",
      timeAgo: "4 hours ago",
      title: `${subreddit} - Latest Discussion Thread`,
      content: `Welcome to the ${subreddit} community! Share your thoughts, questions, and projects here.`,
      upvotes: 1247,
      comments: 89,
      awards: ["helpful", "wholesome"],
      type: "text" as const,
    },
    {
      id: 2,
      subreddit: subreddit,
      user: "community_mod",
      timeAgo: "6 hours ago",
      title: `Weekly ${subreddit} Showcase`,
      content: `Show off your latest projects and get feedback from the community!`,
      upvotes: 892,
      comments: 156,
      awards: ["silver"],
      type: "text" as const,
    },
    {
      id: 3,
      subreddit: subreddit,
      user: "expert_user",
      timeAgo: "1 day ago",
      title: `${subreddit} Best Practices Guide`,
      imageUrl: "/placeholder.svg?height=400&width=600",
      content: `A comprehensive guide to best practices in ${subreddit}.`,
      upvotes: 2341,
      comments: 234,
      awards: ["gold", "helpful"],
      type: "image" as const,
    },
  ]
  return basePosts
}

export default function SubredditPage({ params }: { params: { subreddit: string } }) {
  const subreddit = subredditData[params.subreddit as keyof typeof subredditData]
  const posts = getPostsForSubreddit(params.subreddit)

  if (!subreddit) {
    return (
      <div className="min-h-screen bg-[#DAE0E6]">
        <Header />
        <div className="max-w-5xl mx-auto px-4 py-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Subreddit not found</h1>
          <p className="text-gray-600">The subreddit r/{params.subreddit} doesn't exist or has been removed.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#DAE0E6]">
      <Header />
      <SubredditHeader subreddit={subreddit} subredditName={params.subreddit} />
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_312px] gap-6">
          <main className="space-y-4">
            <CreatePostCard subreddit={params.subreddit} />
            <SortTabs />
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </main>
          <SubredditSidebar subreddit={subreddit} subredditName={params.subreddit} />
        </div>
      </div>
    </div>
  )
}
