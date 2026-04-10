import { createClient } from '@supabase/supabase-js'

// creative-kitchen-video-v3 Supabase project (US East)
// This is where ad_launches, ad_accounts, and push-ads edge function live
const V3_URL = 'https://ajpxzifhoohjkyoyktsi.supabase.co'
const V3_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqcHh6aWZob29oamt5b3lrdHNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5ODk0MDIsImV4cCI6MjA4OTU2NTQwMn0.3yLImWGKgkDtuAoYfJiE9rC5XZUitISzuMcRVJgORGs'

export const supabaseV3 = createClient(V3_URL, V3_ANON_KEY)
