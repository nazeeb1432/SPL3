import type { Post } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"

interface ParsedPost {
  id: string
  title: string
  content: string
  author: string
  subreddit: string
  upvotes: number
  downvotes: number
  comments: number
  timeAgo: string
  imageUrl?: string
  isVideo?: boolean
  tags?: string[]
  flair?: string
}

interface ParseResult {
  fileName: string
  success: boolean
  posts?: ParsedPost[]
  error?: string
}

export async function parseHTMLFile(file: File): Promise<ParsedPost[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const html = e.target?.result as string
        // Use DOMParser for browser environment
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, "text/html")

        const posts: ParsedPost[] = []
        const postElements = doc.querySelectorAll(
          'shreddit-post, [data-testid="post"], .Post, article[data-click-id="body"]',
        )

        postElements.forEach((element, index) => {
          try {
            const post = extractPostData(element, index)
            if (post) {
              posts.push(post)
            }
          } catch (error) {
            console.warn(`Failed to parse post ${index}:`, error)
          }
        })

        if (posts.length === 0) {
          reject(new Error("No valid posts found in HTML file"))
        } else {
          resolve(posts)
        }
      } catch (error) {
        reject(new Error(`Failed to parse HTML: ${error instanceof Error ? error.message : "Unknown error"}`))
      }
    }

    reader.onerror = () => {
      reject(new Error("Failed to read file"))
    }

    reader.readAsText(file)
  })
}

