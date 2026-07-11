import { Header } from "@/components/header"
import { PostDetail } from "@/components/post-detail"
import { CommentSection } from "@/components/comment-section"
import { SubredditSidebar } from "@/components/subreddit-sidebar"

const getPostData = (subreddit: string, postId: string) => {
  return {
    id: Number.parseInt(postId),
    subreddit: subreddit,
    user: "developer123",
    timeAgo: "4 hours ago",
    title: `Post from r/${subreddit}`,
    content: `This is a detailed post from the ${subreddit} community. Here you can see the full content and engage with comments.\n\nThis post demonstrates the full Reddit experience with:\n\n1. **Detailed Content** - Full post content with formatting\n2. **Comment System** - Nested comments with voting\n3. **Community Context** - Subreddit information and rules\n4. **Interactive Elements** - Voting, sharing, and more\n\nFeel free to explore and interact with all the features!`,
    upvotes: 1247,
    comments: 89,
    awards: ["helpful", "wholesome"],
    type: "text" as const,
  }
}

const getSubredditData = (subreddit: string) => {
  const subredditMap: Record<string, any> = {
    nextjs: {
      name: "Next.js",
      description: "The React Framework for Production",
      members: 125000,
      online: 2400,
      created: "Jan 15, 2020",
      icon: "⚛️",
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
      rules: [
        "Keep submissions on topic and of high quality",
        "No surveys, polls, or homework help",
        "No career/education posts",
        "Avoid low-effort content",
        "Be professional and respectful",
      ],
    },
  }

  return (
    subredditMap[subreddit] || {
      name: subreddit,
      description: `The ${subreddit} community`,
      members: 50000,
      online: 1200,
      created: "Jan 1, 2020",
      icon: "📝",
      rules: [
        "Be respectful and constructive",
        "Follow community guidelines",
        "Use descriptive titles",
        "Search before posting",
        "Follow Reddit's content policy",
      ],
    }
  )
}

const comments = [
  {
    id: 1,
    user: "react_expert",
    timeAgo: "3 hours ago",
    content: "Great post! This really helped me understand the concept better. Thanks for sharing your insights.",
    upvotes: 45,
    replies: [
      {
        id: 2,
        user: "developer123",
        timeAgo: "2 hours ago",
        content: "Thanks! I'm glad it was helpful. Feel free to ask if you have any questions.",
        upvotes: 23,
        replies: [
          {
            id: 3,
            user: "nextjs_fan",
            timeAgo: "1 hour ago",
            content: "This thread is exactly what I needed. The community here is amazing!",
            upvotes: 12,
            replies: [],
          },
        ],
      },
    ],
  },
  {
    id: 4,
    user: "webdev_newbie",
    timeAgo: "2 hours ago",
    content:
      "As someone new to this, I really appreciate posts like this. The explanations are clear and easy to follow.",
    upvotes: 32,
    replies: [
      {
        id: 5,
        user: "mentor_dev",
        timeAgo: "1 hour ago",
        content: "Welcome to the community! Don't hesitate to ask questions - we're all here to help each other learn.",
        upvotes: 18,
        replies: [],
      },
    ],
  },
  {
    id: 6,
    user: "performance_guru",
    timeAgo: "1 hour ago",
    content: "Excellent breakdown! I'd love to see a follow-up post about advanced techniques in this area.",
    upvotes: 28,
    replies: [],
  },
]

export default function PostPage({ params }: { params: { subreddit: string; postId: string } }) {
  const postData = getPostData(params.subreddit, params.postId)
  const subredditData = getSubredditData(params.subreddit)

  return (
    <div className="min-h-screen bg-[#DAE0E6]">
      <Header />
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_312px] gap-6">
          <main className="space-y-4">
            <PostDetail post={postData} />
            <CommentSection comments={comments} />
          </main>
          <SubredditSidebar subreddit={subredditData} subredditName={params.subreddit} />
        </div>
      </div>
    </div>
  )
}
