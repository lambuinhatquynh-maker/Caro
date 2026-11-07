import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Sym = 'X' | 'O'
export interface Room {
  code: string
  board: string
  x_player: string | null
  o_player: string | null
  x_name: string | null
  o_name: string | null
  turn: Sym
  status: 'waiting' | 'playing' | 'finished'
  winner: Sym | 'D' | null
  win_line: number[] | null
  last_move: number | null
  updated_at: string
}

/** Đăng nhập ẩn danh: mỗi trình duyệt có 1 id cố định, dùng để nhận diện người chơi khi tải lại trang. */
export async function ensureUser() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user
  const { data: d, error } = await supabase.auth.signInAnonymously()
  if (error || !d.user) throw error ?? new Error('auth_failed')
  return d.user
}
