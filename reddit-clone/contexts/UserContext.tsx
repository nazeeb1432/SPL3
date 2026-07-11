"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { customFeedApi, type UserInfo } from '@/lib/api/customFeedApi'

interface UserContextType {
  currentUser: UserInfo | null
  loading: boolean
  login: (email: string) => Promise<boolean>
  logout: () => void
  setUser: (user: UserInfo | null) => void
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Load user from localStorage on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const savedUser = localStorage.getItem('currentUser')
        if (savedUser) {
          const user = JSON.parse(savedUser)
          
          // Verify user still exists on server
          const serverUser = await customFeedApi.getUserInfo(user.id)
          if (serverUser) {
            setCurrentUser(serverUser)
          } else {
            // User doesn't exist on server, clear localStorage
            localStorage.removeItem('currentUser')
          }
        }
      } catch (error) {
        console.error('Error loading user from localStorage:', error)
        localStorage.removeItem('currentUser')
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [])

  const login = async (email: string): Promise<boolean> => {
    try {
      setLoading(true)
      const result = await customFeedApi.loginWithEmail(email)
      
      if (result) {
        setCurrentUser(result.user)
        localStorage.setItem('currentUser', JSON.stringify(result.user))
        return true
      }
      
      return false
    } catch (error) {
      console.error('Login error:', error)
      return false
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    setCurrentUser(null)
    localStorage.removeItem('currentUser')
  }

  const setUser = (user: UserInfo | null) => {
    setCurrentUser(user)
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user))
    } else {
      localStorage.removeItem('currentUser')
    }
  }

  return (
    <UserContext.Provider value={{ currentUser, loading, login, logout, setUser }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}