import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import Image from "next/image"

interface SubredditHeaderProps {
  subreddit: {
    name: string
    description: string
    members: number
    online: number
    icon: string
    banner: string
  }
  subredditName: string
}

export function SubredditHeader({ subreddit, subredditName }: SubredditHeaderProps) {
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
    <div className="bg-white border-b border-gray-300">
      <div className="relative">
        <Image
          src={subreddit.banner || "/placeholder.svg"}
          alt={`${subreddit.name} banner`}
          width={800}
          height={200}
          className="w-full h-32 sm:h-48 object-cover"
        />
        <div className="absolute inset-0 bg-black bg-opacity-20" />
      </div>

      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-end -mt-6 pb-4">
          <Avatar className="w-16 h-16 sm:w-20 sm:h-20 border-4 border-white bg-white">
            <AvatarFallback className="text-2xl">{subreddit.icon}</AvatarFallback>
          </Avatar>

          <div className="ml-4 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">r/{subredditName}</h1>
            <p className="text-gray-600 mt-1">{subreddit.description}</p>
          </div>

          <Button className="bg-[#0079D3] hover:bg-[#0079D3]/90 text-white">Join</Button>
        </div>

        <div className="flex items-center space-x-6 text-sm text-gray-600 pb-4">
          <div>
            <span className="font-bold text-gray-900">{formatNumber(subreddit.members)}</span>
            <span className="ml-1">Members</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">{formatNumber(subreddit.online)}</span>
            <span className="ml-1">Online</span>
          </div>
        </div>
      </div>
    </div>
  )
}
