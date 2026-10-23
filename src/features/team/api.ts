import { supabase } from '@/lib/supabase'

export interface TeamMember {
  id: string
  user_id: string
  role: 'owner' | 'staff'
  is_active: boolean
  name: string
}
export interface TeamInvite {
  id: string
  email: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

export async function loadTeam(estId: string): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
  const [members, invites] = await Promise.all([
    supabase.from('memberships').select('id,user_id,role,is_active').eq('establishment_id',estId)
      .order('created_at',{ascending:true}),
    supabase.from('team_invitations').select('id,email,created_at,expires_at,accepted_at,revoked_at')
      .eq('establishment_id',estId).order('created_at',{ascending:false}).limit(100),
  ])
  if (members.error) throw members.error
  if (invites.error) throw invites.error
  const ids = (members.data ?? []).map(m=>m.user_id as string)
  const profiles = ids.length
    ? await supabase.from('profiles').select('id,full_name').in('id',ids)
    : {data:[],error:null}
  if (profiles.error) throw profiles.error
  const names = new Map((profiles.data ?? []).map(p=>[p.id,p.full_name]))
  return {
    members: (members.data ?? []).map(m=>({
      id:m.id as string,user_id:m.user_id as string,role:m.role as TeamMember['role'],
      is_active:m.is_active as boolean,name:names.get(m.user_id as string) ?? 'Usuário',
    })),
    invites: (invites.data ?? []) as TeamInvite[],
  }
}

export async function inviteMember(estId: string,email: string): Promise<string> {
  const {data,error} = await supabase.rpc('create_team_invitation',{p_establishment_id:estId,p_email:email})
  if (error) throw error
  return data as string
}
export async function cancelInvite(id: string): Promise<void> {
  const {error} = await supabase.rpc('revoke_team_invitation',{p_invitation_id:id})
  if (error) throw error
}
export async function acceptInvite(token: string): Promise<string> {
  const {data,error} = await supabase.rpc('accept_team_invitation',{p_token:token})
  if (error) throw error
  return data as string
}
export async function setMemberActive(estId: string,id: string,active:boolean):Promise<void> {
  const {data,error}=await supabase.from('memberships').update({is_active:active})
    .eq('establishment_id',estId).eq('id',id).eq('role','staff').select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Não foi possível alterar o acesso deste funcionário.')
}
