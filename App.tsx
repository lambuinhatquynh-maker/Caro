import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, ensureUser, Room, Sym } from './lib/supabase'

const N = 15
const NAME_KEY = 'caro-name'

const errText = (m: string) =>
  m.includes('room_not_found') ? 'Không tìm thấy phòng. Kiểm tra lại mã phòng.'
  : m.includes('room_full') ? 'Phòng đã đủ 2 người.'
  : m.includes('Failed to fetch') ? 'Mất kết nối mạng. Đang thử lại…'
  : 'Có lỗi xảy ra, hãy thử lại.'

function go(path: string) {
  history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const f = () => setPath(location.pathname)
    addEventListener('popstate', f)
    return () => removeEventListener('popstate', f)
  }, [])
  const m = path.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/)
  return m ? <Game key={m[1].toUpperCase()} code={m[1].toUpperCase()} /> : <Home />
}

/* ---------- Quân cờ vẽ bằng nét bút ---------- */
function Mark({ s }: { s: Sym }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.8, strokeLinecap: 'round' as const, pathLength: 1 }
  return s === 'X' ? (
    <svg viewBox="0 0 24 24" className="h-[70%] w-[70%] text-ink-red" aria-label="X">
      <path className="draw" d="M5 5 L19 19" {...common} />
      <path className="draw" d="M19 5 L5 19" {...common} />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-[70%] w-[70%] text-ink-blue" aria-label="O">
      <circle className="draw" cx="12" cy="12" r="7" {...common} />
    </svg>
  )
}

/* ---------- Trang chủ ---------- */
function Home() {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const saveName = () => {
    const n = name.trim() || 'Người chơi'
    localStorage.setItem(NAME_KEY, n)
    return n
  }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const n = saveName()
      await ensureUser()
      const { data, error } = await supabase.rpc('create_room', { p_name: n })
      if (error) throw error
      go(`/r/${data}`)
    } catch (e: any) { setErr(errText(String(e?.message ?? e))) }
    setBusy(false)
  }

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim().length < 4) return setErr('Nhập mã phòng gồm 5 ký tự.')
    saveName()
    go(`/r/${code.trim().toUpperCase()}`)
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-8 px-6 py-10 pl-12">
      <header>
        <h1 className="text-5xl font-extrabold tracking-tight">
          <span className="text-ink-red">X</span> Caro <span className="text-ink-blue">O</span>
        </h1>
        <p className="mt-3 text-lg text-navy/70">Năm quân liền nhau là thắng. Mời bạn bè bằng một đường link.</p>
      </header>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Tên của bạn</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Ví dụ: Minh"
          className="w-full rounded-lg border-2 border-navy/20 bg-white px-4 py-3 text-lg" />
      </label>

      <button onClick={create} disabled={busy}
        className="rounded-lg bg-navy px-5 py-4 text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-60">
        Tạo phòng mới
      </button>

      <form onSubmit={join} className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="Mã phòng"
          className="min-w-0 flex-1 rounded-lg border-2 border-navy/20 bg-white px-4 py-3 text-lg tracking-widest" />
        <button className="rounded-lg border-2 border-navy px-5 py-3 text-lg font-bold">Vào phòng</button>
      </form>
      {err && <p role="alert" className="text-ink-red">{err}</p>}
    </main>
  )
}

