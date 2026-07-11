"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import Link from "next/link"

const recentPosts = [
  {
    subreddit: "tirzepatidecompound",
    time: "9 days ago",
    title: "Brello WTF",
    upvotes: 33,
    comments: 97,
  },
  {
    subreddit: "tirzepatidecompound",
    time: "1 mo. ago",
    title: "Lumimeds 1 Vial",
    upvotes: 5,
    comments: 48,
  },
  {
    subreddit: "tirzepatidecompound",
    time: "26 days ago",
    title: "Longest you've actually used Olympia 75 mg vial",
    upvotes: 17,
    comments: 52,
  },
  {
    subreddit: "tirzepatidecompound",
    time: "9 mo. ago",
    title: "Dosing Explanation - Volume, Concentration, Dose, Units, and...",
    upvotes: 285,
    comments: 70,
  },
]

export function RightSidebar() {
  return (
    <aside className="w-72 hidden xl:block sticky top-12 h-fit">
      <Card className="bg-white border-reddit-border rounded-md">
        <CardHeader className="py-2 px-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xs font-bold uppercase text-reddit-text-secondary">Recent Posts</CardTitle>
            <Link href="#" className="text-xs font-bold text-reddit-blue hover:underline">
              Clear
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul>
            {recentPosts.map((post, index) => (
              <li key={index} className="border-t border-reddit-border">
                <Link href="#" className="block p-3 hover:bg-reddit-hover">
                  <div className="flex items-center gap-2 text-xs text-reddit-text-secondary mb-1">
                    <div className="w-5 h-5 bg-black rounded-full" />
                    <span>r/{post.subreddit}</span>
                    <span>•</span>
                    <span>{post.time}</span>
                  </div>
                  <h4 className="font-medium text-sm text-reddit-text-primary mb-1">{post.title}</h4>
                  <p className="text-xs text-reddit-text-secondary">
                    {post.upvotes} upvotes • {post.comments} comments
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </aside>
  )
}
