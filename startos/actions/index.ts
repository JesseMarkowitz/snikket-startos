import { sdk } from '../sdk'
import { configure } from './configure'
import { configureCertificate } from './configureCertificate'
import { createInvite } from './createInvite'
import { dnsRecords } from './dnsRecords'
import { manageSmtp } from './manageSmtp'
import { resetPassword } from './resetPassword'

export const actions = sdk.Actions.of()
  .addAction(configure)
  .addAction(configureCertificate)
  .addAction(createInvite)
  .addAction(resetPassword)
  .addAction(manageSmtp)
  .addAction(dnsRecords)
