-- Orbit Agenda: configuração inicial de comissões, sem repasses automáticos.
-- NÃO executar em produção sem revisão e backup.
create table public.professional_commission_rules (
 id uuid primary key default gen_random_uuid(),
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 professional_id uuid not null,
 mode text not null check (mode in ('none','percentage','fixed')),
 rate_basis_points integer not null default 0 check (rate_basis_points between 0 and 10000),
 fixed_cents integer not null default 0 check (fixed_cents >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (establishment_id, professional_id),
 foreign key (professional_id, establishment_id)
   references public.professionals(id, establishment_id) on delete cascade,
 check (
   (mode='none' and rate_basis_points=0 and fixed_cents=0)
   or (mode='percentage' and fixed_cents=0)
   or (mode='fixed' and rate_basis_points=0)
 )
);
create index professional_commission_rules_est_idx on public.professional_commission_rules(establishment_id);
alter table public.professional_commission_rules enable row level security;
create policy commission_rules_owner_read on public.professional_commission_rules
 for select to authenticated using (private.is_owner(establishment_id));
create policy commission_rules_owner_insert on public.professional_commission_rules
 for insert to authenticated with check (private.is_owner(establishment_id));
create policy commission_rules_owner_update on public.professional_commission_rules
 for update to authenticated using (private.is_owner(establishment_id))
 with check (private.is_owner(establishment_id));
create policy commission_rules_owner_delete on public.professional_commission_rules
 for delete to authenticated using (private.is_owner(establishment_id));
revoke all on public.professional_commission_rules from public, anon, authenticated;
grant select, insert, update, delete on public.professional_commission_rules to authenticated;
-- Configuração apenas. Não altera financial_entries, appointments, caixa ou repasses.
