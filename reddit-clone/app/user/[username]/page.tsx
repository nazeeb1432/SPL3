import { Header } from "@/components/header"
import { UserProfile } from "@/components/user-profile"
import { PostCard } from "@/components/post-card"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"

const getUserData = (username: string) => {
  return {
    username: username,
    karma: Math.floor(Math.random() * 50000) + 1000,
    cakeDay: "March 15, 2022",
    avatar: "/placeholder.svg?height=100&width=100",
    bio: `${username} is an active member of the Reddit community, passionate about technology and sharing knowledge with others.`,
    badges: ["Verified Email", "One-Year Club", "Gilding I"],
  }
}

const getUserPosts = (username: string) => {
  return [
    {
      id: 1,
      subreddit: "nextjs",
      user: username,
      timeAgo: "4 hours ago",
      title: "My experience with Next.js App Router",
      content: "Sharing my journey learning the new App Router and the challenges I faced along the way.",
      upvotes: 1247,
      comments: 89,
      awards: ["helpful", "wholesome"],
      type: "text" as const,
    },
    {
      id: 2,
      subreddit: "webdev",
      user: username,
      timeAgo: "2 days ago",
      title: "CSS Grid Layout: Tips and Tricks",
      content: "I've been working with CSS Grid for a while now and wanted to share some useful patterns.",
      upvotes: 456,
      comments: 34,
      awards: ["helpful"],
      type: "text" as const,
    },
    {
      id: 3,
      subreddit: "javascript",
      user: username,
      timeAgo: "1 week ago",
      title: "Understanding JavaScript Closures",
      content: "A detailed explanation of closures with practical examples for beginners.",
      upvotes: 789,
      comments: 67,
      awards: ["silver"],
      type: "text" as const,
    },
  ]
}

export default function UserPage({ params }: { params: { username: string } }) {
  const userData = getUserData(params.username)
  const userPosts = getUserPosts(params.username)

  return (
    <div className="min-h-screen bg-[#DAE0E6]">
      <Header />
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_312px] gap-6">
          <main className="space-y-4">
            <Card className="bg-white border border-gray-300">
              <CardHeader>
                <CardTitle className="text-lg">u/{params.username} - Posts</CardTitle>
              </CardHeader>
            </Card>
            {userPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </main>
          <UserProfile user={userData} />
        </div>
      </div>
    </div>
  )
}
