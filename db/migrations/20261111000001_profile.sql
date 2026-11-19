-- Profile photos live in R2 under users/<id>/avatar/. Deleting a member must remove them too.
create or replace function app.member_object_keys(p_user text) returns setof text language sql stable security definer set search_path = '' as
$$ select p.original_key from public.photos p where p.owner_id = p_user
   union all select v.object_key from public.photo_variants v join public.photos p on p.id = v.photo_id where p.owner_id = p_user
   union all select pr.avatar_key from public.profiles pr where pr.id = p_user and pr.avatar_key is not null $$;
