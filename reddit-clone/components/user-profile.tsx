import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Calendar, Award } from "lucide-react"

interface UserProfileProps {
  user: {
    username: string
    karma: number
    cakeDay: string
    avatar: string
    bio: string
    badges: string[]
  }
}

export function UserProfile({ user }: UserProfileProps) {
  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k"
    }
    return num.toString()
  }

  return (
    <aside className="space-y-4">
      <Card className="bg-white border border-gray-300">
        <CardContent className="p-4">
          <div className="text-center space-y-3">
            <Avatar className="w-20 h-20 mx-auto">
              <AvatarImage src={user.avatar || "/placeholder.svg"} />
              <AvatarFallback className="text-2xl">{user.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>

            <div>
              <h2 className="text-lg font-bold">u/{user.username}</h2>
              <p className="text-sm text-gray-600 mt-1">{user.bio}</p>
            </div>

            <div className="flex justify-center space-x-6 text-sm">
              <div className="text-center">
                <div className="font-bold text-gray-900">{formatNumber(user.karma)}</div>
                <div className="text-gray-600">Karma</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-900 flex items-center justify-center">
                  <Calendar className="w-4 h-4 mr-1" />
                </div>
                <div className="text-gray-600">Cake day</div>
                <div className="text-xs text-gray-500">{user.cakeDay}</div>
              </div>
            </div>

            <Button variant="outline" className="w-full">
              Follow
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center">
            <Award className="w-4 h-4 mr-2" />
            Badges
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {user.badges.map((badge, index) => (
            <div key={index} className="flex items-center space-x-2 text-sm">
              <div className="w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center text-xs">🏆</div>
              <span>{badge}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </aside>
  )
}
