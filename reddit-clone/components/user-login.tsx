"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Mail, User, CheckCircle } from "lucide-react"

interface UserInfo {
  id: string
  email: string
  created_at: string
  is_new?: boolean
}

interface UserLoginProps {
  onUserLogin: (user: UserInfo) => void
  currentUser?: UserInfo | null
}

export function UserLogin({ onUserLogin, currentUser }: UserLoginProps) {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email.trim()) {
      setError("Please enter your email address")
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/auth/login-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })

      const result = await response.json()

      if (result.status === 'success') {
        const user = result.user
        setSuccess(result.is_new ? "New account created successfully!" : "Welcome back!")
        onUserLogin(user)
        
        // Store user info in localStorage for persistence
        localStorage.setItem('currentUser', JSON.stringify(user))
      } else {
        setError(result.message || "Login failed")
      }
    } catch (err) {
      console.error('Login error:', err)
      setError("Failed to connect to server. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('currentUser')
    setEmail("")
    setError(null)
    setSuccess(null)
    onUserLogin(null as any) // Clear current user
  }

  // If user is already logged in, show their info
  if (currentUser) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Logged In
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
            <User className="h-4 w-4 text-green-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-900">{currentUser.email}</p>
              {/* <p className="text-xs text-green-700">ID: {currentUser.id}</p> */}
            </div>
          </div>
          
          <Button 
            variant="outline" 
            onClick={handleLogout}
            className="w-full"
          >
            Switch User
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          User Login
        </CardTitle>
        <CardDescription>
          Enter your email to access your feeds. We'll create an account if you're new.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="email"
              placeholder="your.email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full"
            />
          </div>

          <Button 
            type="submit" 
            disabled={loading || !email.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Continue"
            )}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                {success}
              </AlertDescription>
            </Alert>
          )}
        </form>

        <div className="mt-6 text-xs text-gray-500 text-center">
          <p>Your user ID will be generated from your email.</p>
          <p>No password required - this is for research purposes.</p>
        </div>
      </CardContent>
    </Card>
  )
}