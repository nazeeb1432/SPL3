import type { Post, InterventionMatch, PostImage, ImageIntervention } from "@/lib/types"
import type { FeedData } from "@/lib/api/customFeedApi"

// Intervention marker patterns
const INTERVENTION_PATTERNS = {
  blur: /__BLUR_START__(.*?)__BLUR_END__/gs,
  overlay: /__OVERLAY_START__(.*?)\|(.*?)__OVERLAY_END__/gs,
  rewrite: /__REWRITE_START__(.*?)__REWRITE_END__/gs,
}


/**
 * Parse stored feed HTML to extract original and processed posts
 */
export function parseStoredFeed(feedHtml: string): { original: Post[], processed: Post[] } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(feedHtml, 'text/html')
  
  // Look for both .post divs and shreddit-post elements
  const postElements = doc.querySelectorAll('.post')
  const originalPosts: Post[] = []
  const processedPosts: Post[] = []
  
  postElements.forEach((postDiv, index) => {
    // Extract the shreddit-post element inside
    const shredditPost = postDiv.querySelector('shreddit-post')
    if (!shredditPost) {
      return // Skip if no shreddit-post found
    }
    
    // Extract metadata from shreddit-post attributes
    const basePostId = shredditPost.getAttribute('id') || `post-${index}`
    // Make ID unique by adding index to handle duplicate posts
    const postId = `${basePostId}-${index}`
    const author = shredditPost.getAttribute('author') || 'unknown'
    const subreddit = shredditPost.getAttribute('subredditname') || 'unknown'
    const createdTimestamp = shredditPost.getAttribute('created-timestamp')
    const permalink = shredditPost.getAttribute('permalink') || '#'
    
    // Extract title from the a[slot="title"] element
    const titleElement = shredditPost.querySelector('a[slot="title"]')
    const titleHtml = titleElement?.innerHTML || ''
    const titleText = removeInterventionMarkers(titleElement?.textContent || '')
    
    // Extract images from gallery with interventions - include slot="post-media-container" images
    const imageElements = shredditPost.querySelectorAll('.gallery-container img, img[alt="Gallery image"], .diy-mod-custom-processed, [slot="post-media-container"] img')
    const postImages: PostImage[] = []
    let firstImageUrl: string | undefined = undefined
    
    imageElements.forEach((img, imgIndex) => {
      const imgElement = img as HTMLImageElement
      const imgUrl = imgElement.getAttribute('src')
      if (!imgUrl) return
      
      // Set first image URL for backward compatibility
      if (imgIndex === 0) {
        firstImageUrl = imgUrl
      }
      
      // Extract intervention data if present
      const interventionData = imgElement.getAttribute('diy-mod-custom')
      let intervention: ImageIntervention | undefined = undefined
      
      if (interventionData) {
        try {
          const parsed = JSON.parse(interventionData)
          if (parsed.intervention && parsed.intervention !== 'none') {
            intervention = {
              type: parsed.intervention as ImageIntervention['type'],
              status: parsed.status || 'ready',
              coordinates: parsed.coordinates
            }
          }
        } catch (e) {
          console.error('Failed to parse image intervention data:', e)
        }
      }
      
      postImages.push({
        url: imgUrl,
        intervention
      })
    })
    
    const imageUrl = firstImageUrl
    
    // Extract any text content (not including title or media)
    const contentElements = shredditPost.querySelectorAll('.post-body, [slot="text-body"], .md, .usertext-body')
    let contentHtml = ''
    contentElements.forEach(el => {
      // Only add if it's actual text content, not media containers
      const elContent = el.innerHTML || ''
      if (!elContent.includes('slot="post-media-container"') && 
          !elContent.includes('gallery-container') &&
          elContent.trim().length > 0) {
        contentHtml += elContent
      }
    })
    
    // Check if this is a text post by looking for Reddit's text post indicators
    const isTextPost = shredditPost.getAttribute('contenttype') === 'text' || 
                      shredditPost.querySelector('.usertext-body, .md') !== null
    
    // For image/gallery posts without text, leave content empty
    if (!contentHtml && !isTextPost) {
      contentHtml = ''
    }
    
    // Calculate time ago
    let timeAgo = '1h ago'
    if (createdTimestamp) {
      const created = new Date(createdTimestamp)
      const now = new Date()
      const hours = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60))
      if (hours < 24) {
        timeAgo = `${hours}h ago`
      } else {
        const days = Math.floor(hours / 24)
        timeAgo = `${days}d ago`
      }
    }
    
    // Extract intervention info if available
    const interventionInfo = postDiv.querySelector('.intervention-info')?.textContent || ''
    const processingTimeMatch = interventionInfo.match(/Processing: ([\d.]+)ms/)
    
    // Clean up content - remove any remaining media containers that slipped through
    const cleanContent = (html: string) => {
      // Remove media containers and gallery divs
      return html
        .replace(/<div[^>]*slot="post-media-container"[^>]*>.*?<\/div>/gs, '')
        .replace(/<div[^>]*class="gallery-container"[^>]*>.*?<\/div>/gs, '')
        .trim()
    }
    
    const cleanedContent = cleanContent(contentHtml)
    
    // Create base post object with unique ID for original
    const basePost: Post = {
      id: `${postId}-original`,
      title: titleText,
      author,
      subreddit,
      score: Math.floor(Math.random() * 1000), // Mock score as it's not in the HTML
      comments: Math.floor(Math.random() * 200), // Mock comments
      timeAgo,
      url: `https://reddit.com${permalink}`,
      imageUrl,
      content: removeInterventionMarkers(cleanedContent),
      images: postImages.map(img => ({ url: img.url })) // Original posts get images without interventions
    }
    
    // Original: Remove all intervention markers
    originalPosts.push(basePost)
    
    // Processed: Keep intervention markers but still clean the content
    processedPosts.push({
      ...basePost,
      id: `${postId}-processed`, // Unique ID for processed version
      title: titleHtml, // Keep HTML with intervention markers for processed
      content: cleanedContent,
      images: postImages, // Processed posts get images with interventions
      interventions: [
        ...extractInterventions(titleHtml),
        ...extractInterventions(cleanedContent)
      ]
    })
  })
  
  return { original: originalPosts, processed: processedPosts }
}

