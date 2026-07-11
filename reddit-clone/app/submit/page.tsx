import { Header } from "@/components/header"
import { CreatePostForm } from "@/components/create-post-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SubmitPage() {
  return (
    <div className="min-h-screen bg-[#DAE0E6]">
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <main>
            <CreatePostForm />
          </main>
          <aside>
            <Card className="bg-white border border-gray-300">
              <CardHeader>
                <CardTitle className="text-sm font-bold">Posting to Reddit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <h4 className="font-semibold mb-1">1. Remember the human</h4>
                  <p className="text-gray-600">
                    Reddit is a place for creating community and belonging, not for attacking marginalized or vulnerable
                    groups of people.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">2. Behave like you would in real life</h4>
                  <p className="text-gray-600">Be authentic and engage in good faith.</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">3. Look for the original source</h4>
                  <p className="text-gray-600">Link to the original source when possible.</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">4. Search for duplicates</h4>
                  <p className="text-gray-600">Check if your link has already been submitted.</p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
