import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://eoeoaifreavxejmahwvy.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvZW9haWZyZWF2eGVqbWFod3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NDg5NDMsImV4cCI6MjA4NTAyNDk0M30.MAhak45Pv-zAXFkx3LTRHk8i45iaK9axyyN4KQ0laHo";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