/**
 * Remove all intervention markers from content
 */
export function removeInterventionMarkers(content: string): string {
  let cleaned = content
  
  // Remove blur markers
  cleaned = cleaned.replace(INTERVENTION_PATTERNS.blur, '$1')
  
  // Remove overlay markers (keep content, remove warning)
  cleaned = cleaned.replace(INTERVENTION_PATTERNS.overlay, '$2')
  
  // Remove rewrite markers
  cleaned = cleaned.replace(INTERVENTION_PATTERNS.rewrite, '$1')
  
  return cleaned
}

/**
 * Extract intervention information from content
 */
export function extractInterventions(content: string): InterventionMatch[] {
  const interventions: InterventionMatch[] = []
  
  // Extract blur interventions
  let match: RegExpExecArray | null
  const blurRegex = new RegExp(INTERVENTION_PATTERNS.blur)
  while ((match = blurRegex.exec(content)) !== null) {
    interventions.push({
      type: 'blur',
      content: match[1],
      fullMatch: match[0]
    })
  }
  
  // Extract overlay interventions
  const overlayRegex = new RegExp(INTERVENTION_PATTERNS.overlay)
  while ((match = overlayRegex.exec(content)) !== null) {
    interventions.push({
      type: 'overlay',
      warning: match[1],
      content: match[2],
      fullMatch: match[0]
    })
  }
  
  // Extract rewrite interventions
  const rewriteRegex = new RegExp(INTERVENTION_PATTERNS.rewrite)
  while ((match = rewriteRegex.exec(content)) !== null) {
    interventions.push({
      type: 'rewrite',
      content: match[1],
      fullMatch: match[0]
    })
  }
  
  return interventions
}

/**
 * Render content with intervention styling
 */
export function renderInterventions(content: string): string {
  let rendered = content
  
  // Apply blur styling
  rendered = rendered.replace(
    INTERVENTION_PATTERNS.blur,
    '<span class="intervention-blur" data-intervention="blur">$1</span>'
  )
  
  // Apply overlay styling
  rendered = rendered.replace(
    INTERVENTION_PATTERNS.overlay,
    '<div class="intervention-overlay" data-intervention="overlay" data-warning="$1">$2</div>'
  )
  
  // Apply rewrite styling with modification indicator
  rendered = rendered.replace(
    INTERVENTION_PATTERNS.rewrite,
    '<div class="intervention-rewrite-wrapper"><span class="intervention-rewrite" data-intervention="rewrite">$1</span><div class="modification-indicator">DIY-MOD</div></div>'
  )
  
  return rendered
}