export async function parseHTMLFiles(files: FileList): Promise<ParseResult[]> {
  const results: ParseResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      const posts = await parseHTMLFile(file)
      results.push({
        fileName: file.name,
        success: true,
        posts,
      })
    } catch (error) {
      results.push({
        fileName: file.name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  }

  return results
}

function extractPostData(element: Element, index: number): ParsedPost | null {
  try {
    // Extract title
    const titleElement =
      element.querySelector('h3, [data-testid="post-title"], .title, h1, h2') ||
      element.querySelector('[slot="title"]') ||
      element.querySelector('a[data-click-id="title"]')
    const title = titleElement?.textContent?.trim() || `Post ${index + 1}`

    // Extract content
    const contentElement =
      element.querySelector('[data-testid="post-content"], .content, .usertext-body, [slot="text-body"]') ||
      element.querySelector('div[data-click-id="text"]')
    const content = contentElement?.textContent?.trim() || "No content available"

    // Extract author
    const authorElement =
      element.querySelector('[data-testid="post-author"], .author, [slot="credit-bar"] a') ||
      element.querySelector('a[href*="/user/"], a[href*="/u/"]')
    const author = authorElement?.textContent?.trim()?.replace(/^u\//, "") || "unknown"

    // Extract subreddit
    const subredditElement =
      element.querySelector('[data-testid="subreddit-name"], .subreddit, [href*="/r/"]') ||
      element.querySelector('a[data-click-id="subreddit"]')
    const subreddit = subredditElement?.textContent?.trim()?.replace(/^r\//, "") || "general"

    // Extract vote counts
    const upvoteElement = element.querySelector('[data-testid="upvote-button"], .upvote, [aria-label*="upvote"]')
    const upvotes =
      Number.parseInt(upvoteElement?.getAttribute("aria-label")?.match(/\d+/)?.[0] || "0") ||
      Math.floor(Math.random() * 1000)

    const downvoteElement = element.querySelector(
      '[data-testid="downvote-button"], .downvote, [aria-label*="downvote"]',
    )
    const downvotes =
      Number.parseInt(downvoteElement?.getAttribute("aria-label")?.match(/\d+/)?.[0] || "0") ||
      Math.floor(Math.random() * 50)

    // Extract comment count
    const commentElement = element.querySelector('[data-testid="comment-count"], .comments, [aria-label*="comment"]')
    const comments =
      Number.parseInt(commentElement?.textContent?.match(/\d+/)?.[0] || "0") || Math.floor(Math.random() * 200)

    // Extract time
    const timeElement = element.querySelector('time, [data-testid="post-timestamp"], .timestamp')
    const timeAgo = timeElement?.textContent?.trim() || `${Math.floor(Math.random() * 24)} hours ago`

    // Extract image URL
    const imageElement = element.querySelector('img') || element.querySelector('[slot="post-media-container"] img')
    const imageUrl = imageElement?.getAttribute("src") || undefined

    // Extract flair
    const flairElement = element.querySelector('[data-testid="post-flair"], .flair, .linkflairlabel')
    const flair = flairElement?.textContent?.trim() || undefined

    // Determine tags based on content or flair
    const tags: string[] = []
    const titleLower = title.toLowerCase()
    const contentLower = content.toLowerCase()

    if (
      titleLower.includes("politic") ||
      contentLower.includes("politic") ||
      subreddit.toLowerCase().includes("politic") ||
      (flair && flair.toLowerCase().includes("politics"))
    ) {
      tags.push("Politics")
    }
    if (
      titleLower.includes("analys") ||
      contentLower.includes("analys") ||
      (flair && flair.toLowerCase().includes("analysis"))
    ) {
      tags.push("Analysis")
    }
    if (
      titleLower.includes("news") ||
      titleLower.includes("breaking") ||
      (flair && flair.toLowerCase().includes("news"))
    ) {
      tags.push("News")
    }
    if (
      titleLower.includes("discuss") ||
      contentLower.includes("discuss") ||
      (flair && flair.toLowerCase().includes("discussion"))
    ) {
      tags.push("Discussion")
    }

    return {
      id: `post-${index}-${Date.now()}`,
      title,
      content: content.substring(0, 500), // Limit content length
      author,
      subreddit,
      upvotes,
      downvotes,
      comments,
      timeAgo,
      imageUrl,
      isVideo: false,
      tags: tags.length > 0 ? tags : ["General"], // Default to 'General' if no specific tags
      flair,
    }
  } catch (error) {
    console.warn(`Failed to extract post data for element ${index}:`, error)
    return null
  }
}

export function parseHTMLToRedditPosts(html: string, sourceName = "Custom"): ParsedPost[] {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")

    // Look for common post-like structures
    const posts: ParsedPost[] = []

    // Try to find article elements, divs with post-like classes, or other content containers
    const postElements = doc.querySelectorAll("article, .post, .entry, .item, [data-post], .content-item")

    if (postElements.length === 0) {
      // Fallback: look for any div with substantial text content
      const divs = doc.querySelectorAll("div")
      const contentDivs = Array.from(divs).filter((div) => {
        const text = div.textContent?.trim() || ""
        return text.length > 50 && text.length < 2000
      })

      contentDivs.slice(0, 10).forEach((element, index) => {
        const post = extractPostFromElement(element, index, sourceName)
        if (post) posts.push(post)
      })
    } else {
      postElements.forEach((element, index) => {
        const post = extractPostFromElement(element, index, sourceName)
        if (post) posts.push(post)
      })
    }

    return posts.slice(0, 20) // Limit to 20 posts
  } catch (error) {
    console.error("Error parsing HTML:", error)
    return []
  }
}

function extractPostFromElement(element: Element, index: number, sourceName: string): ParsedPost | null {
  try {
    // Extract title - look for headings, links, or elements with title-like classes
    const titleElement = element.querySelector("h1, h2, h3, h4, .title, .headline, [data-title], a[href]")
    const title = titleElement?.textContent?.trim() || `Post ${index + 1} from ${sourceName}`

    // Extract content - get the main text content, excluding title
    let content = element.textContent?.trim() || ""
    if (titleElement?.textContent) {
      content = content.replace(titleElement.textContent.trim(), "").trim()
    }
    content = content.substring(0, 500) // Limit content length

    // Extract author - look for author-like elements
    const authorElement = element.querySelector(".author, .by, .username, [data-author]")
    const author = authorElement?.textContent?.trim() || `user${Math.floor(Math.random() * 1000)}`

    // Extract image
    const imgElement = element.querySelector("img")
    const imageUrl = imgElement?.src

    // Generate some realistic-looking metadata
    const upvotes = Math.floor(Math.random() * 1000) + 10
    const downvotes = Math.floor(Math.random() * 100)
    const comments = Math.floor(Math.random() * 200) + 5
    const timeAgo = `${Math.floor(Math.random() * 24) + 1}h ago`

    // Determine tags based on content analysis
    const tags: string[] = ["Custom Source"]
    if (content.toLowerCase().includes("breaking") || title.toLowerCase().includes("breaking")) {
      tags.push("Breaking News")
    }
    if (content.length > 300) {
      tags.push("Long Read")
    }
    if (imageUrl) {
      tags.push("Image")
    }

    // Simple content moderation simulation
    const hasControversialContent = /\b(controversial|debate|argument|conflict)\b/i.test(content + title)
    if (hasControversialContent) {
      tags.push("AI Processed")
      // Simulate content modification
      content = content.replace(/\b(controversial|heated|angry)\b/gi, "[CONTENT MODIFIED]")
    }

    return {
      id: `custom-${sourceName}-${index}-${Date.now()}`,
      title: title.substring(0, 200), // Limit title length
      content,
      author: author.replace(/[^a-zA-Z0-9_]/g, "").substring(0, 20) || `user${index}`,
      subreddit: sourceName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 20) || "custom",
      upvotes,
      downvotes,
      comments,
      timeAgo,
      imageUrl,
      isVideo: false,
      tags,
      flair: tags.includes("Breaking News") ? "News" : undefined,
    }
  } catch (error) {
    console.error("Error extracting post from element:", error)
    return null
  }
}

export function validateHTMLContent(html: string): { isValid: boolean; error?: string } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")

    // Check for parser errors
    const parserError = doc.querySelector("parsererror")
    if (parserError) {
      return { isValid: false, error: "Invalid HTML structure" }
    }

    // Check if there's any meaningful content
    const textContent = doc.body?.textContent?.trim() || ""
    if (textContent.length < 10) {
      return { isValid: false, error: "HTML contains insufficient content" }
    }

    return { isValid: true }
  } catch (error) {
    return { isValid: false, error: "Failed to parse HTML" }
  }
}

