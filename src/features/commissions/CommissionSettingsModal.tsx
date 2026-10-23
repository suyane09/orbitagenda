import { useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { saveCommissionSettings, type CommissionMode, type CommissionSettings } from './api'
export function CommissionSettingsModal({ establishmentId, professionalId, professionalName, settings, onClose, onSaved }: {
 establishmentId: string; professionalId: string; professionalName: string; settings?: CommissionSettings;
 onClose: () => void; onSaved: () => void
}) {
 const [mode, setMode] = useState<CommissionMode>(settings?.mode ?? 'none')
 const [value, setValue] = useState(settings?.mode === 'percentage' ? String(settings.rate_basis_points / 100).replace('.', ',') : settings?.mode === 'fixed' ? (settings.fixed_cents / 100).toFixed(2).replace('.', ',') : '')
 const [error, setError] = useState('')
 const [busy, setBusy] = useState(false)
 async function submit(event: FormEvent) {
  event.preventDefault(); setError('')
  const normalized = value.trim().replace(',', '.')
  const number = mode === 'none' ? 0 : Number(normalized)
  if (mode !== 'none' && (!normalized || !Number.isFinite(number) || number < 0 || (mode === 'percentage' && number > 100) || !/^\d+(?:[.,]\d{1,2})?$/.test(value.trim()))) {
   setError('Informe um valor válido com até duas casas decimais' + (mode === 'percentage' ? ' (0 a 100%).' : '.')); return
  }
  const cents = Math.round(number * 100)
  setBusy(true)
  try {
   await saveCommissionSettings(establishmentId, { professional_id: professionalId, mode,
    rate_basis_points: mode === 'percentage' ? cents : 0, fixed_cents: mode === 'fixed' ? cents : 0 })
   onSaved()
  } catch (err) { setError(describeError(err, 'Não foi possível salvar a comissão.')); setBusy(false) }
 }
 return <Modal title={`Comissão · ${professionalName}`} onClose={onClose} busy={busy} footer={<>
   <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
   <Button type="submit" form="commission-settings-form" variant="accent" loading={busy}>Salvar comissão</Button>
  </>}>
  <form id="commission-settings-form" className="space-y-5" onSubmit={(e) => void submit(e)}>
   {error && <Alert>{error}</Alert>}
   <SelectField label="Modelo de comissão" value={mode} onChange={(e) => { setMode(e.target.value as CommissionMode); setValue('') }} options={[
    { value: 'none', label: 'Sem comissão' }, { value: 'percentage', label: 'Percentual por atendimento' }, { value: 'fixed', label: 'Valor fixo por atendimento' },
   ]} />
   {mode !== 'none' && <TextField label={mode === 'percentage' ? 'Percentual (%)' : 'Valor por atendimento (R$)'} value={value}
    onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={mode === 'percentage' ? 'Ex.: 40' : 'Ex.: 12,00'} />}
   <Alert tone="info">A regra será usada nos próximos atendimentos concluídos. A comissão é calculada sobre os recebimentos registrados; repasses não são automáticos.</Alert>
  </form>
 </Modal>
}
