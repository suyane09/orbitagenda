-- OrbitAgenda read-only SQL inventory for comparing restored clone to remote.
-- Outputs counts and MD5 per category; no customer row data is read.
-- A matching fingerprint is only a structural hint, NOT a complete restoration test.
WITH o(category,key,definition) AS (
 SELECT 'column'::text,n.nspname||'.'||c.relname||'.'||a.attname,
   format('%s|%s|%s|%s|%s',format_type(a.atttypid,a.atttypmod),
     a.attnotnull,a.attidentity,a.attgenerated,coalesce(pg_get_expr(ad.adbin,ad.adrelid),''))
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint',n.nspname||'.'||c.relname||'.'||con.conname,
   pg_get_constraintdef(con.oid,true)||'|'||con.convalidated::text
 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'index',i.schemaname||'.'||i.indexname,i.indexdef FROM pg_indexes i WHERE i.schemaname='public'
 UNION ALL
 SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
   p.polcmd::text||'|'||p.polpermissive::text||'|'||
   coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||
   coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
   pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')
 UNION ALL
 SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
   pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'view',n.nspname||'.'||c.relname,
   pg_get_viewdef(c.oid,true)||'|'||array_to_string(coalesce(c.reloptions,array[]::text[]),',')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='v'
 UNION ALL
 SELECT 'rls',n.nspname||'.'||c.relname,
   c.relrowsecurity::text||'|'||c.relforcerowsecurity::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 UNION ALL
 SELECT 'acl',n.nspname||'.'||c.relname,
   coalesce(array_to_string(c.relacl,','),'DEFAULT')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v')
)
SELECT category,count(*)::int AS object_count,
  md5(string_agg(key||'='||definition,E'\n' ORDER BY key)) AS md5_fingerprint
FROM o GROUP BY category ORDER BY category;