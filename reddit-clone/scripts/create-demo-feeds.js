#!/usr/bin/env node

/**
 * Create demo feeds in the backend for testing the reddit-clone viewer
 * This simulates what an admin would do using the custom feed processor
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_URL || 'http://localhost:8001';
const USER_ID = process.env.DEMO_USER_ID || 'demo-user';

// Demo feed data
const demoFeedTemplate = {
  posts: [
    {
      title: "5 weeks post 270° TT - My recovery journey",
      content: "Let me explain how I use ClaudeAI as an old hat engineer, but before I do that I'd like to give you a little insight into my credentials so you know I'm not a vibe coder gone rouge. I have a CS degree and I've been doing dotnet development since dotnet was invented 20 years ago.",
      author: "user123",
      subreddit: "tummytucksurgery",
      score: 53,
      comments: 10,
      interventions: {
        text: [
          {
            type: "blur",
            pattern: "surgery|tummy|270°",
            reason: "Medical procedure content"
          },
          {
            type: "rewrite", 
            original_phrase: "vibe coder gone rouge",
            new_phrase: "trendy programmer",
            reason: "Clarifying terminology"
          }
        ]
      }
    },
    {
      title: "The beautiful scenery of the Swiss Alps",
      content: "Just returned from an amazing trip to Switzerland. The views were absolutely breathtaking!",
      author: "globetrotter",
      subreddit: "travel",
      score: 1200,
      comments: 256,
      image_url: "/placeholder.svg?width=600&height=400",
      interventions: {}
    },
    {
      title: "What's the best way to learn a new programming language in 2025?",
      content: "I've been a developer for a few years, mainly working with JavaScript. I want to pick up a new language, maybe something like Rust or Go. What are the most effective learning strategies you've found?",
      author: "code_newbie",
      subreddit: "learnprogramming", 
      score: 450,
      comments: 150,
      interventions: {
        text: [
          {
            type: "overlay",
            pattern: "Rust|Go",
            warning: "Technical Content",
            reason: "Programming language discussion"
          }
        ]
      }
    },
    {
      title: "My thoughts on the recent political developments",
      content: "The recent election results have been quite controversial. Many people are upset about the outcome and there have been heated debates across social media.",
      author: "political_observer",
      subreddit: "politics",
      score: 890,
      comments: 432,
      interventions: {
        text: [
          {
            type: "blur",
            pattern: "political|election|controversial",
            reason: "Political content"
          },
          {
            type: "overlay",
            pattern: "heated debates",
            warning: "Potentially divisive content",
            reason: "Discussion of conflicts"
          }
        ]
      }
    }
  ]
};

async function createDemoFeed() {
  console.log('Creating demo feed...');
  console.log(`API Base: ${API_BASE}`);
  console.log(`User ID: ${USER_ID}`);
  
  try {
    // First, save the template to a temporary JSON file
    const tempFile = path.join(__dirname, 'temp_demo_feed.json');
    fs.writeFileSync(tempFile, JSON.stringify(demoFeedTemplate, null, 2));
    console.log(`Created template file: ${tempFile}`);
    
    // Process the feed using the custom feed endpoint
    const processResponse = await fetch(`${API_BASE}/custom-feed/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: `demo_${Date.now()}`,
        posts: demoFeedTemplate.posts,
        return_original: true
      })
    });
    
    if (!processResponse.ok) {
      throw new Error(`Process failed: ${processResponse.statusText}`);
    }
    
    const processResult = await processResponse.json();
    console.log('Feed processed successfully');
    console.log(`- Processed ${processResult.data.posts.length} posts`);
    console.log(`- Total interventions: ${Object.values(processResult.data.intervention_counts).reduce((a, b) => a + b, 0)}`);
    
    // Save the processed feed
    const saveResponse = await fetch(`${API_BASE}/custom-feed/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: USER_ID,
        title: `Demo Feed - ${new Date().toLocaleString()}`,
        feed_html: processResult.data.timeline_html,
        metadata: {
          source: 'demo_script',
          post_count: processResult.data.posts.length,
          processing_time_ms: processResult.data.processing_time_ms,
          interventions: processResult.data.intervention_counts,
          session_id: processResult.data.session_id
        }
      })
    });
    
    if (!saveResponse.ok) {
      throw new Error(`Save failed: ${saveResponse.statusText}`);
    }
    
    const saveResult = await saveResponse.json();
    console.log(`\n✅ Feed saved successfully!`);
    console.log(`Feed ID: ${saveResult.data.feed_id}`);
    console.log(`Title: ${saveResult.data.title}`);
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    // List all feeds for the user
    const listResponse = await fetch(`${API_BASE}/custom-feed/list/${USER_ID}`);
    if (listResponse.ok) {
      const listResult = await listResponse.json();
      console.log(`\nTotal feeds for ${USER_ID}: ${listResult.data.count}`);
    }
    
  } catch (error) {
    console.error('Error creating demo feed:', error);
    process.exit(1);
  }
}

// Run the script
createDemoFeed().then(() => {
  console.log('\nDemo feed creation complete!');
  console.log('You can now view the feed in the reddit-clone viewer.');
}).catch(console.error);