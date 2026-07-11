import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar, Shield } from "lucide-react"

interface SubredditSidebarProps {
  subreddit: {
    name: string
    description: string
    members: number
    online: number
    created: string
    rules: string[]
  }
  subredditName: string
}

export function SubredditSidebar({ subreddit, subredditName }: SubredditSidebarProps) {
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k"
    }
    return num.toString()
  }

  return (
    <aside className="space-y-4">
      {/* About Community */}
      <Card className="bg-white border border-gray-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">About Community</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-700">{subreddit.description}</p>

          <div className="flex items-center text-sm text-gray-600">
            <Calendar className="w-4 h-4 mr-2" />
            Created {subreddit.created}
          </div>

          <div className="flex justify-between text-sm">
            <div>
              <div className="font-bold text-gray-900">{formatNumber(subreddit.members)}</div>
              <div className="text-gray-600">Members</div>
            </div>
            <div>
              <div className="font-bold text-gray-900">{formatNumber(subreddit.online)}</div>
              <div className="text-gray-600">Online</div>
            </div>
          </div>

          <Button className="w-full bg-[#0079D3] hover:bg-[#0079D3]/90 text-white">Join</Button>
        </CardContent>
      </Card>

      {/* Rules */}
      <Card className="bg-white border border-gray-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center">
            <Shield className="w-4 h-4 mr-2" />
            r/{subredditName} Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {subreddit.rules.map((rule, index) => (
            <div key={index} className="text-sm">
              <div className="font-medium text-gray-900">
                {index + 1}. {rule}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Moderators */}
      <Card className="bg-white border border-gray-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">Moderators</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-blue-600 hover:underline cursor-pointer">u/moderator1</span>
              <Button variant="outline" size="sm" className="text-xs h-6">
                Message
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-600 hover:underline cursor-pointer">u/moderator2</span>
              <Button variant="outline" size="sm" className="text-xs h-6">
                Message
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  )
}
