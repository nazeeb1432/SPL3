export interface Post {
  id: string
  title: string
  subreddit: string
  author: string
  score: number
  comments: number
  timeAgo: string
  url: string
  flair?: string
  content?: string
  imageUrl?: string
  tags?: string[]
  interventions?: InterventionMatch[]
  imageInterventions?: ImageIntervention[]
  images?: PostImage[]
}

export interface PostImage {
  url: string
  intervention?: ImageIntervention
}

export interface ImageIntervention {
  type: 'blur' | 'overlay' | 'cartoonish' | 'edit_to_replace'
  status?: 'ready' | 'processing' | 'failed'
  coordinates?: Array<{x1: number, y1: number, x2: number, y2: number}>
}

export interface InterventionMatch {
  type: 'blur' | 'overlay' | 'rewrite'
  content: string
  warning?: string
  fullMatch: string
}

export interface Feed {
  id: string
  name: string
  posts: Post[]
}

export interface PostCardProps {
  post: Post
}
