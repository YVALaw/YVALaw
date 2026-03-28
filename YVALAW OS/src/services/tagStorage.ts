import { supabase } from '../lib/supabase'
import type { Tag } from '../data/types'

const FALLBACK_KEY = 'yva_tags'

export async function loadTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('*').order('label')
  if (error) {
    // Fallback to localStorage when table doesn't exist yet
    try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]') } catch { return [] }
  }
  return (data || []) as Tag[]
}

export async function saveTags(tags: Tag[]): Promise<void> {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(tags))
  // Best-effort Supabase sync
  for (const tag of tags) {
    await supabase.from('tags').upsert({ id: tag.id, label: tag.label, color: tag.color })
  }
}
