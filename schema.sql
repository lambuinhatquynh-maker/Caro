-- =====================================================================
-- CARO ONLINE - Database + luật chơi chạy ở server (Supabase / Postgres)
-- Dán toàn bộ file này vào Supabase > SQL Editor > Run
-- =====================================================================

create table if not exists public.rooms (
  code        text primary key,
  board       text not null default repeat('.', 225),        -- 15x15, '.' = trống
  x_player    uuid,
  o_player    uuid,
  x_name      text,
  o_name      text,
  turn        text not null default 'X' check (turn in ('X','O')),
  status      text not null default 'waiting' check (status in ('waiting','playing','finished')),
  winner      text check (winner in ('X','O','D')),
  win_line    int[],
  last_move   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Bảo mật: client chỉ được ĐỌC. Mọi thay đổi đi qua các hàm bên dưới (có kiểm tra luật).
alter table public.rooms enable row level security;
drop policy if exists "rooms readable" on public.rooms;
create policy "rooms readable" on public.rooms for select to authenticated using (true);
revoke insert, update, delete on public.rooms from anon, authenticated;

-- Bật realtime cho bảng rooms
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
create or replace function public.create_room(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text; tries int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  p_name := left(coalesce(nullif(trim(p_name), ''), 'Người chơi'), 20);
  delete from rooms where updated_at < now() - interval '2 days';   -- dọn phòng cũ
  loop
    c := '';
    for i in 1..5 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    begin
      insert into rooms(code, x_player, x_name) values (c, uid, p_name);
      return c;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 10 then raise; end if;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
create or replace function public.join_room(p_code text, p_name text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r rooms;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  p_name := left(coalesce(nullif(trim(p_name), ''), 'Người chơi'), 20);
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'room_not_found'; end if;

  if r.x_player = uid or r.o_player = uid then
    return r;                                  -- vào lại sau khi tải lại trang
  elsif r.o_player is null then
    update rooms set o_player = uid, o_name = p_name, status = 'playing', turn = 'X',
           board = repeat('.', 225), winner = null, win_line = null, last_move = null, updated_at = now()
     where code = r.code returning * into r;
    return r;
  else
    raise exception 'room_full';
  end if;
end $$;

-- ---------------------------------------------------------------------
create or replace function public.make_move(p_code text, p_idx int)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r rooms; b text; sym text;
  row_ int; col_ int; dr int; dc int; rr int; cc int;
  line int[]; wl int[]; won boolean := false;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.status <> 'playing' then raise exception 'not_playing'; end if;
  if p_idx is null or p_idx < 0 or p_idx > 224 then raise exception 'bad_move'; end if;

  sym := r.turn;
  if (sym = 'X' and r.x_player is distinct from uid) or (sym = 'O' and r.o_player is distinct from uid) then
    raise exception 'not_your_turn';
  end if;
  if substr(r.board, p_idx + 1, 1) <> '.' then raise exception 'cell_taken'; end if;

  b := overlay(r.board placing sym from p_idx + 1 for 1);
  row_ := p_idx / 15; col_ := p_idx % 15;

  for d in 1..4 loop
    dr := (array[0,1,1,1])[d]; dc := (array[1,0,1,-1])[d];
    line := array[p_idx];
    rr := row_ + dr; cc := col_ + dc;
    while rr between 0 and 14 and cc between 0 and 14 and substr(b, rr * 15 + cc + 1, 1) = sym loop
      line := line || (rr * 15 + cc); rr := rr + dr; cc := cc + dc;
    end loop;
    rr := row_ - dr; cc := col_ - dc;
    while rr between 0 and 14 and cc between 0 and 14 and substr(b, rr * 15 + cc + 1, 1) = sym loop
      line := (rr * 15 + cc) || line; rr := rr - dr; cc := cc - dc;
    end loop;
    if array_length(line, 1) >= 5 then won := true; wl := line; exit; end if;
  end loop;

  update rooms set
    board = b,
    last_move = p_idx,
    status = case when won or position('.' in b) = 0 then 'finished' else 'playing' end,
    winner = case when won then sym when position('.' in b) = 0 then 'D' else null end,
    win_line = wl,
    turn = case when sym = 'X' then 'O' else 'X' end,
    updated_at = now()
  where code = r.code returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Chơi lại: đổi bên X/O cho công bằng. Gọi nhiều lần khi ván đã bắt đầu thì không làm gì thêm.
create or replace function public.rematch(p_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r rooms;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'room_not_found'; end if;
  if uid is distinct from r.x_player and uid is distinct from r.o_player then raise exception 'not_in_room'; end if;
  if r.status <> 'finished' then return r; end if;
  update rooms set
    x_player = o_player, o_player = x_player, x_name = o_name, o_name = x_name,
    board = repeat('.', 225), turn = 'X', status = 'playing',
    winner = null, win_line = null, last_move = null, updated_at = now()
  where code = r.code returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
create or replace function public.leave_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r rooms;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then return; end if;
  if r.x_player = uid then
    if r.o_player is null then
      delete from rooms where code = r.code;
    else
      update rooms set x_player = o_player, x_name = o_name, o_player = null, o_name = null,
             status = 'waiting', board = repeat('.', 225), turn = 'X',
             winner = null, win_line = null, last_move = null, updated_at = now()
       where code = r.code;
    end if;
  elsif r.o_player = uid then
    update rooms set o_player = null, o_name = null, status = 'waiting', board = repeat('.', 225), turn = 'X',
           winner = null, win_line = null, last_move = null, updated_at = now()
     where code = r.code;
  end if;
end $$;

-- Chỉ người đã đăng nhập (kể cả ẩn danh) mới gọi được các hàm
revoke execute on function public.create_room(text), public.join_room(text, text),
  public.make_move(text, int), public.rematch(text), public.leave_room(text) from public, anon;
grant execute on function public.create_room(text), public.join_room(text, text),
  public.make_move(text, int), public.rematch(text), public.leave_room(text) to authenticated;
