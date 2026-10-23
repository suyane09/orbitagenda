import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField, SelectField } from '@/components/ui/Field'
import { supabase } from '@/lib/supabase'

export function AsaasBillingPanel({ establishmentId, planPrice, linked, provisioning, onFinished }: {
  establishmentId: string
  planPrice: number
  linked: boolean
  provisioning: boolean
  onFinished: () => Promise<void>
}) {
  const [taxId,setTaxId]=useState('')
  const [billingType,setBillingType]=useState('PIX')
  const [agreed,setAgreed]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  async function submit(e:FormEvent) {
    e.preventDefault()
    const digits=taxId.replace(/\\D/g,'')
    if(![11,14].includes(digits.length))return setError('Informe um CPF ou CNPJ válido do responsável pelo pagamento.')
    if(!agreed)return setError('Confirme que deseja gerar cobranças recorrentes para este plano.')
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try {
      const {data,error:callError}=await supabase.functions.invoke('asaas-subscribe',{
        body:{establishmentId,cpfCnpj:digits,billingType,confirm:true},
      })
      if(callError) {
        const response = (callError as { context?: Response }).context
        if(response && typeof response.json==='function') {
          const body=await response.json().catch(()=>null)
          throw new Error(typeof body?.message==='string' ? body.message : 'Não foi possível iniciar a assinatura.')
        }
        throw callError
      }
      if(typeof data?.message!=='string')throw Error('Resposta inválida. Consulte o suporte antes de repetir a operação.')
      setTaxId('')
      setNotice(data.message)
      await onFinished()
    }catch(err) {setError(err instanceof Error?err.message:'Não foi possível iniciar a assinatura.')}
    finally{setBusy(false)}
  }
  return <section className="rounded-xl border border-hairline bg-surface p-6">
    <h2 className="font-display text-lg font-semibold">Pagamento recorrente com Asaas</h2>
    {linked?<p className="mt-3 text-sm leading-relaxed text-slate">Sua empresa já possui uma assinatura vinculada ao Asaas. As cobranças e os pagamentos são acompanhados pelo provedor, sem exigir uma nova contratação.</p>:
    provisioning?<p className="mt-3 text-sm leading-relaxed text-slate">Uma contratação foi iniciada e está em conferência. Por segurança, novas tentativas estão bloqueadas para evitar cobranças duplicadas. Entre em contato com o suporte.</p>:
    <><p className="mt-2 text-sm leading-relaxed text-slate">Após a configuração da conta Asaas pelo administrador, você poderá autorizar uma mensalidade de <strong>R$ {(planPrice/100).toFixed(2).replace('.',',')}</strong>. Não informe dados de cartão: nesta etapa estão disponíveis Pix e boleto.</p>
      <form onSubmit={e=>void submit(e)} className="mt-5 space-y-4">
        <TextField label="CPF ou CNPJ do pagador" value={taxId} onChange={e=>setTaxId(e.target.value)} placeholder="Somente números" required inputMode="numeric"/>
        <SelectField label="Forma de pagamento" value={billingType} onChange={e=>setBillingType(e.target.value)}
          options={[{value:'PIX',label:'Pix'},{value:'BOLETO',label:'Boleto bancário'}]}/>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} className="mt-1 size-4 shrink-0" />
          <span>Autorizo a criação de uma assinatura mensal no Asaas para este plano e estou ciente de que, no ambiente de produção, serão geradas cobranças recorrentes.</span>
        </label>
        <p className="text-xs leading-relaxed text-slate">A integração inicia desativada e em homologação até a configuração segura da chave da conta Asaas. Em caso de falha, não repita o envio sem conferir com o suporte.</p>
        {error&&<p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
        {notice&&<p role="status" className="rounded-lg bg-ok-soft p-3 text-sm text-ok">{notice}</p>}
        <Button type="submit" loading={busy} disabled={!agreed||busy}>Solicitar assinatura mensal</Button>
      </form></>}
  </section>
}
