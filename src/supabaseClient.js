import { createClient } from '@supabase/supabase-js'

// ここにSupabaseのダッシュボードで取得したURLとanonキーを貼り付けます
const supabaseUrl = 'https://ugdhdeczybceajsvfiws.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZGhkZWN6eWJjZWFqc3ZmaXdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzI1MzgsImV4cCI6MjA4Nzg0ODUzOH0.zCLYUKOYe81s2HTmIOq_OGdfKYPRNcNGTv3rMYWDkvk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)