/* ---------- Phòng chơi ---------- */
function Game({ code }: { code: string }) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? '')
  const [uid, setUid] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [online, setOnline] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [fatal, setFatal] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const apply = useCallback((next: Room) => {
    setRoom((prev) => (!prev || Date.parse(next.updated_at) >= Date.parse(prev.updated_at) ? next : prev))
  }, [])

  const refetch = useCallback(async () => {
    const { data, error } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle()
    if (error) return
    if (!data) setFatal('Phòng không còn tồn tại.')
    else apply(data as Room)
  }, [code, apply])

  // Vào phòng + đăng ký realtime (chạy khi đã có tên)
  useEffect(() => {
    if (!name) return
    let alive = true
    ;(async () => {
      try {
        const user = await ensureUser()
        if (!alive) return
        setUid(user.id)
        const { data, error } = await supabase.rpc('join_room', { p_code: code, p_name: name })
        if (error) throw error
        if (!alive) return
        apply(data as Room)

        const ch = supabase
          .channel(`room:${code}`, { config: { presence: { key: user.id } } })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
            (p) => apply(p.new as Room))
          .on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState())))
          .subscribe(async (st) => {
            if (st === 'SUBSCRIBED') {
              await ch.track({ at: Date.now() })
              refetch() // bù các nước đi có thể bị lỡ khi mất kết nối
            }
          })
        chRef.current = ch
      } catch (e: any) {
        if (alive) setFatal(errText(String(e?.message ?? e)))
      }
    })()
    return () => { alive = false; if (chRef.current) supabase.removeChannel(chRef.current); chRef.current = null }
  }, [name, code, apply, refetch])

  // Dự phòng: đồng bộ lại khi quay lại tab và định kỳ 8 giây
  useEffect(() => {
    if (!room) return
    const onVis = () => document.visibilityState === 'visible' && refetch()
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => document.visibilityState === 'visible' && refetch(), 8000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [room === null, refetch])

  if (!name) return <NamePrompt onDone={(n) => { localStorage.setItem(NAME_KEY, n); setName(n) }} />
  if (fatal) return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-5 px-6 pl-12">
      <p className="text-xl font-bold">{fatal}</p>
      <button onClick={() => go('/')} className="rounded-lg bg-navy px-5 py-3 font-bold text-white">Về trang chủ</button>
    </main>
  )
  if (!room || !uid) return <main className="grid min-h-[100dvh] place-items-center text-lg">Đang vào phòng…</main>

  const me: Sym | null = room.x_player === uid ? 'X' : room.o_player === uid ? 'O' : null
  const opp: Sym | null = me ? (me === 'X' ? 'O' : 'X') : null
  const nameOf = (s: Sym) => (s === 'X' ? room.x_name : room.o_name)
  const idOf = (s: Sym) => (s === 'X' ? room.x_player : room.o_player)
  const myTurn = room.status === 'playing' && me === room.turn
  const link = `${location.origin}/r/${room.code}`

  const move = async (i: number) => {
    if (!myTurn || busy || room.board[i] !== '.') return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('make_move', { p_code: code, p_idx: i })
    if (error) { setErr(errText(error.message)); refetch() } else apply(data as Room)
    setBusy(false)
  }
  const rematch = async () => {
    const { data, error } = await supabase.rpc('rematch', { p_code: code })
    if (error) setErr(errText(error.message)); else apply(data as Room)
  }
  const leave = async () => { await supabase.rpc('leave_room', { p_code: code }); go('/') }
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Caro Online', text: 'Chơi Caro với mình nhé!', url: link }); return } catch { /* đóng hộp thoại */ } }
    await navigator.clipboard.writeText(link)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  const status =
    room.status === 'waiting' ? 'Đang chờ đối thủ…'
    : room.status === 'finished' ? (room.winner === 'D' ? 'Hòa! Bàn cờ đã đầy.' : room.winner === me ? 'Bạn thắng!' : 'Bạn thua rồi.')
    : myTurn ? 'Đến lượt bạn' : `Chờ ${nameOf(room.turn) ?? 'đối thủ'} đánh…`
  const win = new Set(room.win_line ?? [])

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[680px] flex-col gap-4 px-3 py-4 pl-9 sm:px-6 sm:pl-12">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-navy/60">Mã phòng</p>
          <p className="text-2xl font-extrabold tracking-[0.2em]">{room.code}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={share} className="rounded-lg border-2 border-navy px-3 py-2 text-sm font-bold">
            {copied ? 'Đã chép link' : 'Mời bạn'}
          </button>
          <button onClick={leave} className="rounded-lg border-2 border-navy/30 px-3 py-2 text-sm font-medium">Thoát phòng</button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3">
        {(['X', 'O'] as Sym[]).map((s) => {
          const id = idOf(s)
          const active = room.status === 'playing' && room.turn === s
          return (
            <div key={s} className={`flex items-center gap-3 rounded-xl border-2 bg-white px-3 py-2 transition ${active ? 'border-navy shadow-[3px_3px_0_#18223F]' : 'border-navy/15'}`}>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-navy/15 bg-paper">
                <Mark s={s} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-bold">{nameOf(s) ?? 'Chưa có người'}{id === uid && ' (bạn)'}</p>
                <p className="flex items-center gap-1.5 text-xs text-navy/60">
                  <span className={`inline-block h-2 w-2 rounded-full ${id && online.includes(id) ? 'bg-green-600' : 'bg-navy/25'}`} />
                  {!id ? 'Đang chờ' : online.includes(id) ? 'Trực tuyến' : 'Mất kết nối'}
                </p>
              </div>
            </div>
          )
        })}
      </section>

      <p role="status" className={`text-center text-xl font-bold ${room.status === 'finished' && room.winner === me ? 'text-ink-blue' : ''}`}>{status}</p>

      {room.status === 'waiting' && (
        <div className="rounded-xl border-2 border-dashed border-navy/30 bg-white/70 p-3 text-center text-sm">
          Gửi link này cho bạn bè: <span className="break-all font-bold">{link}</span>
        </div>
      )}

      <div className={`mx-auto w-full ${room.status === 'waiting' ? 'opacity-60' : ''}`}>
        <div className="grid gap-px border-2 border-navy bg-grid" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
          {Array.from(room.board).map((c, i) => (
            <button key={i} onClick={() => move(i)} disabled={!myTurn || c !== '.'}
              aria-label={`Hàng ${Math.floor(i / N) + 1}, cột ${(i % N) + 1}${c !== '.' ? `, ${c}` : ''}`}
              className={`relative grid aspect-square place-items-center bg-paper ${win.has(i) ? 'win-cell' : ''} ${myTurn && c === '.' ? 'cursor-pointer hover:bg-ink-blue/10' : 'cursor-default'} ${room.last_move === i && !win.has(i) ? 'bg-yellow-100' : ''}`}>
              {c !== '.' && <Mark s={c as Sym} />}
            </button>
          ))}
        </div>
      </div>

      {err && <p role="alert" className="text-center text-ink-red">{err}</p>}

      {room.status === 'finished' && (
        <button onClick={rematch} className="rounded-lg bg-navy px-5 py-4 text-lg font-bold text-white active:scale-[0.98]">Chơi lại</button>
      )}
    </main>
  )
}

function NamePrompt({ onDone }: { onDone: (n: string) => void }) {
  const [n, setN] = useState('')
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-5 px-6 pl-12">
      <h1 className="text-3xl font-extrabold">Bạn được mời chơi Caro</h1>
      <form onSubmit={(e) => { e.preventDefault(); onDone(n.trim() || 'Người chơi') }} className="flex flex-col gap-4">
        <input autoFocus value={n} onChange={(e) => setN(e.target.value)} maxLength={20} placeholder="Tên của bạn"
          className="rounded-lg border-2 border-navy/20 bg-white px-4 py-3 text-lg" />
        <button className="rounded-lg bg-navy px-5 py-4 text-lg font-bold text-white">Vào phòng</button>
      </form>
    </main>
  )
}
