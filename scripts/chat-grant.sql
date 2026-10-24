-- Run through the owner's already-authorized database connector.
-- The result is a SHORT-LIVED SECRET. Pass it privately to chat-import.ts;
-- never print it into chat, commit it, or upload it to Drive.
with candidate as (
  select replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','') as token
), issued as (
  insert into kitchen.chat_import_grants(token_hash,expires_at)
  select encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '30 minutes' from candidate
  returning expires_at
)
select candidate.token,issued.expires_at from candidate cross join issued;
