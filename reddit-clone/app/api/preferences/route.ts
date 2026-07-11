import { NextRequest, NextResponse } from 'next/server'

interface PostPreference {
  post_id: string
  post0_text_content: string
  post1_text_content: string
  text_preference?: 0 | 1
  post0_image_url?: string
  post1_image_url?: string
  image_preference?: 0 | 1
}

interface PreferenceSubmission {
  user_id: string
  comparison_set_id: string
  preferences: PostPreference[]
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

export async function POST(request: NextRequest) {
  try {
    const body: PreferenceSubmission = await request.json()
    
    // Validate request body
    if (!body.user_id || !body.comparison_set_id || !Array.isArray(body.preferences)) {
      return NextResponse.json(
        { error: 'Missing required fields: user_id, comparison_set_id, preferences' },
        { status: 400 }
      )
    }

    if (body.preferences.length === 0) {
      return NextResponse.json(
        { error: 'No preferences provided' },
        { status: 400 }
      )
    }

    // Validate each preference
    for (const pref of body.preferences) {
      if (!pref.post_id || !pref.post0_text_content || !pref.post1_text_content) {
        return NextResponse.json(
          { error: 'Invalid preference: missing post_id or text content' },
          { status: 400 }
        )
      }

      // At least one preference must be set
      if (pref.text_preference === undefined && pref.image_preference === undefined) {
        return NextResponse.json(
          { error: `No preferences set for post ${pref.post_id}` },
          { status: 400 }
        )
      }

      // Validate preference values
      if (pref.text_preference !== undefined && ![0, 1].includes(pref.text_preference)) {
        return NextResponse.json(
          { error: `Invalid text_preference value for post ${pref.post_id}` },
          { status: 400 }
        )
      }

      if (pref.image_preference !== undefined && ![0, 1].includes(pref.image_preference)) {
        return NextResponse.json(
          { error: `Invalid image_preference value for post ${pref.post_id}` },
          { status: 400 }
        )
      }
    }

    // Forward to backend API
    const response = await fetch(`${API_BASE}/human-preferences/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Backend API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Backend error: ${response.statusText}` },
        { status: response.status }
      )
    }

    const result = await response.json()
    
    return NextResponse.json({
      success: true,
      message: `Successfully saved ${body.preferences.length} preferences`,
      data: result
    })

  } catch (error) {
    console.error('Error processing preferences:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId') || searchParams.get('user_id')
  const comparisonSetId = searchParams.get('comparisonSetId') || searchParams.get('comparison_set_id')

  if (!userId) {
    return NextResponse.json(
      { error: 'Missing userId parameter' },
      { status: 400 }
    )
  }

  try {
    let url = `${API_BASE}/human-preferences/list/${userId}`
    if (comparisonSetId) {
      url += `?comparison_set_id=${comparisonSetId}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.statusText}` },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json(result)

  } catch (error) {
    console.error('Error fetching preferences:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}