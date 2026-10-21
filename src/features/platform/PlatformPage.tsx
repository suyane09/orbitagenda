import { useCallback, useEffect, useState } from 'react'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { BUSINESS_TYPES } from '@/lib/validation'

interface Row { id: string; name: string; slug: string; business_type: string; created_at: string }

export default function PlatformPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data, error: e } = await supabase.from('establishments')
      .select('id, name, slug, business_type, created_at').order('created_at', { ascending: false }).limit(200)
    if (e) return setError(describeError(e, 'Não foi possível listar os estabelecimentos.'))
    setRows((data ?? []) as Row[])
  }, [])
  useEffect(() => { void load() }, [load])

  if (error) return <ErrorState title="Plataforma indisponível" message={error} onRetry={() => void load()} />

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 lg:py-12">
      <h1 className="font-display text-[2rem] font-semibold tracking-tight">Plataforma</h1>
      <p className="mt-1.5 text-slate">Estabelecimentos cadastrados no Orbit Agenda.</p>
      <div className="mt-8 rounded-panel border border-hairline bg-surface">
        {!rows ? (
          <div className="flex items-center justify-center gap-3 p-12 text-slate"><Spinner />Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState title="Nenhum estabelecimento ainda">Quando alguém cadastrar uma barbearia ou salão, ela aparece aqui.</EmptyState></div>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-sm text-slate">{r.slug}</p>
                </div>
                <p className="text-sm text-slate">
                  {BUSINESS_TYPES.find((b) => b.value === r.business_type)?.label} desde {new Date(r.created_at).toLocaleDateString('pt-BR')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
