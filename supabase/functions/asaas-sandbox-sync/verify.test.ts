import { describe, expect, it } from 'vitest'
import { verifyPaidSandboxCharge } from './verify'

const expected={
  subscriptionId:'sub_good123',customerId:'cus_good123',
  establishmentId:'123e4567-e89b-12d3-a456-426614174000',amountCents:4990,
}
const good={
  id:'pay_paid123',subscription:expected.subscriptionId,
  customer:expected.customerId,
  externalReference:expected.establishmentId,
  status:'RECEIVED',value:49.9,dueDate:'2026-10-25',
}
describe('sandbox payment reconciliation safety',()=>{
  it('accepts an exact, provider-verified paid invoice',()=>{
    expect(verifyPaidSandboxCharge(good,expected)).toEqual({
      paymentId:good.id,status:'RECEIVED',dueDate:'2026-10-25',amountCents:4990,
    })
    expect(verifyPaidSandboxCharge({...good,status:'CONFIRMED'},expected)?.status).toBe('CONFIRMED')
  })
  it('rejects wrong subscription/customer/tenant to prevent cross-company activation',()=>{
    expect(verifyPaidSandboxCharge({...good,subscription:'sub_wrong'},expected)).toBeNull()
    expect(verifyPaidSandboxCharge({...good,customer:'cus_wrong'},expected)).toBeNull()
    expect(verifyPaidSandboxCharge({...good,externalReference:'wrong'},expected)).toBeNull()
  })
  it('rejects awaiting, overdue, cancelled or reversed payments',()=>{
    for(const status of ['PENDING','OVERDUE','REFUNDED','REFUND_REQUESTED','CANCELLED','CHARGEBACK_REQUESTED','AWAITING_RISK_ANALYSIS'])
      expect(verifyPaidSandboxCharge({...good,status},expected)).toBeNull()
  })
  it('rejects wrong, invalid or spoofed amounts',()=>{
    for(const value of [0,49.89,50,49.90005,-1,NaN,Infinity,'49.90'])
      expect(verifyPaidSandboxCharge({...good,value},expected)).toBeNull()
  })
  it('requires a valid ISO due date',()=>{
    for(const dueDate of ['2026-02-30','2026-13-01','2026-2-5','','10/25/2026',null])
      expect(verifyPaidSandboxCharge({...good,dueDate},expected)).toBeNull()
  })
  it('rejects invalid payment IDs',()=>{
    for(const id of ['other123','pay_fake?x=1','','pay_'])
      expect(verifyPaidSandboxCharge({...good,id},expected)).toBeNull()
  })
})
