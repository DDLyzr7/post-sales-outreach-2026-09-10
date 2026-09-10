-- =============================================================================
-- Microsoft sign-in: trusted profile fields, Lyzr-only sign-up, sign-in policy
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Close a privilege escalation in the Phase 1 profile trigger.
--
-- raw_user_meta_data is writable by the signed-in user themselves
-- (supabase.auth.updateUser({ data })), and the old trigger copied is_admin,
-- default_role and warm_sender_address out of it on every metadata update. Any
-- user could make themselves the post-sales lead.
--
-- Now the fields that grant access or choose a sending address come only from
-- raw_app_meta_data, which only the service role can write, and only when the
-- profile is first created. After that, app_user is the source of truth and a
-- metadata update touches nothing but email, name and title.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_user (id, email, full_name, title, is_admin, default_role, warm_sender_address)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'title',
    coalesce((new.raw_app_meta_data ->> 'is_admin')::boolean, false),
    nullif(new.raw_app_meta_data ->> 'default_role', '')::public.assignment_role,
    coalesce(nullif(new.raw_app_meta_data ->> 'warm_sender_address', ''), new.email)
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        title      = coalesce(excluded.title, public.app_user.title),
        updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Who may create an account, as policy data.
-- Microsoft sign-in is also limited to Lyzr's tenant in the Supabase Azure
-- provider settings; this list is the second lock. Password accounts exist only
-- for the fictional sample users.
-- -----------------------------------------------------------------------------
insert into public.app_policy (key, value, description) values
(
  'sign_in_rules',
  jsonb_build_object(
    'microsoft_email_domains', jsonb_build_array('lyzr.com', 'lyzr.ai'),
    'password_email_domains',  jsonb_build_array('example.com')
  ),
  'Email domains allowed to create an account, per sign-in method. Microsoft accounts must also belong to Lyzr''s tenant; password accounts are only the fictional sample users.'
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Before User Created auth hook: refuse any account outside those domains.
-- Enable it in the Supabase dashboard: Authentication -> Hooks -> Before User
-- Created -> Postgres -> public.hook_restrict_sign_up.
--
-- SECURITY DEFINER so supabase_auth_admin can read app_policy through its RLS.
-- Fails closed: if the policy row is missing, nobody new gets in.
-- -----------------------------------------------------------------------------
create or replace function public.hook_restrict_sign_up(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_email    text  := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_domain   text  := split_part(v_email, '@', 2);
  v_provider text  := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email');
  v_rules    jsonb;
  v_allowed  jsonb;
begin
  select value into v_rules from public.app_policy where key = 'sign_in_rules';

  v_allowed := case v_provider
    when 'azure' then v_rules -> 'microsoft_email_domains'
    when 'email' then v_rules -> 'password_email_domains'
    else '[]'::jsonb
  end;

  if v_domain <> '' and coalesce(v_allowed, '[]'::jsonb) ? v_domain then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This account can''t use Post-Sales Outreach. Sign in with your Lyzr Microsoft account.',
      'http_code', 403
    )
  );
end;
$$;

revoke execute on function public.hook_restrict_sign_up(jsonb) from public, anon, authenticated;
grant execute on function public.hook_restrict_sign_up(jsonb) to supabase_auth_admin;