export function parseHTMLString(htmlString: string, fileName: string): Post[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, "text/html")
  const posts: Post[] = []

  // This selector is a guess for common Reddit post structures.
  // It might need adjustment for different HTML layouts.
  const postElements = doc.querySelectorAll(".thing, shreddit-post, [data-testid='post-container']")

  if (postElements.length === 0) {
    // Fallback if no specific post elements are found
    return [
      {
        id: `fallback-${fileName}`,
        title: `Could not find posts in ${fileName}`,
        content:
          "The HTML parser could not identify any post structures. Please ensure the file contains Reddit-like post elements.",
        author: "system",
        subreddit: "parser-error",
        score: 1,
        comments: 0,
        url: "#",
        domain: "local",
        flair: "Error",
        isSelf: true,
        isVideo: false,
        isNsfw: false,
        thumbnail: "default",
        createdAt: new Date(),
        timeAgo: "just now",
      },
    ]
  }

  postElements.forEach((el, i) => {
    try {
      const titleEl = el.querySelector("a.title, [data-testid='post-title']") as HTMLAnchorElement
      const authorEl = el.querySelector("a.author, [data-testid='post-author-name']") as HTMLAnchorElement
      const subredditEl = el.querySelector("a.subreddit, [data-testid='subreddit-name']") as HTMLAnchorElement
      const scoreEl = el.querySelector(".score.unvoted, [data-testid='score']") as HTMLElement
      const commentsEl = el.querySelector("a.comments, [data-testid='comment-button']") as HTMLAnchorElement
      const timeEl = el.querySelector("time") as HTMLTimeElement

      const title = titleEl?.innerText || `Parsed Post #${i + 1}`
      const author = authorEl?.innerText || "unknown"
      const subreddit = subredditEl?.innerText.replace(/^r\//, "") || "unknown"
      const score = Number.parseInt(scoreEl?.innerText || "0") || Math.floor(Math.random() * 100)
      const comments = Number.parseInt(commentsEl?.innerText.split(" ")[0] || "0") || 0
      const createdAt = timeEl?.dateTime ? new Date(timeEl.dateTime) : new Date()

      posts.push({
        id: el.getAttribute("data-fullname") || `${fileName}-post-${i}`,
        title,
        author,
        subreddit,
        score,
        comments,
        url: titleEl?.href || "#",
        domain: (el.querySelector(".domain a") as HTMLAnchorElement)?.innerText || "self.post",
        flair: (el.querySelector(".linkflairlabel") as HTMLElement)?.innerText || null,
        isSelf: el.classList.contains("self"),
        isVideo: el.querySelector("video") !== null,
        isNsfw: el.classList.contains("over18"),
        thumbnail: (el.querySelector("img") as HTMLImageElement)?.src || "self",
        createdAt,
        timeAgo: formatDistanceToNow(createdAt, { addSuffix: true }),
      })
    } catch (e) {
      console.warn(`Could not parse an element in ${fileName}:`, e)
    }
  })

  return posts
}
